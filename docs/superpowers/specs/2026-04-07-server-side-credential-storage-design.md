# Server-Side Credential Storage

**Date:** 2026-04-07
**Source:** Security feedback from beta tester (Antony) — org-level client credentials stored in browser localStorage are vulnerable to XSS/malicious npm packages even when encrypted.
**Goal:** Move credential storage from client-side (localStorage + Web Crypto + IndexedDB) to server-side (Azure Table Storage + Key Vault), eliminating browser-accessible secrets entirely.

---

## Architecture Overview

### New Azure Resources

| Resource | Name | Purpose | Cost |
|----------|------|---------|------|
| Azure Key Vault | `kv-rift-prod` | Holds AES-256 encryption key for credential encryption/decryption | ~$0.03/month |
| Azure Storage Account | `striftprod` (or use existing) | Table Storage for encrypted session rows | ~$0.01/month |
| Managed Identity | System-assigned on `rift-prod` App Service | Sole principal with Key Vault access | Free |

All resources in `rg-marketplace-prod`, Central US region (same as App Service).

### Session Model

Each environment connection creates a **server-side session** stored as a row in Azure Table Storage:

```
Table: sessions
PartitionKey: sessionId (UUID)
RowKey: "env"
Fields:
  - encryptedClientId: string (ciphertext)
  - encryptedClientSecret: string (ciphertext)
  - iv: string (base64 initialization vector)
  - cmUrl: string
  - envName: string
  - accessToken: string (current Sitecore token, encrypted)
  - expiresAt: number (Unix timestamp — sliding window, 1 hour from last use)
  - createdAt: number (Unix timestamp)
```

### Encryption

- Key Vault holds a single AES-256 key (`rift-session-key`)
- On session creation: server encrypts clientId and clientSecret using the Key Vault key via Azure SDK's encrypt operation
- On session read: server decrypts via Key Vault's decrypt operation
- The App Service's Managed Identity is the only principal with `Key Vault Crypto User` role — no human accounts have decrypt permission by default
- Key Vault audit logs record every access

### Cookie

- Name: `rift_session`
- Value: `{sessionId}:{envId}` (maps to Table Storage row)
- Flags: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/rift`
- No expiry on cookie itself — server-side TTL is authoritative

---

## Data Flow

### Connect (New Environment)

```
Browser                         Server                          Azure
  |-- POST /api/rift/auth ------->|                               |
  |   {clientId, clientSecret}    |-- POST auth.sitecorecloud.io  |
  |                               |<-- accessToken                |
  |                               |-- encrypt(creds) via KV ----->|
  |                               |-- store in Table Storage ---->|
  |<-- Set-Cookie: rift_session   |                               |
  |<-- {accessToken, envId}       |                               |
```

### Subsequent API Calls (tree, sites, projects, environments)

```
Browser                         Server                          Azure
  |-- POST /api/rift/tree ------->|                               |
  |   Cookie: rift_session        |-- read Table Storage -------->|
  |   {cmUrl, parentPath}        |<-- encrypted creds ------------|
  |                               |-- decrypt via KV ------------>|
  |                               |<-- plaintext creds -----------|
  |                               |-- update TTL in Table ------->|
  |                               |-- Sitecore GraphQL API ------>|
  |<-- {children}                 |                               |
```

### Migration (Two Environments)

```
Browser                              Server
  |-- POST /api/rift/migrate -------->|
  |   {                               |-- lookup session for source envId
  |     sourceEnvId: "abc",           |-- lookup session for target envId
  |     targetEnvId: "def",           |-- decrypt both via Key Vault
  |     paths: [...],                 |-- auth both with Sitecore
  |     batchSize, logLevel, ...      |-- proceed with migration
  |   }                               |
```

### Session Expired

```
Browser                         Server
  |-- POST /api/rift/tree ------->|
  |   Cookie: rift_session        |-- read Table Storage (expired/missing)
  |<-- 401 {error: "session_expired", message: "Please reconnect"}
```

For migration, if either environment's session is expired:
```json
{"error": "session_expired", "envId": "abc", "envName": "Production"}
```
Client shows: "Your session for **Production** has expired. Please reconnect to continue."

---

## Sliding Window TTL

- Default TTL: **1 hour** from last API interaction
- Every API call that reads the session updates `expiresAt` to `now + 1 hour`
- Active users never see expiry during a work session
- Idle users (closed tab, walked away) get prompted to reconnect on return
- Expired rows cleaned up lazily on access (check `expiresAt < now`, delete if expired) and optionally via a periodic sweep

---

## Client-Side Changes

### What Gets Removed

- `src/lib/rift/crypto.ts` — entire file (Web Crypto AES-GCM encryption)
- `src/lib/rift/storage.ts` — credential encryption/decryption functions (`encryptEnv`, `decryptEnv`), IndexedDB key management
- IndexedDB `rift-keystore` database — no longer created or used

### What Stays in localStorage

- Environment metadata: `{id, name, cmUrl, allowWrite}` — not sensitive
- Migration history (last 50 runs)
- Presets
- Settings (batch size, log level, parallel toggle)
- Dark mode preference

### What Changes in localStorage

- `StoredEnvironment` type loses `clientId: EncryptedValue` and `clientSecret: EncryptedValue` fields
- Environments stored as plain metadata objects, no encryption layer

### API Client Changes

All API client functions (`fetchTreeChildren`, `fetchSites`, `fetchProjects`, `fetchEnvironments`, `fetchItemFields`) currently receive `accessToken` as a parameter and send it in the request body. After this change:

- These functions no longer accept or send `accessToken`
- The `rift_session` cookie is sent automatically by the browser
- Server reads the session from the cookie, retrieves the access token from Table Storage
- If the token is expired, server transparently refreshes it using the stored credentials

### Migration Request Changes

Current migrate request body:
```typescript
{
  source: { cmUrl, clientId, clientSecret },
  target: { cmUrl, clientId, clientSecret },
  paths, batchSize, logLevel, recycleOrphans
}
```

New migrate request body:
```typescript
{
  sourceEnvId: string,
  targetEnvId: string,
  paths, batchSize, logLevel, recycleOrphans
}
```

Server retrieves both credential sets from Table Storage using the environment IDs.

### UX Changes

- **None visible.** The connect flow, environment management, migration workflow all look and behave identically to today.
- The only user-visible change: if a session expires between visits, the user sees a "Please reconnect" prompt when they try to use an environment. This matches the current behavior of needing to re-enter credentials on a new browser/cleared storage.

---

## Server-Side Changes

### New Files

- `src/lib/rift/session-store.ts` — Azure Table Storage session CRUD + Key Vault encrypt/decrypt
  - `createSession(envId, clientId, clientSecret, accessToken, cmUrl, envName): Promise<string>` — returns sessionId
  - `getSession(sessionId): Promise<Session | null>` — returns decrypted session or null if expired
  - `touchSession(sessionId): Promise<void>` — extends TTL
  - `deleteSession(sessionId): Promise<void>` — explicit deletion
  - `getSessionCredentials(sessionId): Promise<{clientId, clientSecret, accessToken, cmUrl}>` — decrypts and returns

### API Route Changes

All existing API routes (`/api/rift/auth`, `/api/rift/tree`, `/api/rift/sites`, `/api/rift/projects`, `/api/rift/environments`, `/api/rift/item-fields`, `/api/rift/migrate`) need to:

1. Read `rift_session` cookie from the request
2. Call `getSession()` to retrieve and validate the session
3. Use credentials from the session instead of the request body
4. Call `touchSession()` to extend TTL on successful operations

The `/api/rift/auth` route additionally:
1. Receives credentials in the request body (initial connect — only time credentials cross the wire)
2. Authenticates with Sitecore
3. Creates a server-side session via `createSession()`
4. Sets the `rift_session` cookie in the response

### Shared Session Middleware

Extract a helper to reduce duplication across routes:

```typescript
async function withSession(request: NextRequest): Promise<{session: Session} | Response> {
  const cookie = request.cookies.get('rift_session');
  if (!cookie) return unauthorizedResponse('No session');
  const session = await getSession(cookie.value);
  if (!session) return unauthorizedResponse('Session expired');
  await touchSession(cookie.value);
  return { session };
}
```

---

## Azure Infrastructure Setup

### Provisioning (via Azure CLI)

```bash
# Key Vault
az keyvault create --name kv-rift-prod --resource-group rg-marketplace-prod --location centralus --sku standard

# Enable system-assigned managed identity on App Service
az webapp identity assign --name rift-prod --resource-group rg-marketplace-prod

# Grant App Service identity Key Vault Crypto User role
IDENTITY_ID=$(az webapp identity show --name rift-prod --resource-group rg-marketplace-prod --query principalId -o tsv)
KV_ID=$(az keyvault show --name kv-rift-prod --query id -o tsv)
az role assignment create --role "Key Vault Crypto User" --assignee $IDENTITY_ID --scope $KV_ID

# Create encryption key in Key Vault
az keyvault key create --vault-name kv-rift-prod --name rift-session-key --kty oct --size 256

# Storage account (if not reusing existing)
az storage account create --name striftprod --resource-group rg-marketplace-prod --location centralus --sku Standard_LRS

# Create sessions table
az storage table create --name sessions --account-name striftprod

# App Service environment variables
az webapp config appsettings set --name rift-prod --resource-group rg-marketplace-prod --settings \
  AZURE_KEYVAULT_URL=https://kv-rift-prod.vault.azure.net/ \
  AZURE_STORAGE_ACCOUNT=striftprod \
  AZURE_STORAGE_TABLE=sessions
```

### Environment Variables

| Variable | Value | Purpose |
|----------|-------|---------|
| `AZURE_KEYVAULT_URL` | `https://kv-rift-prod.vault.azure.net/` | Key Vault endpoint |
| `AZURE_STORAGE_ACCOUNT` | `striftprod` | Storage account name |
| `AZURE_STORAGE_TABLE` | `sessions` | Table name for sessions |

No connection strings or secrets in env vars — Managed Identity handles authentication to both Key Vault and Table Storage.

---

## Dependencies

New npm packages:
- `@azure/identity` — Managed Identity authentication
- `@azure/keyvault-keys` — Key Vault key operations (encrypt/decrypt)
- `@azure/data-tables` — Table Storage CRUD

---

## Privacy Policy Updates (rift-site repo)

Update the data storage section in the Privacy Policy page:

**Current text (to be replaced):** References to browser-side encryption, localStorage, IndexedDB, Web Crypto API.

**New text:**
> **Credential Storage:** When you connect a Sitecore environment, your client credentials are encrypted using AES-256 encryption and stored on our server infrastructure (Azure Table Storage). The encryption key is managed by Azure Key Vault, a hardware-backed key management service, and is accessible only to the application's managed identity — not to any human operator. Your credentials are automatically purged after 1 hour of inactivity. No credentials are stored in your browser.

**Data retention section update:**
> Server-side sessions (containing encrypted credentials) are automatically deleted after 1 hour of inactivity. Active sessions are extended with each interaction. No credentials persist beyond the session lifetime.

## Terms of Service Updates (rift-site repo)

Update the security section:

**New text:**
> **Security Architecture:** Rift employs server-side credential storage with encryption at rest using Azure Key Vault, a FIPS 140-2 compliant key management service. Credentials are encrypted using AES-256 before storage and are accessible only to the application at runtime via Azure Managed Identity. Encryption keys are not accessible to any human operator. All data in transit is encrypted via TLS 1.2+. Server-side sessions expire after 1 hour of inactivity.

---

## Auth Flow Diagram (for stakeholder presentation)

To be generated after implementation as a shareable visual. Will cover:
- End-to-end credential flow from user input to Sitecore API
- Azure resource relationships (App Service → Key Vault → Table Storage)
- Session lifecycle (create → use → extend → expire)
- Security boundaries (what each actor can access)

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Session TTL | 1 hour sliding window | Balances security (short credential lifetime) with usability (active users never see expiry) |
| "Sign Out" / "Forget Me" UI | Not included (for now) | Re-auth is transparent; no need for explicit session management. Can be added later if requested. Noted as deliberate omission. |
| Client-side encryption removal | Full removal | Clean break — credentials entirely server-side. Keeping both would add complexity without security benefit. |
| Session indicator in UI | Not included | UX stays identical to today. Session management is invisible to the user. |
| Key Vault vs. local encryption | Key Vault | Encryption key never accessible to humans (even subscription owner must explicitly grant themselves access, which is auditable). Local encryption key would be in env vars or code. |
| Table Storage vs. Redis vs. Cosmos | Table Storage | Cheapest (~$0.01/month), simplest, sufficient for session storage. No need for Redis speed or Cosmos features at this scale. |
