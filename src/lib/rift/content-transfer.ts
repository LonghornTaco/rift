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
    if (!fileId) throw new Error('completeChunkSetTransfer did not return fileId');

    // Phase 6: Consume the .raif file
    report('consuming');
    const consumeResult = await client.query('xmc.contentTransfer.consumeFile', {
      params: {
        query: { sitecoreContextId: targetContextId },
        body: { fileId },
      },
    });
    const blobId = consumeResult.data?.data?.blobId;
    if (!blobId) throw new Error('consumeFile did not return blobId');

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
