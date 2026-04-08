import { describe, it, expect, vi } from 'vitest';
import { transferPath } from '@/lib/rift/content-transfer';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';

function createMockClient() {
  const mutate = vi.fn();
  const query = vi.fn();
  return { client: { mutate, query } as unknown as ClientSDK, mutate, query };
}

describe('transferPath', () => {
  it('executes the full 8-step lifecycle', async () => {
    const { client, mutate, query } = createMockClient();

    // createContentTransfer — returns 202 with empty data
    mutate.mockResolvedValueOnce({ data: { data: {} } });
    // getContentTransferStatus — ready with 1 chunkset containing 1 chunk
    query.mockResolvedValueOnce({ data: { data: { State: 'Ready', ChunkSetsMetadata: [{ ChunkSetId: 'cs-1', ChunkCount: 1 }] } } });
    // getChunk — returns blob data
    query.mockResolvedValueOnce({ data: { data: new Blob(['chunk-data']) } });
    // saveChunk
    mutate.mockResolvedValueOnce({ data: { data: { success: true } } });
    // completeChunkSetTransfer
    mutate.mockResolvedValueOnce({ data: { data: { fileName: 'file-1.raif' } } });
    // consumeFile (registered as query in SDK despite being POST)
    query.mockResolvedValueOnce({ data: { data: { success: true } } });
    // getBlobState — complete
    query.mockResolvedValueOnce({ data: { data: { status: 'Complete' } } });
    // deleteContentTransfer
    mutate.mockResolvedValueOnce({ data: { data: { success: true } } });

    const progressUpdates: string[] = [];
    const onProgress = (phase: string) => progressUpdates.push(phase);

    await transferPath(client, {
      sourceContextId: 'src-ctx',
      targetContextId: 'tgt-ctx',
      itemPath: '/sitecore/content/Home',
      scope: 'SingleItem',
      onProgress,
    });

    expect(mutate).toHaveBeenCalledTimes(4); // create, saveChunk, completeChunkSet, deleteTransfer
    expect(query).toHaveBeenCalledTimes(4); // getStatus, getChunk, consumeFile, getBlobState
    expect(progressUpdates).toContain('creating');
    expect(progressUpdates).toContain('complete');
  });
});
