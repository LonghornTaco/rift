import type { DualTreeNode } from '@/lib/rift/types';

export interface DriftRollup {
  count: number;
  complete: boolean;
}

/** A child counts as drift when it differs, or exists on the source with no target; target-only and undiff'd children never count. */
export function countsAsDrift(node: DualTreeNode): boolean {
  return node.diff === 'different' || (!!node.source && !node.target);
}

/** The walk descends only into folders (hasChildren) present on both sides; a source-only folder counts as one and is never descended. */
export function isWalkableFolder(node: DualTreeNode): boolean {
  return node.hasChildren && !!node.source && !!node.target;
}

/** True when the path is one of the roots or sits beneath one (a sibling sharing a name prefix does not count). */
export function isUnderRoot(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(root + '/'));
}

/** Paths of the children the walk may descend into, in listing order. */
export function walkableChildPaths(children: readonly DualTreeNode[]): string[] {
  return children.filter(isWalkableFolder).map((c) => c.path);
}

/** Per-folder drift count beneath each root; a folder never counts itself and is complete only when every walkable child is cached and complete. */
export function computeDriftRollup(
  cache: ReadonlyMap<string, DualTreeNode[]>,
  roots: readonly string[],
): Map<string, DriftRollup> {
  const results = new Map<string, DriftRollup>();

  const visit = (path: string): DriftRollup => {
    const known = results.get(path);
    if (known) return known;
    const children = cache.get(path);
    if (!children) {
      const uncached: DriftRollup = { count: 0, complete: false };
      results.set(path, uncached);
      return uncached;
    }
    // Guard against a cyclic listing: a re-entrant visit sees this placeholder.
    results.set(path, { count: 0, complete: false });
    let count = 0;
    let complete = true;
    for (const child of children) {
      if (countsAsDrift(child)) count += 1;
      if (isWalkableFolder(child)) {
        const sub = visit(child.path);
        count += sub.count;
        if (!sub.complete) complete = false;
      }
    }
    const rollup: DriftRollup = { count, complete };
    results.set(path, rollup);
    return rollup;
  };

  for (const root of roots) visit(root);
  return results;
}

/** Breadth-first from the roots, the walkable folders (roots included) that are not yet in the cache. */
export function missingFolders(
  cache: ReadonlyMap<string, DualTreeNode[]>,
  roots: readonly string[],
): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  const queue = [...roots];
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    if (seen.has(path)) continue;
    seen.add(path);
    const children = cache.get(path);
    if (!children) {
      missing.push(path);
      continue;
    }
    queue.push(...walkableChildPaths(children));
  }
  return missing;
}

/** Drops each path and everything beneath it (not siblings sharing a name prefix); returns the same map instance when nothing matches. */
export function evictSubtrees(
  cache: ReadonlyMap<string, DualTreeNode[]>,
  paths: readonly string[],
): Map<string, DualTreeNode[]> {
  const matches = (key: string) => isUnderRoot(key, paths);
  if (![...cache.keys()].some(matches)) return cache as Map<string, DualTreeNode[]>;
  return new Map([...cache].filter(([key]) => !matches(key)));
}
