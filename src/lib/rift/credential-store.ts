import { TableClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';
import { encryptString, decryptString } from './session-store';

const CRED_TABLE = 'credentials';

export interface StoredCredentials {
  clientId: string;
  clientSecret: string;
}

// Separate table client for credentials table
let credTableClient: TableClient | null = null;

function getCredTableClient() {
  if (!credTableClient) {
    const account = process.env.AZURE_STORAGE_ACCOUNT;
    if (!account) throw new Error('AZURE_STORAGE_ACCOUNT not set');
    credTableClient = new TableClient(
      `https://${account}.table.core.windows.net`,
      CRED_TABLE,
      new DefaultAzureCredential()
    );
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
