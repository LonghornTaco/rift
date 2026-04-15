import { describe, it, expect, vi } from 'vitest';
import { transferPath } from '@/lib/rift/content-transfer';
import type { experimental_XMC } from '@sitecore-marketplace-sdk/xmc';

function createMockXmc() {
  const createContentTransfer = vi.fn().mockResolvedValue({ data: {}, error: undefined });
  const getContentTransferStatus = vi.fn().mockResolvedValue({
    data: { State: 'Ready', ChunkSetsMetadata: [{ ChunkSetId: 'cs-1', ChunkCount: 1, TotalItemCount: 1 }] },
    error: undefined,
  });
  const getChunk = vi.fn().mockResolvedValue({ data: new Blob(['chunk-data']), error: undefined });
  const saveChunk = vi.fn().mockResolvedValue({ data: undefined, error: undefined });
  const completeChunkSetTransfer = vi.fn().mockResolvedValue({
    data: { ContentTransferFileName: 'file-1.raif' },
    error: undefined,
  });
  const consumeFile = vi.fn().mockResolvedValue({ data: undefined, error: undefined });
  const getBlobState = vi.fn().mockResolvedValue({ data: { status: 'OK' }, error: undefined });
  const deleteContentTransfer = vi.fn().mockResolvedValue({ data: undefined, error: undefined });

  const xmc = {
    contentTransfer: {
      createContentTransfer,
      getContentTransferStatus,
      getChunk,
      saveChunk,
      completeChunkSetTransfer,
      consumeFile,
      getBlobState,
      deleteContentTransfer,
    },
  } as unknown as experimental_XMC;

  return {
    xmc,
    createContentTransfer,
    getContentTransferStatus,
    getChunk,
    saveChunk,
    completeChunkSetTransfer,
    consumeFile,
    getBlobState,
    deleteContentTransfer,
  };
}

describe('transferPath', () => {
  it('executes the full lifecycle via the typed XMC client', async () => {
    const mock = createMockXmc();

    const progressUpdates: string[] = [];
    await transferPath(mock.xmc, {
      sourceContextId: 'src-ctx',
      targetContextId: 'tgt-ctx',
      itemPath: '/sitecore/content/Home',
      scope: 'SingleItem',
      onProgress: (phase) => progressUpdates.push(phase),
    });

    expect(mock.createContentTransfer).toHaveBeenCalledTimes(2); // source + target
    expect(mock.getContentTransferStatus).toHaveBeenCalledTimes(1);
    expect(mock.getChunk).toHaveBeenCalledTimes(1);
    expect(mock.saveChunk).toHaveBeenCalledTimes(1);
    expect(mock.completeChunkSetTransfer).toHaveBeenCalledTimes(1);
    expect(mock.consumeFile).toHaveBeenCalledTimes(1);
    expect(mock.getBlobState).toHaveBeenCalledTimes(1);
    expect(mock.deleteContentTransfer).toHaveBeenCalledTimes(2); // source + target cleanup

    // saveChunk should receive the Blob at the top level, not nested under params
    const saveChunkCall = mock.saveChunk.mock.calls[0][0];
    expect(saveChunkCall.path).toEqual({ transferId: expect.any(String), chunksetId: 'cs-1', chunkId: 0 });
    expect(saveChunkCall.query).toEqual({ sitecoreContextId: 'tgt-ctx' });
    expect(saveChunkCall.body).toBeInstanceOf(Blob);

    expect(progressUpdates).toContain('creating');
    expect(progressUpdates).toContain('complete');
  });
});
