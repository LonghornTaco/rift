import { describe, it, expect, vi } from 'vitest';
import { transferPath } from '@/lib/rift/content-transfer';
import { formatProgress } from '@/lib/rift/progress-format';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import type { TransferPhase } from '@/lib/rift/types';

// The SDK proxy wraps responses as { data: <body>, request, response }.
// Our helpers expect that shape, so mocks return it too.
function wrap<T>(body: T) {
  return { data: body, request: {} as Request, response: { status: 200 } as Response };
}

function createMockClient(opts?: { onCreate?: () => Promise<void> }) {
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
      case 'xmc.contentTransfer.getBlobState':
        return wrap({ status: 'OK' });
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
      onProgress: (phase) => phases.push(phase),
    });

    const finalPhase = phases[phases.length - 1];
    const formatted = formatProgress({ itemPath: '/sitecore/content/Home', phase: finalPhase });
    expect(formatted.state).toBe('complete');
    expect(formatted.state).not.toBe('active');
  });
});
