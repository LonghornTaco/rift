import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Azure SDKs
vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class MockCredential {},
}));

vi.mock('@azure/keyvault-keys', () => {
  const mockEncrypt = vi.fn().mockResolvedValue({ result: Buffer.from('encrypted-data') });
  const mockDecrypt = vi.fn().mockImplementation((_alg: string, data: Uint8Array) => ({
    result: data, // echo back for test simplicity
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
    updateEntity = vi.fn().mockImplementation((entity: Record<string, unknown>) => {
      const key = `${entity.partitionKey}:${entity.rowKey}`;
      const existing = mockEntities.get(key);
      if (existing) mockEntities.set(key, { ...existing, ...entity });
      return Promise.resolve();
    });
    deleteEntity = vi.fn().mockImplementation((pk: string, rk: string) => {
      mockEntities.delete(`${pk}:${rk}`);
      return Promise.resolve();
    });
  },
  TableServiceClient: class MockTableServiceClient {},
}));

// Set env vars before importing the module
process.env.AZURE_KEYVAULT_URL = 'https://kv-rift-prod.vault.azure.net/';
process.env.AZURE_STORAGE_ACCOUNT = 'striftprod';
process.env.AZURE_STORAGE_TABLE = 'sessions';

import { createSession, getSession, touchSession, deleteSession, _resetForTesting } from '@/lib/rift/session-store';

describe('session-store', () => {
  beforeEach(() => {
    mockEntities.clear();
    _resetForTesting();
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
