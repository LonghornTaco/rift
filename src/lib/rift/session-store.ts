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

export function _resetForTesting(): void {
  credential = null;
  tableClient = null;
  cryptoClient = null;
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
