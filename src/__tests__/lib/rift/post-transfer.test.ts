import { describe, it, expect } from 'vitest';
import {
  distinctSnapshotPaths,
  findMissingChildren,
  buildCacheLagNotices,
  markRepairing,
  applyRepairResult,
  markRepairFailed,
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
  it('snapshots each selected root once, in order, and nothing else', () => {
    // Only a transferred item's own child list can go stale (it is rewritten
    // under a lock); its parent is not transferred and a new child updates the
    // parent's cached list in place. So the roots are the whole snapshot.
    expect(distinctSnapshotPaths(['/a/b/c', '/a/b/d', '/a/b/c', ''])).toEqual(['/a/b/c', '/a/b/d']);
  });
});

describe('repair bookkeeping on notices', () => {
  const notices = [
    { parentPath: '/a/Home', missing: ['about', 'ccoe'] },
    { parentPath: '/a/Other', missing: ['x'] },
  ];
  const before = [node('1', 'about'), node('2', 'ccoe'), node('3', 'Data')];

  it('markRepairing flags only the given parent', () => {
    expect(markRepairing(notices, '/a/Home')).toEqual([
      { parentPath: '/a/Home', missing: ['about', 'ccoe'], repair: { status: 'repairing' } },
      { parentPath: '/a/Other', missing: ['x'] },
    ]);
  });

  it('applyRepairResult reports repaired, keeping the restored names, once every pre-existing child is listed again', () => {
    const after = [node('3', 'Data'), node('1', 'about'), node('2', 'ccoe')];
    expect(applyRepairResult(notices, '/a/Home', before, after)).toEqual([
      { parentPath: '/a/Home', missing: [], repair: { status: 'repaired', restored: ['about', 'ccoe'] } },
      { parentPath: '/a/Other', missing: ['x'] },
    ]);
  });

  it('applyRepairResult reports incomplete with what is still missing and what came back', () => {
    const after = [node('3', 'Data'), node('1', 'about')];
    expect(applyRepairResult(notices, '/a/Home', before, after)).toEqual([
      { parentPath: '/a/Home', missing: ['ccoe'], repair: { status: 'incomplete', restored: ['about'] } },
      { parentPath: '/a/Other', missing: ['x'] },
    ]);
  });

  it('markRepairFailed keeps the missing list and records the error', () => {
    expect(markRepairFailed(notices, '/a/Home', 'Access denied')).toEqual([
      { parentPath: '/a/Home', missing: ['about', 'ccoe'], repair: { status: 'failed', error: 'Access denied' } },
      { parentPath: '/a/Other', missing: ['x'] },
    ]);
  });
});
