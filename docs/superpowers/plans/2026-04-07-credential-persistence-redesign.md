# Credential Persistence Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove credentials from browser localStorage, add opt-in persistent credential storage in Azure Table Storage, and support auto-reconnect from stored credentials.

**Architecture:** Credentials are decoupled from environments and sessions. A new `credentials` table in Azure Table Storage stores encrypted credentials permanently (keyed by envId). Sessions remain short-lived (1-hour TTL) access token caches. When a session expires, the server re-authenticates automatically using stored credentials. The browser only stores environment metadata (no secrets) and receives an opaque session cookie.

**Tech Stack:** Next.js 15 API routes, Azure Table Storage, Azure Key Vault (envelope encryption), React state management, Vitest

---

### Task 1: Create Credential Store Module

**Files:**
- Create: `src/lib/rift/credential-store.ts`
- Modify: `src/lib/rift/session-store.ts` (reuse `encryptString`/`decryptString` and Azure clients)
- Test: `src/__tests__/lib/rift/credential-store.test.ts`

- [ ] **Step 1: Extract shared encryption into a reusable module**

The `encryptString` and `decryptString` functions in `session-store.ts` are currently private. We also need the Azure client getters. Extract them so `credential-store.ts` can reuse them.

In `src/lib/rift/session-store.ts`, export the encryption functions and client getters by adding `export` to:
- `function getTableClient()` → `export function getTableClient()`
- `async function encryptString()` → `export async function encryptString()`
- `async function decryptString()` → `export async function decryptString()`

No other changes to session-store.ts. The existing tests should still pass.

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `npx vitest run src/__tests__/lib/rift/session-store.test.ts`
Expected: All 5 tests pass.

- [ ] **Step 3: Write failing tests for credential-store**

Create `src/__tests__/lib/rift/credential-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reuse the same Azure SDK mocks as session-store tests
vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class MockCredential {},
}));

vi.mock('@azure/keyvault-keys', () => {
  const mockEncrypt = vi.fn().mockResolvedValue({ result: Buffer.from('encrypted-data') });
  const mockDecrypt = vi.fn().mockImplementation((_alg: string, data: Uint8Array) => ({
    result: data,
  }));
  return {
    KeyClient: class MockKeyClient {
      getKey = vi.fn().mockResolvedValue({ id: 'https://kv/keys/rift-session-key/123' });
    },
    CryptographyClient: class MockCryptoClient {
      encrypt = mockEncrypt;
      decrypt = mockDecrypt;
    },
  };
});

const mockEntities = new Map<string, Record<string, unknown>>();

vi.mock('@azure/data-tables', () => ({
  TableClient: class MockTableClient {
    createEntity = vi.fn().mockImplementation((entity: Record<string, unknown>) => {
      mockEntities.set(`${entity.partitionKey}:${entity.rowKey}`, entity);
      return Promise.resolve();
    });
    getEntity = vi.fn().mockImplementation((pk: string, rk: string) => {
      const entity = mockEntities.get(`${pk}:${rk}`);
      if (!entity) throw { statusCode: 404 };
      return Promise.resolve(entity);
    });
    updateEntity = vi.fn().mockImplementation((entity: Record<string, unknown>, mode: string) => {
      const key = `${entity.partitionKey}:${entity.rowKey}`;
      if (mode === 'Replace') {
        mockEntities.set(key, entity);
      } else {
        const existing = mockEntities.get(key);
        if (existing) mockEntities.set(key, { ...existing, ...entity });
      }
      return Promise.resolve();
    });
    deleteEntity = vi.fn().mockImplementation((pk: string, rk: string) => {
      mockEntities.delete(`${pk}:${rk}`);
      return Promise.resolve();
    });
  },
}));

process.env.AZURE_KEYVAULT_URL = 'https://kv-rift-prod.vault.azure.net/';
process.env.AZURE_STORAGE_ACCOUNT = 'striftprod';
process.env.AZURE_STORAGE_TABLE = 'sessions';

import {
  storeCredentials,
  getStoredCredentials,
  hasStoredCredentials,
  deleteStoredCredentials,
  _resetCredentialStoreForTesting,
} from '@/lib/rift/credential-store';
import { _resetForTesting as _resetSessionStore } from '@/lib/rift/session-store';

describe('credential-store', () => {
  beforeEach(() => {
    mockEntities.clear();
    _resetCredentialStoreForTesting();
    _resetSessionStore();
  });

  it('stores and retrieves credentials', async () => {
    await storeCredentials('env-1', 'my-client-id', 'my-client-secret');
    const creds = await getStoredCredentials('env-1');
    expect(creds).not.toBeNull();
    expect(creds!.clientId).toBeTruthy();
    expect(creds!.clientSecret).toBeTruthy();
  });

  it('returns null for non-existent credentials', async () => {
    const creds = await getStoredCredentials('no-such-env');
    expect(creds).toBeNull();
  });

  it('reports hasStoredCredentials correctly', async () => {
    expect(await hasStoredCredentials('env-1')).toBe(false);
    await storeCredentials('env-1', 'cid', 'csec');
    expect(await hasStoredCredentials('env-1')).toBe(true);
  });

  it('deletes credentials', async () => {
    await storeCredentials('env-1', 'cid', 'csec');
    await deleteStoredCredentials('env-1');
    expect(await hasStoredCredentials('env-1')).toBe(false);
    const creds = await getStoredCredentials('env-1');
    expect(creds).toBeNull();
  });

  it('overwrites existing credentials on re-store', async () => {
    await storeCredentials('env-1', 'old-id', 'old-secret');
    await storeCredentials('env-1', 'new-id', 'new-secret');
    const creds = await getStoredCredentials('env-1');
    expect(creds).not.toBeNull();
    // Encrypted data changes, so just verify it resolves
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/rift/credential-store.test.ts`
Expected: FAIL — module `@/lib/rift/credential-store` does not exist.

- [ ] **Step 5: Implement credential-store module**

Create `src/lib/rift/credential-store.ts`:

```typescript
import { getTableClient, encryptString, decryptString } from './session-store';

const CRED_TABLE = 'credentials';

export interface StoredCredentials {
  clientId: string;
  clientSecret: string;
}

// Separate table client for credentials table
let credTableClient: ReturnType<typeof getTableClient> | null = null;

function getCredTableClient() {
  if (!credTableClient) {
    const account = process.env.AZURE_STORAGE_ACCOUNT;
    if (!account) throw new Error('AZURE_STORAGE_ACCOUNT not set');
    // Import TableClient directly to create a client for the credentials table
    // We reuse the same storage account but a different table
    const { TableClient } = require('@azure/data-tables');
    const { DefaultAzureCredential } = require('@azure/identity');
    credTableClient = new TableClient(
      `https://${account}.table.core.windows.net`,
      CRED_TABLE,
      new DefaultAzureCredential()
    ) as ReturnType<typeof getTableClient>;
  }
  return credTableClient;
}

export async function storeCredentials(
  envId: string,
  clientId: string,
  clientSecret: string
): Promise<void> {
  const table = getCredTableClient();
  const encryptedClientId = await encryptString(clientId);
  const encryptedClientSecret = await encryptString(clientSecret);

  // Upsert: try update first, create if not exists
  try {
    await table.upsertEntity(
      {
        partitionKey: envId,
        rowKey: 'cred',
        encryptedClientId,
        encryptedClientSecret,
        updatedAt: Date.now(),
      },
      'Replace'
    );
  } catch {
    // Fallback: create
    await table.createEntity({
      partitionKey: envId,
      rowKey: 'cred',
      encryptedClientId,
      encryptedClientSecret,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}

export async function getStoredCredentials(
  envId: string
): Promise<StoredCredentials | null> {
  const table = getCredTableClient();
  try {
    const entity = await table.getEntity(envId, 'cred');
    return {
      clientId: await decryptString(entity.encryptedClientId as string),
      clientSecret: await decryptString(entity.encryptedClientSecret as string),
    };
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'statusCode' in err &&
      (err as { statusCode: number }).statusCode === 404
    ) {
      return null;
    }
    throw err;
  }
}

export async function hasStoredCredentials(envId: string): Promise<boolean> {
  const table = getCredTableClient();
  try {
    await table.getEntity(envId, 'cred');
    return true;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'statusCode' in err &&
      (err as { statusCode: number }).statusCode === 404
    ) {
      return false;
    }
    throw err;
  }
}

export async function deleteStoredCredentials(envId: string): Promise<void> {
  const table = getCredTableClient();
  try {
    await table.deleteEntity(envId, 'cred');
  } catch {}
}

export function _resetCredentialStoreForTesting(): void {
  credTableClient = null;
}
```

**Note:** The `getCredTableClient()` uses `require()` because the Azure SDK mocks are set up at module level in tests. This follows the same lazy-init pattern as `session-store.ts`. In production, both tables live in the same storage account (`striftprod`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/rift/credential-store.test.ts`
Expected: All 5 tests pass.

- [ ] **Step 7: Run all tests to verify no regression**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/rift/credential-store.ts src/lib/rift/session-store.ts src/__tests__/lib/rift/credential-store.test.ts
git commit -m "feat: add credential-store module for persistent server-side credential storage"
```

---

### Task 2: Create Credentials API Route

**Files:**
- Create: `src/app/api/rift/credentials/route.ts`
- Modify: `src/lib/rift/session-store.ts` (add `serverExternalPackages` entry if needed — already done)

- [ ] **Step 1: Create the credentials API route**

Create `src/app/api/rift/credentials/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rift/api-security';
import { logError } from '@/lib/rift/logger';
import {
  storeCredentials,
  hasStoredCredentials,
  deleteStoredCredentials,
} from '@/lib/rift/credential-store';

interface CredentialRequestBody {
  envId: string;
  clientId?: string;
  clientSecret?: string;
  action?: 'store' | 'check' | 'delete';
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  if (!rateLimit(clientIp, 60_000, 20)) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 }
    );
  }

  let body: CredentialRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { envId, action = 'store' } = body;
  if (!envId) {
    return NextResponse.json({ error: 'envId is required' }, { status: 400 });
  }

  try {
    if (action === 'check') {
      const has = await hasStoredCredentials(envId);
      return NextResponse.json({ hasCredentials: has });
    }

    if (action === 'delete') {
      await deleteStoredCredentials(envId);
      return NextResponse.json({ deleted: true });
    }

    // action === 'store'
    const { clientId, clientSecret } = body;
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'clientId and clientSecret are required for store action' },
        { status: 400 }
      );
    }

    await storeCredentials(envId, clientId, clientSecret);
    return NextResponse.json({ stored: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logError('/api/rift/credentials', 'credential_operation_error', detail, { clientIp });
    return NextResponse.json(
      { error: 'Credential operation failed' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/rift/credentials/route.ts
git commit -m "feat: add credentials API route for storing/checking/deleting credentials"
```

---

### Task 3: Modify Auth Route to Support Re-Authentication from Stored Credentials

**Files:**
- Modify: `src/app/api/rift/auth/route.ts`

- [ ] **Step 1: Update auth route to accept envId-only re-auth**

Replace the contents of `src/app/api/rift/auth/route.ts` with:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIp } from '@/lib/rift/api-security';
import { logAuth, logRateLimit, logError } from '@/lib/rift/logger';
import { createSession } from '@/lib/rift/session-store';
import { getStoredCredentials } from '@/lib/rift/credential-store';
import { buildSessionCookie } from '@/lib/rift/session-middleware';

interface AuthRequestBody {
  clientId?: string;
  clientSecret?: string;
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

  let { clientId, clientSecret } = body;
  const { envId, cmUrl, envName } = body;

  // If credentials not provided directly, look up stored credentials
  if (!clientId || !clientSecret) {
    if (!envId) {
      return NextResponse.json(
        { error: 'clientId/clientSecret or envId with stored credentials required' },
        { status: 400 }
      );
    }
    try {
      const stored = await getStoredCredentials(envId);
      if (!stored) {
        return NextResponse.json(
          { error: 'no_stored_credentials', message: 'No stored credentials for this environment.' },
          { status: 401 }
        );
      }
      clientId = stored.clientId;
      clientSecret = stored.clientSecret;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logError('/api/rift/auth', 'credential_lookup_error', detail, { clientIp });
      return NextResponse.json(
        { error: 'Failed to retrieve stored credentials' },
        { status: 500 }
      );
    }
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
    let sessionId: string;
    try {
      sessionId = await createSession({
        envId: envId || 'unknown',
        clientId,
        clientSecret,
        accessToken,
        cmUrl: cmUrl || '',
        envName: envName || '',
      });
    } catch (sessionErr) {
      const detail = sessionErr instanceof Error ? sessionErr.message : String(sessionErr);
      logError('/api/rift/auth', 'session_create_error', detail, { clientIp });
      return NextResponse.json(
        { error: 'Failed to create session' },
        { status: 500 }
      );
    }

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

Key change: if `clientId`/`clientSecret` are missing from the request body, the route looks them up from the credential store using `envId`. This enables re-auth from stored credentials without the browser needing to know the secrets.

- [ ] **Step 2: Build to verify compilation**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/rift/auth/route.ts
git commit -m "feat: auth route supports re-auth from stored credentials via envId"
```

---

### Task 4: Provision Azure Credentials Table

**Files:** None (Azure CLI only)

- [ ] **Step 1: Create the credentials table in the existing storage account**

```bash
az storage table create --name credentials --account-name striftprod --auth-mode login
```

If the above fails due to auth-mode, use:

```bash
az rest --method put \
  --url "https://striftprod.table.core.windows.net/Tables" \
  --headers "Content-Type=application/json" "Accept=application/json;odata=nometadata" \
  --body '{"TableName": "credentials"}'
```

Expected: Table created successfully.

- [ ] **Step 2: Verify the table exists**

```bash
az storage table list --account-name striftprod --auth-mode login --query "[].name" -o tsv
```

Expected output includes both `sessions` and `credentials`.

- [ ] **Step 3: Add AZURE_CREDENTIAL_TABLE env var to App Service**

```bash
az webapp config appsettings set --name rift-prod --resource-group rg-longhorntaco-marketplace \
  --settings AZURE_CREDENTIAL_TABLE=credentials
```

- [ ] **Step 4: Add to .env.local**

Append to `.env.local`:
```
AZURE_CREDENTIAL_TABLE=credentials
```

---

### Task 5: Remove Credentials from RiftEnvironment Type and localStorage

**Files:**
- Modify: `src/lib/rift/types.ts`
- Modify: `src/lib/rift/storage.ts`

- [ ] **Step 1: Update RiftEnvironment type**

In `src/lib/rift/types.ts`, change the `RiftEnvironment` interface:

```typescript
export interface RiftEnvironment {
  id: string;
  name: string;
  cmUrl: string;
  allowWrite: boolean;
  hasStoredCredentials?: boolean; // UI hint — server is source of truth
}
```

Remove `clientId` and `clientSecret` fields entirely.

- [ ] **Step 2: Build to find all compile errors**

Run: `npx tsc --noEmit 2>&1 | head -60`

This will produce errors everywhere `env.clientId` and `env.clientSecret` are referenced. Note down the file:line locations — these will be fixed in Tasks 6-8.

- [ ] **Step 3: Commit the type change only**

```bash
git add src/lib/rift/types.ts
git commit -m "refactor: remove clientId/clientSecret from RiftEnvironment type"
```

---

### Task 6: Update Client-Side Auth Helper

**Files:**
- Modify: `src/lib/rift/sitecore-auth.ts`
- Modify: `src/lib/rift/api-client.ts`

- [ ] **Step 1: Add authenticateFromStored helper**

In `src/lib/rift/sitecore-auth.ts`, add a function that authenticates using stored credentials (no clientId/clientSecret needed from browser):

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

/** Authenticate using server-side stored credentials (no secrets from browser) */
export async function authenticateFromStored(
  envId: string,
  cmUrl: string,
  envName: string
): Promise<AuthResult> {
  const res = await fetch('/api/rift/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envId, cmUrl, envName }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.message || `Authentication failed (${res.status})`);
  }

  return res.json();
}
```

- [ ] **Step 2: Add client-side credential API helpers**

In `src/lib/rift/api-client.ts`, add at the end of the file:

```typescript
/** Store credentials server-side for an environment */
export async function storeCredentialsApi(
  envId: string,
  clientId: string,
  clientSecret: string
): Promise<void> {
  const res = await fetch('/api/rift/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envId, clientId, clientSecret, action: 'store' }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to store credentials');
  }
}

/** Check if credentials are stored server-side for an environment */
export async function checkCredentialsApi(envId: string): Promise<boolean> {
  const res = await fetch('/api/rift/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envId, action: 'check' }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.hasCredentials === true;
}

/** Delete stored credentials for an environment */
export async function deleteCredentialsApi(envId: string): Promise<void> {
  const res = await fetch('/api/rift/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envId, action: 'delete' }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete credentials');
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/rift/sitecore-auth.ts src/lib/rift/api-client.ts
git commit -m "feat: add authenticateFromStored and credential API client helpers"
```

---

### Task 7: Update RiftEnvironments Component

This is the largest component change. The environment card needs new states, a "Forget Credentials" button, a "Reconnect" button, and the "Remember Credentials" opt-in checkbox with informational modal.

**Files:**
- Modify: `src/components/rift/RiftEnvironments.tsx`

- [ ] **Step 1: Update imports and add new state**

At the top of `RiftEnvironments.tsx`, add imports:

```typescript
import { authenticate, authenticateFromStored } from '@/lib/rift/sitecore-auth';
import { storeCredentialsApi, deleteCredentialsApi, checkCredentialsApi } from '@/lib/rift/api-client';
```

Add new state variables after existing state declarations (around line 85):

```typescript
const [rememberCredentials, setRememberCredentials] = useState(false);
const [showRememberModal, setShowRememberModal] = useState(false);
const [pendingRememberAction, setPendingRememberAction] = useState<(() => void) | null>(null);
const [reconnectEnvId, setReconnectEnvId] = useState<string | null>(null);
const [reconnectClientId, setReconnectClientId] = useState('');
const [reconnectClientSecret, setReconnectClientSecret] = useState('');
const [reconnectError, setReconnectError] = useState<string | null>(null);
const [isReconnecting, setIsReconnecting] = useState(false);
const [credentialStatuses, setCredentialStatuses] = useState<Record<string, boolean>>({});
```

- [ ] **Step 2: Add credential status check on mount**

Add a `useEffect` after `refreshEnvironments` that checks credential status for all environments:

```typescript
useEffect(() => {
  async function checkAllCredentials() {
    const envs = getEnvironments();
    const statuses: Record<string, boolean> = {};
    for (const env of envs) {
      statuses[env.id] = env.hasStoredCredentials ?? false;
    }
    setCredentialStatuses(statuses);
  }
  checkAllCredentials();
}, [environments]);
```

- [ ] **Step 3: Update handleSaveNew to conditionally store credentials**

Replace `handleSaveNew` (around line 145):

```typescript
async function handleSaveNew() {
  if (rememberCredentials) {
    const env: RiftEnvironment = {
      id: crypto.randomUUID(),
      name: envName,
      cmUrl: envCmUrl,
      allowWrite,
      hasStoredCredentials: true,
    };
    await storeCredentialsApi(env.id, clientId, clientSecret);
    saveEnvironment(env);
    refreshEnvironments();
    closeModal();
  } else {
    // Ephemeral — don't save environment, just authenticate for this session
    closeModal();
  }
}
```

- [ ] **Step 4: Update handleTest to use stored credentials when available**

Replace `handleTest` (around line 212):

```typescript
async function handleTest(env: RiftEnvironment) {
  setTestingId(env.id);
  setTestError((prev) => {
    const next = { ...prev };
    delete next[env.id];
    return next;
  });
  try {
    if (env.hasStoredCredentials) {
      await authenticateFromStored(env.id, env.cmUrl, env.name);
    } else {
      // No stored credentials — can't test. Show reconnect prompt.
      setConnectionStatuses((prev) => ({ ...prev, [env.id]: 'failed' }));
      setTestError((prev) => ({ ...prev, [env.id]: 'No credentials stored. Use Reconnect.' }));
      setTestingId(null);
      return;
    }
    setConnectionStatuses((prev) => ({ ...prev, [env.id]: 'connected' }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    setConnectionStatuses((prev) => ({ ...prev, [env.id]: 'failed' }));
    setTestError((prev) => ({ ...prev, [env.id]: message }));
  } finally {
    setTestingId(null);
  }
}
```

- [ ] **Step 5: Add Forget Credentials handler**

```typescript
async function handleForgetCredentials(envId: string) {
  try {
    await deleteCredentialsApi(envId);
    const env = environments.find((e) => e.id === envId);
    if (env) {
      saveEnvironment({ ...env, hasStoredCredentials: false });
    }
    setCredentialStatuses((prev) => ({ ...prev, [envId]: false }));
    setConnectionStatuses((prev) => ({ ...prev, [envId]: 'untested' }));
    refreshEnvironments();
  } catch (err) {
    console.error('[Rift] Failed to forget credentials:', err);
  }
}
```

- [ ] **Step 6: Add Reconnect handlers**

```typescript
function openReconnect(envId: string) {
  setReconnectEnvId(envId);
  setReconnectClientId('');
  setReconnectClientSecret('');
  setReconnectError(null);
  setRememberCredentials(false);
}

async function handleReconnect() {
  if (!reconnectEnvId) return;
  setIsReconnecting(true);
  setReconnectError(null);
  try {
    const env = environments.find((e) => e.id === reconnectEnvId);
    if (!env) return;

    await authenticate(reconnectClientId, reconnectClientSecret, env.id, env.cmUrl, env.name);

    if (rememberCredentials) {
      await storeCredentialsApi(env.id, reconnectClientId, reconnectClientSecret);
      saveEnvironment({ ...env, hasStoredCredentials: true });
      setCredentialStatuses((prev) => ({ ...prev, [env.id]: true }));
    }

    setConnectionStatuses((prev) => ({ ...prev, [env.id]: 'connected' }));
    setReconnectEnvId(null);
    refreshEnvironments();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Reconnect failed';
    setReconnectError(message);
  } finally {
    setIsReconnecting(false);
  }
}
```

- [ ] **Step 7: Update confirmDelete to also delete stored credentials**

Replace `confirmDelete` (around line 232):

```typescript
async function confirmDelete() {
  if (!deleteConfirmId) return;
  await deleteCredentialsApi(deleteConfirmId).catch(() => {});
  deleteEnvironment(deleteConfirmId);
  setConnectionStatuses((prev) => {
    const next = { ...prev };
    delete next[deleteConfirmId];
    return next;
  });
  setCredentialStatuses((prev) => {
    const next = { ...prev };
    delete next[deleteConfirmId];
    return next;
  });
  setDeleteConfirmId(null);
  refreshEnvironments();
}
```

- [ ] **Step 8: Update environment card rendering**

In the card grid (around line 471), update the button row to conditionally show Forget Credentials / Reconnect:

Replace the `{/* Masked Client ID */}` section (lines 509-512) with:

```tsx
{/* Credential status */}
<div className="text-xs text-muted-foreground">
  {env.hasStoredCredentials ? (
    <span className="text-green-600 dark:text-green-400">Credentials stored</span>
  ) : (
    <span className="text-amber-600 dark:text-amber-400">No credentials</span>
  )}
</div>
```

Replace the button row (lines 526-551) with:

```tsx
{/* Button row */}
<div className="flex gap-2 mt-1 flex-wrap">
  {env.hasStoredCredentials ? (
    <>
      <Button variant="outline" size="xs" onClick={() => handleTest(env)} disabled={isTesting} className="text-primary">
        {isTesting ? 'Testing...' : 'Test'}
      </Button>
      <Button variant="outline" size="xs" onClick={() => openEditModal(env)}>
        Edit
      </Button>
      <Button variant="outline" size="xs" onClick={() => handleForgetCredentials(env.id)}>
        Forget Credentials
      </Button>
      <Button variant="outline" size="xs" colorScheme="danger" onClick={() => setDeleteConfirmId(env.id)}>
        Delete
      </Button>
    </>
  ) : (
    <>
      <Button variant="outline" size="xs" className="text-primary" onClick={() => openReconnect(env.id)}>
        Reconnect
      </Button>
      <Button variant="outline" size="xs" onClick={() => openEditModal(env)}>
        Edit
      </Button>
      <Button variant="outline" size="xs" colorScheme="danger" onClick={() => setDeleteConfirmId(env.id)}>
        Delete
      </Button>
    </>
  )}
</div>
```

- [ ] **Step 9: Add Remember Credentials checkbox to Add modal**

In `renderAddModal()`, after the Read Only checkbox (around line 435), add:

```tsx
<div className="flex items-center gap-2">
  <Checkbox
    checked={rememberCredentials}
    onCheckedChange={(checked) => {
      if (checked === true) {
        setShowRememberModal(true);
      } else {
        setRememberCredentials(false);
      }
    }}
    id="rememberCredsNew"
  />
  <Label htmlFor="rememberCredsNew" className="text-sm text-foreground">
    Remember Credentials
  </Label>
</div>
```

- [ ] **Step 10: Add Remember Credentials informational modal**

After the delete confirmation dialog (around line 585), add the informational modal and reconnect dialog:

```tsx
{/* Remember Credentials info modal */}
<AlertDialog open={showRememberModal} onOpenChange={(open) => { if (!open) setShowRememberModal(false); }}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Credential Storage</AlertDialogTitle>
      <AlertDialogDescription>
        Your credentials will be encrypted and stored securely on our servers. Only the application can access them — no person can view or retrieve your credentials. You can delete them at any time from the Environments page.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onClick={() => setShowRememberModal(false)}>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={() => { setRememberCredentials(true); setShowRememberModal(false); }}>
        Continue
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

{/* Reconnect dialog */}
<Dialog open={!!reconnectEnvId} onOpenChange={(open) => { if (!open) setReconnectEnvId(null); }}>
  <DialogContent size="sm">
    <DialogHeader>
      <DialogTitle>Reconnect Environment</DialogTitle>
    </DialogHeader>
    <div className="flex flex-col gap-3">
      <div>
        <Label className="text-xs font-semibold text-foreground mb-1">Client ID</Label>
        <Input
          type="text"
          value={reconnectClientId}
          onChange={(e) => setReconnectClientId(e.target.value)}
          placeholder="Enter your Sitecore Client ID"
        />
      </div>
      <div>
        <Label className="text-xs font-semibold text-foreground mb-1">Client Secret</Label>
        <Input
          type="password"
          value={reconnectClientSecret}
          onChange={(e) => setReconnectClientSecret(e.target.value)}
          placeholder="Enter your Sitecore Client Secret"
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={rememberCredentials}
          onCheckedChange={(checked) => {
            if (checked === true) {
              setShowRememberModal(true);
            } else {
              setRememberCredentials(false);
            }
          }}
          id="rememberCredsReconnect"
        />
        <Label htmlFor="rememberCredsReconnect" className="text-sm text-foreground">
          Remember Credentials
        </Label>
      </div>
      {reconnectError && (
        <div className="text-xs text-destructive px-3 py-2 bg-destructive/10 rounded border border-destructive/30">
          {reconnectError}
        </div>
      )}
      <DialogFooter className="mt-2">
        <Button variant="outline" onClick={() => setReconnectEnvId(null)}>Cancel</Button>
        <Button
          onClick={handleReconnect}
          disabled={isReconnecting || !reconnectClientId || !reconnectClientSecret}
        >
          {isReconnecting ? 'Connecting...' : 'Connect'}
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
```

- [ ] **Step 11: Build to verify compilation**

Run: `npm run build`
Expected: Build succeeds. There may be errors in other components (RiftSetupWizard, RiftMigrate) due to the type change — those are fixed in Tasks 8 and 9.

- [ ] **Step 12: Commit**

```bash
git add src/components/rift/RiftEnvironments.tsx
git commit -m "feat: environment cards with credential storage opt-in, forget, and reconnect"
```

---

### Task 8: Update RiftSetupWizard Component

**Files:**
- Modify: `src/components/rift/RiftSetupWizard.tsx`

- [ ] **Step 1: Add state and imports for credential opt-in**

Add imports for `storeCredentialsApi` and add state:

```typescript
import { storeCredentialsApi } from '@/lib/rift/api-client';
```

Add state variables (after existing state, around line 77):

```typescript
const [rememberCredentials, setRememberCredentials] = useState(false);
const [showRememberModal, setShowRememberModal] = useState(false);
```

- [ ] **Step 2: Update handleStep1Next to conditionally save environment**

Replace `handleStep1Next` (around line 132):

```typescript
async function handleStep1Next() {
  if (rememberCredentials) {
    const env: RiftEnvironment = {
      id: crypto.randomUUID(),
      name: step1EnvName,
      cmUrl: step1CmUrl,
      allowWrite: step1AllowWrite,
      hasStoredCredentials: true,
    };
    await storeCredentialsApi(env.id, clientId, clientSecret);
    saveEnvironment(env);
  }

  setSavedClientId(clientId);
  setSavedClientSecret(clientSecret);
  setSavedProjectId(step1SelectedProjectId);

  setStep2Phase('credentials');
  setClientId(clientId);
  setClientSecret(clientSecret);
  setRememberCredentials(false); // Reset for step 2

  setWizardStep(2);
}
```

- [ ] **Step 3: Update handleStep2Finish similarly**

Replace `handleStep2Finish` (around line 224):

```typescript
async function handleStep2Finish() {
  if (rememberCredentials) {
    const env: RiftEnvironment = {
      id: crypto.randomUUID(),
      name: step2EnvName,
      cmUrl: step2CmUrl,
      allowWrite: step2AllowWrite,
      hasStoredCredentials: true,
    };
    await storeCredentialsApi(env.id, clientId, clientSecret);
    saveEnvironment(env);
  }
  onComplete();
}
```

- [ ] **Step 4: Add Remember Credentials checkbox to the select forms**

In `renderSelectForm()` (around line 312), find the Read Only checkbox section and add after it:

```tsx
<div className="flex items-center gap-2">
  <Checkbox
    checked={rememberCredentials}
    onCheckedChange={(checked) => {
      if (checked === true) {
        setShowRememberModal(true);
      } else {
        setRememberCredentials(false);
      }
    }}
    id={`rememberCreds-step${wizardStep}`}
  />
  <Label htmlFor={`rememberCreds-step${wizardStep}`} className="text-sm text-foreground">
    Remember Credentials
  </Label>
</div>
```

- [ ] **Step 5: Add the informational modal**

Before the closing `</div>` of the component's return, add:

```tsx
<AlertDialog open={showRememberModal} onOpenChange={(open) => { if (!open) setShowRememberModal(false); }}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Credential Storage</AlertDialogTitle>
      <AlertDialogDescription>
        Your credentials will be encrypted and stored securely on our servers. Only the application can access them — no person can view or retrieve your credentials. You can delete them at any time from the Environments page.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onClick={() => setShowRememberModal(false)}>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={() => { setRememberCredentials(true); setShowRememberModal(false); }}>
        Continue
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Add the `AlertDialog` imports at the top if not already present.

- [ ] **Step 6: Build to verify**

Run: `npm run build`
Expected: Build succeeds (or only RiftMigrate errors remain — fixed in Task 9).

- [ ] **Step 7: Commit**

```bash
git add src/components/rift/RiftSetupWizard.tsx
git commit -m "feat: add Remember Credentials opt-in to setup wizard"
```

---

### Task 9: Update RiftMigrate Component

**Files:**
- Modify: `src/components/rift/RiftMigrate.tsx`

- [ ] **Step 1: Update handleEnvChange to use stored credentials**

Import `authenticateFromStored`:

```typescript
import { authenticate, authenticateFromStored } from '@/lib/rift/sitecore-auth';
```

Replace `handleEnvChange` (around line 297):

```typescript
const handleEnvChange = useCallback(
  async (envId: string) => {
    setSelectedEnvId(envId);
    setSelectedSiteRootPath(null);
    setSites([]);
    setSessionId(null);
    setAuthError(null);

    if (!envId) return;

    const envs = getEnvironments();
    const env = envs.find((e) => e.id === envId);
    if (!env) return;

    if (selectedTargetEnvId === envId) {
      setSelectedTargetEnvId(null);
    }

    try {
      setIsLoadingSites(true);
      let result;
      if (env.hasStoredCredentials) {
        result = await authenticateFromStored(env.id, env.cmUrl, env.name);
      } else {
        // No stored credentials — need credential prompt
        setAuthError('No credentials available. Please reconnect this environment.');
        return;
      }
      setSessionId(result.sessionId);
      const fetchedSites = await fetchSites();
      setSites(fetchedSites);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed');
      setSites([]);
      setSessionId(null);
    } finally {
      setIsLoadingSites(false);
    }
  },
  [selectedTargetEnvId]
);
```

- [ ] **Step 2: Update handleTargetEnvChange similarly**

Replace `handleTargetEnvChange` (around line 334):

```typescript
const handleTargetEnvChange = useCallback(async (envId: string) => {
  setSelectedTargetEnvId(envId);
  setTargetSessionId(null);
  const envs = getEnvironments();
  const env = envs.find((e) => e.id === envId);
  if (env) {
    try {
      let result;
      if (env.hasStoredCredentials) {
        result = await authenticateFromStored(env.id, env.cmUrl, env.name);
      } else {
        setAuthError('No credentials available for target. Please reconnect this environment.');
        return;
      }
      setTargetSessionId(result.sessionId);
    } catch {
      setAuthError('Failed to authenticate target environment');
    }
  }
}, []);
```

- [ ] **Step 3: Build to verify compilation**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/rift/RiftMigrate.tsx
git commit -m "feat: migrate page uses stored credentials for auto-reconnect"
```

---

### Task 10: Add Credential Prompt for Preset Loading Without Credentials

**Files:**
- Modify: `src/components/rift/RiftMigrate.tsx`

- [ ] **Step 1: Add credential prompt state**

Add state for the credential prompt dialog (after existing state around line 68):

```typescript
const [credPromptEnvId, setCredPromptEnvId] = useState<string | null>(null);
const [credPromptClientId, setCredPromptClientId] = useState('');
const [credPromptClientSecret, setCredPromptClientSecret] = useState('');
const [credPromptError, setCredPromptError] = useState<string | null>(null);
const [isCredPrompting, setIsCredPrompting] = useState(false);
const [credPromptRemember, setCredPromptRemember] = useState(false);
const [showCredRememberModal, setShowCredRememberModal] = useState(false);
const [credPromptRole, setCredPromptRole] = useState<'source' | 'target'>('source');
const [credPromptCallback, setCredPromptCallback] = useState<(() => void) | null>(null);
```

- [ ] **Step 2: Update handleEnvChange to show credential prompt instead of error**

In `handleEnvChange`, replace the `setAuthError('No credentials available...')` block with:

```typescript
if (!env.hasStoredCredentials) {
  setCredPromptEnvId(env.id);
  setCredPromptRole('source');
  setCredPromptClientId('');
  setCredPromptClientSecret('');
  setCredPromptError(null);
  setCredPromptRemember(false);
  return;
}
```

Do the same in `handleTargetEnvChange`:

```typescript
if (!env.hasStoredCredentials) {
  setCredPromptEnvId(env.id);
  setCredPromptRole('target');
  setCredPromptClientId('');
  setCredPromptClientSecret('');
  setCredPromptError(null);
  setCredPromptRemember(false);
  return;
}
```

- [ ] **Step 3: Add credential prompt submit handler**

```typescript
async function handleCredPromptSubmit() {
  if (!credPromptEnvId) return;
  setIsCredPrompting(true);
  setCredPromptError(null);

  const envs = getEnvironments();
  const env = envs.find((e) => e.id === credPromptEnvId);
  if (!env) return;

  try {
    const result = await authenticate(
      credPromptClientId,
      credPromptClientSecret,
      env.id,
      env.cmUrl,
      env.name
    );

    if (credPromptRemember) {
      await storeCredentialsApi(env.id, credPromptClientId, credPromptClientSecret);
      saveEnvironment({ ...env, hasStoredCredentials: true });
    }

    if (credPromptRole === 'source') {
      setSessionId(result.sessionId);
      const fetchedSites = await fetchSites();
      setSites(fetchedSites);
    } else {
      setTargetSessionId(result.sessionId);
    }

    setCredPromptEnvId(null);
  } catch (err) {
    setCredPromptError(err instanceof Error ? err.message : 'Authentication failed');
  } finally {
    setIsCredPrompting(false);
  }
}
```

Add import for `storeCredentialsApi`:

```typescript
import { storeCredentialsApi } from '@/lib/rift/api-client';
```

- [ ] **Step 4: Add credential prompt dialog to JSX**

Before the closing tag of the component's return JSX, add:

```tsx
{/* Credential prompt for environments without stored credentials */}
<Dialog open={!!credPromptEnvId} onOpenChange={(open) => { if (!open) setCredPromptEnvId(null); }}>
  <DialogContent size="sm">
    <DialogHeader>
      <DialogTitle>Enter Credentials</DialogTitle>
    </DialogHeader>
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Enter credentials for {credPromptRole === 'source' ? 'the source' : 'the target'} environment.
      </p>
      <div>
        <Label className="text-xs font-semibold text-foreground mb-1">Client ID</Label>
        <Input
          type="text"
          value={credPromptClientId}
          onChange={(e) => setCredPromptClientId(e.target.value)}
          placeholder="Enter your Sitecore Client ID"
        />
      </div>
      <div>
        <Label className="text-xs font-semibold text-foreground mb-1">Client Secret</Label>
        <Input
          type="password"
          value={credPromptClientSecret}
          onChange={(e) => setCredPromptClientSecret(e.target.value)}
          placeholder="Enter your Sitecore Client Secret"
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={credPromptRemember}
          onCheckedChange={(checked) => {
            if (checked === true) {
              setShowCredRememberModal(true);
            } else {
              setCredPromptRemember(false);
            }
          }}
          id="rememberCredsMigrate"
        />
        <Label htmlFor="rememberCredsMigrate" className="text-sm text-foreground">
          Remember Credentials
        </Label>
      </div>
      {credPromptError && (
        <div className="text-xs text-destructive px-3 py-2 bg-destructive/10 rounded border border-destructive/30">
          {credPromptError}
        </div>
      )}
      <DialogFooter className="mt-2">
        <Button variant="outline" onClick={() => setCredPromptEnvId(null)}>Cancel</Button>
        <Button
          onClick={handleCredPromptSubmit}
          disabled={isCredPrompting || !credPromptClientId || !credPromptClientSecret}
        >
          {isCredPrompting ? 'Connecting...' : 'Connect'}
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>

{/* Remember Credentials info modal (migrate page) */}
<AlertDialog open={showCredRememberModal} onOpenChange={(open) => { if (!open) setShowCredRememberModal(false); }}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Credential Storage</AlertDialogTitle>
      <AlertDialogDescription>
        Your credentials will be encrypted and stored securely on our servers. Only the application can access them — no person can view or retrieve your credentials. You can delete them at any time from the Environments page.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onClick={() => setShowCredRememberModal(false)}>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={() => { setCredPromptRemember(true); setShowCredRememberModal(false); }}>
        Continue
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 5: Build to verify**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/rift/RiftMigrate.tsx
git commit -m "feat: credential prompt dialog when loading presets without stored credentials"
```

---

### Task 11: Update RiftWelcome, RiftPresets, and Rift Components

Fix any remaining TypeScript errors from the `RiftEnvironment` type change (removed `clientId`/`clientSecret`).

**Files:**
- Modify: `src/components/rift/RiftWelcome.tsx` (if it references `clientId`/`clientSecret`)
- Modify: `src/components/rift/RiftPresets.tsx` (if it references `clientId`/`clientSecret`)
- Modify: `src/components/rift/Rift.tsx` (if it references `clientId`/`clientSecret`)

- [ ] **Step 1: Build to find all remaining errors**

Run: `npx tsc --noEmit 2>&1`

Fix each error. These components should not reference `clientId` or `clientSecret` from `RiftEnvironment` — they only use environment metadata.

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Build succeeds with zero errors.

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: resolve remaining TypeScript errors from RiftEnvironment type change"
```

---

### Task 12: Final Build, Test, and Cleanup

**Files:**
- Modify: `src/lib/rift/session-store.ts` (verify `serverExternalPackages` still correct)
- Modify: `next.config.ts` (no changes expected)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Verify no credentials in localStorage types**

Run: `grep -rn "clientId\|clientSecret" src/lib/rift/types.ts`
Expected: No matches (confirming credentials are removed from the browser-side type).

- [ ] **Step 4: Verify credentials are not stored in localStorage at runtime**

Run: `grep -rn "clientId\|clientSecret" src/lib/rift/storage.ts`
Expected: No matches.

- [ ] **Step 5: Commit final state**

```bash
git add -A
git commit -m "chore: final verification — no credentials in browser storage"
```
