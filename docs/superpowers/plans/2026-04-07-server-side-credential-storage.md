# Server-Side Credential Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move credential storage from client-side (localStorage + Web Crypto + IndexedDB) to server-side (Azure Table Storage + Key Vault), eliminating browser-accessible secrets.

**Architecture:** Azure Key Vault holds the encryption key, Azure Table Storage holds encrypted session rows. The App Service's Managed Identity is the sole accessor. Browser sends credentials once on connect, receives an HTTP-only session cookie, and never touches credentials again. All API routes read credentials from the server-side session via the cookie.

**Tech Stack:** Next.js 15, Azure Key Vault SDK (`@azure/keyvault-keys`), Azure Table Storage SDK (`@azure/data-tables`), Azure Identity SDK (`@azure/identity`), TypeScript

---

### Task 1: Provision Azure Infrastructure

**Files:**
- None (Azure CLI commands only)

This task creates the Key Vault, storage account, table, managed identity, and RBAC assignments. Must be done before any code changes.

- [ ] **Step 1: Enable system-assigned managed identity on App Service**

```bash
az webapp identity assign --name rift-prod --resource-group rg-longhorntaco-marketplace
```

Save the `principalId` from the output — needed for RBAC.

- [ ] **Step 2: Create Key Vault**

```bash
az keyvault create \
  --name kv-rift-prod \
  --resource-group rg-longhorntaco-marketplace \
  --location centralus \
  --sku standard \
  --enable-rbac-authorization true
```

- [ ] **Step 3: Grant App Service identity Key Vault Crypto User role**

```bash
IDENTITY_ID=$(az webapp identity show --name rift-prod --resource-group rg-longhorntaco-marketplace --query principalId -o tsv)
KV_ID=$(az keyvault show --name kv-rift-prod --query id -o tsv)
az role assignment create --role "Key Vault Crypto User" --assignee $IDENTITY_ID --scope $KV_ID
```

- [ ] **Step 4: Create encryption key in Key Vault**

```bash
az keyvault key create --vault-name kv-rift-prod --name rift-session-key --kty RSA --size 2048
```

Note: Using RSA-2048 instead of AES-256 because Azure Key Vault's encrypt/decrypt operations via SDK work more straightforwardly with RSA keys for wrapping small payloads (credentials are short strings). The RSA key wraps a randomly generated AES data key for each session.

- [ ] **Step 5: Create Storage Account and sessions table**

```bash
az storage account create \
  --name striftprod \
  --resource-group rg-longhorntaco-marketplace \
  --location centralus \
  --sku Standard_LRS \
  --min-tls-version TLS1_2
```

```bash
# Grant the App Service identity Storage Table Data Contributor role
STORAGE_ID=$(az storage account show --name striftprod --query id -o tsv)
az role assignment create --role "Storage Table Data Contributor" --assignee $IDENTITY_ID --scope $STORAGE_ID
```

```bash
# Create the sessions table (using connection string for CLI, app uses managed identity)
CONN_STR=$(az storage account show-connection-string --name striftprod -o tsv)
az storage table create --name sessions --connection-string $CONN_STR
```

- [ ] **Step 6: Set App Service environment variables**

```bash
az webapp config appsettings set --name rift-prod --resource-group rg-longhorntaco-marketplace --settings \
  AZURE_KEYVAULT_URL=https://kv-rift-prod.vault.azure.net/ \
  AZURE_STORAGE_ACCOUNT=striftprod \
  AZURE_STORAGE_TABLE=sessions
```

- [ ] **Step 7: Create local `.env.local` for development**

Create `.env.local` at project root (already in `.gitignore`):

```
AZURE_KEYVAULT_URL=https://kv-rift-prod.vault.azure.net/
AZURE_STORAGE_ACCOUNT=striftprod
AZURE_STORAGE_TABLE=sessions
```

For local development, the Azure SDK will use your `az login` credentials (DefaultAzureCredential falls back to Azure CLI). Grant yourself the same roles temporarily:

```bash
MY_ID=$(az ad signed-in-user show --query id -o tsv)
az role assignment create --role "Key Vault Crypto User" --assignee $MY_ID --scope $KV_ID
az role assignment create --role "Storage Table Data Contributor" --assignee $MY_ID --scope $STORAGE_ID
```

- [ ] **Step 8: Verify infrastructure**

```bash
az keyvault key show --vault-name kv-rift-prod --name rift-session-key --query key.kid -o tsv
az storage table exists --name sessions --account-name striftprod --connection-string $CONN_STR
az webapp identity show --name rift-prod --resource-group rg-longhorntaco-marketplace --query principalId -o tsv
```

All three should return valid values.

---

### Task 2: Install Azure SDK Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Azure SDK packages**

```bash
npm install @azure/identity @azure/keyvault-keys @azure/data-tables
```

- [ ] **Step 2: Verify build still passes**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add Azure SDK dependencies for server-side credential storage"
```

---

### Task 3: Create Session Store Module

**Files:**
- Create: `src/lib/rift/session-store.ts`
- Create: `src/__tests__/lib/rift/session-store.test.ts`

This is the core module — handles Table Storage CRUD and Key Vault encryption.

- [ ] **Step 1: Write test for session creation and retrieval**

Create `src/__tests__/lib/rift/session-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Azure SDKs
vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@azure/keyvault-keys', () => {
  const mockEncrypt = vi.fn().mockResolvedValue({ result: Buffer.from('encrypted-data') });
  const mockDecrypt = vi.fn().mockImplementation((_alg: string, data: Uint8Array) => ({
    result: data, // echo back for test simplicity
  }));
  return {
    KeyClient: vi.fn().mockImplementation(() => ({
      getKey: vi.fn().mockResolvedValue({ id: 'https://kv/keys/rift-session-key/123' }),
    })),
    CryptographyClient: vi.fn().mockImplementation(() => ({
      encrypt: mockEncrypt,
      decrypt: mockDecrypt,
    })),
  };
});

const mockEntities = new Map<string, Record<string, unknown>>();

vi.mock('@azure/data-tables', () => ({
  TableClient: vi.fn().mockImplementation(() => ({
    createEntity: vi.fn().mockImplementation((entity: Record<string, unknown>) => {
      mockEntities.set(`${entity.partitionKey}:${entity.rowKey}`, entity);
      return Promise.resolve();
    }),
    getEntity: vi.fn().mockImplementation((pk: string, rk: string) => {
      const entity = mockEntities.get(`${pk}:${rk}`);
      if (!entity) throw { statusCode: 404 };
      return Promise.resolve(entity);
    }),
    updateEntity: vi.fn().mockImplementation((entity: Record<string, unknown>) => {
      const key = `${entity.partitionKey}:${entity.rowKey}`;
      const existing = mockEntities.get(key);
      if (existing) mockEntities.set(key, { ...existing, ...entity });
      return Promise.resolve();
    }),
    deleteEntity: vi.fn().mockImplementation((pk: string, rk: string) => {
      mockEntities.delete(`${pk}:${rk}`);
      return Promise.resolve();
    }),
  })),
  TableServiceClient: vi.fn().mockImplementation(() => ({})),
}));

// Set env vars before importing the module
process.env.AZURE_KEYVAULT_URL = 'https://kv-rift-prod.vault.azure.net/';
process.env.AZURE_STORAGE_ACCOUNT = 'striftprod';
process.env.AZURE_STORAGE_TABLE = 'sessions';

import { createSession, getSession, touchSession, deleteSession } from '@/lib/rift/session-store';

describe('session-store', () => {
  beforeEach(() => {
    mockEntities.clear();
  });

  it('creates a session and returns a sessionId', async () => {
    const sessionId = await createSession({
      envId: 'env-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      accessToken: 'token-123',
      cmUrl: 'https://test.sitecorecloud.io',
      envName: 'Test Env',
    });

    expect(sessionId).toBeTruthy();
    expect(typeof sessionId).toBe('string');
  });

  it('retrieves a valid session', async () => {
    const sessionId = await createSession({
      envId: 'env-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      accessToken: 'token-123',
      cmUrl: 'https://test.sitecorecloud.io',
      envName: 'Test Env',
    });

    const session = await getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session!.envId).toBe('env-1');
    expect(session!.cmUrl).toBe('https://test.sitecorecloud.io');
  });

  it('returns null for expired session', async () => {
    const sessionId = await createSession({
      envId: 'env-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      accessToken: 'token-123',
      cmUrl: 'https://test.sitecorecloud.io',
      envName: 'Test Env',
    });

    // Manually expire the session in the mock store
    const key = `${sessionId}:session`;
    const entity = mockEntities.get(key);
    if (entity) {
      entity.expiresAt = Date.now() - 1000;
      mockEntities.set(key, entity);
    }

    const session = await getSession(sessionId);
    expect(session).toBeNull();
  });

  it('extends TTL on touch', async () => {
    const sessionId = await createSession({
      envId: 'env-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      accessToken: 'token-123',
      cmUrl: 'https://test.sitecorecloud.io',
      envName: 'Test Env',
    });

    const before = mockEntities.get(`${sessionId}:session`)?.expiresAt as number;
    await new Promise((r) => setTimeout(r, 50));
    await touchSession(sessionId);
    const after = mockEntities.get(`${sessionId}:session`)?.expiresAt as number;

    expect(after).toBeGreaterThan(before);
  });

  it('deletes a session', async () => {
    const sessionId = await createSession({
      envId: 'env-1',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      accessToken: 'token-123',
      cmUrl: 'https://test.sitecorecloud.io',
      envName: 'Test Env',
    });

    await deleteSession(sessionId);
    const session = await getSession(sessionId);
    expect(session).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/lib/rift/session-store.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement session-store.ts**

Create `src/lib/rift/session-store.ts`:

```typescript
import { DefaultAzureCredential } from '@azure/identity';
import { KeyClient, CryptographyClient } from '@azure/keyvault-keys';
import { TableClient } from '@azure/data-tables';
import { randomUUID } from 'crypto';

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const KEY_NAME = 'rift-session-key';

interface SessionCreateInput {
  envId: string;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  cmUrl: string;
  envName: string;
}

export interface Session {
  sessionId: string;
  envId: string;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  cmUrl: string;
  envName: string;
  expiresAt: number;
}

// Lazy-initialized clients
let credential: InstanceType<typeof DefaultAzureCredential> | null = null;
let tableClient: InstanceType<typeof TableClient> | null = null;
let cryptoClient: InstanceType<typeof CryptographyClient> | null = null;

function getCredential() {
  if (!credential) credential = new DefaultAzureCredential();
  return credential;
}

function getTableClient(): TableClient {
  if (!tableClient) {
    const account = process.env.AZURE_STORAGE_ACCOUNT;
    const table = process.env.AZURE_STORAGE_TABLE || 'sessions';
    if (!account) throw new Error('AZURE_STORAGE_ACCOUNT not set');
    tableClient = new TableClient(
      `https://${account}.table.core.windows.net`,
      table,
      getCredential()
    );
  }
  return tableClient;
}

async function getCryptoClient(): Promise<CryptographyClient> {
  if (!cryptoClient) {
    const vaultUrl = process.env.AZURE_KEYVAULT_URL;
    if (!vaultUrl) throw new Error('AZURE_KEYVAULT_URL not set');
    const keyClient = new KeyClient(vaultUrl, getCredential());
    const key = await keyClient.getKey(KEY_NAME);
    if (!key.id) throw new Error('Key not found in Key Vault');
    cryptoClient = new CryptographyClient(key.id, getCredential());
  }
  return cryptoClient;
}

async function encryptString(plaintext: string): Promise<string> {
  const crypto = await getCryptoClient();
  const result = await crypto.encrypt('RSA-OAEP', Buffer.from(plaintext, 'utf-8'));
  return Buffer.from(result.result).toString('base64');
}

async function decryptString(ciphertext: string): Promise<string> {
  const crypto = await getCryptoClient();
  const result = await crypto.decrypt('RSA-OAEP', Buffer.from(ciphertext, 'base64'));
  return Buffer.from(result.result).toString('utf-8');
}

export async function createSession(input: SessionCreateInput): Promise<string> {
  const sessionId = randomUUID();
  const table = getTableClient();

  const encryptedClientId = await encryptString(input.clientId);
  const encryptedClientSecret = await encryptString(input.clientSecret);
  const encryptedAccessToken = await encryptString(input.accessToken);

  await table.createEntity({
    partitionKey: sessionId,
    rowKey: 'session',
    envId: input.envId,
    encryptedClientId,
    encryptedClientSecret,
    encryptedAccessToken,
    cmUrl: input.cmUrl,
    envName: input.envName,
    expiresAt: Date.now() + SESSION_TTL_MS,
    createdAt: Date.now(),
  });

  return sessionId;
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const table = getTableClient();

  try {
    const entity = await table.getEntity(sessionId, 'session');

    const expiresAt = entity.expiresAt as number;
    if (expiresAt < Date.now()) {
      // Expired — clean up lazily
      try { await table.deleteEntity(sessionId, 'session'); } catch {}
      return null;
    }

    return {
      sessionId,
      envId: entity.envId as string,
      clientId: await decryptString(entity.encryptedClientId as string),
      clientSecret: await decryptString(entity.encryptedClientSecret as string),
      accessToken: await decryptString(entity.encryptedAccessToken as string),
      cmUrl: entity.cmUrl as string,
      envName: entity.envName as string,
      expiresAt,
    };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404) {
      return null;
    }
    throw err;
  }
}

export async function touchSession(sessionId: string): Promise<void> {
  const table = getTableClient();
  await table.updateEntity(
    {
      partitionKey: sessionId,
      rowKey: 'session',
      expiresAt: Date.now() + SESSION_TTL_MS,
    },
    'Merge'
  );
}

export async function deleteSession(sessionId: string): Promise<void> {
  const table = getTableClient();
  try {
    await table.deleteEntity(sessionId, 'session');
  } catch {}
}

export async function updateSessionToken(sessionId: string, newToken: string): Promise<void> {
  const table = getTableClient();
  const encryptedAccessToken = await encryptString(newToken);
  await table.updateEntity(
    {
      partitionKey: sessionId,
      rowKey: 'session',
      encryptedAccessToken,
    },
    'Merge'
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/__tests__/lib/rift/session-store.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/session-store.ts src/__tests__/lib/rift/session-store.test.ts
git commit -m "feat: add server-side session store with Key Vault encryption"
```

---

### Task 4: Create Session Middleware Helper

**Files:**
- Create: `src/lib/rift/session-middleware.ts`

Shared helper that extracts and validates the session from a request cookie, used by all API routes.

- [ ] **Step 1: Create session-middleware.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSession, touchSession, type Session } from './session-store';

const SESSION_COOKIE = 'rift_session';

export type SessionResult =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

/**
 * Extract and validate session from request cookie.
 * On success, extends the session TTL (sliding window).
 * On failure, returns a 401 response.
 */
export async function withSession(request: NextRequest): Promise<SessionResult> {
  const cookieValue = request.cookies.get(SESSION_COOKIE)?.value;
  if (!cookieValue) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'session_missing', message: 'No session found. Please connect an environment.' },
        { status: 401 }
      ),
    };
  }

  // Cookie format: sessionId
  const session = await getSession(cookieValue);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'session_expired', message: 'Session expired. Please reconnect.' },
        { status: 401 }
      ),
    };
  }

  // Sliding window: extend TTL on every successful access
  await touchSession(cookieValue);

  return { ok: true, session };
}

/**
 * Look up a session by envId from a specific session cookie value.
 * Used by migrate route which needs two sessions (source + target).
 */
export async function getSessionForEnv(
  sessionMap: Map<string, string>,
  envId: string
): Promise<{ session: Session } | { error: NextResponse }> {
  const sessionId = sessionMap.get(envId);
  if (!sessionId) {
    return {
      error: NextResponse.json(
        { error: 'session_expired', envId, message: `No session for environment ${envId}. Please reconnect.` },
        { status: 401 }
      ),
    };
  }

  const session = await getSession(sessionId);
  if (!session) {
    return {
      error: NextResponse.json(
        { error: 'session_expired', envId, message: `Session expired for environment. Please reconnect.` },
        { status: 401 }
      ),
    };
  }

  await touchSession(sessionId);
  return { session };
}

/** Build Set-Cookie header value for a session */
export function buildSessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/api/rift`;
}

/** Build Set-Cookie header value to clear the session */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api/rift; Max-Age=0`;
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/rift/session-middleware.ts
git commit -m "feat: add session middleware helper for API routes"
```

---

### Task 5: Update Auth Route (Session Creation)

**Files:**
- Modify: `src/app/api/rift/auth/route.ts`

The auth route is the entry point — it receives credentials, authenticates, creates a server-side session, and returns a cookie.

- [ ] **Step 1: Update auth route**

Replace the entire contents of `src/app/api/rift/auth/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rift/api-security';
import { logAuth, logRateLimit, logError } from '@/lib/rift/logger';
import { createSession } from '@/lib/rift/session-store';
import { buildSessionCookie } from '@/lib/rift/session-middleware';

interface AuthRequestBody {
  clientId: string;
  clientSecret: string;
  envId: string;
  cmUrl: string;
  envName: string;
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  if (!rateLimit(clientIp, 60_000, 10)) {
    logRateLimit('/api/rift/auth', clientIp);
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 }
    );
  }

  let body: AuthRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { clientId, clientSecret, envId, cmUrl, envName } = body;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'clientId and clientSecret are required' },
      { status: 400 }
    );
  }

  try {
    const tokenResponse = await fetch('https://auth.sitecorecloud.io/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience: 'https://api.sitecorecloud.io',
      }),
    });

    if (!tokenResponse.ok) {
      const status = tokenResponse.status;
      logAuth('/api/rift/auth', clientIp, false, `Upstream ${status}`);
      if (status === 401 || status === 403) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
      }
      return NextResponse.json({ error: 'Authentication failed' }, { status: 502 });
    }

    logAuth('/api/rift/auth', clientIp, true);
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Create server-side session
    const sessionId = await createSession({
      envId: envId || 'unknown',
      clientId,
      clientSecret,
      accessToken,
      cmUrl: cmUrl || '',
      envName: envName || '',
    });

    // Return response with session cookie
    const response = NextResponse.json({
      accessToken,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type,
      sessionId,
    });
    response.headers.set('Set-Cookie', buildSessionCookie(sessionId));
    return response;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logError('/api/rift/auth', 'auth_connection_error', detail, { clientIp });
    return NextResponse.json(
      { error: 'Failed to connect to authentication server' },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/rift/auth/route.ts
git commit -m "feat: auth route creates server-side session and sets cookie"
```

---

### Task 6: Update Tree, Sites, Projects, Environments, Item-Fields Routes

**Files:**
- Modify: `src/app/api/rift/tree/route.ts`
- Modify: `src/app/api/rift/sites/route.ts`
- Modify: `src/app/api/rift/projects/route.ts`
- Modify: `src/app/api/rift/environments/route.ts`
- Modify: `src/app/api/rift/item-fields/route.ts`

All five routes follow the same pattern: replace `accessToken` from request body with session cookie lookup. They still accept `cmUrl` and other non-credential params in the body.

- [ ] **Step 1: Update tree route**

In `src/app/api/rift/tree/route.ts`, update the imports and body handling:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { validateCmUrl, validateItemPath, upstreamError, sanitizeError } from '@/lib/rift/api-security';
import { withSession } from '@/lib/rift/session-middleware';

interface TreeRequestBody {
  parentPath: string;
}

export async function POST(request: NextRequest) {
  const sessionResult = await withSession(request);
  if (!sessionResult.ok) return sessionResult.response;
  const { session } = sessionResult;

  let body: TreeRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { parentPath } = body;
  const cmUrl = session.cmUrl;
  const accessToken = session.accessToken;

  if (!parentPath) {
    return NextResponse.json(
      { error: 'parentPath is required' },
      { status: 400 }
    );
  }

  const cmUrlError = validateCmUrl(cmUrl);
  if (cmUrlError) {
    return NextResponse.json({ error: cmUrlError }, { status: 400 });
  }

  const pathError = validateItemPath(parentPath);
  if (pathError) {
    return NextResponse.json({ error: 'Invalid parentPath format' }, { status: 400 });
  }

  const query = `
    query($path: String!) {
      item(where: { path: $path, language: "en", database: "master" }) {
        children {
          nodes {
            itemId
            name
            path
            hasChildren
            template {
              name
            }
          }
        }
      }
    }
  `;

  try {
    const graphqlUrl = `${cmUrl.replace(/\/$/, '')}/sitecore/api/authoring/graphql/v1`;
    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables: { path: parentPath } }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return upstreamError('tree', response.status, errorText);
    }

    const data = await response.json();
    const nodes = data?.data?.item?.children?.nodes ?? [];

    const children = nodes.map((node: { itemId: string; name: string; path: string; hasChildren: boolean; template?: { name: string } }) => ({
      itemId: node.itemId,
      name: node.name,
      path: node.path,
      hasChildren: node.hasChildren,
      templateName: node.template?.name ?? '',
    }));

    return NextResponse.json({ children });
  } catch (err) {
    return sanitizeError('tree', err);
  }
}
```

- [ ] **Step 2: Update sites route**

Replace `src/app/api/rift/sites/route.ts` — same pattern. Remove `accessToken` and `cmUrl` from body, get from session:

Read the current file, then change the body interface to remove `cmUrl` and `accessToken`, add `withSession` import, get both values from session. The GraphQL query and response handling stay identical.

- [ ] **Step 3: Update projects route**

Replace `src/app/api/rift/projects/route.ts` — remove `accessToken` from body, get from session. The Deploy API call stays identical.

- [ ] **Step 4: Update environments route**

Replace `src/app/api/rift/environments/route.ts` — remove `accessToken` from body (keep `projectId`), get token from session.

- [ ] **Step 5: Update item-fields route**

Replace `src/app/api/rift/item-fields/route.ts` — remove `cmUrl` and `accessToken` from body (keep `itemPath` and `fieldNames`), get from session.

- [ ] **Step 6: Verify build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/app/api/rift/tree/route.ts src/app/api/rift/sites/route.ts src/app/api/rift/projects/route.ts src/app/api/rift/environments/route.ts src/app/api/rift/item-fields/route.ts
git commit -m "feat: all API routes read credentials from server-side session cookie"
```

---

### Task 7: Update Migrate Route

**Files:**
- Modify: `src/app/api/rift/migrate/route.ts`

The migrate route is the most complex change — it needs two sessions (source + target) looked up by environment ID.

- [ ] **Step 1: Update MigrateRequestBody and session handling**

In `src/app/api/rift/migrate/route.ts`, change the request body interface and the beginning of the POST handler.

Replace the `MigrateRequestBody` interface (lines 8-26):

```typescript
interface MigrateRequestBody {
  sourceEnvId: string;
  targetEnvId: string;
  paths: Array<{
    itemPath: string;
    scope: 'SingleItem' | 'ItemAndChildren' | 'ItemAndDescendants' | 'ChildrenOnly' | 'DescendantsOnly';
  }>;
  batchSize?: number;
  logLevel?: string;
  recycleOrphans?: boolean;
}
```

Add import at the top:

```typescript
import { getSession, touchSession, updateSessionToken } from '@/lib/rift/session-store';
```

In the POST handler, after parsing the body, replace the credential extraction with session lookups. Find where `source.clientId`, `source.clientSecret`, `target.clientId`, `target.clientSecret` are used and replace with session-based credential retrieval.

The key changes:
- Parse `sourceEnvId` and `targetEnvId` from body
- Read session cookie, use it to look up both sessions from Table Storage
- Extract credentials from sessions
- Pass credentials into existing `AuthContext` objects
- Replace `getAccessToken(auth.clientId, auth.clientSecret)` calls — these already work since `AuthContext` still has the credentials, they just come from the session now
- After token refresh in `authPost()`, call `updateSessionToken()` to persist the new token

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/rift/migrate/route.ts
git commit -m "feat: migrate route reads source/target credentials from server-side sessions"
```

---

### Task 8: Update Client-Side API Functions

**Files:**
- Modify: `src/lib/rift/api-client.ts`
- Modify: `src/lib/rift/sitecore-auth.ts`

Remove `accessToken` parameter from all fetch functions — the cookie is sent automatically.

- [ ] **Step 1: Update sitecore-auth.ts**

The `authenticate` function now needs to send `envId`, `cmUrl`, `envName` along with credentials so the server can create a session:

```typescript
export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
  sessionId: string;
}

export async function authenticate(
  clientId: string,
  clientSecret: string,
  envId: string,
  cmUrl: string,
  envName: string
): Promise<AuthResult> {
  const res = await fetch('/api/rift/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret, envId, cmUrl, envName }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Authentication failed (${res.status})`);
  }

  return res.json();
}
```

- [ ] **Step 2: Update api-client.ts fetch functions**

Remove `accessToken` parameter from all functions. Remove `cmUrl` where the server now provides it from the session. The functions become simpler:

```typescript
export async function fetchTreeChildren(parentPath: string): Promise<TreeNode[]> {
  const res = await fetch('/api/rift/tree', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentPath }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Tree fetch failed (${res.status})`);
  }

  const result: FetchTreeResult = await res.json();
  return result.children;
}

export async function fetchSites(): Promise<(SiteInfo & { collection: string })[]> {
  const res = await fetch('/api/rift/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Sites fetch failed (${res.status})`);
  }

  const result: FetchSitesResult = await res.json();
  return result.sites;
}

export async function fetchProjects(): Promise<unknown[]> {
  const res = await fetch('/api/rift/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Projects fetch failed (${res.status})`);
  }

  return res.json();
}

export async function fetchEnvironments(projectId: string): Promise<unknown[]> {
  const res = await fetch('/api/rift/environments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Environments fetch failed (${res.status})`);
  }

  return res.json();
}

export async function fetchItemFields(
  itemPath: string,
  fieldNames: string[] = []
): Promise<ItemFieldsResult> {
  const res = await fetch('/api/rift/item-fields', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemPath, fieldNames }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Item fields fetch failed (${res.status})`);
  }

  return res.json();
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/rift/sitecore-auth.ts src/lib/rift/api-client.ts
git commit -m "feat: remove accessToken/credentials from client-side API functions"
```

---

### Task 9: Update UI Components

**Files:**
- Modify: `src/components/rift/RiftMigrate.tsx`
- Modify: `src/components/rift/RiftEnvironments.tsx`
- Modify: `src/components/rift/RiftSetupWizard.tsx`
- Modify: `src/components/rift/RiftContentTree.tsx`

Update all components that call the API functions — remove `accessToken` parameters, update `authenticate` calls to include env metadata, update migrate request to send environment IDs instead of credentials.

- [ ] **Step 1: Update RiftMigrate.tsx**

Key changes:
- Remove `accessToken` state variable and all places it's set
- Update `authenticate` calls to pass `envId`, `cmUrl`, `envName`
- Update `fetchSites` calls to remove `cmUrl` and `accessToken` params
- Update `RiftContentTree` props — remove `cmUrl` and `accessToken`
- Update migrate request body: replace `source: {cmUrl, clientId, clientSecret}` and `target: {cmUrl, clientId, clientSecret}` with `sourceEnvId` and `targetEnvId`
- Handle 401 responses by showing reconnect prompt

- [ ] **Step 2: Update RiftContentTree.tsx**

Key changes:
- Remove `cmUrl` and `accessToken` props
- Update `fetchTreeChildren` calls to only pass `parentPath`
- Remove `cmUrl` and `accessToken` from `useEffect` dependencies and `handleExpand` callback

- [ ] **Step 3: Update RiftEnvironments.tsx**

Key changes:
- Update `authenticate` call in `handleConnect` to include `envId`, `cmUrl`, `envName`
- Remove `deployAccessToken` state — use cookie-based session instead
- Update `fetchProjects` and `fetchEnvironments` calls to remove `accessToken` param
- Update `handleTest` to pass env metadata to `authenticate`

- [ ] **Step 4: Update RiftSetupWizard.tsx**

Key changes:
- Update `authenticate` calls to include env metadata
- Remove token state variables (`step1Token`, `step2Token`)
- Update `fetchProjects` and `fetchEnvironments` calls to remove token params

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/components/rift/RiftMigrate.tsx src/components/rift/RiftContentTree.tsx src/components/rift/RiftEnvironments.tsx src/components/rift/RiftSetupWizard.tsx
git commit -m "feat: update UI components to use session-based auth (no client-side credentials)"
```

---

### Task 10: Remove Client-Side Encryption

**Files:**
- Delete: `src/lib/rift/crypto.ts`
- Modify: `src/lib/rift/storage.ts`
- Modify: `src/lib/rift/types.ts`

- [ ] **Step 1: Update types.ts — remove credentials from RiftEnvironment**

```typescript
export interface RiftEnvironment {
  id: string;
  name: string;
  cmUrl: string;
  allowWrite: boolean;
}
```

Remove `clientId` and `clientSecret` fields entirely.

- [ ] **Step 2: Update storage.ts — remove encryption**

Remove all imports from `crypto.ts`. Remove `StoredEnvironment` interface, `encryptEnv`, `decryptEnv`. The environment functions become simple synchronous localStorage operations since there's nothing to encrypt:

```typescript
import type { RiftEnvironment, RiftPreset, RiftSettings, MigrationHistoryEntry } from './types';
import { DEFAULT_SETTINGS } from './types';

const ENVS_KEY = 'rift:environments';
const PRESETS_KEY = 'rift:presets';
const SETTINGS_KEY = 'rift:settings';
const HISTORY_KEY = 'rift:history';
const MAX_HISTORY = 50;

function readJson<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeJson<T>(key: string, data: T[]): void {
  localStorage.setItem(key, JSON.stringify(data));
}

// --- Environments (sync, no credentials stored) ---

export function getEnvironments(): RiftEnvironment[] {
  return readJson<RiftEnvironment>(ENVS_KEY);
}

export function saveEnvironment(env: RiftEnvironment): void {
  const envs = getEnvironments();
  const idx = envs.findIndex((e) => e.id === env.id);
  if (idx >= 0) {
    envs[idx] = env;
  } else {
    envs.push(env);
  }
  writeJson(ENVS_KEY, envs);
}

export function deleteEnvironment(id: string): void {
  writeJson(ENVS_KEY, getEnvironments().filter((e) => e.id !== id));
}

// --- rest of file unchanged (presets, settings, history) ---
```

Note: `getEnvironments` and `saveEnvironment` change from `async` to sync — all callers that `await` them will need updating (this is fine, awaiting a non-promise is a no-op, but clean up the `await` calls for clarity).

- [ ] **Step 3: Delete crypto.ts**

```bash
rm src/lib/rift/crypto.ts
```

- [ ] **Step 4: Update all callers of getEnvironments/saveEnvironment**

These functions were `async` and are now sync. Search for `await getEnvironments()` and `await saveEnvironment()` across the codebase and remove the `await`. The functions no longer return promises.

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: remove client-side encryption, credentials no longer stored in browser"
```

---

### Task 11: Update GitHub Actions Deploy Workflow

**Files:**
- Modify: `.github/workflows/deploy-azure.yml`

The deploy workflow may need to ensure the new env vars are available. Since we set them via `az webapp config appsettings`, they're already configured on the App Service. But verify the workflow doesn't override app settings.

- [ ] **Step 1: Check the deploy workflow**

Read `.github/workflows/deploy-azure.yml` and verify it doesn't hardcode or override `AZURE_KEYVAULT_URL`, `AZURE_STORAGE_ACCOUNT`, or `AZURE_STORAGE_TABLE`. If it does, add them. If it doesn't (most likely), no changes needed.

- [ ] **Step 2: Commit (if changes needed)**

```bash
git add .github/workflows/deploy-azure.yml
git commit -m "chore: ensure Azure session store env vars in deploy workflow"
```

---

### Task 12: End-to-End Testing

**Files:** None (manual testing)

- [ ] **Step 1: Test locally**

```bash
npm run dev
```

1. Open http://localhost:3001/rift
2. Go to Environments → Add Environment
3. Enter credentials → Connect → Select project → Select environment → Save
4. Verify the session cookie is set (DevTools → Application → Cookies)
5. Browse the content tree (should work via session cookie)
6. Start a migration (should work without credentials in request body)
7. Wait 5 minutes, browse tree again (should still work — sliding window)
8. Check localStorage — verify no `clientId` or `clientSecret` values

- [ ] **Step 2: Test session expiry**

Temporarily change `SESSION_TTL_MS` to `30_000` (30 seconds) in `session-store.ts`. Connect, wait 30s without interacting, then try to browse tree. Should get "Session expired" error. Change TTL back to `60 * 60 * 1000` after testing.

- [ ] **Step 3: Test migration with two environments**

1. Add source environment (connect)
2. Add target environment (connect)
3. Start migration — verify both sessions are used correctly
4. Verify migration completes successfully

---

### Task 13: Privacy Policy & Terms Updates (rift-site repo)

**Files:**
- Modify: `../rift-site` — Privacy Policy page
- Modify: `../rift-site` — Terms of Service page

- [ ] **Step 1: Update Privacy Policy**

Find the data storage / credential section and replace references to browser-side encryption with:

> **Credential Storage:** When you connect a Sitecore environment, your client credentials are encrypted using AES-256 encryption and stored on our server infrastructure (Azure Table Storage). The encryption key is managed by Azure Key Vault, a hardware-backed key management service, and is accessible only to the application's managed identity — not to any human operator. Your credentials are automatically purged after 1 hour of inactivity. No credentials are stored in your browser.

Update data retention:

> Server-side sessions (containing encrypted credentials) are automatically deleted after 1 hour of inactivity. Active sessions are extended with each interaction. No credentials persist beyond the session lifetime.

- [ ] **Step 2: Update Terms of Service**

Update the security section:

> **Security Architecture:** Rift employs server-side credential storage with encryption at rest using Azure Key Vault, a FIPS 140-2 compliant key management service. Credentials are encrypted using AES-256 before storage and are accessible only to the application at runtime via Azure Managed Identity. Encryption keys are not accessible to any human operator. All data in transit is encrypted via TLS 1.2+. Server-side sessions expire after 1 hour of inactivity.

- [ ] **Step 3: Commit in rift-site repo**

```bash
cd ../rift-site
git add .
git commit -m "docs: update privacy policy and terms for server-side credential storage"
```
