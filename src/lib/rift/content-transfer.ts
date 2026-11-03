import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import type { TransferPhase } from './types';
import { FINALIZING_TIMEOUT_PREFIX, CONSUME_REJECTED_PREFIX } from './types';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes

/**
 * Polling budget for the finalizing phase: after consumeFile the target runs a
 * background job that writes the items into its database, and the blob only
 * reaches BlobState Transferred when that job finishes. One item with many
 * versions can take minutes, and the target processes jobs one at a time, so
 * this budget is separate from and much larger than MAX_POLL_ATTEMPTS.
 */
export interface FinalizePolling {
  intervalMs: number;
  /** Ceiling once the blob has reached Consumed (the background write). */
  maxAttempts: number;
  /** Ceiling for the blob to be accepted at all (states before Consumed). */
  consumeMaxAttempts: number;
}

export const DEFAULT_FINALIZE_POLLING: FinalizePolling = {
  intervalMs: 3000,
  maxAttempts: 800, // 40 minutes of finalizing
  consumeMaxAttempts: 200, // 10 minutes to be accepted, like the export budget
};

export interface TransferResult {
  /** Present when the target reported errors while writing (TransferredWithErrors). */
  warning?: string;
}

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
  /** Override the finalizing poll interval or ceiling (tests use tiny values). */
  finalizePolling?: Partial<FinalizePolling>;
}

interface ChunkSetMeta {
  ChunkSetId: string;
  ChunkCount: number;
}

// Sitecore's source-side createContentTransfer mutates a shared, non-thread-safe
// server registry. Two creates in flight at once corrupt it and the handler throws
// a spurious .NET 500 — {"Error":"An item with the same key already been added."} —
// even for genuinely distinct items. The migration UI dispatches every path's
// transfer in the same tick (paths.map(() => transferPath(...))), so without a gate
// all creates race and all but one fail. Serialize just the create step across every
// concurrent transferPath() call: only one create is ever in flight, while the rest
// of the lifecycle (keyed by the unique transferId) still runs in parallel.
let createGate: Promise<unknown> = Promise.resolve();

function runCreateExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = createGate.then(fn, fn);
  // Advance the gate to the settled (never-rejected) tail so one failed create
  // doesn't poison the chain for the next waiter.
  createGate = run.then(
    () => undefined,
    () => undefined
  );
  return run;
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
): Promise<TransferResult> {
  const {
    sourceContextId,
    targetContextId,
    itemPath,
    scope,
    mergeStrategy = 'OverrideExistingItem',
    onProgress,
    signal,
    finalizePolling,
  } = options;
  const finalize: FinalizePolling = { ...DEFAULT_FINALIZE_POLLING, ...finalizePolling };
  let warning: string | undefined;

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
  // Media library transfers contain binary blob data; the server handles the
  // chunk differently when this flag is set. Omitting it for media paths
  // triggers a "Maximum call stack size exceeded" inside Sitecore's handler.
  const isMedia = /^\/sitecore\/media library(\/|$)/i.test(itemPath);

  report('creating');

  // 1. Create the transfer on the SOURCE only. createContentTransfer is a
  //    source-side operation: the SDK documents its itemPath as "the existing item
  //    path in the Source environment", and it validates that path against the
  //    SOURCE master database while it starts the export. The TARGET is never sent
  //    a create — the receiving transfer is established implicitly by the first
  //    saveChunk (PUT chunk) below, reusing this same client-generated transferId,
  //    and is then completed and consumed there.
  //
  //    A prior version also called createContentTransfer against the target with
  //    the same configuration. That validated the SOURCE itemPath against the
  //    TARGET database, so it rejected any item not already present on the target
  //    ("Invalid configuration. Item doesn't exist by <path> in master database")
  //    and rejected an empty dataTrees ("DataTrees are empty or missing; there is
  //    nothing to transfer"). It only ever succeeded when the item already existed
  //    on both sides, which is why NEW items selected directly could never migrate.
  assertOk(
    'createContentTransfer (source)',
    await runCreateExclusive(() =>
      client.mutate('xmc.contentTransfer.createContentTransfer', {
        params: {
          query: { sitecoreContextId: sourceContextId },
          body: { configuration, transferId },
        },
      })
    )
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
              query: { sitecoreContextId: targetContextId, isMedia },
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

    // 5. Consume each .raif file on target, then wait for the target to FINISH
    //    writing. ConsumeFile only makes the items visible through a transferred
    //    source overlay; a background job then materializes them into the
    //    database and the blob advances Consumed -> Transferred when it is done.
    //    Reporting completion (and refreshing the tree) before Transferred reads
    //    the target mid-write and caches a transitional child list on the CM,
    //    which is what made a migrated tree look like it had lost items.
    //    ConsumeFile requires a schema prefix on the filename - blob:// for the
    //    Cloud blob-storage location produced by completeChunkSetTransfer.
    //    GetBlobState uses the bare filename.
    report('consuming');
    for (const fileName of fileIds) {
      assertOk(
        'consumeFile',
        await client.query('xmc.contentTransfer.consumeFile', {
          params: {
            query: {
              databaseName: 'master',
              fileName: `blob://${fileName}`,
              sitecoreContextId: targetContextId,
            },
          },
        })
      );
      const fileWarning = await pollBlobState(client, targetContextId, fileName, report, finalize, signal);
      if (fileWarning && !warning) warning = fileWarning;
    }
  } finally {
    // 6. Cleanup: delete the transfer on both envs (best-effort). This runs on
    //    both success and error, and shows a transient "Finishing up" status.
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

  // Report the terminal success phase LAST. Statements after a try/finally run
  // only if the try body did not throw (and after the finally completes), so on
  // error the throw propagates before we get here and the row stays terminal
  // 'error'; on success the row ends on 'complete' (checkmark), not 'cleanup'.
  report('complete');
  return warning ? { warning } : {};
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

/** Blob states that mean the consume or the background write failed. */
const BLOB_FAILURE_STATES = new Set(['Error', 'Failed', 'ValidationFailed', 'Discarded', 'NotFound']);

/**
 * Poll the target's blob state until its background job has finished writing.
 *
 * The CM's BlobState enum is: Unknown, Uploading, Uploaded, Initializing, Error,
 * Consumed, Transferred, TransferredWithErrors, Discarded, ValidationFailed.
 * Only Transferred means the items are in the database. Consumed means the
 * file was accepted and the background job is still running, so it is reported
 * as the 'finalizing' phase and polling continues. Any token not recognised
 * keeps polling and is surfaced as the phase detail rather than being treated
 * as done, so a new state can never make Rift report completion early.
 *
 * Two budgets: until the blob first reads Consumed the wait is the "consume"
 * step with its own ten-minute ceiling and a plain consume-timeout error; once
 * Consumed has been seen the counter restarts against the (much larger)
 * finalizing ceiling, and only that timeout carries FINALIZING_TIMEOUT_PREFIX,
 * so the "still finalizing" copy and the run-level gate never apply to a file
 * the target never accepted.
 *
 * Resolves with a warning string for TransferredWithErrors (the items that did
 * transfer are in the database), undefined for Transferred.
 */
async function pollBlobState(
  client: ClientSDK,
  contextId: string,
  fileName: string,
  report: (phase: TransferPhase, detail?: string) => void,
  finalize: FinalizePolling,
  signal?: AbortSignal
): Promise<string | undefined> {
  let lastState = '';
  let consumedSeen = false;
  let attempts = 0;
  for (;;) {
    signal?.throwIfAborted();
    const result = await client.query('xmc.contentTransfer.getBlobState', {
      params: { query: { fileName, sitecoreContextId: contextId } },
    });
    assertOk('getBlobState', result);
    const body = unwrapData(result.data) as
      | { status?: string; BlobState?: string; details?: unknown; Error?: string | null }
      | undefined;
    const state = body?.status ?? body?.BlobState ?? '';
    lastState = state;
    if (state === 'Transferred') {
      return undefined;
    }
    if (state === 'TransferredWithErrors') {
      return `Target reported errors while writing ${fileName}`;
    }
    if (BLOB_FAILURE_STATES.has(state)) {
      throw new Error(
        `${CONSUME_REJECTED_PREFIX}${state}): ${JSON.stringify(body?.details ?? body?.Error ?? body)}`
      );
    }
    if (state === 'Consumed' && !consumedSeen) {
      // The file has been accepted; from here the clock is the finalizing budget.
      consumedSeen = true;
      attempts = 0;
    }
    attempts++;
    // Before Consumed (Unknown, Uploading, Uploaded, Initializing, or an
    // unrecognised token) this is still the consume step; after it, the
    // background write is in progress.
    report(consumedSeen ? 'finalizing' : 'consuming', state);
    const limit = consumedSeen ? finalize.maxAttempts : finalize.consumeMaxAttempts;
    if (attempts >= limit) {
      throw new Error(
        consumedSeen
          ? `${FINALIZING_TIMEOUT_PREFIX} (last state=${lastState})`
          : `Content consume timed out (last state=${lastState})`
      );
    }
    await delay(finalize.intervalMs);
  }
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
