import type { experimental_XMC } from '@sitecore-marketplace-sdk/xmc';
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
 * Server-side: uses the experimental_XMC typed client which hits the XMC
 * edge platform directly with a bearer token (bypasses the iframe proxy).
 */
export async function transferPath(
  xmc: experimental_XMC,
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

  const ct = xmc.contentTransfer;
  const report = (phase: TransferPhase, detail?: string) => onProgress?.(phase, detail);
  const throwIfError = (label: string, result: { error?: unknown; response?: Response }) => {
    if (result.error) {
      const status = result.response?.status;
      throw new Error(`${label} failed${status ? ` (${status})` : ''}: ${JSON.stringify(result.error)}`);
    }
  };

  // Phase 1: Create content transfer on both source and target with the same transferId
  report('creating');
  const transferId = crypto.randomUUID();
  const configuration = {
    dataTrees: [{ itemPath, scope: scope as 'SingleItem' | 'ItemAndDescendants', mergeStrategy: mergeStrategy as 'OverrideExistingItem' }],
  };
  throwIfError(
    'createContentTransfer (source)',
    await ct.createContentTransfer({
      query: { sitecoreContextId: sourceContextId },
      body: { configuration, transferId },
    })
  );
  throwIfError(
    'createContentTransfer (target)',
    await ct.createContentTransfer({
      query: { sitecoreContextId: targetContextId },
      body: { configuration, transferId },
    })
  );

  try {
    // Phase 2: Poll until export is ready
    report('exporting');
    const { chunkSets } = await pollUntilReady(xmc, sourceContextId, transferId, signal);

    // Phase 3: Download chunks from source
    report('downloading');
    const allChunks: { chunksetId: string; chunkId: number; data: Blob }[] = [];
    const totalChunks = chunkSets.reduce((sum, cs) => sum + cs.chunkCount, 0);
    let downloaded = 0;
    for (const cs of chunkSets) {
      for (let i = 0; i < cs.chunkCount; i++) {
        signal?.throwIfAborted();
        downloaded++;
        report('downloading', `${downloaded}/${totalChunks}`);
        const result = await ct.getChunk({
          path: { transferId, chunksetId: cs.chunksetId, chunkId: i },
          query: { sitecoreContextId: sourceContextId },
        });
        throwIfError('getChunk', result);
        allChunks.push({ chunksetId: cs.chunksetId, chunkId: i, data: result.data as Blob });
      }
    }

    // Phase 4: Upload chunks to target (PUT)
    report('uploading');
    let uploaded = 0;
    for (const chunk of allChunks) {
      signal?.throwIfAborted();
      uploaded++;
      report('uploading', `${uploaded}/${totalChunks}`);
      throwIfError(
        'saveChunk',
        await ct.saveChunk({
          path: { transferId, chunksetId: chunk.chunksetId, chunkId: chunk.chunkId },
          query: { sitecoreContextId: targetContextId },
          body: chunk.data,
        })
      );
    }

    // Phase 5: Complete each chunk set
    report('assembling');
    const fileIds: string[] = [];
    for (const cs of chunkSets) {
      const result = await ct.completeChunkSetTransfer({
        path: { transferId, chunksetId: cs.chunksetId },
        query: { sitecoreContextId: targetContextId },
      });
      throwIfError('completeChunkSetTransfer', result);
      const fileId = (result.data as { ContentTransferFileName?: string } | undefined)?.ContentTransferFileName;
      if (fileId) fileIds.push(fileId);
    }
    if (fileIds.length === 0) throw new Error('completeChunkSetTransfer did not return any file identifiers');

    // Phase 6: Consume each .raif file and poll its state
    report('consuming');
    for (const fileName of fileIds) {
      throwIfError(
        'consumeFile',
        await ct.consumeFile({
          query: { databaseName: 'master', fileName, sitecoreContextId: targetContextId },
        })
      );
      await pollBlobState(xmc, targetContextId, fileName, signal);
    }

    report('complete');
  } finally {
    // Phase 8: Cleanup — delete the transfer on both environments
    report('cleanup');
    await Promise.allSettled([
      ct.deleteContentTransfer({
        path: { transferId },
        query: { sitecoreContextId: sourceContextId },
      }),
      ct.deleteContentTransfer({
        path: { transferId },
        query: { sitecoreContextId: targetContextId },
      }),
    ]);
  }
}

interface ChunkSetInfo {
  chunksetId: string;
  chunkCount: number;
}

async function pollUntilReady(
  xmc: experimental_XMC,
  contextId: string,
  transferId: string,
  signal?: AbortSignal
): Promise<{ chunkSets: ChunkSetInfo[] }> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    signal?.throwIfAborted();
    const result = await xmc.contentTransfer.getContentTransferStatus({
      path: { transferId },
      query: { sitecoreContextId: contextId },
    });
    if (result.error) {
      throw new Error(`getContentTransferStatus failed: ${JSON.stringify(result.error)}`);
    }
    const data = result.data;
    const state = data?.State;
    if (state === 'Ready' || state === 'Completed' || state === 'Complete') {
      const chunkSets: ChunkSetInfo[] = (data?.ChunkSetsMetadata ?? []).map((cs) => ({
        chunksetId: cs.ChunkSetId,
        chunkCount: cs.ChunkCount,
      }));
      return { chunkSets };
    }
    if (state === 'Failed' || state === 'Error') {
      throw new Error(`Content transfer export failed: ${JSON.stringify(data)}`);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Content transfer export timed out');
}

async function pollBlobState(
  xmc: experimental_XMC,
  contextId: string,
  fileName: string,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    signal?.throwIfAborted();
    const result = await xmc.contentTransfer.getBlobState({
      query: { fileName, sitecoreContextId: contextId },
    });
    if (result.error) {
      throw new Error(`getBlobState failed: ${JSON.stringify(result.error)}`);
    }
    const state = result.data?.status;
    if (state === 'OK' || state === 'Complete' || state === 'Completed') return;
    if (state === 'Error' || state === 'Failed') {
      throw new Error(`Content consume failed: ${JSON.stringify(result.data?.details ?? result.data)}`);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Content consume timed out');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
