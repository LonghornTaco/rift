import { describe, it, expect, vi } from 'vitest';
import { fetchTreeChildren, fetchSites, zipDualTreeChildren, fetchDualTreeChildren, fetchItemFields } from '@/lib/rift/api-client';
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
            {
              itemId: 'id1',
              name: 'Home',
              path: '/sitecore/content/Home',
              hasChildren: true,
              template: { name: 'Page' },
              updated: { value: '20260419T153045Z' },
            },
            {
              itemId: 'id2',
              name: 'About',
              path: '/sitecore/content/About',
              hasChildren: false,
              template: { name: 'Page' },
              updated: null,
            },
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
      updated: '20260419T153045Z',
    });
    expect(result[1].updated).toBeUndefined();
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

describe('zipDualTreeChildren diff computation', () => {
  function nodeWithUpdated(path: string, updated: string | undefined): TreeNode {
    const name = path.split('/').filter(Boolean).pop() ?? '';
    return {
      itemId: `id-${path}`,
      name,
      path,
      hasChildren: false,
      templateName: 'Page',
      ...(updated !== undefined ? { updated } : {}),
    };
  }

  it('sets diff to match when both sides have equal updated timestamps', () => {
    const source = [nodeWithUpdated('/a/Home', '20260419T120000Z')];
    const target = [nodeWithUpdated('/a/Home', '20260419T120000Z')];

    const result = zipDualTreeChildren(source, target);

    expect(result).toHaveLength(1);
    expect(result[0].diff).toBe('match');
  });

  it('sets diff to different when updated timestamps differ', () => {
    const source = [nodeWithUpdated('/a/Home', '20260419T120000Z')];
    const target = [nodeWithUpdated('/a/Home', '20260420T090000Z')];

    const result = zipDualTreeChildren(source, target);

    expect(result[0].diff).toBe('different');
  });

  it('leaves diff undefined when only source has updated', () => {
    const source = [nodeWithUpdated('/a/Home', '20260419T120000Z')];
    const target = [nodeWithUpdated('/a/Home', undefined)];

    const result = zipDualTreeChildren(source, target);

    expect(result[0].diff).toBeUndefined();
  });

  it('leaves diff undefined when only target has updated', () => {
    const source = [nodeWithUpdated('/a/Home', undefined)];
    const target = [nodeWithUpdated('/a/Home', '20260419T120000Z')];

    const result = zipDualTreeChildren(source, target);

    expect(result[0].diff).toBeUndefined();
  });

  it('leaves diff undefined when target side is absent (source-only row)', () => {
    const source = [nodeWithUpdated('/a/Home', '20260419T120000Z')];
    const target: TreeNode[] = [];

    const result = zipDualTreeChildren(source, target);

    expect(result[0].diff).toBeUndefined();
    expect(result[0].target).toBeUndefined();
  });

  it('leaves diff undefined when source side is absent (target-only row)', () => {
    const source: TreeNode[] = [];
    const target = [nodeWithUpdated('/a/Home', '20260419T120000Z')];

    const result = zipDualTreeChildren(source, target);

    expect(result[0].diff).toBeUndefined();
    expect(result[0].source).toBeUndefined();
  });

  it('leaves diff undefined when either updated is an empty string', () => {
    const source = [nodeWithUpdated('/a/Home', '')];
    const target = [nodeWithUpdated('/a/Home', '20260419T120000Z')];

    const result = zipDualTreeChildren(source, target);
    expect(result[0].diff).toBeUndefined();
  });
});

function mockClientWithResponses(responses: unknown[]): ClientSDK {
  const mutate = vi.fn();
  for (const r of responses) mutate.mockResolvedValueOnce({ data: { data: r } });
  return { mutate, query: vi.fn() } as unknown as ClientSDK;
}

function rejectingMutateAtIndex(responses: unknown[], rejectIndex: number, error: Error): ClientSDK {
  const mutate = vi.fn();
  responses.forEach((r, i) => {
    if (i === rejectIndex) mutate.mockRejectedValueOnce(error);
    else mutate.mockResolvedValueOnce({ data: { data: r } });
  });
  return { mutate, query: vi.fn() } as unknown as ClientSDK;
}

function treeResponse(
  children: { itemId: string; name: string; path: string; hasChildren?: boolean; updated?: string }[],
) {
  return {
    item: {
      children: {
        nodes: children.map((c) => ({
          itemId: c.itemId,
          name: c.name,
          path: c.path,
          hasChildren: c.hasChildren ?? false,
          template: { name: 'Page' },
          updated: c.updated ? { value: c.updated } : null,
        })),
      },
    },
  };
}

describe('fetchDualTreeChildren', () => {
  it('pairs source and target children when both fetches succeed', async () => {
    const client = mockClientWithResponses([
      treeResponse([
        { itemId: 'src-home', name: 'Home', path: '/site/Home' },
        { itemId: 'src-about', name: 'About', path: '/site/About' },
      ]),
      treeResponse([
        { itemId: 'tgt-home', name: 'Home', path: '/site/Home' },
      ]),
    ]);

    const result = await fetchDualTreeChildren(client, 'src-ctx', 'tgt-ctx', '/site');

    expect(result).toHaveLength(2);
    expect(result[0].source?.itemId).toBe('src-home');
    expect(result[0].target?.itemId).toBe('tgt-home');
    expect(result[1].source?.itemId).toBe('src-about');
    expect(result[1].target).toBeUndefined();
  });

  it('propagates diff state from __Updated timestamps through to DualTreeNode', async () => {
    const client = mockClientWithResponses([
      treeResponse([
        { itemId: 'src-home', name: 'Home', path: '/site/Home', updated: '20260419T120000Z' },
        { itemId: 'src-about', name: 'About', path: '/site/About', updated: '20260419T120000Z' },
      ]),
      treeResponse([
        { itemId: 'tgt-home', name: 'Home', path: '/site/Home', updated: '20260419T120000Z' },
        { itemId: 'tgt-about', name: 'About', path: '/site/About', updated: '20260420T090000Z' },
      ]),
    ]);

    const result = await fetchDualTreeChildren(client, 'src-ctx', 'tgt-ctx', '/site');

    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('/site/Home');
    expect(result[0].diff).toBe('match');
    expect(result[1].path).toBe('/site/About');
    expect(result[1].diff).toBe('different');
  });

  it('skips the target fetch when targetContextId is null', async () => {
    const client = mockClientWithResponses([
      treeResponse([{ itemId: 'src-home', name: 'Home', path: '/site/Home' }]),
    ]);

    const result = await fetchDualTreeChildren(client, 'src-ctx', null, '/site');

    expect(result).toHaveLength(1);
    expect(result[0].source).toBeDefined();
    expect(result[0].target).toBeUndefined();
    expect(client.mutate).toHaveBeenCalledTimes(1);
  });

  it('returns source-only pairs when the target fetch rejects', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const client = rejectingMutateAtIndex(
      [
        treeResponse([{ itemId: 'src-home', name: 'Home', path: '/site/Home' }]),
        null,
      ],
      1,
      new Error('target site missing'),
    );

    const result = await fetchDualTreeChildren(client, 'src-ctx', 'tgt-ctx', '/site');

    expect(result).toHaveLength(1);
    expect(result[0].source).toBeDefined();
    expect(result[0].target).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[Rift] Target tree fetch failed for /site:',
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  it('propagates the source-side error when the source fetch rejects', async () => {
    const client = rejectingMutateAtIndex(
      [null, treeResponse([])],
      0,
      new Error('source unreachable'),
    );

    await expect(
      fetchDualTreeChildren(client, 'src-ctx', 'tgt-ctx', '/site'),
    ).rejects.toThrow('source unreachable');
  });

  it('includes target-only children appended after source children', async () => {
    const client = mockClientWithResponses([
      treeResponse([{ itemId: 'src-home', name: 'Home', path: '/site/Home' }]),
      treeResponse([
        { itemId: 'tgt-home', name: 'Home', path: '/site/Home' },
        { itemId: 'tgt-legacy', name: 'Legacy', path: '/site/Legacy' },
      ]),
    ]);

    const result = await fetchDualTreeChildren(client, 'src-ctx', 'tgt-ctx', '/site');

    expect(result.map((n) => n.path)).toEqual(['/site/Home', '/site/Legacy']);
    expect(result[1].source).toBeUndefined();
    expect(result[1].target?.itemId).toBe('tgt-legacy');
  });
});

describe('fetchItemFields', () => {
  it('uses excludeStandardFields=true by default', async () => {
    const mutate = vi.fn().mockResolvedValue({
      data: {
        data: {
          item: {
            itemId: 'i', name: 'n', path: '/p',
            template: { name: 'T' },
            fields: { nodes: [{ name: 'Title', value: 'Home' }] },
          },
        },
      },
    });
    const client = { mutate, query: vi.fn() } as unknown as ClientSDK;

    await fetchItemFields(client, 'ctx', '/p');

    const call = mutate.mock.calls[0][1];
    expect(call.params.body.query).toContain('excludeStandardFields: true');
    expect(call.params.body.query).toContain('ownFields: true');
    expect(call.params.body.query).not.toContain('templateId');
  });

  it('drops ownFields alongside excludeStandardFields when includeStandard is true', async () => {
    const mutate = vi.fn().mockResolvedValue({
      data: { data: { item: { itemId: 'i', name: 'n', path: '/p', template: { name: 'T' }, fields: { nodes: [] } } } },
    });
    const client = { mutate, query: vi.fn() } as unknown as ClientSDK;

    await fetchItemFields(client, 'ctx', '/p', { includeStandard: true });

    const call = mutate.mock.calls[0][1];
    expect(call.params.body.query).toContain('ownFields: false');
    expect(call.params.body.query).toContain('excludeStandardFields: false');
  });

  it('throws when GraphQL response contains errors', async () => {
    const mutate = vi.fn().mockResolvedValue({
      data: {
        errors: [{ message: 'The field `itemId` does not exist on the type `ItemTemplate`.' }],
      },
    });
    const client = { mutate, query: vi.fn() } as unknown as ClientSDK;

    await expect(fetchItemFields(client, 'ctx', '/p')).rejects.toThrow(/GraphQL error/);
  });

  it('uses excludeStandardFields=false when includeStandard is true', async () => {
    const mutate = vi.fn().mockResolvedValue({
      data: {
        data: {
          item: {
            itemId: 'i', name: 'n', path: '/p',
            template: { name: 'T' },
            fields: { nodes: [] },
          },
        },
      },
    });
    const client = { mutate, query: vi.fn() } as unknown as ClientSDK;

    await fetchItemFields(client, 'ctx', '/p', { includeStandard: true });

    const call = mutate.mock.calls[0][1];
    expect(call.params.body.query).toContain('excludeStandardFields: false');
    expect(call.params.body.query).toContain('ownFields: false');
  });
});
