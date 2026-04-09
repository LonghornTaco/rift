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
 *
 * SDK param conventions:
 * - path: URL path params (transferId, chunksetId, chunkId)
 * - query: URL query params (sitecoreContextId, databaseName, fileName, isMedia)
 * - body: request body (only for POST/PUT — createContentTransfer, saveChunk)
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

  // Phase 1: Create content transfer on BOTH source and target
  // The source needs the transfer to export; the target needs it to accept chunks
  report('creating');
  const transferId = crypto.randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.mutate('xmc.contentTransfer.createContentTransfer', {
    params: {
      query: { sitecoreContextId: sourceContextId },
      body: { configuration: { dataTrees: [{ itemPath, scope, mergeStrategy }] }, transferId },
    },
  } as any);
  // Create matching transfer on target so it can receive chunks.
  // Use the same transferId — the target needs this to accept chunk uploads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetCreate = await client.mutate('xmc.contentTransfer.createContentTransfer', {
    params: {
      query: { sitecoreContextId: targetContextId },
      body: { configuration: { dataTrees: [{ itemPath, scope, mergeStrategy }] }, transferId },
    },
  } as any);
  // Log if target create failed (SDK wraps errors as success with error property)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((targetCreate.data as any)?.error) {
    console.warn('[Rift] Target createContentTransfer error:', (targetCreate.data as any).error);
  }

  try {
    // Phase 2: Poll until export is ready (GET /content/v1/transfers/{transferId}/status)
    report('exporting');
    const statusResult = await pollUntilReady(client, sourceContextId, transferId, signal);
    const chunkSets = statusResult.chunkSets;

    // Phase 3: Download chunks from source (GET /content/v1/transfers/{transferId}/chunksets/{chunksetId}/chunks/{chunkId})
    report('downloading');
    const allChunks: { chunksetId: string; chunkId: number; data: Blob }[] = [];
    let totalChunks = 0;
    for (const cs of chunkSets) {
      totalChunks += cs.chunkCount;
    }
    let downloaded = 0;
    for (const cs of chunkSets) {
      for (let i = 0; i < cs.chunkCount; i++) {
        signal?.throwIfAborted();
        downloaded++;
        report('downloading', `${downloaded}/${totalChunks}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chunkResult = await client.query('xmc.contentTransfer.getChunk', {
          params: {
            path: { transferId, chunksetId: cs.chunksetId, chunkId: i },
            query: { sitecoreContextId: sourceContextId },
          },
        } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        allChunks.push({ chunksetId: cs.chunksetId, chunkId: i, data: (chunkResult.data as any)?.data as Blob });
      }
    }

    // Phase 4: Upload chunks to target (PUT /content/v1/transfers/{transferId}/chunksets/{chunksetId}/chunks/{chunkId})
    report('uploading');
    let uploaded = 0;
    for (const chunk of allChunks) {
      signal?.throwIfAborted();
      uploaded++;
      report('uploading', `${uploaded}/${totalChunks}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await client.mutate('xmc.contentTransfer.saveChunk', {
        params: {
          path: { transferId, chunksetId: chunk.chunksetId, chunkId: chunk.chunkId },
          query: { sitecoreContextId: targetContextId },
          body: chunk.data,
        },
      } as any);
    }

    // Phase 5: Complete chunk set transfer (POST /content/v1/transfers/{transferId}/chunksets/{chunksetId}/complete)
    report('assembling');
    const fileIds: string[] = [];
    for (const cs of chunkSets) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const completeResult = await client.mutate('xmc.contentTransfer.completeChunkSetTransfer', {
        params: {
          path: { transferId, chunksetId: cs.chunksetId },
          query: { sitecoreContextId: targetContextId },
        },
      } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (completeResult.data as any)?.data;
      const fileId = data?.ContentTransferFileName ?? data?.fileName ?? data?.fileId;
      if (fileId) fileIds.push(fileId);
    }
    if (fileIds.length === 0) throw new Error('completeChunkSetTransfer did not return any file identifiers');

    // Phase 6: Consume the .raif files (POST /items/v2/ConsumeFile)
    report('consuming');
    for (const fileName of fileIds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await client.query('xmc.contentTransfer.consumeFile', {
        params: {
          query: { databaseName: 'master', fileName, sitecoreContextId: targetContextId },
        },
      } as any);

      // Phase 7: Poll consume status (GET /items/v2/GetBlobState)
      await pollBlobState(client, targetContextId, fileName, signal);
    }

    report('complete');
  } finally {
    // Phase 8: Cleanup — delete transfer from both source and target
    report('cleanup');
    try {
      await Promise.allSettled([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.mutate('xmc.contentTransfer.deleteContentTransfer', {
          params: { path: { transferId }, query: { sitecoreContextId: sourceContextId } },
        } as any),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.mutate('xmc.contentTransfer.deleteContentTransfer', {
          params: { path: { transferId }, query: { sitecoreContextId: targetContextId } },
        } as any),
      ]);
    } catch {
      // Cleanup failure is non-fatal
    }
  }
}

interface ChunkSetInfo {
  chunksetId: string;
  chunkCount: number;
}

async function pollUntilReady(
  client: ClientSDK,
  contextId: string,
  transferId: string,
  signal?: AbortSignal
): Promise<{ chunkSets: ChunkSetInfo[] }> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    signal?.throwIfAborted();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await client.query('xmc.contentTransfer.getContentTransferStatus', {
      params: {
        path: { transferId },
        query: { sitecoreContextId: contextId },
      },
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (result.data as any)?.data;
    const state = data?.State ?? data?.state ?? data?.status;
    if (state === 'Ready' || state === 'Completed' || state === 'Complete') {
      const rawChunkSets = data?.ChunkSetsMetadata ?? data?.chunkSetsMetadata ?? data?.chunkSets ?? [];
      const chunkSets: ChunkSetInfo[] = rawChunkSets.map((cs: any) => ({
        chunksetId: cs.ChunkSetId ?? cs.chunkSetId ?? cs.id,
        chunkCount: cs.ChunkCount ?? cs.chunkCount ?? cs.totalChunks ?? 0,
      }));
      return { chunkSets };
    }
    if (state === 'Failed' || state === 'Error') {
      throw new Error(`Content transfer export failed: ${data?.error ?? data?.Error ?? 'unknown error'}`);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Content transfer export timed out');
}

async function pollBlobState(
  client: ClientSDK,
  contextId: string,
  fileName: string,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    signal?.throwIfAborted();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await client.query('xmc.contentTransfer.getBlobState', {
      params: {
        query: { fileName, sitecoreContextId: contextId },
      },
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (result.data as any)?.data;
    const state = data?.status ?? data?.state ?? data?.State;
    if (state === 'OK' || state === 'Complete' || state === 'Completed') return;
    if (state === 'Error' || state === 'Failed') {
      throw new Error(`Content consume failed: ${JSON.stringify(data?.details ?? data?.error ?? 'unknown error')}`);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Content consume timed out');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

