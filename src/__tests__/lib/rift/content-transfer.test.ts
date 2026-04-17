import { describe, it, expect, vi } from 'vitest';
import { transferPath } from '@/lib/rift/content-transfer';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';

// The SDK proxy wraps responses as { data: <body>, request, response }.
// Our helpers expect that shape, so mocks return it too.
function wrap<T>(body: T) {
  return { data: body, request: {} as Request, response: { status: 200 } as Response };
}

function createMockClient() {
  const mutate = vi.fn(async (key: string) => {
    switch (key) {
      case 'xmc.contentTransfer.createContentTransfer':
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
    expect(mutateKeys.filter((k) => k === 'xmc.contentTransfer.createContentTransfer')).toHaveLength(2);
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

    expect(phases).toContain('creating');
    expect(phases).toContain('complete');
  });
});
