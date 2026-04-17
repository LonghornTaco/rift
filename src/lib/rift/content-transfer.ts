import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import type { TransferPhase } from './types';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes

type TransferScope = 'SingleItem' | 'ItemAndDescendants';
type MergeStrategy =
  | 'OverrideExistingItem'
  | 'KeepExistingItem'
  | 'LatestWin'
  | 'OverrideExistingTree';

interface TransferOptions {
  sourceContextId: string;
  targetContextId: string;
  itemPath: string;
  scope: TransferScope | string;
  mergeStrategy?: MergeStrategy | string;
  onProgress?: (phase: TransferPhase, detail?: string) => void;
  signal?: AbortSignal;
}

interface ChunkSetMeta {
  ChunkSetId: string;
  ChunkCount: number;
}

/**
 * Execute the full Content Transfer API lifecycle for a single path,
 * routed entirely through the Marketplace iframe proxy (client.mutate/query).
 *
 * Verified 2026-04-17 against Mayo Foundation tenants: the proxy accepts
 * every verb (POST, PUT, GET, DELETE) for this API. The earlier 405/500
 * failures were caused by not unwrapping the proxy response envelope before
 * passing downloaded chunk bytes to saveChunk.
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
  const transferId = crypto.randomUUID();
  const configuration = {
    dataTrees: [
      {
        itemPath,
        scope: scope as TransferScope,
        mergeStrategy: mergeStrategy as MergeStrategy,
      },
    ],
  };

  report('creating');

  // 1. Create transfer on both source and target with same transferId.
  assertOk(
    'createContentTransfer (source)',
    await client.mutate('xmc.contentTransfer.createContentTransfer', {
      params: {
        query: { sitecoreContextId: sourceContextId },
        body: { configuration, transferId },
      },
    })
  );
  assertOk(
    'createContentTransfer (target)',
    await client.mutate('xmc.contentTransfer.createContentTransfer', {
      params: {
        query: { sitecoreContextId: targetContextId },
        body: { configuration, transferId },
      },
    })
  );

  try {
    // 2. Poll source for export completion.
    report('exporting');
    const chunkSets = await pollUntilReady(client, sourceContextId, transferId, signal);

    // 3. Download chunks from source, upload to target (PUT).
    const totalChunks = chunkSets.reduce((sum, cs) => sum + cs.ChunkCount, 0);
    let transferred = 0;
    report('downloading', `0/${totalChunks}`);
    for (const cs of chunkSets) {
      for (let chunkId = 0; chunkId < cs.ChunkCount; chunkId++) {
        signal?.throwIfAborted();

        const getResult = await client.query('xmc.contentTransfer.getChunk', {
          params: {
            path: { transferId, chunksetId: cs.ChunkSetId, chunkId },
            query: { sitecoreContextId: sourceContextId },
          },
        });
        assertOk(`getChunk ${cs.ChunkSetId}/${chunkId}`, getResult);
        const chunkBlob = await toBlob(getResult.data);

        signal?.throwIfAborted();
        report('uploading', `${transferred}/${totalChunks}`);
        assertOk(
          `saveChunk ${cs.ChunkSetId}/${chunkId}`,
          await client.mutate('xmc.contentTransfer.saveChunk', {
            params: {
              path: { transferId, chunksetId: cs.ChunkSetId, chunkId },
              query: { sitecoreContextId: targetContextId, isMedia: false },
              body: chunkBlob,
            },
          })
        );

        transferred++;
        report('uploading', `${transferred}/${totalChunks}`);
      }
    }

    // 4. Complete each chunk set on target → returns the .raif filename to consume.
    report('assembling');
    const fileIds: string[] = [];
    for (const cs of chunkSets) {
      const result = await client.mutate('xmc.contentTransfer.completeChunkSetTransfer', {
        params: {
          path: { transferId, chunksetId: cs.ChunkSetId },
          query: { sitecoreContextId: targetContextId },
        },
      });
      assertOk(`completeChunkSetTransfer ${cs.ChunkSetId}`, result);
      const body = unwrapData(result.data) as { ContentTransferFileName?: string } | undefined;
      if (body?.ContentTransferFileName) fileIds.push(body.ContentTransferFileName);
    }
    if (fileIds.length === 0) throw new Error('completeChunkSetTransfer returned no file names');

    // 5. Consume each .raif file on target and poll state until OK.
    report('consuming');
    for (const fileName of fileIds) {
      assertOk(
        'consumeFile',
        await client.query('xmc.contentTransfer.consumeFile', {
          params: {
            query: { databaseName: 'master', fileName, sitecoreContextId: targetContextId },
          },
        })
      );
      await pollBlobState(client, targetContextId, fileName, signal);
    }

    report('complete');
  } finally {
    // 6. Cleanup: delete the transfer on both envs (best-effort).
    report('cleanup');
    await Promise.allSettled([
      client.mutate('xmc.contentTransfer.deleteContentTransfer', {
        params: { path: { transferId }, query: { sitecoreContextId: sourceContextId } },
      }),
      client.mutate('xmc.contentTransfer.deleteContentTransfer', {
        params: { path: { transferId }, query: { sitecoreContextId: targetContextId } },
      }),
    ]);
  }
}

async function pollUntilReady(
  client: ClientSDK,
  contextId: string,
  transferId: string,
  signal?: AbortSignal
): Promise<ChunkSetMeta[]> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    signal?.throwIfAborted();
    const result = await client.query('xmc.contentTransfer.getContentTransferStatus', {
      params: {
        path: { transferId },
        query: { sitecoreContextId: contextId },
      },
    });
    assertOk('getContentTransferStatus', result);
    const body = unwrapData(result.data) as
      | { State?: string; ChunkSetsMetadata?: ChunkSetMeta[] }
      | undefined;
    const state = body?.State ?? '';
    if (state === 'Ready' || state === 'Completed' || state === 'Complete') {
      return body?.ChunkSetsMetadata ?? [];
    }
    if (state === 'Failed' || state === 'Error' || state === 'NotFound') {
      throw new Error(`Content transfer ended with state=${state}`);
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
    const result = await client.query('xmc.contentTransfer.getBlobState', {
      params: { query: { fileName, sitecoreContextId: contextId } },
    });
    assertOk('getBlobState', result);
    const body = unwrapData(result.data) as
      | { status?: string; BlobState?: string; details?: unknown; Error?: string }
      | undefined;
    const state = body?.status ?? body?.BlobState ?? '';
    if (state === 'OK' || state === 'Complete' || state === 'Completed') return;
    if (state === 'Error' || state === 'Failed') {
      throw new Error(`Consume failed: ${JSON.stringify(body?.details ?? body?.Error ?? body)}`);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Content consume timed out');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assertOk(label: string, result: any): void {
  if (result?.error) {
    const status = result?.response?.status;
    throw new Error(`${label} failed${status ? ` (${status})` : ''}: ${JSON.stringify(result.error)}`);
  }
}

// The SDK proxy wraps response bodies one extra level: result.data is
// { data: <body>, request, response }. Strip that wrapper.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapData(raw: any): unknown {
  let cur = raw;
  for (let i = 0; i < 4; i++) {
    if (
      cur &&
      typeof cur === 'object' &&
      !(cur instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(cur) &&
      !(cur instanceof Blob) &&
      'data' in cur &&
      ('request' in cur || 'response' in cur)
    ) {
      cur = cur.data;
    } else {
      return cur;
    }
  }
  return cur;
}

async function toBlob(raw: unknown): Promise<Blob> {
  const v = unwrapData(raw);
  if (v instanceof Blob) return v;
  if (v instanceof ArrayBuffer) return new Blob([v], { type: 'application/octet-stream' });
  if (ArrayBuffer.isView(v)) {
    const view = v as ArrayBufferView;
    const buf = (view.buffer as ArrayBuffer).slice(view.byteOffset, view.byteOffset + view.byteLength);
    return new Blob([buf], { type: 'application/octet-stream' });
  }
  if (typeof v === 'string') {
    try {
      const bin = atob(v);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: 'application/octet-stream' });
    } catch {
      return new Blob([v], { type: 'application/octet-stream' });
    }
  }
  return new Blob([JSON.stringify(v)], { type: 'application/octet-stream' });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
