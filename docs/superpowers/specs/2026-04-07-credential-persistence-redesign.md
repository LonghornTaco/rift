# Credential Persistence Redesign

**Date:** 2026-04-07
**Context:** Follow-up to server-side credential storage (Session 14-15). Credentials are currently still stored in browser localStorage as plain text alongside environment metadata. This redesign removes credentials from the browser entirely and introduces opt-in persistent credential storage server-side.

---

## Problem

After implementing server-side sessions (Session 14-15), `clientId` and `clientSecret` are still stored in browser localStorage as part of the `RiftEnvironment` object. This undermines the security goal of keeping credentials out of the browser.

## Design

### Credential Storage Model

Credentials are decoupled from environments and sessions:

- **Environment metadata** (name, CM URL, env ID, project ID, read-only flag) — stored in browser localStorage. No secrets.
- **Encrypted credentials** (clientId, clientSecret) — stored permanently in Azure Table Storage, encrypted with envelope encryption (AES-256-GCM + Key Vault RSA-OAEP). Keyed by environment ID. Independent of session TTL.
- **Sessions** (access token) — short-lived (1-hour sliding TTL), stored in Azure Table Storage. When a session expires, the app automatically re-authenticates using stored credentials — invisible to the user.

### Opt-In Flow ("Remember Credentials")

A **"Remember Credentials" checkbox** appears in the setup wizard and the reconnect dialog. **Unchecked by default** — users must explicitly opt in.

When checked, an informational modal appears before proceeding:

> "Your credentials will be encrypted and stored securely on our servers. Only the application can access them — no person can view or retrieve your credentials. You can delete them at any time from the Environments page."

User must acknowledge (OK/Continue) to proceed.

**Behavior based on opt-in:**

| Scenario | Environment saved? | Credentials stored server-side? |
|---|---|---|
| Opt-in checked | Yes | Yes |
| Opt-in unchecked, environment already exists | Yes (unchanged) | No |
| Opt-in unchecked, environment does not exist | No | No |

### Environment Card States

Each environment card on the Environments page has one of three visual states:

1. **Connected** — credentials stored server-side, active or re-establishable session. Current green tint styling.
2. **No credentials** — environment metadata exists but no stored credentials. Muted/warning appearance. Shows a **"Reconnect"** button.
3. **Untested** — freshly added, not yet connected.

### Environment Card Actions

- **Test** — authenticate and verify connection (existing)
- **Edit** — modify environment metadata (existing)
- **Delete** — removes environment metadata from localStorage AND deletes any stored credentials from Azure Table Storage
- **Forget Credentials** — deletes encrypted credentials from Azure Table Storage. Environment metadata remains in localStorage. Card transitions to "No credentials" state.
- **Reconnect** — appears when no credentials are stored. Opens a dialog to enter credentials with the "Remember Credentials" checkbox and opt-in modal.

### Preset Loading Without Credentials

Presets are always available regardless of credential opt-in (they store path selections, not credentials).

When loading a preset that references environments without stored credentials:

1. Preset loads normally (paths, site selection, environment references)
2. Credential prompt appears for each environment that lacks stored credentials
3. Prompt includes credential fields + "Remember Credentials" checkbox with opt-in modal
4. After credentials are entered, migration proceeds normally

### Session Auto-Reconnect

When a 1-hour session expires but credentials are stored server-side:

1. Next API call returns 401 (session expired)
2. Client automatically calls `/api/rift/auth` using stored credentials to get a new session
3. Retries the original API call
4. User sees no interruption

This requires a new API endpoint or modification to the auth flow to support re-authentication from stored credentials (since clientId/clientSecret are no longer sent from the browser).

### API Changes

**New endpoint: `POST /api/rift/credentials`**
- **Store:** `{ envId, clientId, clientSecret }` → encrypts and stores in Azure Table Storage keyed by envId
- **Get:** `{ envId }` → returns `{ hasCredentials: true/false }` (never returns actual credentials)
- **Delete:** `{ envId, action: 'delete' }` → removes credentials from Azure Table Storage

**Modified: `POST /api/rift/auth`**
- Accepts either `{ clientId, clientSecret, envId, ... }` (direct auth) or `{ envId }` (re-auth from stored credentials)
- When envId-only, looks up stored credentials from Azure Table Storage, authenticates, creates session

**Session cookie** continues to work as-is (SameSite=None, HttpOnly, Secure).

### Data Model Changes

**Azure Table Storage — new `credentials` table:**

| Field | Type | Description |
|---|---|---|
| partitionKey | string | envId |
| rowKey | string | "cred" |
| encryptedClientId | string | Envelope-encrypted clientId |
| encryptedClientSecret | string | Envelope-encrypted clientSecret |
| createdAt | number | Timestamp |

**localStorage `RiftEnvironment` type changes:**
- Remove `clientId` and `clientSecret` fields
- Add `hasStoredCredentials: boolean` (UI hint, not authoritative — server is source of truth)

### Security Considerations

- Credentials never stored in the browser (localStorage or cookies)
- Server-side credentials encrypted with envelope encryption (AES-256-GCM + Key Vault RSA-OAEP)
- No API endpoint returns decrypted credentials — they are only used internally for authentication
- "Forget Credentials" provides user control over stored data
- Deleting an environment cascades to credential deletion
- Opt-in default (unchecked) ensures informed consent

## Out of Scope

- Moving presets, history, or settings to server-side storage
- Multi-user or account-based credential management
- Credential sharing across browsers/devices
