# Marketplace SDK Auth Pivot — Design Spec

**Date:** 2026-04-08
**Branch:** `feature/marketplace-sdk-auth`
**Status:** Approved

## Overview

Replace Rift's credential-based authentication and Management API migration engine with the Sitecore Marketplace SDK. This is a full architectural pivot — not an incremental migration.

**Why:** Beta testers won't hand org-level `client_id`/`client_secret` to a third-party server. The Marketplace SDK solves this with Auth0 authorization code flow (users "Sign in with Sitecore") and provides the Content Transfer API for bulk migration.

**Result:** Users never provide credentials. Rift holds only its own app-level client credentials (from App Studio, stored as env vars). Same trust model as every other Marketplace app.

---

## Section 1: Auth Architecture

**Approved in Session 17.**

- **Architecture:** Full-stack app with custom authorization
- **Auth flow:** Auth0 authorization code flow via redirect. User clicks "Sign in with Sitecore" → Auth0 redirect → callback → session established.
- **Client credentials type:** Regular web app (client ID + client secret from App Studio)
- **Server-side:** `experimental_createXMCClient({ getAccessToken })` for server-to-server API calls. Auth0 token automatically refreshed by SDK.
- **Packages:** `@sitecore-marketplace-sdk/client`, `@sitecore-marketplace-sdk/xmc`
- **Auth library:** `@auth0/nextjs-auth0` or `@auth0/auth0-react` (decided during implementation based on SDK starter kit patterns)
- **App ID:** `966f3479-ea3a-4afb-9e...` (Mayo Foundation org)
- **Env vars:** `MARKETPLACE_APP_ID`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_ISSUER_BASE_URL`

---

## Section 2: Content Transfer / Migration Engine

### Current engine (replaced entirely)

The current `migrate/route.ts` (~1,200 lines) uses Management API `serialize` + `executeSerializationCommands` with client-side diffing that builds 9 command types (CREATE, UPDATE, MOVE, RENAME, RECYCLE, CHANGE_TEMPLATE, ADD_VERSION, REMOVE_VERSION, RESET_FIELD). All of this is removed.

### New engine: Content Transfer API

The SDK's `@sitecore-marketplace-sdk/xmc` package exposes 8 content transfer operations. For cross-environment migration, a single path transfer follows this lifecycle:

**Phase 1 — Export from source** (source Context ID):
1. `xmc.contentTransfer.createContentTransfer` — initiate with itemPath, scope, mergeStrategy
2. `xmc.contentTransfer.getContentTransferStatus` — poll until chunks ready
3. `xmc.contentTransfer.getChunk` — download chunk blobs (Protobuf/.raif format)

**Phase 2 — Import to target** (target Context ID):
4. `xmc.contentTransfer.saveChunk` — upload each chunk
5. `xmc.contentTransfer.completeChunkSetTransfer` — server assembles .raif file
6. `xmc.contentTransfer.consumeFile` — apply .raif to target database
7. `xmc.contentTransfer.getBlobState` — poll until consume completes

**Phase 3 — Cleanup:**
8. `xmc.contentTransfer.deleteContentTransfer` — clean up source transfer

### Design decisions

- **Use the Content Transfer API as designed.** No custom command building, no client-side diffing, no Management API fallback for MOVE/RENAME/RECYCLE. The SDK handles merge strategy server-side.
- **Parallel paths:** Each selected path gets its own transfer lifecycle, run in parallel (same pattern as current engine).
- **Progress reporting:** Chunk-level (downloading chunk 3/7, uploading, consuming) rather than item-level. Coarser than current but accurate.
- **Scopes:** Pass through to `createContentTransfer`. During implementation, test each scope (SingleItem, ItemAndChildren, ItemAndDescendants). If the API doesn't support a scope, remove it from the UI dropdown. ChildrenOnly/DescendantsOnly (Rift-custom scopes that filter out the root item) are dropped unless trivially implementable on top of the API's native scopes.
- **MOVE/RENAME/RECYCLE:** Not implemented. Can be added later via Management API GraphQL if needed. Don't design around features we're probably not keeping.

---

## Section 3: Environment Discovery & Selection UX

### Current approach (replaced)

Deploy API (`deploy.sitecorecloud.io`) with org-level credentials → project listing → environment listing → credential prompt per environment.

### New approach

`client.query("application.context")` returns `resourceAccess` — an array of every environment where Rift is installed:

```json
{
  "resourceAccess": [
    {
      "resourceId": "xmcloud",
      "tenantId": "d93a37cd-...",
      "tenantDisplayName": "Production",
      "context": {
        "preview": "<PREVIEW_CONTEXT_ID>",
        "live": "<LIVE_CONTEXT_ID>"
      }
    }
  ]
}
```

### UX

- **Source environment dropdown** + **Target environment dropdown**, both populated from `resourceAccess`. No credentials, no connection step, no "Test Connection" button.
- Environments identified by `tenantDisplayName` (display) and `context.preview` (API calls). Preview Context ID used because migration needs access to all content including drafts.
- **Sites dropdown** populated via `xmc.xmapp.listSites` using selected environment's Context ID.
- **Setup wizard** collapses from multi-step credential flow to: pick source env → pick site → pick target env.
- If only one environment in `resourceAccess`: show message — "Install Rift in additional environments to enable migration."

---

## Section 4: What Gets Removed

### Files deleted entirely (~1,800 lines)

| File | Purpose |
|------|---------|
| `src/lib/rift/credential-store.ts` | Azure Table Storage encrypted credential CRUD |
| `src/lib/rift/sitecore-auth.ts` | `client_credentials` grant token exchange |
| `src/lib/rift/session-store.ts` | Server-side session table + Key Vault encryption |
| `src/lib/rift/session-middleware.ts` | Cookie-based session extraction + TTL |
| `src/lib/rift/storage.ts` | localStorage wrapper for environments/presets |
| `src/app/api/rift/auth/route.ts` | Credential auth + session creation |
| `src/app/api/rift/credentials/route.ts` | Store/check/delete credentials |
| `src/app/api/rift/projects/route.ts` | Deploy API project listing |
| `src/app/api/rift/environments/route.ts` | Deploy API env listing |
| `src/app/api/rift/migrate/route.ts` | Entire 1,200-line migration engine |

### Files heavily rewritten (~2,500 lines touched)

| File | What changes |
|------|-------------|
| `src/components/rift/Rift.tsx` | SDK initialization, app context, auth provider wrapping |
| `src/components/rift/RiftMigrate.tsx` | Content Transfer API workflow; remove credential/session state |
| `src/components/rift/RiftEnvironments.tsx` | Remove credential forms; show `resourceAccess` environments |
| `src/components/rift/RiftSetupWizard.tsx` | Collapse to env+site selection |
| `src/components/rift/RiftWelcome.tsx` | Remove credential status warnings |
| `src/components/rift/RiftPresets.tsx` | Remove credential dependency; presets store Context IDs |
| `src/components/rift/RiftContentTree.tsx` | SDK GraphQL mutations instead of fetch + cookies |
| `src/lib/rift/api-client.ts` | SDK query/mutation calls instead of fetch wrappers |
| `src/lib/rift/types.ts` | Remove credential/session types; add Context ID types |

### Files mostly unchanged

| File | Why |
|------|-----|
| `src/components/rift/RiftConfirmDialog.tsx` | Migration confirmation UX |
| `src/components/rift/RiftSelectionPanel.tsx` | Path selection, scope dropdowns |
| `src/components/rift/RiftHistory.tsx` | Migration history (localStorage) |
| `src/components/rift/RiftProgressOverlay.tsx` | Progress display (adapts to chunk-level) |
| `src/lib/rift/api-security.ts` | CSRF middleware |
| `src/lib/rift/logger.ts` | Structured logging |

### Azure infrastructure removed

- Table Storage tables: `credentials`, `sessions`
- Key Vault key: `rift-session-key`
- Storage Account `striftprod` — can be deleted entirely
- Key Vault `kv-rift-prod` — can be deleted entirely

### Impact estimate

- ~10 files deleted (~1,800 lines)
- ~9 files heavily rewritten (~2,500 lines touched)
- ~60-70% of server-side code removed or replaced
- ~40% of client-side code rewritten
- Net: significantly smaller codebase, zero custom infrastructure

---

## Section 5: Migration Path

### Approach: Clean break

No feature flags, no incremental migration. The Marketplace SDK fundamentally changes how the app loads (iframe in SitecoreAI), authenticates (Auth0), and transfers content (Content Transfer API). There's no meaningful halfway state.

All work on `feature/marketplace-sdk-auth`. When ready, merge to `main` as a full replacement. Nobody is using the current app except the developer, so no backwards compatibility concerns.

### Build order

1. **SDK scaffolding + Auth0 integration** — App loading in Sitecore extension point with custom auth. `experimental_createXMCClient` on server side. Env vars for App ID + client credentials.
2. **Environment discovery + site selection** — `application.context` → `resourceAccess` → source/target dropdowns. Sites via `xmc.xmapp.listSites`.
3. **Content tree browsing** — Replace `/api/rift/tree`, `/api/rift/sites`, `/api/rift/item-fields` with SDK GraphQL mutations. Tree component stays mostly the same.
4. **Content Transfer migration** — 8-step transfer workflow. Polling loops, chunk relay, progress reporting, error handling.
5. **UI cleanup** — Remove credential UI, simplify wizard, update presets, remove dead components.
6. **Infrastructure teardown** — Delete Azure resources. Update deploy workflow. Update compliance docs.

### Presets

- Store `tenantId` + `tenantDisplayName` + selected paths + scope per path
- On load: match preset's `tenantId` against `resourceAccess` to resolve Context IDs
- If environment no longer in `resourceAccess`, show warning
- Old presets incompatible — ignored/cleared on first load

### Deployment

- Deployment URL: `app.riftapp.dev` (no localhost, no custom DNS)
- Manual deploy workflow (`deploy-staging.yml`) exists for testing
- Final cutover: merge to `main`, normal pipeline deploys, update Marketplace app config
- Old standalone URL stops working (app requires Sitecore iframe context)

---

## Section 6: Risk Assessment

### 1. Experimental server SDK (`experimental_createXMCClient`)

**Severity: Medium-High | Likelihood: Medium**

Server-side XMC client is explicitly "experimental." Could have breaking changes.

**Mitigation:** Thin service wrapper around all server-side SDK calls. If the experimental API breaks, fall back to raw HTTP with the same Auth0 token — the experimental tooling is convenience (token attachment + headers), not irreplaceable logic.

### 2. Content Transfer API completeness

**Severity: Medium | Likelihood: Medium**

Betting the migration engine on 8 SDK operations we haven't exercised yet. Unknowns: supported scopes, merge strategy behavior, error reporting from `consumeFile`, chunk sizes/limits.

**Mitigation:** Build the Content Transfer migration step early. If a blocker surfaces, `xmc.authoring.graphql` gives full Management API access through the SDK — we can rewrite the engine against GraphQL instead.

### 3. Iframe-only operation

**Severity: Low | Likelihood: Certain**

App only works inside Sitecore Cloud Portal iframe after pivot. No standalone testing without Sitecore context.

**Mitigation:** This is how Marketplace apps work. Manual deploy workflow enables testing against the real Sitecore host. Mock SDK client for automated tests.

### 4. SDK version 0.4 (pre-1.0)

**Severity: Low-Medium | Likelihood: Low**

APIs could change between minor versions.

**Mitigation:** Pin exact versions in `package.json`. SDK is open-source — track changes on GitHub. Sitecore is pushing Marketplace adoption so stability is incentivized.

### 5. Multi-org session handling

**Severity: Low | Likelihood: Low**

Apps in multiple orgs need session invalidation per org to avoid 401s.

**Mitigation:** Rift is single-org currently. Implement per docs but not a launch blocker.

### Summary

| Risk | Severity | Likelihood | Escape hatch |
|------|----------|-----------|--------------|
| Experimental server SDK | Medium-High | Medium | Thin wrapper; raw HTTP fallback |
| Content Transfer API unknowns | Medium | Medium | Test early; GraphQL via SDK |
| Iframe-only operation | Low | Certain | By design; manual deploy for testing |
| SDK pre-1.0 | Low-Medium | Low | Pin versions; track GitHub |
| Multi-org sessions | Low | Low | Implement per docs |

**Overall:** Biggest risk is Content Transfer API not behaving as expected for cross-env bulk migration. GraphQL via SDK is the escape hatch. Everything else is manageable.
