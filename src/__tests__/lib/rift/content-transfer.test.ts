import { describe, it, expect, vi } from 'vitest';
import { transferPath } from '@/lib/rift/content-transfer';
import { formatProgress } from '@/lib/rift/progress-format';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import type { TransferPhase } from '@/lib/rift/types';
import { FINALIZING_TIMEOUT_PREFIX } from '@/lib/rift/types';

// The SDK proxy wraps responses as { data: <body>, request, response }.
// Our helpers expect that shape, so mocks return it too.
function wrap<T>(body: T) {
  return { data: body, request: {} as Request, response: { status: 200 } as Response };
}

function createMockClient(opts?: { onCreate?: () => Promise<void>; blobStates?: string[] }) {
  // getBlobState returns this sequence in order, repeating the last value once
  // exhausted. The default mirrors the real target: Consumed (background job
  // still writing items to the database) and then Transferred (job finished).
  const blobStates = opts?.blobStates ?? ['Consumed', 'Transferred'];
  let blobIdx = 0;

  const mutate = vi.fn(async (key: string, _options?: unknown) => {
    switch (key) {
      case 'xmc.contentTransfer.createContentTransfer':
        if (opts?.onCreate) await opts.onCreate();
        return wrap({});
      case 'xmc.contentTransfer.saveChunk':
        return wrap({});
      case 'xmc.contentTransfer.completeChunkSetTransfer':
        return wrap({ ContentTransferFileName: 'file-1.raif' });
      case 'xmc.contentTransfer.deleteContentTransfer':
        return wrap({});
      default:
        throw new Error(`unexpected mutate key: ${key}`);
    }
  });

  const query = vi.fn(async (key: string) => {
    switch (key) {
      case 'xmc.contentTransfer.getContentTransferStatus':
        return wrap({
          State: 'Ready',
          ChunkSetsMetadata: [{ ChunkSetId: 'cs-1', ChunkCount: 1 }],
        });
      case 'xmc.contentTransfer.getChunk':
        return wrap(new Blob(['chunk-data']));
      case 'xmc.contentTransfer.consumeFile':
        return wrap({});
      case 'xmc.contentTransfer.getBlobState': {
        const state = blobStates[Math.min(blobIdx, blobStates.length - 1)];
        blobIdx++;
        return wrap({ BlobState: state });
      }
      default:
        throw new Error(`unexpected query key: ${key}`);
    }
  });

  const client = { mutate, query } as unknown as ClientSDK;
  return { client, mutate, query };
}

describe('transferPath', () => {
  it('executes the full lifecycle via client.mutate / client.query', async () => {
    const { client, mutate, query } = createMockClient();

    const phases: string[] = [];
    await transferPath(client, {
      sourceContextId: 'src-ctx',
      targetContextId: 'tgt-ctx',
      itemPath: '/sitecore/content/Home',
      scope: 'SingleItem',
      finalizePolling: { intervalMs: 0 },
      onProgress: (phase) => phases.push(phase),
    });

    const mutateKeys = mutate.mock.calls.map((c) => c[0]);
    // createContentTransfer is source-only. The target transfer is established
    // implicitly by saveChunk, so there must be exactly ONE create call.
    expect(mutateKeys.filter((k) => k === 'xmc.contentTransfer.createContentTransfer')).toHaveLength(1);
    expect(mutateKeys.filter((k) => k === 'xmc.contentTransfer.saveChunk')).toHaveLength(1);
    expect(mutateKeys.filter((k) => k === 'xmc.contentTransfer.completeChunkSetTransfer')).toHaveLength(1);
    expect(mutateKeys.filter((k) => k === 'xmc.contentTransfer.deleteContentTransfer')).toHaveLength(2);

    const queryKeys = query.mock.calls.map((c) => c[0]);
    expect(queryKeys).toContain('xmc.contentTransfer.getContentTransferStatus');
    expect(queryKeys).toContain('xmc.contentTransfer.getChunk');
    expect(queryKeys).toContain('xmc.contentTransfer.consumeFile');
    expect(queryKeys).toContain('xmc.contentTransfer.getBlobState');

    // saveChunk body must be a Blob, wrapped in the SDK's params envelope.
    const saveCall = mutate.mock.calls.find((c) => c[0] === 'xmc.contentTransfer.saveChunk');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saveArgs = saveCall?.[1] as any;
    expect(saveArgs?.params?.path).toMatchObject({ chunksetId: 'cs-1', chunkId: 0 });
    expect(saveArgs?.params?.query).toMatchObject({ sitecoreContextId: 'tgt-ctx' });
    expect(saveArgs?.params?.body).toBeInstanceOf(Blob);

    // The single create must target the SOURCE context and carry the itemPath;
    // the target must never receive a createContentTransfer. Sending the source
    // itemPath to the target validated it against the target DB and rejected any
    // item not already present there, blocking new-item transfers. Regression
    // guard for that bug.
    const createCalls = mutate.mock.calls.filter(
      (c) => c[0] === 'xmc.contentTransfer.createContentTransfer'
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createArgs = createCalls.map((c) => c[1] as any);
    expect(createArgs.every((a) => a?.params?.query?.sitecoreContextId === 'src-ctx')).toBe(true);
    expect(createArgs.some((a) => a?.params?.query?.sitecoreContextId === 'tgt-ctx')).toBe(false);
    expect(createArgs[0]?.params?.body?.configuration?.dataTrees).toEqual([
      { itemPath: '/sitecore/content/Home', scope: 'SingleItem', mergeStrategy: 'OverrideExistingItem' },
    ]);

    expect(phases).toContain('creating');
    expect(phases).toContain('finalizing');
    expect(phases).toContain('complete');
    // Cleanup runs inside the finally, so its phase is reported...
    expect(phases).toContain('cleanup');
    // ...but 'complete' must be the LAST phase on a successful transfer so the
    // row ends terminal (checkmark) instead of stuck on 'cleanup' (spinner).
    expect(phases[phases.length - 1]).toBe('complete');
    expect(phases.indexOf('cleanup')).toBeLessThan(phases.indexOf('complete'));
  });

  it('serializes createContentTransfer across concurrent transfers (never overlaps)', async () => {
    // Sitecore's source-side create mutates a shared non-thread-safe registry;
    // two creates in flight at once corrupt it and throw a spurious .NET
    // "same key already added" 500. The UI fires every path's transfer in the
    // same tick, so the create step must be gated to one-in-flight. This mock
    // makes each create yield, so an ungated implementation would show >1
    // concurrent create and fail this test.
    let inFlight = 0;
    let maxInFlight = 0;
    const { client } = createMockClient({
      onCreate: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
      },
    });

    await Promise.all(
      ['/sitecore/content/A', '/sitecore/content/B', '/sitecore/content/C'].map((itemPath) =>
        transferPath(client, {
          sourceContextId: 'src-ctx',
          targetContextId: 'tgt-ctx',
          itemPath,
          scope: 'ItemAndDescendants',
          finalizePolling: { intervalMs: 0 },
        })
      )
    );

    expect(maxInFlight).toBe(1);
  });

  it('ends terminal (state complete, not active) on a successful transfer', async () => {
    const { client } = createMockClient();

    const phases: TransferPhase[] = [];
    await transferPath(client, {
      sourceContextId: 'src-ctx',
      targetContextId: 'tgt-ctx',
      itemPath: '/sitecore/content/Home',
      scope: 'SingleItem',
      finalizePolling: { intervalMs: 0 },
      onProgress: (phase) => phases.push(phase),
    });

    const finalPhase = phases[phases.length - 1];
    const formatted = formatProgress({ itemPath: '/sitecore/content/Home', phase: finalPhase });
    expect(formatted.state).toBe('complete');
    expect(formatted.state).not.toBe('active');
  });

  it('keeps polling through Consumed and completes only on Transferred, reporting finalizing', async () => {
    const { client, query } = createMockClient({ blobStates: ['Uploaded', 'Consumed', 'Consumed', 'Transferred'] });
    const events: { phase: TransferPhase; detail?: string }[] = [];
    const result = await transferPath(client, {
      sourceContextId: 'src-ctx',
      targetContextId: 'tgt-ctx',
      itemPath: '/sitecore/content/Home',
      scope: 'SingleItem',
      finalizePolling: { intervalMs: 0 },
      onProgress: (phase, detail) => events.push({ phase, detail }),
    });
    expect(result).toEqual({});
    const blobCalls = query.mock.calls.filter((c) => c[0] === 'xmc.contentTransfer.getBlobState');
    expect(blobCalls).toHaveLength(4);
    const phases = events.map((e) => e.phase);
    expect(phases.indexOf('finalizing')).toBeGreaterThan(phases.indexOf('consuming'));
    expect(phases.indexOf('finalizing')).toBeLessThan(phases.indexOf('cleanup'));
    expect(phases[phases.length - 1]).toBe('complete');
    expect(events.find((e) => e.phase === 'finalizing')?.detail).toBe('Consumed');
  });

  it('never resolves on Consumed alone and times out with the finalizing message', async () => {
    const { client } = createMockClient({ blobStates: ['Consumed'] });
    await expect(
      transferPath(client, {
        sourceContextId: 'src-ctx',
        targetContextId: 'tgt-ctx',
        itemPath: '/sitecore/content/Home',
        scope: 'SingleItem',
        finalizePolling: { intervalMs: 0, maxAttempts: 3 },
      })
    ).rejects.toThrow(FINALIZING_TIMEOUT_PREFIX);
  });

  it('times out with the consume message, not the finalizing one, when the blob never reaches Consumed', async () => {
    const { client } = createMockClient({ blobStates: ['Uploaded'] });
    const run = transferPath(client, {
      sourceContextId: 'src-ctx',
      targetContextId: 'tgt-ctx',
      itemPath: '/sitecore/content/Home',
      scope: 'SingleItem',
      finalizePolling: { intervalMs: 0, consumeMaxAttempts: 2 },
    });
    await expect(run).rejects.toThrow(/Content consume timed out/);
    await expect(run).rejects.not.toThrow(FINALIZING_TIMEOUT_PREFIX);
  });

  it('resets the budget once Consumed is seen so the finalizing ceiling applies from there', async () => {
    const { client } = createMockClient({
      blobStates: ['Uploaded', 'Uploaded', 'Consumed', 'Consumed', 'Consumed', 'Transferred'],
    });
    await expect(
      transferPath(client, {
        sourceContextId: 'src-ctx',
        targetContextId: 'tgt-ctx',
        itemPath: '/sitecore/content/Home',
        scope: 'SingleItem',
        finalizePolling: { intervalMs: 0, consumeMaxAttempts: 3, maxAttempts: 4 },
      })
    ).resolves.toEqual({});
  });

  it('treats TransferredWithErrors as complete with a warning', async () => {
    const { client } = createMockClient({ blobStates: ['Consumed', 'TransferredWithErrors'] });
    const phases: TransferPhase[] = [];
    const result = await transferPath(client, {
      sourceContextId: 'src-ctx',
      targetContextId: 'tgt-ctx',
      itemPath: '/sitecore/content/Home',
      scope: 'SingleItem',
      finalizePolling: { intervalMs: 0 },
      onProgress: (phase) => phases.push(phase),
    });
    expect(result.warning).toMatch(/reported errors/i);
    expect(phases[phases.length - 1]).toBe('complete');
  });

  it.each(['Error', 'ValidationFailed', 'Discarded', 'NotFound'])('fails on blob state %s', async (state) => {
    const { client } = createMockClient({ blobStates: [state] });
    await expect(
      transferPath(client, {
        sourceContextId: 'src-ctx',
        targetContextId: 'tgt-ctx',
        itemPath: '/sitecore/content/Home',
        scope: 'SingleItem',
        finalizePolling: { intervalMs: 0 },
      })
    ).rejects.toThrow(state);
  });

  it('keeps polling on an unknown token and shows it as the detail', async () => {
    const { client } = createMockClient({ blobStates: ['Validating', 'Transferred'] });
    const events: { phase: TransferPhase; detail?: string }[] = [];
    await transferPath(client, {
      sourceContextId: 'src-ctx',
      targetContextId: 'tgt-ctx',
      itemPath: '/sitecore/content/Home',
      scope: 'SingleItem',
      finalizePolling: { intervalMs: 0 },
      onProgress: (phase, detail) => events.push({ phase, detail }),
    });
    expect(events.some((e) => e.detail === 'Validating')).toBe(true);
  });

  it('stops polling immediately when cancelled during finalizing', async () => {
    const { client, query } = createMockClient({ blobStates: ['Consumed'] });
    const controller = new AbortController();
    const run = transferPath(client, {
      sourceContextId: 'src-ctx',
      targetContextId: 'tgt-ctx',
      itemPath: '/sitecore/content/Home',
      scope: 'SingleItem',
      finalizePolling: { intervalMs: 5, maxAttempts: 1000 },
      signal: controller.signal,
      onProgress: (phase) => {
        if (phase === 'finalizing') controller.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    const after = query.mock.calls.filter((c) => c[0] === 'xmc.contentTransfer.getBlobState').length;
    expect(after).toBeLessThanOrEqual(2);
  });
});
