import { describe, it, expect, vi } from 'vitest';
import { fetchTreeChildren, fetchSites } from '@/lib/rift/api-client';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';

function mockClient(graphqlResponse: unknown): ClientSDK {
  return {
    mutate: vi.fn().mockResolvedValue({ data: { data: graphqlResponse } }),
    query: vi.fn().mockResolvedValue({ data: { data: graphqlResponse } }),
  } as unknown as ClientSDK;
}

describe('fetchTreeChildren', () => {
  it('returns parsed tree nodes from GraphQL response', async () => {
    const client = mockClient({
      item: {
        children: {
          nodes: [
            { itemId: 'id1', name: 'Home', path: '/sitecore/content/Home', hasChildren: true, template: { name: 'Page' } },
            { itemId: 'id2', name: 'About', path: '/sitecore/content/About', hasChildren: false, template: { name: 'Page' } },
          ],
        },
      },
    });

    const result = await fetchTreeChildren(client, 'ctx-123', '/sitecore/content');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      itemId: 'id1',
      name: 'Home',
      path: '/sitecore/content/Home',
      hasChildren: true,
      templateName: 'Page',
    });
  });
});

describe('fetchSites', () => {
  it('returns sites from listSites query', async () => {
    const client = mockClient([
      { id: 's1', name: 'MySite', rootItem: { path: '/sitecore/content/MySite' }, collection: { name: 'Col1' } },
    ]);

    const result = await fetchSites(client, 'ctx-123');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('MySite');
    expect(result[0].rootPath).toBe('/sitecore/content/MySite');
  });
});
