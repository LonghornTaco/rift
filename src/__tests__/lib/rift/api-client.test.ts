import { describe, it, expect, vi } from 'vitest';
import { fetchTreeChildren, fetchSites, zipDualTreeChildren } from '@/lib/rift/api-client';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import type { TreeNode } from '@/lib/rift/types';

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
  it('returns sites with root paths constructed from collections', async () => {
    const query = vi.fn();
    // First call: listSites
    query.mockResolvedValueOnce({
      data: { data: [{ id: 's1', name: 'MySite', collectionId: 'c1' }] },
    });
    // Second call: listCollections
    query.mockResolvedValueOnce({
      data: { data: [{ id: 'c1', name: 'MyCollection' }] },
    });
    const client = { mutate: vi.fn(), query } as unknown as ClientSDK;

    const result = await fetchSites(client, 'ctx-123');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('MySite');
    expect(result[0].rootPath).toBe('/sitecore/content/MyCollection/MySite');
    expect(result[0].collection).toBe('MyCollection');
  });
});

function node(path: string, hasChildren = false): TreeNode {
  const name = path.split('/').filter(Boolean).pop() ?? '';
  return { itemId: `id-${path}`, name, path, hasChildren, templateName: 'Page' };
}

describe('zipDualTreeChildren', () => {
  it('pairs children that exist on both sides by path, in source order', () => {
    const source = [node('/a/Home'), node('/a/About'), node('/a/Data')];
    const target = [node('/a/Data'), node('/a/Home'), node('/a/About')];

    const result = zipDualTreeChildren(source, target);

    expect(result).toHaveLength(3);
    expect(result.map((n) => n.path)).toEqual(['/a/Home', '/a/About', '/a/Data']);
    expect(result.every((n) => n.source && n.target)).toBe(true);
  });

  it('returns source-only pairs when a path is missing on target', () => {
    const source = [node('/a/Home'), node('/a/About')];
    const target = [node('/a/Home')];

    const result = zipDualTreeChildren(source, target);

    expect(result).toHaveLength(2);
    const aboutRow = result.find((n) => n.path === '/a/About')!;
    expect(aboutRow.source).toBeDefined();
    expect(aboutRow.target).toBeUndefined();
  });

  it('appends target-only pairs at the end in target order', () => {
    const source = [node('/a/Home')];
    const target = [node('/a/Home'), node('/a/Legacy'), node('/a/Archive')];

    const result = zipDualTreeChildren(source, target);

    expect(result.map((n) => n.path)).toEqual(['/a/Home', '/a/Legacy', '/a/Archive']);
    const legacyRow = result.find((n) => n.path === '/a/Legacy')!;
    expect(legacyRow.source).toBeUndefined();
    expect(legacyRow.target).toBeDefined();
  });

  it('sets hasChildren when either side has children', () => {
    const source = [node('/a/NoKids', false)];
    const target = [node('/a/NoKids', true)];

    const result = zipDualTreeChildren(source, target);
    expect(result[0].hasChildren).toBe(true);
  });

  it('treats null/undefined target list as source-only', () => {
    const source = [node('/a/Home'), node('/a/About')];
    const result = zipDualTreeChildren(source, null);
    expect(result).toHaveLength(2);
    expect(result.every((n) => n.target === undefined)).toBe(true);
  });
});
