import type { TreeNode, TransferProgress } from './types';
import { CONSUME_REJECTED_PREFIX } from './types';

/**
 * Pure helpers for what happens AFTER a migration run: deciding the run's
 * status, choosing which target paths to snapshot, and detecting a target
 * whose cached child list has not caught up with its database.
 *
 * Why the snapshot exists: the target CM caches each item's child list. While
 * the transfer job rewrites an item that already exists on the target it holds
 * a per-item lock, and under that lock the item's children evaluate to only the
 * ones carried by the transfer. Anything that reads the list in that window
 * (the CM's own save handlers are enough) caches it, and the job's completion
 * does not clear it, so the tree then looks as if items were deleted. Waiting
 * for Transferred cannot prevent that; only a cache clear on the target fixes
 * it. Because the merge strategy Rift sends never deletes, every child that
 * existed under a snapshotted path before the run must still be listed after
 * it; anything that is not is cache lag, not data loss.
 *
 * Everything here is SDK-free so it is unit-testable; the fetches live in the
 * component.
 */

/** Unique non-empty paths, in first-seen order. */
function distinctPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * The target paths whose child lists are compared before and after a run: each
 * selected root, once, in first-seen order. Only a transferred item's own list
 * can go stale (it is rewritten under a lock, see the module comment); its
 * parent is not transferred, and a newly created child updates the parent's
 * cached list in place.
 */
export function distinctSnapshotPaths(itemPaths: string[]): string[] {
  return distinctPaths(itemPaths);
}

/**
 * Children present in `before` whose itemId is absent from `after`. Keyed on
 * itemId, not name: a transfer can rename an item in place and a source-side
 * move can relocate a GUID, and neither is a missing item.
 */
export function findMissingChildren(before: TreeNode[], after: TreeNode[]): TreeNode[] {
  const present = new Set(after.map((n) => n.itemId));
  return before.filter((n) => !present.has(n.itemId));
}

export type RepairStatus = 'repairing' | 'repaired' | 'incomplete' | 'failed';

export interface CacheLagNotice {
  parentPath: string;
  /** Names of the pre-existing children the target is not listing right now. */
  missing: string[];
  /** Set once Rift has started repairing this parent's listing (see applyRepairResult). */
  repair?: { status: RepairStatus; restored?: string[]; error?: string };
}

/**
 * One notice per parent that was snapshotted both before and after the run and
 * lost at least one pre-existing child. A parent missing from either map (its
 * fetch failed) is skipped: the check must never raise a false alarm because a
 * fetch did not happen.
 */
export function buildCacheLagNotices(
  before: Map<string, TreeNode[]>,
  after: Map<string, TreeNode[]>
): CacheLagNotice[] {
  const notices: CacheLagNotice[] = [];
  for (const [parentPath, pre] of before) {
    const post = after.get(parentPath);
    if (!post) continue;
    const missing = findMissingChildren(pre, post);
    if (missing.length > 0) {
      notices.push({ parentPath, missing: missing.map((n) => n.name) });
    }
  }
  return notices;
}

function updateNotice(
  notices: CacheLagNotice[],
  parentPath: string,
  update: (n: CacheLagNotice) => CacheLagNotice
): CacheLagNotice[] {
  return notices.map((n) => (n.parentPath === parentPath ? update(n) : n));
}

/** The notices with the given parent flagged as being repaired right now. */
export function markRepairing(notices: CacheLagNotice[], parentPath: string): CacheLagNotice[] {
  return updateNotice(notices, parentPath, (n) => ({ ...n, repair: { status: 'repairing' } }));
}

/**
 * The notices after one flagged parent has been repaired (saved under its
 * current name) and re-read. Its notice stays, so the user sees that content
 * was written: `repaired` when every pre-existing child is listed again,
 * `incomplete` when some still are not. `restored` names what came back,
 * `missing` what is still absent. Other notices are untouched.
 */
export function applyRepairResult(
  notices: CacheLagNotice[],
  parentPath: string,
  before: TreeNode[],
  after: TreeNode[]
): CacheLagNotice[] {
  const missing = findMissingChildren(before, after).map((n) => n.name);
  return updateNotice(notices, parentPath, (n) => ({
    parentPath,
    missing,
    repair: {
      status: missing.length > 0 ? 'incomplete' : 'repaired',
      restored: n.missing.filter((name) => !missing.includes(name)),
    },
  }));
}

/** The notices with the given parent's repair recorded as failed; its missing list is unchanged. */
export function markRepairFailed(
  notices: CacheLagNotice[],
  parentPath: string,
  error: string
): CacheLagNotice[] {
  return updateNotice(notices, parentPath, (n) => ({ ...n, repair: { status: 'failed', error } }));
}

/**
 * True when this path's target write is unconfirmed: the target accepted the
 * file (the path reached `consuming` or `finalizing`) but Rift never saw
 * Transferred, and the target did not definitively reject it. That covers a
 * finalizing timeout, a cancel after the file was submitted, and a transport
 * error while polling. In all of them the target's background job keeps
 * running after Rift stops, so reading the tree now is exactly the early read
 * that caches a transitional child list.
 */
export function wasTargetWriteUnconfirmed(p: TransferProgress): boolean {
  if (p.phase !== 'error') return false;
  const reachedTarget = (p.events ?? []).some(
    (e) => e.phase === 'consuming' || e.phase === 'finalizing'
  );
  if (!reachedTarget) return false;
  return !(p.error ?? '').startsWith(CONSUME_REJECTED_PREFIX);
}

/** True when any path's target write is unconfirmed; the tree must not be refreshed. */
export function hasUnconfirmedTargetWrite(progress: TransferProgress[]): boolean {
  return progress.some(wasTargetWriteUnconfirmed);
}

export type RunStatus = 'success' | 'partial' | 'failed';

/**
 * `failed` when every path errored; `partial` when any path errored or any path
 * finished with a target warning (TransferredWithErrors); otherwise `success`.
 */
export function runStatus(progress: TransferProgress[]): RunStatus {
  const errored = progress.filter((p) => p.phase === 'error').length;
  if (progress.length > 0 && errored === progress.length) return 'failed';
  if (errored > 0 || progress.some((p) => p.warning)) return 'partial';
  return 'success';
}
