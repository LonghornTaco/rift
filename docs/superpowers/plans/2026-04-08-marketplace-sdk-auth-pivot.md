# Marketplace SDK Auth Pivot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Rift's credential-based auth and Management API migration engine with Marketplace SDK custom authorization (Auth0) + Content Transfer API.

**Architecture:** Full-stack Marketplace app with custom Auth0 authorization. Client-side SDK (`@sitecore-marketplace-sdk/client` + `xmc`) handles iframe communication and API calls. Server-side `experimental_createXMCClient` handles server-to-server calls for Content Transfer API. Environment discovery via `application.context` → `resourceAccess`. Migration via 8-step Content Transfer API lifecycle.

**Tech Stack:** Next.js 15, React 19, TypeScript, `@sitecore-marketplace-sdk/client`, `@sitecore-marketplace-sdk/xmc`, `@auth0/auth0-react` (SPA type — SDK starter kit default), Vitest

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/lib/rift/marketplace-client.ts` | Marketplace SDK initialization hook (`useMarketplaceClient`), app context state, XMC module setup |
| `src/lib/rift/auth-provider.tsx` | Auth0 provider wrapper + login/logout helpers |
| `src/lib/rift/content-transfer.ts` | Content Transfer API service — 8-step lifecycle for a single path, polling helpers |
| `src/app/api/rift/transfer/route.ts` | Server-side Content Transfer API route — chunk relay between source and target environments |
| `src/__tests__/lib/rift/content-transfer.test.ts` | Tests for content transfer polling/lifecycle logic |

### Modified files

| File | Changes |
|------|---------|
| `src/lib/rift/types.ts` | Remove `ConnectionStatus`, credential-related fields. Add `RiftContext` (app context + environments from SDK), update `RiftEnvironment`, `RiftPreset` |
| `src/lib/rift/api-client.ts` | Gut and rebuild — SDK query/mutation wrappers for tree, sites, item-fields. Remove all fetch-to-local-API-route functions. Remove credential/project/environment API functions |
| `src/components/rift/Rift.tsx` | Wrap in SDK + Auth0 providers. Replace localStorage environment check with SDK app context. Simplify view management |
| `src/components/rift/RiftMigrate.tsx` | Replace session/credential state with SDK context. Replace migration fetch with Content Transfer API calls. Simplify env/site selection to dropdown from `resourceAccess` |
| `src/components/rift/RiftEnvironments.tsx` | Read-only list of environments from `resourceAccess`. Remove all credential CRUD |
| `src/components/rift/RiftSetupWizard.tsx` | Collapse to source env → site → target env. No credentials |
| `src/components/rift/RiftWelcome.tsx` | Remove credential warnings. Simplify preset display |
| `src/components/rift/RiftPresets.tsx` | Store `tenantId` instead of `envId`. Remove credential dependency checks |
| `src/components/rift/RiftContentTree.tsx` | No structural changes — receives data from parent as before |
| `src/components/rift/RiftProgressOverlay.tsx` | Adapt to chunk-level progress messages instead of item-level |
| `src/app/rift/page.tsx` | No change needed — still renders `<Rift />` |
| `src/app/layout.tsx` | No change needed |
| `package.json` | Add SDK packages, remove Azure SDK packages |
| `next.config.ts` | Remove `@azure/*` from `serverExternalPackages`. Update CSP for Auth0 domains |
| `.env.local` | Replace Azure vars with `MARKETPLACE_APP_ID`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_ISSUER_BASE_URL` |

### Deleted files

| File | Reason |
|------|--------|
| `src/lib/rift/credential-store.ts` | No credentials |
| `src/lib/rift/sitecore-auth.ts` | Auth0 replaces client_credentials |
| `src/lib/rift/session-store.ts` | No server sessions |
| `src/lib/rift/session-middleware.ts` | No cookie sessions |
| `src/lib/rift/storage.ts` | Replaced by SDK context + simplified localStorage |
| `src/app/api/rift/auth/route.ts` | Auth0 handles auth |
| `src/app/api/rift/credentials/route.ts` | No credentials |
| `src/app/api/rift/projects/route.ts` | `resourceAccess` replaces Deploy API |
| `src/app/api/rift/environments/route.ts` | `resourceAccess` replaces Deploy API |
| `src/app/api/rift/migrate/route.ts` | Content Transfer API replaces Management API |
| `src/app/api/rift/tree/route.ts` | SDK GraphQL replaces server proxy |
| `src/app/api/rift/sites/route.ts` | SDK listSites replaces server proxy |
| `src/app/api/rift/item-fields/route.ts` | SDK GraphQL replaces server proxy |
| `src/__tests__/lib/rift/session-store.test.ts` | No sessions |
| `src/__tests__/lib/rift/credential-store.test.ts` | No credentials |
| `src/__tests__/lib/rift/storage.test.ts` | storage.ts deleted |

---

## Task 1: Install SDK Packages and Update Config

**Files:**
- Modify: `package.json`
- Modify: `next.config.ts`
- Modify: `.env.local`

- [ ] **Step 1: Install Marketplace SDK and Auth0 packages**

```bash
cd C:/projects/longhorntaco/rift
npm install @sitecore-marketplace-sdk/client @sitecore-marketplace-sdk/xmc @auth0/auth0-react
```

- [ ] **Step 2: Remove Azure SDK packages**

```bash
npm uninstall @azure/data-tables @azure/identity @azure/keyvault-keys
```

- [ ] **Step 3: Update `next.config.ts`**

Remove `@azure/*` from `serverExternalPackages` (the array can be emptied or removed). Update CSP `connect-src` to allow Auth0 and Sitecore API domains:

```ts
// In the CSP header value, replace:
//   connect-src 'self'
// with:
//   connect-src 'self' https://*.sitecorecloud.io https://*.auth0.com https://*.sitecore.cloud
```

Remove `X-Frame-Options: DENY` header — it conflicts with `frame-ancestors` in CSP and prevents iframe embedding. The CSP `frame-ancestors https://*.sitecorecloud.io` is the correct mechanism.

- [ ] **Step 4: Update `.env.local`**

Replace the Azure env vars with Marketplace/Auth0 vars:

```env
MARKETPLACE_APP_ID=966f3479-ea3a-4afb-9e...
AUTH0_CLIENT_ID=<from App Studio client credentials>
AUTH0_CLIENT_SECRET=<from App Studio client credentials>
AUTH0_ISSUER_BASE_URL=https://auth.sitecorecloud.io
```

Note: The actual values come from App Studio → Client Credentials. The `AUTH0_ISSUER_BASE_URL` is Sitecore's Auth0 tenant.

- [ ] **Step 5: Verify build still passes**

```bash
npm run build
```

Expected: Build succeeds. Azure SDK imports in deleted files will cause errors — that's expected and gets resolved in Task 2.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.ts .env.local
git commit -m "chore: install Marketplace SDK, remove Azure SDK packages, update config"
```

---

## Task 2: Delete Old Server-Side Infrastructure

**Files:**
- Delete: `src/lib/rift/credential-store.ts`
- Delete: `src/lib/rift/sitecore-auth.ts`
- Delete: `src/lib/rift/session-store.ts`
- Delete: `src/lib/rift/session-middleware.ts`
- Delete: `src/lib/rift/storage.ts`
- Delete: `src/app/api/rift/auth/route.ts`
- Delete: `src/app/api/rift/credentials/route.ts`
- Delete: `src/app/api/rift/projects/route.ts`
- Delete: `src/app/api/rift/environments/route.ts`
- Delete: `src/app/api/rift/migrate/route.ts`
- Delete: `src/app/api/rift/tree/route.ts`
- Delete: `src/app/api/rift/sites/route.ts`
- Delete: `src/app/api/rift/item-fields/route.ts`
- Delete: `src/__tests__/lib/rift/session-store.test.ts`
- Delete: `src/__tests__/lib/rift/credential-store.test.ts`
- Delete: `src/__tests__/lib/rift/storage.test.ts`

- [ ] **Step 1: Delete all server-side auth, credential, and session files**

```bash
cd C:/projects/longhorntaco/rift
rm src/lib/rift/credential-store.ts
rm src/lib/rift/sitecore-auth.ts
rm src/lib/rift/session-store.ts
rm src/lib/rift/session-middleware.ts
rm src/lib/rift/storage.ts
```

- [ ] **Step 2: Delete all API routes**

```bash
rm -rf src/app/api/rift/auth
rm -rf src/app/api/rift/credentials
rm -rf src/app/api/rift/projects
rm -rf src/app/api/rift/environments
rm -rf src/app/api/rift/migrate
rm -rf src/app/api/rift/tree
rm -rf src/app/api/rift/sites
rm -rf src/app/api/rift/item-fields
```

- [ ] **Step 3: Delete old tests**

```bash
rm src/__tests__/lib/rift/session-store.test.ts
rm src/__tests__/lib/rift/credential-store.test.ts
rm src/__tests__/lib/rift/storage.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete old auth, credential, session, and API route infrastructure"
```

Note: The app will NOT build at this point — components still import deleted modules. That's fine. We're clearing the ground before rebuilding.

---

## Task 3: Rewrite Types

**Files:**
- Modify: `src/lib/rift/types.ts`

- [ ] **Step 1: Rewrite types.ts**

Replace the entire file with the new type definitions:

```ts
// --- Environment types (from Marketplace SDK application.context) ---

export interface RiftEnvironment {
  tenantId: string;
  tenantDisplayName: string;
  contextId: string; // preview Context ID — used for all API calls
}

// --- Migration types ---

export interface MigrationPath {
  itemPath: string;
  itemId: string;
  scope: 'SingleItem' | 'ItemAndChildren' | 'ItemAndDescendants';
}

export interface RiftPreset {
  id: string;
  name: string;
  paths: MigrationPath[];
  lastUsed: string;
  sourceTenantId?: string;
  targetTenantId?: string;
  siteRootPath?: string;
}

export interface TreeNode {
  itemId: string;
  name: string;
  path: string;
  hasChildren: boolean;
  templateName: string;
  children?: TreeNode[];
  isExpanded?: boolean;
}

export interface SiteInfo {
  name: string;
  rootPath: string;
}

export type MigrationLogLevel = 'DEBUG' | 'INFORMATION' | 'WARNING' | 'ERROR';

export interface RiftSettings {
  parallelPaths: boolean;
}

export const DEFAULT_SETTINGS: RiftSettings = {
  parallelPaths: true,
};

export interface MigrationHistoryEntry {
  id: string;
  date: string;
  sourceEnvName: string;
  targetEnvName: string;
  paths: { itemPath: string; scope: string }[];
  elapsedMs: number;
  status: 'success' | 'partial' | 'failed';
}

export type RiftView = 'migrate' | 'presets' | 'history';

// --- Content Transfer types ---

export type TransferPhase =
  | 'creating'
  | 'exporting'
  | 'downloading'
  | 'uploading'
  | 'assembling'
  | 'consuming'
  | 'cleanup'
  | 'complete'
  | 'error';

export interface TransferProgress {
  itemPath: string;
  phase: TransferPhase;
  chunksTotal?: number;
  chunksComplete?: number;
  error?: string;
}
```

Key changes from current types:
- `RiftEnvironment`: `tenantId`/`tenantDisplayName`/`contextId` replaces `id`/`name`/`cmUrl`/`allowWrite`/`hasStoredCredentials`
- `MigrationPath.scope`: Removed `ChildrenOnly`/`DescendantsOnly` (Rift-custom, not supported by Content Transfer API)
- `RiftPreset`: `sourceTenantId`/`targetTenantId` replaces `sourceEnvId`/`targetEnvId`
- `RiftSettings`: Removed `batchSize`/`logLevel` (Content Transfer API manages these server-side)
- `MigrationHistoryEntry`: Simplified — removed `totalItems`/`succeeded`/`failed`/`created`/`updated` (chunk-level progress, not item-level)
- `RiftView`: Removed `'environments'` and `'display'` (environments are read-only from SDK context, display settings collapsed)
- `ConnectionStatus`: Deleted (no connection testing)
- Added `TransferPhase`/`TransferProgress` for Content Transfer lifecycle

- [ ] **Step 2: Commit**

```bash
git add src/lib/rift/types.ts
git commit -m "refactor: rewrite types for Marketplace SDK architecture"
```

---

## Task 4: Marketplace SDK Client Initialization

**Files:**
- Create: `src/lib/rift/marketplace-client.ts`
- Create: `src/lib/rift/auth-provider.tsx`

- [ ] **Step 1: Create the Marketplace SDK client hook**

Create `src/lib/rift/marketplace-client.ts`:

```ts
'use client';

import { useState, useEffect, useRef } from 'react';
import { createMarketplaceClient, type ClientSDK, type ApplicationContext } from '@sitecore-marketplace-sdk/client';
import { XMC } from '@sitecore-marketplace-sdk/xmc';
import type { RiftEnvironment } from './types';

interface MarketplaceState {
  client: ClientSDK | null;
  appContext: ApplicationContext | null;
  environments: RiftEnvironment[];
  isInitialized: boolean;
  error: string | null;
}

export function useMarketplaceClient(): MarketplaceState {
  const [state, setState] = useState<MarketplaceState>({
    client: null,
    appContext: null,
    environments: [],
    isInitialized: false,
    error: null,
  });
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    async function init() {
      try {
        const client = await createMarketplaceClient({
          target: window.parent,
          modules: [XMC],
        });

        const contextResult = await client.query('application.context');
        const appContext = contextResult.data;

        const environments: RiftEnvironment[] = (appContext.resourceAccess ?? [])
          .filter((r: { resourceId: string }) => r.resourceId === 'xmcloud')
          .map((r: { tenantId: string; tenantDisplayName: string; context: { preview: string } }) => ({
            tenantId: r.tenantId,
            tenantDisplayName: r.tenantDisplayName || r.tenantId,
            contextId: r.context.preview,
          }));

        setState({
          client,
          appContext,
          environments,
          isInitialized: true,
          error: null,
        });
      } catch (err) {
        setState(prev => ({
          ...prev,
          error: err instanceof Error ? err.message : 'Failed to initialize Marketplace SDK',
          isInitialized: true,
        }));
      }
    }

    init();
  }, []);

  return state;
}
```

- [ ] **Step 2: Create Auth0 provider**

Create `src/lib/rift/auth-provider.tsx`:

```tsx
'use client';

import { Auth0Provider } from '@auth0/auth0-react';
import type { ReactNode } from 'react';

interface AuthProviderProps {
  children: ReactNode;
}

export function RiftAuthProvider({ children }: AuthProviderProps) {
  const clientId = process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID;
  const domain = process.env.NEXT_PUBLIC_AUTH0_DOMAIN;

  if (!clientId || !domain) {
    return <div>Auth0 configuration missing. Set NEXT_PUBLIC_AUTH0_CLIENT_ID and NEXT_PUBLIC_AUTH0_DOMAIN.</div>;
  }

  return (
    <Auth0Provider
      domain={domain}
      clientId={clientId}
      authorizationParams={{
        redirect_uri: typeof window !== 'undefined' ? window.location.origin : '',
      }}
    >
      {children}
    </Auth0Provider>
  );
}
```

Note: The exact Auth0 configuration (domain, audience, scopes) will need adjustment during implementation based on the Sitecore Marketplace custom auth flow. The SDK starter kit's auth setup is the reference — consult `https://github.com/Sitecore/marketplace-starter` for the exact pattern. The `@auth0/auth0-react` package with SPA credentials is the SDK starter kit default, but the Marketplace SDK docs note that `@auth0/nextjs-auth0` with "Regular web app" credentials is also valid. Adapt based on what works during integration.

- [ ] **Step 3: Update `.env.local` with public Auth0 vars**

Add the client-side Auth0 vars (these are safe to expose — SPA client IDs are public):

```env
NEXT_PUBLIC_AUTH0_CLIENT_ID=<from App Studio>
NEXT_PUBLIC_AUTH0_DOMAIN=auth.sitecorecloud.io
MARKETPLACE_APP_ID=966f3479-ea3a-4afb-9e...
AUTH0_CLIENT_SECRET=<from App Studio - server-side only>
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/rift/marketplace-client.ts src/lib/rift/auth-provider.tsx .env.local
git commit -m "feat: add Marketplace SDK client initialization and Auth0 provider"
```

---

## Task 5: Rewrite API Client for SDK

**Files:**
- Modify: `src/lib/rift/api-client.ts`

- [ ] **Step 1: Write test for SDK-based tree fetch**

Create `src/__tests__/lib/rift/api-client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchTreeChildren, fetchSites } from '@/lib/rift/api-client';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';

function mockClient(graphqlResponse: unknown): ClientSDK {
  return {
    mutate: vi.fn().mockResolvedValue({ data: { data: graphqlResponse } }),
    query: vi.fn().mockResolvedValue({ data: { data: graphqlResponse } }),
  } as unknown as ClientSDK;
}

describe('fetchTreeChildren', () => {
  it('returns parsed tree nodes from GraphQL response', async () => {
    const client = mockClient({
      item: {
        children: {
          nodes: [
            { itemId: 'id1', name: 'Home', path: '/sitecore/content/Home', hasChildren: true, template: { name: 'Page' } },
            { itemId: 'id2', name: 'About', path: '/sitecore/content/About', hasChildren: false, template: { name: 'Page' } },
          ],
        },
      },
    });

    const result = await fetchTreeChildren(client, 'ctx-123', '/sitecore/content');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      itemId: 'id1',
      name: 'Home',
      path: '/sitecore/content/Home',
      hasChildren: true,
      templateName: 'Page',
    });
  });
});

describe('fetchSites', () => {
  it('returns sites from listSites query', async () => {
    const client = mockClient([
      { id: 's1', name: 'MySite', rootItem: { path: '/sitecore/content/MySite' }, collection: { name: 'Col1' } },
    ]);

    const result = await fetchSites(client, 'ctx-123');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('MySite');
    expect(result[0].rootPath).toBe('/sitecore/content/MySite');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/__tests__/lib/rift/api-client.test.ts
```

Expected: FAIL — `fetchTreeChildren` and `fetchSites` have wrong signatures (don't accept client/contextId yet).

- [ ] **Step 3: Rewrite api-client.ts**

Replace `src/lib/rift/api-client.ts` entirely:

```ts
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import type { TreeNode, SiteInfo } from './types';

/**
 * Fetch children of a tree node via Authoring GraphQL API.
 */
export async function fetchTreeChildren(
  client: ClientSDK,
  contextId: string,
  parentPath: string
): Promise<TreeNode[]> {
  const query = {
    query: `query GetChildren($path: String!) {
      item(where: { path: $path }) {
        children { nodes { itemId name path hasChildren template { name } } }
      }
    }`,
    variables: { path: parentPath },
  };

  const response = await client.mutate('xmc.authoring.graphql', {
    params: { query: { sitecoreContextId: contextId }, body: query },
  });

  const nodes = response.data?.data?.item?.children?.nodes ?? [];
  return nodes.map((n: { itemId: string; name: string; path: string; hasChildren: boolean; template: { name: string } }) => ({
    itemId: n.itemId,
    name: n.name,
    path: n.path,
    hasChildren: n.hasChildren,
    templateName: n.template?.name ?? '',
  }));
}

/**
 * Fetch sites via XM Apps Sites REST API.
 */
export async function fetchSites(
  client: ClientSDK,
  contextId: string
): Promise<(SiteInfo & { collection: string })[]> {
  const response = await client.query('xmc.xmapp.listSites', {
    params: { query: { sitecoreContextId: contextId } },
  });

  const sites = response.data?.data ?? [];
  return sites.map((s: { name: string; rootItem?: { path: string }; collection?: { name: string } }) => ({
    name: s.name,
    rootPath: s.rootItem?.path ?? '',
    collection: s.collection?.name ?? '',
  }));
}

/**
 * Fetch item fields via Authoring GraphQL API.
 */
export async function fetchItemFields(
  client: ClientSDK,
  contextId: string,
  itemPath: string
): Promise<{ itemId: string; name: string; path: string; templateId: string; templateName: string; fields: Record<string, string> }> {
  const query = {
    query: `query GetItemFields($path: String!) {
      item(where: { path: $path }) {
        itemId name path
        template { templateId: itemId name }
        fields(ownFields: true, excludeStandardFields: true) {
          nodes { name value }
        }
      }
    }`,
    variables: { path: itemPath },
  };

  const response = await client.mutate('xmc.authoring.graphql', {
    params: { query: { sitecoreContextId: contextId }, body: query },
  });

  const item = response.data?.data?.item;
  if (!item) throw new Error(`Item not found: ${itemPath}`);

  const fields: Record<string, string> = {};
  for (const f of item.fields?.nodes ?? []) {
    fields[f.name] = f.value;
  }

  return {
    itemId: item.itemId,
    name: item.name,
    path: item.path,
    templateId: item.template?.templateId ?? '',
    templateName: item.template?.name ?? '',
    fields,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/__tests__/lib/rift/api-client.test.ts
```

Expected: Tests pass. Adjust mock structure if SDK response wrapping differs.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/api-client.ts src/__tests__/lib/rift/api-client.test.ts
git commit -m "feat: rewrite api-client for Marketplace SDK queries and mutations"
```

---

## Task 6: Content Transfer Service

**Files:**
- Create: `src/lib/rift/content-transfer.ts`
- Create: `src/__tests__/lib/rift/content-transfer.test.ts`

- [ ] **Step 1: Write test for transfer lifecycle**

Create `src/__tests__/lib/rift/content-transfer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { transferPath } from '@/lib/rift/content-transfer';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';

function createMockClient() {
  const mutate = vi.fn();
  const query = vi.fn();
  return { client: { mutate, query } as unknown as ClientSDK, mutate, query };
}

describe('transferPath', () => {
  it('executes the full 8-step lifecycle', async () => {
    const { client, mutate, query } = createMockClient();

    // createContentTransfer
    mutate.mockResolvedValueOnce({ data: { data: { operationId: 'op-1' } } });
    // getContentTransferStatus — ready with 1 chunk
    query.mockResolvedValueOnce({ data: { data: { status: 'Ready', totalChunks: 1 } } });
    // getChunk — returns blob data
    query.mockResolvedValueOnce({ data: { data: new Blob(['chunk-data']) } });
    // saveChunk
    mutate.mockResolvedValueOnce({ data: { data: { success: true } } });
    // completeChunkSetTransfer
    mutate.mockResolvedValueOnce({ data: { data: { fileId: 'file-1' } } });
    // consumeFile
    query.mockResolvedValueOnce({ data: { data: { blobId: 'blob-1' } } });
    // getBlobState — complete
    query.mockResolvedValueOnce({ data: { data: { state: 'Complete' } } });
    // deleteContentTransfer
    mutate.mockResolvedValueOnce({ data: { data: { success: true } } });

    const progressUpdates: string[] = [];
    const onProgress = (phase: string) => progressUpdates.push(phase);

    await transferPath(client, {
      sourceContextId: 'src-ctx',
      targetContextId: 'tgt-ctx',
      itemPath: '/sitecore/content/Home',
      scope: 'SingleItem',
      onProgress,
    });

    expect(mutate).toHaveBeenCalledTimes(4); // create, save, complete, delete
    expect(query).toHaveBeenCalledTimes(4); // status, getChunk, consume, blobState
    expect(progressUpdates).toContain('creating');
    expect(progressUpdates).toContain('complete');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/__tests__/lib/rift/content-transfer.test.ts
```

Expected: FAIL — `transferPath` doesn't exist yet.

- [ ] **Step 3: Implement content-transfer.ts**

Create `src/lib/rift/content-transfer.ts`:

```ts
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import type { TransferPhase } from './types';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes max

interface TransferOptions {
  sourceContextId: string;
  targetContextId: string;
  itemPath: string;
  scope: string;
  mergeStrategy?: string;
  onProgress?: (phase: TransferPhase, detail?: string) => void;
  signal?: AbortSignal;
}

/**
 * Execute the full Content Transfer API lifecycle for a single path.
 * Exports content from source environment, imports into target environment.
 */
export async function transferPath(
  client: ClientSDK,
  options: TransferOptions
): Promise<void> {
  const {
    sourceContextId,
    targetContextId,
    itemPath,
    scope,
    mergeStrategy = 'OverrideExistingItem',
    onProgress,
    signal,
  } = options;

  const report = (phase: TransferPhase, detail?: string) => onProgress?.(phase, detail);

  // Phase 1: Create content transfer on source
  report('creating');
  const createResult = await client.mutate('xmc.contentTransfer.createContentTransfer', {
    params: {
      query: { sitecoreContextId: sourceContextId },
      body: { itemPath, scope, mergeStrategy },
    },
  });
  const operationId = createResult.data?.data?.operationId;
  if (!operationId) throw new Error('createContentTransfer did not return operationId');

  try {
    // Phase 2: Poll until export is ready
    report('exporting');
    const status = await pollUntilReady(client, sourceContextId, operationId, signal);
    const totalChunks = status.totalChunks ?? 0;

    // Phase 3: Download chunks from source
    report('downloading');
    const chunks: Blob[] = [];
    for (let i = 0; i < totalChunks; i++) {
      signal?.throwIfAborted();
      report('downloading', `${i + 1}/${totalChunks}`);
      const chunkResult = await client.query('xmc.contentTransfer.getChunk', {
        params: {
          query: { sitecoreContextId: sourceContextId },
          body: { operationId, chunkIndex: i },
        },
      });
      chunks.push(chunkResult.data?.data as Blob);
    }

    // Phase 4: Upload chunks to target
    report('uploading');
    for (let i = 0; i < chunks.length; i++) {
      signal?.throwIfAborted();
      report('uploading', `${i + 1}/${totalChunks}`);
      await client.mutate('xmc.contentTransfer.saveChunk', {
        params: {
          query: { sitecoreContextId: targetContextId },
          body: { operationId, chunkIndex: i, data: chunks[i] },
        },
      });
    }

    // Phase 5: Complete chunk set transfer
    report('assembling');
    const completeResult = await client.mutate('xmc.contentTransfer.completeChunkSetTransfer', {
      params: {
        query: { sitecoreContextId: targetContextId },
        body: { operationId },
      },
    });
    const fileId = completeResult.data?.data?.fileId;

    // Phase 6: Consume the .raif file
    report('consuming');
    const consumeResult = await client.query('xmc.contentTransfer.consumeFile', {
      params: {
        query: { sitecoreContextId: targetContextId },
        body: { fileId },
      },
    });
    const blobId = consumeResult.data?.data?.blobId;

    // Phase 7: Poll consume status
    await pollBlobState(client, targetContextId, blobId, signal);

    report('complete');
  } finally {
    // Phase 8: Cleanup — always attempt even on error
    report('cleanup');
    try {
      await client.mutate('xmc.contentTransfer.deleteContentTransfer', {
        params: {
          query: { sitecoreContextId: sourceContextId },
          body: { operationId },
        },
      });
    } catch {
      // Cleanup failure is non-fatal
    }
  }
}

async function pollUntilReady(
  client: ClientSDK,
  contextId: string,
  operationId: string,
  signal?: AbortSignal
): Promise<{ totalChunks: number }> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    signal?.throwIfAborted();
    const result = await client.query('xmc.contentTransfer.getContentTransferStatus', {
      params: {
        query: { sitecoreContextId: contextId },
        body: { operationId },
      },
    });
    const data = result.data?.data;
    if (data?.status === 'Ready' || data?.status === 'Completed') {
      return { totalChunks: data.totalChunks ?? 0 };
    }
    if (data?.status === 'Failed') {
      throw new Error(`Content transfer export failed: ${data.error ?? 'unknown error'}`);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Content transfer export timed out');
}

async function pollBlobState(
  client: ClientSDK,
  contextId: string,
  blobId: string,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    signal?.throwIfAborted();
    const result = await client.query('xmc.contentTransfer.getBlobState', {
      params: {
        query: { sitecoreContextId: contextId },
        body: { blobId },
      },
    });
    const state = result.data?.data?.state;
    if (state === 'Complete' || state === 'Completed') return;
    if (state === 'Failed') {
      throw new Error(`Content consume failed: ${result.data?.data?.error ?? 'unknown error'}`);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Content consume timed out');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

Note: The exact parameter names and response shapes for the Content Transfer API operations (`operationId`, `chunkIndex`, `fileId`, `blobId`, `status` values) are based on the SDK type definitions and the experimental docs. These WILL need adjustment during implementation when we see actual API responses. The structure is correct — the field names may vary. This is the highest-risk code in the plan and should be validated first against the real API.

- [ ] **Step 4: Run tests**

```bash
npm test -- src/__tests__/lib/rift/content-transfer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/content-transfer.ts src/__tests__/lib/rift/content-transfer.test.ts
git commit -m "feat: add Content Transfer API service with 8-step lifecycle"
```

---

## Task 7: Rewrite Root Component with SDK Providers

**Files:**
- Modify: `src/components/rift/Rift.tsx`

- [ ] **Step 1: Rewrite Rift.tsx**

This is a full rewrite. The component wraps the app in Auth0 + SDK providers and uses `useMarketplaceClient` for environment state instead of localStorage.

```tsx
'use client';

import { useState } from 'react';
import { RiftAuthProvider } from '@/lib/rift/auth-provider';
import { useMarketplaceClient } from '@/lib/rift/marketplace-client';
import { RiftMigrate } from './RiftMigrate';
import { RiftWelcome } from './RiftWelcome';
import { RiftPresets } from './RiftPresets';
import { RiftHistory } from './RiftHistory';
import { RiftSetupWizard } from './RiftSetupWizard';
import type { RiftView, RiftPreset, RiftEnvironment } from '@/lib/rift/types';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
// Keep existing UI imports: SidebarProvider, Sidebar, lucide icons, etc.

function RiftApp() {
  const { client, environments, isInitialized, error } = useMarketplaceClient();
  const [activeView, setActiveView] = useState<RiftView>('migrate');
  const [migrateMode, setMigrateMode] = useState<'welcome' | 'workspace'>('welcome');
  const [loadedPreset, setLoadedPreset] = useState<RiftPreset | null>(null);

  if (!isInitialized) {
    return <div className="flex items-center justify-center h-screen text-muted-foreground">Connecting to Sitecore...</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center h-screen text-destructive">SDK Error: {error}</div>;
  }

  if (environments.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 text-muted-foreground p-8 text-center">
        <h2 className="text-lg font-semibold">Install Rift in additional environments</h2>
        <p>Rift needs access to at least two SitecoreAI environments (source and target) to perform migrations.</p>
        <p>Install Rift in your environments via the Cloud Portal &rarr; App Studio &rarr; Install.</p>
        <p className="text-sm">Environments found: {environments.length}</p>
      </div>
    );
  }

  const handleLoadPreset = (preset: RiftPreset) => {
    setLoadedPreset(preset);
    setActiveView('migrate');
    setMigrateMode('workspace');
  };

  const handleNavClick = (view: RiftView) => {
    setActiveView(view);
    if (view !== 'migrate') setMigrateMode('welcome');
  };

  function renderContent() {
    switch (activeView) {
      case 'migrate':
        return migrateMode === 'welcome'
          ? <RiftWelcome
              onNewMigration={() => setMigrateMode('workspace')}
              onLoadPreset={handleLoadPreset}
              environments={environments}
            />
          : <RiftMigrate
              client={client!}
              environments={environments}
              loadedPreset={loadedPreset}
              onBack={() => setMigrateMode('welcome')}
            />;
      case 'presets':
        return <RiftPresets onLoadPreset={handleLoadPreset} environments={environments} />;
      case 'history':
        return <RiftHistory />;
    }
  }

  // Render sidebar + content using existing SidebarProvider layout pattern.
  // Sidebar items: Migrate, Presets, History (removed: Environments, Theme, About — simplify)
  // Keep dark mode toggle inline if desired, but no separate 'display' view.
  return (
    <div className="flex h-screen">
      {/* Sidebar — simplified nav */}
      <nav className="w-56 border-r bg-background p-4 flex flex-col gap-1">
        {(['migrate', 'presets', 'history'] as RiftView[]).map(view => (
          <button
            key={view}
            onClick={() => handleNavClick(view)}
            className={`px-3 py-2 rounded text-left text-sm ${activeView === view ? 'bg-accent font-medium' : 'hover:bg-accent/50'}`}
          >
            {view.charAt(0).toUpperCase() + view.slice(1)}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-auto">
        {renderContent()}
      </main>
    </div>
  );
}

export function Rift() {
  return (
    <RiftAuthProvider>
      <RiftApp />
    </RiftAuthProvider>
  );
}
```

This is a simplified skeleton. The actual implementation should preserve the existing Shadcn/Sidebar UI components and styling — just rewire the data flow and remove credential-dependent views. The key structural changes are:
- Wrap in `RiftAuthProvider`
- Use `useMarketplaceClient()` instead of localStorage checks
- Pass `client` and `environments` down to children
- Remove `'environments'` and `'display'` views
- Remove setup wizard trigger (replaced by `environments.length < 2` guard)

- [ ] **Step 2: Commit**

```bash
git add src/components/rift/Rift.tsx
git commit -m "feat: rewrite root component with SDK providers and simplified navigation"
```

---

## Task 8: Rewrite RiftMigrate with Content Transfer

**Files:**
- Modify: `src/components/rift/RiftMigrate.tsx`

This is the largest single task. The component needs to:
1. Accept `client` and `environments` as props (instead of reading from localStorage/sessions)
2. Replace credential/session state with simple environment selection from `environments` array
3. Replace the migration fetch (streaming to `/api/rift/migrate`) with `transferPath()` calls from content-transfer.ts
4. Adapt progress reporting to chunk-level phases

- [ ] **Step 1: Rewrite RiftMigrate component**

Key changes to the component interface:

```tsx
interface RiftMigrateProps {
  client: ClientSDK;
  environments: RiftEnvironment[];
  loadedPreset: RiftPreset | null;
  onBack: () => void;
}
```

State to REMOVE (all credential/session related):
- `sessionId`, `targetSessionId` — no sessions
- `authError`, `isLoadingSites` credential-related — simplified
- `credPromptEnvId`, `isRestoringPreset` credential states — gone
- All `pendingDangerousNode`, `showIarSecondWarning`, `showIarMigrationWarning`, `showIarPresetWarning`, `iarPresetPaths`, `pendingMediaLibraryNode` — IAR protection removed (simplification per spec — "don't remodel around a shitty kitchen")

State to KEEP (migration UX):
- `selectedSourceEnvId`, `selectedTargetEnvId` — now `tenantId` strings from environments dropdown
- `selectedSiteRootPath`, `selectedPaths` — path selection unchanged
- `sites` — loaded via SDK `fetchSites`
- `isMigrating`, `migrationComplete` — migration lifecycle
- `showConfirmDialog` — confirmation before migration
- `showSettingsModal` — settings (just parallelPaths now)
- `abortControllerRef` — cancel support
- `showCancelConfirm` — cancel confirmation
- `splitPercent`, `treeRefreshKey` — UI layout
- `showPresetInput`, `presetName` — preset saving

State to ADD:
- `transferProgress: TransferProgress[]` — per-path progress from Content Transfer API

Migration execution:

```tsx
async function executeMigration(paths: MigrationPath[]) {
  setIsMigrating(true);
  const controller = new AbortController();
  abortControllerRef.current = controller;
  const startTime = Date.now();

  const sourceEnv = environments.find(e => e.tenantId === selectedSourceEnvId)!;
  const targetEnv = environments.find(e => e.tenantId === selectedTargetEnvId)!;

  const progress: TransferProgress[] = paths.map(p => ({
    itemPath: p.itemPath,
    phase: 'creating' as TransferPhase,
  }));
  setTransferProgress([...progress]);

  const settings = getSettings();
  const transfers = paths.map((path, index) => {
    return transferPath(client, {
      sourceContextId: sourceEnv.contextId,
      targetContextId: targetEnv.contextId,
      itemPath: path.itemPath,
      scope: path.scope,
      signal: controller.signal,
      onProgress: (phase, detail) => {
        progress[index] = { ...progress[index], phase, chunksComplete: detail ? parseInt(detail) : undefined };
        setTransferProgress([...progress]);
      },
    }).catch(err => {
      progress[index] = { ...progress[index], phase: 'error', error: err.message };
      setTransferProgress([...progress]);
    });
  });

  if (settings.parallelPaths) {
    await Promise.allSettled(transfers);
  } else {
    for (const transfer of transfers) {
      await transfer;
    }
  }

  setIsMigrating(false);
  setMigrationComplete(true);

  // Save history entry
  const elapsed = Date.now() - startTime;
  const hasErrors = progress.some(p => p.phase === 'error');
  addHistoryEntry({
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    sourceEnvName: sourceEnv.tenantDisplayName,
    targetEnvName: targetEnv.tenantDisplayName,
    paths: paths.map(p => ({ itemPath: p.itemPath, scope: p.scope })),
    elapsedMs: elapsed,
    status: hasErrors ? (progress.every(p => p.phase === 'error') ? 'failed' : 'partial') : 'success',
  });
}
```

For tree data loading, change from `fetchTreeChildren(parentPath)` to `fetchTreeChildren(client, sourceEnv.contextId, parentPath)`.

For site loading, change from `fetchSites()` to `fetchSites(client, sourceEnv.contextId)`.

The full component rewrite is substantial (~400 lines). The engineer should:
1. Start from the current `RiftMigrate.tsx`
2. Remove all credential/session imports and state
3. Add `client`/`environments` props
4. Replace `fetchSites()`/`fetchTreeChildren()` calls with SDK-backed versions
5. Replace the migration streaming logic with `transferPath()` calls
6. Adapt `RiftProgressOverlay` data to use `TransferProgress[]`

- [ ] **Step 2: Commit**

```bash
git add src/components/rift/RiftMigrate.tsx
git commit -m "feat: rewrite RiftMigrate with Content Transfer API and SDK environment selection"
```

---

## Task 9: Simplify Supporting Components

**Files:**
- Modify: `src/components/rift/RiftWelcome.tsx`
- Modify: `src/components/rift/RiftPresets.tsx`
- Modify: `src/components/rift/RiftEnvironments.tsx` → Delete
- Modify: `src/components/rift/RiftSetupWizard.tsx` → Delete
- Modify: `src/components/rift/RiftProgressOverlay.tsx`

- [ ] **Step 1: Simplify RiftWelcome**

Update props to accept `environments: RiftEnvironment[]`. Remove `needsCredentials()` check and credential warning badges. Remove `getEnvironments()` / `getPresets()` localStorage calls for environments (presets still come from localStorage). Environment name resolution uses `environments.find(e => e.tenantId === preset.sourceTenantId)?.tenantDisplayName`.

- [ ] **Step 2: Simplify RiftPresets**

Update props to accept `environments: RiftEnvironment[]`. Remove credential status indicators. Update preset format references from `sourceEnvId` to `sourceTenantId`. Remove `hasStoredCredentials` checks. Environment name resolution same as Welcome.

- [ ] **Step 3: Delete RiftEnvironments and RiftSetupWizard**

```bash
rm src/components/rift/RiftEnvironments.tsx
rm src/components/rift/RiftSetupWizard.tsx
```

These are fully replaced by the SDK's `resourceAccess` environment list. No UI needed for environment management.

- [ ] **Step 4: Update RiftProgressOverlay**

Adapt to display `TransferProgress[]` instead of streaming migration messages. Each row shows: path name, current phase (creating/exporting/downloading/uploading/assembling/consuming/complete/error), chunk progress if available.

Replace the current streaming message parsing with a simple map over `transferProgress`:

```tsx
{transferProgress.map((tp) => (
  <div key={tp.itemPath} className="flex items-center gap-2 py-1">
    <span className="truncate flex-1">{tp.itemPath.split('/').pop()}</span>
    <span className={`text-xs ${tp.phase === 'error' ? 'text-destructive' : tp.phase === 'complete' ? 'text-green-500' : 'text-muted-foreground'}`}>
      {tp.phase}{tp.chunksComplete ? ` (${tp.chunksComplete})` : ''}
    </span>
  </div>
))}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: simplify Welcome, Presets, ProgressOverlay; delete Environments and SetupWizard"
```

---

## Task 10: Preset Storage Migration

**Files:**
- Modify: `src/components/rift/RiftPresets.tsx` (if not done in Task 9)
- Modify: `src/components/rift/RiftMigrate.tsx` (preset save/load)

- [ ] **Step 1: Implement localStorage preset helpers**

Since `storage.ts` was deleted, add minimal localStorage helpers directly in the components that need them, or create a slim `src/lib/rift/local-storage.ts`:

```ts
import type { RiftPreset, RiftSettings, MigrationHistoryEntry } from './types';
import { DEFAULT_SETTINGS } from './types';

const PRESETS_KEY = 'rift:presets';
const SETTINGS_KEY = 'rift:settings';
const HISTORY_KEY = 'rift:history';
const MAX_HISTORY = 50;

export function getPresets(): RiftPreset[] {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
  } catch { return []; }
}

export function savePreset(preset: RiftPreset): void {
  const presets = getPresets();
  const index = presets.findIndex(p => p.id === preset.id);
  if (index >= 0) presets[index] = preset;
  else presets.push(preset);
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

export function deletePreset(id: string): void {
  const presets = getPresets().filter(p => p.id !== id);
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

export function getSettings(): RiftSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(settings: RiftSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getHistory(): MigrationHistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch { return []; }
}

export function addHistoryEntry(entry: MigrationHistoryEntry): void {
  const history = [entry, ...getHistory()].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}
```

- [ ] **Step 2: Clear incompatible old presets on first load**

In `getPresets()`, detect old format (has `sourceEnvId` but not `sourceTenantId`) and return empty array, clearing stale data:

```ts
export function getPresets(): RiftPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
    // Detect old format presets and discard
    if (raw.length > 0 && raw[0].sourceEnvId && !raw[0].sourceTenantId) {
      localStorage.removeItem(PRESETS_KEY);
      return [];
    }
    return raw;
  } catch { return []; }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/rift/local-storage.ts
git commit -m "feat: add slim localStorage helpers for presets, settings, and history"
```

---

## Task 11: Update RiftConfirmDialog and RiftSelectionPanel

**Files:**
- Modify: `src/components/rift/RiftConfirmDialog.tsx`
- Modify: `src/components/rift/RiftSelectionPanel.tsx`

- [ ] **Step 1: Update RiftConfirmDialog**

Remove `recycleOrphans` checkbox and prop — RECYCLE is not supported in the Content Transfer API flow. Remove IAR warning logic if present (simplified per spec). Keep the rest: path list, scope labels, confirm/cancel buttons.

Update scope labels to remove ChildrenOnly/DescendantsOnly:

```ts
const SCOPE_LABELS: Record<string, string> = {
  SingleItem: 'Item only',
  ItemAndChildren: 'Item + children',
  ItemAndDescendants: 'Item + descendants',
};
```

- [ ] **Step 2: Update RiftSelectionPanel**

Remove ChildrenOnly/DescendantsOnly from scope dropdown options. Keep SingleItem, ItemAndChildren, ItemAndDescendants.

- [ ] **Step 3: Commit**

```bash
git add src/components/rift/RiftConfirmDialog.tsx src/components/rift/RiftSelectionPanel.tsx
git commit -m "feat: simplify ConfirmDialog and SelectionPanel for Content Transfer API scopes"
```

---

## Task 12: Build Verification and Deploy

**Files:**
- Modify: `next.config.ts` (if CSP needs further tweaks)

- [ ] **Step 1: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

Fix any type errors. Common issues: imports referencing deleted modules, prop mismatches from rewritten components.

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Fix any build errors.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: All tests pass. Only the new tests from Tasks 5-6 should exist.

- [ ] **Step 4: Deploy to rift-prod via manual workflow**

Trigger the `deploy-staging.yml` workflow from GitHub to deploy to `rift-prod`. Verify the app loads inside the Sitecore Cloud Portal iframe.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build and type errors from SDK pivot"
```

---

## Task 13: Infrastructure Teardown

**Files:**
- No code files — Azure CLI commands

- [ ] **Step 1: Delete Azure Table Storage tables**

```bash
az storage table delete --name sessions --account-name striftprod
az storage table delete --name credentials --account-name striftprod
```

- [ ] **Step 2: Delete Key Vault key**

```bash
az keyvault key delete --vault-name kv-rift-prod --name rift-session-key
```

- [ ] **Step 3: Evaluate deleting Storage Account and Key Vault entirely**

If no other resources use them:

```bash
az storage account delete --name striftprod --resource-group rg-marketplace-prod --yes
az keyvault delete --name kv-rift-prod --resource-group rg-marketplace-prod
```

- [ ] **Step 4: Remove Azure env vars from App Service**

```bash
az webapp config appsettings delete --name rift-prod --resource-group rg-marketplace-prod --setting-names AZURE_KEYVAULT_URL AZURE_STORAGE_ACCOUNT AZURE_STORAGE_TABLE AZURE_CREDENTIAL_TABLE
```

- [ ] **Step 5: Set new env vars on App Service**

```bash
az webapp config appsettings set --name rift-prod --resource-group rg-marketplace-prod --settings \
  MARKETPLACE_APP_ID="<value>" \
  NEXT_PUBLIC_AUTH0_CLIENT_ID="<value>" \
  NEXT_PUBLIC_AUTH0_DOMAIN="auth.sitecorecloud.io" \
  AUTH0_CLIENT_SECRET="<value>"
```

- [ ] **Step 6: Update Marketplace app deployment URL**

In Cloud Portal → App Studio → Studio → Rift app → Configuration: change Deployment URL from localhost to `https://app.riftapp.dev`.

- [ ] **Step 7: Commit deploy workflow update if needed**

No code commit for this task — it's infrastructure only.

---

## Task 14: Update Compliance Docs

**Files:**
- Modify: `docs/compliance/privacy-policy.md`
- Modify: `docs/compliance/terms-of-service.md`
- Modify: `docs/compliance/data-inventory.md`
- Modify: `docs/compliance/api-documentation.md`

- [ ] **Step 1: Update privacy policy**

Remove all references to:
- Server-side credential storage
- Azure Table Storage / Key Vault
- Session cookies
- "Remember Credentials" feature

Add:
- Auth0 authorization (Sitecore-managed identity provider)
- No user credentials collected or stored by Rift
- Data flows through Sitecore's Marketplace SDK infrastructure

- [ ] **Step 2: Update terms of service**

Update security sections to reflect:
- No credential storage
- Auth0 authentication (same trust model as native Sitecore apps)
- Content Transfer API (Sitecore-managed transfer mechanism)

- [ ] **Step 3: Update data inventory**

Remove: credential data, session data, encryption keys
Add: Auth0 tokens (managed by SDK, not stored by Rift), Content Transfer operation IDs (ephemeral)

- [ ] **Step 4: Update API documentation**

Document the new architecture:
- No custom API routes (all calls go through SDK)
- Content Transfer API lifecycle
- Environment discovery via `application.context`

- [ ] **Step 5: Commit**

```bash
git add docs/compliance/
git commit -m "docs: update compliance docs for Marketplace SDK architecture"
```
