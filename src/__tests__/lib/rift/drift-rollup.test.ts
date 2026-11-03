import { describe, it, expect } from 'vitest';
import {
  countsAsDrift,
  isWalkableFolder,
  computeDriftRollup,
  missingFolders,
  evictSubtrees,
} from '@/lib/rift/drift-rollup';
import type { DualTreeNode, TreeNode } from '@/lib/rift/types';

interface NodeOpts {
  source?: boolean;
  target?: boolean;
  diff?: 'match' | 'different';
  hasChildren?: boolean;
}

function treeNode(path: string, hasChildren: boolean): TreeNode {
  return { itemId: `id-${path}`, name: path.split('/').pop() ?? path, path, hasChildren, templateName: 'Folder' };
}

function n(path: string, opts: NodeOpts = {}): DualTreeNode {
  const { source = true, target = true, diff, hasChildren = false } = opts;
  return {
    path,
    name: path.split('/').pop() ?? path,
    hasChildren,
    source: source ? treeNode(path, hasChildren) : undefined,
    target: target ? treeNode(path, hasChildren) : undefined,
    diff,
  };
}

const folder = { hasChildren: true };

describe('countsAsDrift', () => {
  it('counts different', () => {
    expect(countsAsDrift(n('/r/a', { diff: 'different' }))).toBe(true);
  });
  it('counts source-only', () => {
    expect(countsAsDrift(n('/r/a', { target: false }))).toBe(true);
  });
  it('ignores target-only', () => {
    expect(countsAsDrift(n('/r/a', { source: false }))).toBe(false);
  });
  it('ignores match and undefined', () => {
    expect(countsAsDrift(n('/r/a', { diff: 'match' }))).toBe(false);
    expect(countsAsDrift(n('/r/a'))).toBe(false);
  });
});

describe('isWalkableFolder', () => {
  it('walks folders on both sides only', () => {
    expect(isWalkableFolder(n('/r/a', folder))).toBe(true);
    expect(isWalkableFolder(n('/r/a', { ...folder, target: false }))).toBe(false);
    expect(isWalkableFolder(n('/r/a'))).toBe(false);
  });
});

describe('computeDriftRollup', () => {
  const full = (): Map<string, DualTreeNode[]> =>
    new Map([
      ['/r', [n('/r/a', { ...folder, diff: 'different' }), n('/r/b', { diff: 'match' })]],
      ['/r/a', [n('/r/a/x', { target: false }), n('/r/a/y', { diff: 'different' })]],
    ]);

  it('sums drift beneath nested folders', () => {
    const result = computeDriftRollup(full(), ['/r']);
    expect(result.get('/r')).toEqual({ count: 3, complete: true });
    expect(result.get('/r/a')).toEqual({ count: 2, complete: true });
  });

  it('marks a folder incomplete while a walkable child is uncached', () => {
    const cache = full();
    cache.delete('/r/a');
    const result = computeDriftRollup(cache, ['/r']);
    expect(result.get('/r')).toEqual({ count: 1, complete: false });
    expect(result.get('/r/a')).toEqual({ count: 0, complete: false });
  });

  it('counts a source-only folder as one and ignores its cached children', () => {
    const cache = new Map<string, DualTreeNode[]>([
      ['/r', [n('/r/f', { ...folder, target: false })]],
      ['/r/f', [n('/r/f/1', { diff: 'different' }), n('/r/f/2', { diff: 'different' })]],
    ]);
    const result = computeDriftRollup(cache, ['/r']);
    expect(result.get('/r')).toEqual({ count: 1, complete: true });
    expect(result.has('/r/f')).toBe(false);
  });

  it('never emits entries above or outside the roots', () => {
    const cache = new Map<string, DualTreeNode[]>([
      ['/sitecore/content', [n('/r', folder)]],
      ['/r', [n('/r/a', { diff: 'different' })]],
    ]);
    const result = computeDriftRollup(cache, ['/r']);
    expect(result.has('/sitecore/content')).toBe(false);
    expect([...result.keys()]).toEqual(['/r']);
  });

  it('handles several roots', () => {
    const cache = new Map<string, DualTreeNode[]>([
      ['/r', [n('/r/a', { diff: 'different' })]],
      ['/m', [n('/m/a', { target: false }), n('/m/b', { target: false })]],
    ]);
    const result = computeDriftRollup(cache, ['/r', '/m']);
    expect(result.get('/r')).toEqual({ count: 1, complete: true });
    expect(result.get('/m')).toEqual({ count: 2, complete: true });
  });
});

describe('missingFolders', () => {
  it('returns uncached walkable folders breadth-first', () => {
    const cache = new Map<string, DualTreeNode[]>([
      ['/r', [n('/r/a', folder), n('/r/b', folder)]],
      ['/r/a', [n('/r/a/c', folder)]],
    ]);
    expect(missingFolders(cache, ['/r'])).toEqual(['/r/b', '/r/a/c']);
  });

  it('returns an uncached root itself', () => {
    expect(missingFolders(new Map(), ['/r'])).toEqual(['/r']);
  });

  it('skips source-only folders and returns [] when complete', () => {
    const cache = new Map<string, DualTreeNode[]>([
      ['/r', [n('/r/a', folder), n('/r/f', { ...folder, target: false })]],
      ['/r/a', [n('/r/a/leaf')]],
    ]);
    expect(missingFolders(cache, ['/r'])).toEqual([]);
  });
});

describe('evictSubtrees', () => {
  it('drops the path and its descendants but not a sibling sharing the prefix', () => {
    const cache = new Map<string, DualTreeNode[]>([
      ['/site/Home', []],
      ['/site/Home/About', []],
      ['/site/Homepage', []],
    ]);
    const result = evictSubtrees(cache, ['/site/Home']);
    expect([...result.keys()]).toEqual(['/site/Homepage']);
  });

  it('returns the same map when nothing matches', () => {
    const cache = new Map<string, DualTreeNode[]>([['/site/Home', []]]);
    expect(evictSubtrees(cache, ['/other'])).toBe(cache);
  });
});
