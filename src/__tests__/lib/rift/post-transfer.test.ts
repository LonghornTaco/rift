import { describe, it, expect } from 'vitest';
import {
  parentPathOf,
  distinctParentPaths,
  findMissingChildren,
  buildCacheLagNotices,
  hasFinalizingTimeout,
  runStatus,
} from '@/lib/rift/post-transfer';
import type { TreeNode, TransferProgress } from '@/lib/rift/types';
import { FINALIZING_TIMEOUT_PREFIX } from '@/lib/rift/types';

const node = (itemId: string, name: string): TreeNode => ({
  itemId,
  name,
  path: `/x/${name}`,
  hasChildren: false,
  templateName: 'T',
});

describe('parentPathOf / distinctParentPaths', () => {
  it('returns the parent and skips roots', () => {
    expect(parentPathOf('/sitecore/content/mcc/Home')).toBe('/sitecore/content/mcc');
    expect(parentPathOf('/sitecore')).toBe('');
    expect(parentPathOf('Home')).toBe('');
    expect(distinctParentPaths(['/a/b/c', '/a/b/d', '/sitecore', '/a/b/c'])).toEqual(['/a/b']);
  });
});

describe('findMissingChildren', () => {
  it('keys on itemId, ignores extras and renames', () => {
    const before = [node('1', 'about'), node('2', 'case-studies')];
    const after = [node('1', 'about-renamed'), node('3', 'new-item')];
    expect(findMissingChildren(before, after).map((n) => n.name)).toEqual(['case-studies']);
  });

  it('passes when before is a subset of after', () => {
    expect(findMissingChildren([node('1', 'a')], [node('1', 'a'), node('2', 'b')])).toEqual([]);
  });
});

describe('buildCacheLagNotices', () => {
  it('reports only parents present in both snapshots with missing children', () => {
    const before = new Map([
      ['/p', [node('1', 'a'), node('2', 'b')]],
      ['/q', [node('9', 'z')]],
    ]);
    const after = new Map([['/p', [node('1', 'a')]]]);
    expect(buildCacheLagNotices(before, after)).toEqual([{ parentPath: '/p', missing: ['b'] }]);
  });
});

describe('hasFinalizingTimeout / runStatus', () => {
  const tp = (over: Partial<TransferProgress>): TransferProgress => ({
    itemPath: '/x',
    phase: 'complete',
    ...over,
  });

  it('detects a finalizing timeout error', () => {
    expect(
      hasFinalizingTimeout([tp({ phase: 'error', error: `${FINALIZING_TIMEOUT_PREFIX} (last state=Consumed)` })])
    ).toBe(true);
    expect(hasFinalizingTimeout([tp({ phase: 'error', error: 'boom' })])).toBe(false);
  });

  it('is partial when one path carries a warning and the rest succeed', () => {
    expect(runStatus([tp({}), tp({ warning: 'w' })])).toBe('partial');
  });

  it('is failed only when every path errored, success when none did', () => {
    expect(runStatus([tp({ phase: 'error', error: 'x' }), tp({ phase: 'error', error: 'y' })])).toBe('failed');
    expect(runStatus([tp({ phase: 'error', error: 'x' }), tp({})])).toBe('partial');
    expect(runStatus([tp({}), tp({})])).toBe('success');
  });
});
