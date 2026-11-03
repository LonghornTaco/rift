import { describe, it, expect } from 'vitest';
import {
  parentPathOf,
  distinctSnapshotPaths,
  findMissingChildren,
  buildCacheLagNotices,
  hasUnconfirmedTargetWrite,
  runStatus,
} from '@/lib/rift/post-transfer';
import type { TreeNode, TransferPhase, TransferProgress } from '@/lib/rift/types';
import { FINALIZING_TIMEOUT_PREFIX, CONSUME_REJECTED_PREFIX } from '@/lib/rift/types';

const node = (itemId: string, name: string): TreeNode => ({
  itemId,
  name,
  path: `/x/${name}`,
  hasChildren: false,
  templateName: 'T',
});

describe('parentPathOf', () => {
  it('returns the parent and skips roots', () => {
    expect(parentPathOf('/sitecore/content/mcc/Home')).toBe('/sitecore/content/mcc');
    expect(parentPathOf('/sitecore')).toBe('');
    expect(parentPathOf('Home')).toBe('');
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

describe('hasUnconfirmedTargetWrite / runStatus', () => {
  const tp = (over: Partial<TransferProgress>): TransferProgress => ({
    itemPath: '/x',
    phase: 'complete',
    ...over,
  });
  const ev = (...phases: TransferPhase[]) => phases.map((phase) => ({ timestamp: 1, phase }));

  it('is true for a finalizing timeout', () => {
    expect(
      hasUnconfirmedTargetWrite([
        tp({
          phase: 'error',
          error: `${FINALIZING_TIMEOUT_PREFIX} (last state=Consumed)`,
          events: ev('creating', 'consuming', 'finalizing'),
        }),
      ])
    ).toBe(true);
  });

  it('is true when cancelled or disconnected after the target accepted the file', () => {
    expect(
      hasUnconfirmedTargetWrite([
        tp({ phase: 'error', error: 'This operation was aborted', events: ev('creating', 'consuming', 'finalizing') }),
      ])
    ).toBe(true);
    expect(
      hasUnconfirmedTargetWrite([
        tp({ phase: 'error', error: 'getBlobState failed (503): {}', events: ev('creating', 'consuming') }),
      ])
    ).toBe(true);
  });

  it('is false when the target definitively rejected the file or the failure came before consume', () => {
    expect(
      hasUnconfirmedTargetWrite([
        tp({ phase: 'error', error: `${CONSUME_REJECTED_PREFIX}Error): {}`, events: ev('creating', 'consuming') }),
      ])
    ).toBe(false);
    expect(
      hasUnconfirmedTargetWrite([
        tp({ phase: 'error', error: 'This operation was aborted', events: ev('creating', 'uploading') }),
      ])
    ).toBe(false);
    expect(hasUnconfirmedTargetWrite([tp({}), tp({})])).toBe(false);
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

describe('distinctSnapshotPaths', () => {
  it('snapshots each selected root itself as well as its parent, once each, roots of the tree skipped', () => {
    // A SingleItem transfer of a parent that already exists on the target is the
    // case that empties the parent's own cached child list, so the root's own
    // children must be in the before/after comparison, not only the parent's.
    expect(distinctSnapshotPaths(['/a/b/c', '/a/b/d', '/sitecore', '/a/b/c'])).toEqual([
      '/a/b',
      '/a/b/c',
      '/a/b/d',
      '/sitecore',
    ]);
  });

  it('does not list a path twice when one selected root is the parent of another', () => {
    expect(distinctSnapshotPaths(['/a/b/c', '/a/b'])).toEqual(['/a/b', '/a/b/c', '/a']);
  });
});
