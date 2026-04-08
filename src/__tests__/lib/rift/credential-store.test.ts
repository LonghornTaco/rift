import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reuse the same Azure SDK mocks as session-store tests
vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class MockCredential {},
}));

vi.mock('@azure/keyvault-keys', () => {
  // Identity mock: encrypt/decrypt pass through the data unchanged
  // This allows the AES key round-trip to work (encrypt stores 32-byte key, decrypt returns it)
  const mockEncrypt = vi.fn().mockImplementation((_alg: string, data: Uint8Array) => {
    return Promise.resolve({ result: Buffer.from(data) });
  });
  const mockDecrypt = vi.fn().mockImplementation((_alg: string, data: Uint8Array) => {
    return Promise.resolve({ result: Buffer.from(data) });
  });
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
  });
});
