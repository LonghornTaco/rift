import type { TreeNode, TransferProgress } from './types';
import { CONSUME_REJECTED_PREFIX } from './types';

/**
 * Pure helpers for what happens AFTER a migration run: deciding the run's
 * status, choosing which target parents to snapshot, and detecting a target
 * whose cached child list has not caught up with its database.
 *
 * Why the snapshot exists: the target CM caches each parent's child list. If
 * anything reads a parent while a transfer's background job is still writing
 * under it, that transitional list can be cached and the tree then looks as if
 * items were deleted. Rift no longer reads before the job finishes, but an open
 * Content Editor can. Because the merge strategy Rift sends never deletes, every
 * child that existed under a parent before the run must still be listed after
 * it; anything that is not is cache lag, not data loss.
 *
 * Everything here is SDK-free so it is unit-testable; the fetches live in the
 * component.
 */

/** The path up to the last `/`, or `''` when there is no parent segment. */
export function parentPathOf(itemPath: string): string {
  const idx = itemPath.lastIndexOf('/');
  if (idx <= 0) return '';
  return itemPath.slice(0, idx);
}

/** Unique parents of the given paths, in first-seen order, roots skipped. */
export function distinctParentPaths(itemPaths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of itemPaths) {
    const parent = parentPathOf(p);
    if (!parent || seen.has(parent)) continue;
    seen.add(parent);
    out.push(parent);
  }
  return out;
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

export interface CacheLagNotice {
  parentPath: string;
  /** Names of the pre-existing children the target is no longer listing. */
  missing: string[];
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
