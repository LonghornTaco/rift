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

    // createContentTransfer
    mutate.mockResolvedValueOnce({ data: { data: { operationId: 'op-1' } } });
    // getContentTransferStatus — ready with 1 chunk
    query.mockResolvedValueOnce({ data: { data: { status: 'Ready', totalChunks: 1 } } });
    // getChunk — returns blob data
    query.mockResolvedValueOnce({ data: { data: new Blob(['chunk-data']) } });
    // saveChunk
    mutate.mockResolvedValueOnce({ data: { data: { success: true } } });
    // completeChunkSetTransfer
    mutate.mockResolvedValueOnce({ data: { data: { fileId: 'file-1' } } });
    // consumeFile
    query.mockResolvedValueOnce({ data: { data: { blobId: 'blob-1' } } });
    // getBlobState — complete
    query.mockResolvedValueOnce({ data: { data: { state: 'Complete' } } });
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

    expect(mutate).toHaveBeenCalledTimes(4); // create, save, complete, delete
    expect(query).toHaveBeenCalledTimes(4); // status, getChunk, consume, blobState
    expect(progressUpdates).toContain('creating');
    expect(progressUpdates).toContain('complete');
  });
});
