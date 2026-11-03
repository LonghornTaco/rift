'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { TreeNode, MigrationPath, DualTreeNode } from '@/lib/rift/types';
import { fetchDualTreeChildren, fetchDualTreeChildrenStrict } from '@/lib/rift/api-client';
import { Checkbox } from '@/components/ui/checkbox';
import { Folder, File } from 'lucide-react';
import { DriftPill } from './DriftPill';
import {
  computeDriftRollup,
  evictSubtrees,
  isUnderRoot,
  missingFolders,
  walkableChildPaths,
  type DriftRollup,
} from '@/lib/rift/drift-rollup';
import { TreeWalker, type WalkProgress } from '@/lib/rift/tree-walker';

import { cn } from '@/lib/utils';

const EMPTY_ROLLUP: ReadonlyMap<string, DriftRollup> = new Map();

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function getFolderIconClasses(diff: DualTreeNode['diff']): string {
  if (diff === 'match') return 'fill-emerald-500/30 stroke-emerald-500';
  if (diff === 'different') return 'fill-amber-500/30 stroke-amber-500';
  return '';
}

/**
 * Renders the left half of a dual-tree row. Shows checkbox + icon + name when the item
 * exists on source; a ghost slot (dashed hatched) when it does not.
 */
interface SourceCellProps {
  node: DualTreeNode;
  isSelected: boolean;
  isInherited: boolean;
  isAncestorDisabled: boolean;
  onTogglePath: (node: TreeNode) => void;
  onCompareItem: (node: DualTreeNode) => void;
  isCompareTarget: boolean;
  rollup?: DriftRollup;
}

function SourceCell({
  node,
  isSelected,
  isInherited,
  isAncestorDisabled,
  onTogglePath,
  onCompareItem,
  isCompareTarget,
  rollup,
}: SourceCellProps) {
  if (!node.source) {
    return <GhostSlot />;
  }

  const Icon = node.hasChildren ? Folder : File;

  return (
    <div className="flex items-center gap-1 min-w-0">
      <Checkbox
        checked={isSelected || isInherited}
        onCheckedChange={() => onTogglePath(node.source!)}
        disabled={isInherited || isAncestorDisabled}
        className={cn(
          'shrink-0',
          (isInherited || isAncestorDisabled) && 'opacity-50 pointer-events-none'
        )}
      />

      <button
        type="button"
        onClick={() => onCompareItem(node)}
        className={cn(
          'flex items-center gap-1 min-w-0 text-left rounded-sm px-1 -mx-1',
          isCompareTarget && 'bg-accent/60',
        )}
      >
        <Icon
          className={cn(
            'w-4 h-4 shrink-0 text-muted-foreground',
            getFolderIconClasses(node.diff),
            isAncestorDisabled && 'opacity-40',
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            'truncate',
            isSelected ? 'font-bold' : 'font-normal',
            (isInherited || isAncestorDisabled) ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {node.name}
        </span>
        <DriftPill rollup={rollup} />
      </button>
    </div>
  );
}

/**
 * Renders the right half of a dual-tree row.
 * - Real node: icon + name (no checkbox).
 * - Not on target: ghost slot.
 * - No target env selected: muted em-dash.
 */
interface TargetCellProps {
  node: DualTreeNode;
  targetContextId: string | null;
  onCompareItem: (node: DualTreeNode) => void;
  isCompareTarget: boolean;
  rollup?: DriftRollup;
}

function TargetCell({ node, targetContextId, onCompareItem, isCompareTarget, rollup }: TargetCellProps) {
  if (targetContextId === null) {
    return (
      <div className="flex items-center min-w-0 text-muted-foreground/60 text-sm">
        &mdash;
      </div>
    );
  }

  if (!node.target) {
    return <GhostSlot tone="warning" />;
  }

  const tint = node.diff === 'different' ? 'text-amber-500' : 'text-muted-foreground';
  const Icon = node.hasChildren ? Folder : File;

  return (
    <button
      type="button"
      onClick={() => onCompareItem(node)}
      className={cn(
        'flex items-center gap-1 min-w-0 text-left rounded-sm px-1 -mx-1',
        tint,
        isCompareTarget && 'bg-accent/60',
      )}
      title={node.diff === 'different' ? 'Target differs from source' : undefined}
    >
      <Icon
        className={cn('w-4 h-4 shrink-0', getFolderIconClasses(node.diff))}
        aria-hidden="true"
      />
      <span className="truncate">{node.target.name}</span>
      <DriftPill rollup={rollup} />
    </button>
  );
}

/**
 * A dashed, hatched box of uniform row height, used when an item exists on one side but
 * not the other.
 *
 * - `tone="neutral"` (default): gray hatch. Used on source side for target-only rows.
 * - `tone="warning"`: amber hatch. Used on target side for source-only rows —
 *   visually matches the amber "drift" tint since the item will need to be created
 *   on target if the user chooses to migrate.
 */
function GhostSlot({ tone = 'neutral' }: { tone?: 'neutral' | 'warning' }) {
  const isWarning = tone === 'warning';
  const borderClass = isWarning ? 'border-amber-500/60' : 'border-muted-foreground/50';
  const hatchColor = isWarning ? 'rgba(245,158,11,0.2)' : 'rgba(127,127,127,0.15)';
  const label = isWarning ? 'not present on target' : 'not present';
  return (
    <div
      className={cn('inline-block border border-dashed rounded-sm h-4 w-20', borderClass)}
      style={{
        backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 3px, ${hatchColor} 3px, ${hatchColor} 6px)`,
      }}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

interface TreeNodeRowProps {
  node: DualTreeNode;
  depth: number;
  expandedNodes: Set<string>;
  loadingNodes: Set<string>;
  selectedPathSet: Set<string>;
  inheritedPaths: Set<string>;
  childrenCache: Map<string, DualTreeNode[]>;
  onExpand: (node: DualTreeNode) => void;
  onTogglePath: (node: TreeNode) => void;
  showHiddenItems: boolean;
  /** Paths that should have disabled checkboxes (content tree ancestors) */
  disabledAncestorPaths?: Set<string>;
  /** Set of child paths to show when hidden items are off. If undefined, no filtering. */
  visibleChildPaths?: Set<string>;
  targetContextId: string | null;
  onCompareItem: (node: DualTreeNode) => void;
  compareTargetPath: string | null;
  driftRollup: ReadonlyMap<string, DriftRollup>;
  /** True while the target may still be writing; uncached folders cannot be expanded. */
  expansionBlocked: boolean;
}

/**
 * The expand arrow shared by both row renderers, with the loading overlay. When
 * `blocked` the arrow is dimmed and inert.
 */
function ExpandArrow({
  hasChildren,
  isExpanded,
  isLoading,
  blocked,
  onClick,
}: {
  hasChildren: boolean;
  isExpanded: boolean;
  isLoading: boolean;
  blocked: boolean;
  onClick: () => void;
}) {
  return (
    <span className="w-4 shrink-0 relative text-center">
      {hasChildren ? (
        <span
          onClick={blocked ? undefined : onClick}
          className={cn(
            'text-muted-foreground select-none',
            blocked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
          )}
          title={blocked ? 'Target is still writing; refresh the tree to continue' : undefined}
        >
          {isExpanded ? '\u25BC' : '\u25B6'}
        </span>
      ) : null}
      {isLoading && (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs bg-background">
          ...
        </span>
      )}
    </span>
  );
}

function TreeNodeRow({
  node,
  depth,
  expandedNodes,
  loadingNodes,
  selectedPathSet,
  inheritedPaths,
  childrenCache,
  onExpand,
  onTogglePath,
  showHiddenItems,
  disabledAncestorPaths,
  visibleChildPaths,
  targetContextId,
  onCompareItem,
  compareTargetPath,
  driftRollup,
  expansionBlocked,
}: TreeNodeRowProps) {
  const isExpanded = expandedNodes.has(node.path);
  const isLoading = loadingNodes.has(node.path);
  const hasSource = !!node.source;
  // Only report selected/inherited when there's a source node — target-only rows should
  // never render a checked state even if the path coincidentally appears in selection.
  const isSelected = hasSource && selectedPathSet.has(node.path);
  const isInherited = hasSource && inheritedPaths.has(node.path);
  const isAncestorDisabled = disabledAncestorPaths?.has(node.path) ?? false;
  let children = childrenCache.get(node.path) ?? [];

  if (visibleChildPaths) {
    children = children.filter((c) => visibleChildPaths.has(c.path));
  }

  return (
    <>
      <div
        className="flex items-center gap-2 leading-8 text-sm"
        style={{ paddingLeft: depth * 20 }}
      >
        <ExpandArrow
          hasChildren={node.hasChildren}
          isExpanded={isExpanded}
          isLoading={isLoading}
          blocked={expansionBlocked && !childrenCache.has(node.path)}
          onClick={() => onExpand(node)}
        />

        {/* Source half */}
        <div className="flex-1 min-w-0">
          <SourceCell
            node={node}
            isSelected={isSelected}
            isInherited={isInherited}
            isAncestorDisabled={isAncestorDisabled}
            onTogglePath={onTogglePath}
            onCompareItem={onCompareItem}
            isCompareTarget={compareTargetPath === node.path}
            rollup={driftRollup.get(node.path)}
          />
        </div>

        {/* Target half */}
        {targetContextId !== null && (
          <div className="flex-1 min-w-0">
            <TargetCell
              node={node}
              targetContextId={targetContextId}
              onCompareItem={onCompareItem}
              isCompareTarget={compareTargetPath === node.path}
              rollup={driftRollup.get(node.path)}
            />
          </div>
        )}
      </div>

      {isExpanded &&
        children.map((child) => (
          <TreeNodeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedNodes={expandedNodes}
            loadingNodes={loadingNodes}
            selectedPathSet={selectedPathSet}
            inheritedPaths={inheritedPaths}
            childrenCache={childrenCache}
            onExpand={onExpand}
            onTogglePath={onTogglePath}
            showHiddenItems={showHiddenItems}
            disabledAncestorPaths={disabledAncestorPaths}
            targetContextId={targetContextId}
            onCompareItem={onCompareItem}
            compareTargetPath={compareTargetPath}
            driftRollup={driftRollup}
            expansionBlocked={expansionBlocked}
          />
        ))}
    </>
  );
}

interface RiftContentTreeProps {
  client: ClientSDK;
  contextId: string;
  targetContextId: string | null;
  rootPath: string;
  selectedPaths: MigrationPath[];
  onTogglePath: (node: TreeNode) => void;
  inheritedPaths: Set<string>;
  onChildrenLoaded?: (parentPath: string, children: TreeNode[]) => void;
  disabled?: boolean;
  refreshKey?: number;
  /**
   * Bump to re-fetch the children of currently-expanded nodes and merge them into
   * the cache WITHOUT collapsing the tree or clearing the cache. Used after a
   * successful migration so the target side reflects newly-migrated items while
   * preserving the user's expansion state.
   */
  preserveExpansionRefreshKey?: number;
  onCompareItem: (node: DualTreeNode) => void;
  compareTargetPath: string | null;
}

export function RiftContentTree({
  client,
  contextId,
  targetContextId,
  rootPath,
  selectedPaths,
  onTogglePath,
  inheritedPaths,
  onChildrenLoaded,
  disabled,
  refreshKey,
  preserveExpansionRefreshKey,
  onCompareItem,
  compareTargetPath,
}: RiftContentTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [childrenCache, setChildrenCache] = useState<Map<string, DualTreeNode[]>>(new Map());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [showHiddenItems, setShowHiddenItems] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const walkerRef = useRef<TreeWalker | null>(null);
  const [walkProgress, setWalkProgress] = useState<WalkProgress>({
    checked: 0,
    pending: 0,
    inFlight: 0,
    paused: false,
  });
  const [walkRoots, setWalkRoots] = useState<string[]>([]);
  // Set when a migration starts; cleared only by the post-run soft refresh or a full
  // reset. While set, the walk stays paused and uncached folders cannot be expanded,
  // because reading a target child list while the target is still writing caches a
  // wrong list on the CM.
  const [awaitingSettle, setAwaitingSettle] = useState(false);
  const expansionBlocked = !!disabled || awaitingSettle;

  // The two top-level nodes: "content" and "media library" from /sitecore
  const [contentNode, setContentNode] = useState<DualTreeNode | null>(null);
  const [mediaLibraryNode, setMediaLibraryNode] = useState<DualTreeNode | null>(null);

  const childrenCacheRef = useRef(childrenCache);
  childrenCacheRef.current = childrenCache;

  const expandedNodesRef = useRef(expandedNodes);
  expandedNodesRef.current = expandedNodes;

  const onChildrenLoadedRef = useRef(onChildrenLoaded);
  onChildrenLoadedRef.current = onChildrenLoaded;

  const walkRootsRef = useRef<string[]>([]);
  walkRootsRef.current = walkRoots;

  const selectedPathsRef = useRef(selectedPaths);
  selectedPathsRef.current = selectedPaths;

  const selectedPathSet = new Set(
    selectedPaths.map((p) => p.itemPath)
  );

  // Parse rootPath into segments for building filter paths
  const pathInfo = useMemo(() => {
    const contentPrefix = '/sitecore/content/';
    if (!rootPath.toLowerCase().startsWith(contentPrefix.toLowerCase())) return null;
    const relativePath = rootPath.slice(contentPrefix.length);
    const segments = relativePath.split('/').filter(Boolean);

    const contentLockedPaths = new Map<string, Set<string>>();
    const contentDefaultPaths = new Map<string, Set<string>>();
    // All ancestor paths (including site root) that should have disabled checkboxes
    const contentAncestorPaths = new Set<string>();

    let contentAccum = '/sitecore/content';
    contentAncestorPaths.add(contentAccum);
    for (const seg of segments) {
      const childPath = `${contentAccum}/${seg}`;
      contentLockedPaths.set(contentAccum, new Set([childPath]));
      contentAccum = childPath;
      contentAncestorPaths.add(contentAccum);
    }
    contentDefaultPaths.set(rootPath, new Set([
      `${rootPath}/Home`,
      `${rootPath}/Data`,
    ]));

    // Media tree: intermediate paths are default-hidden (revealed with Show Hidden Items)
    const mediaDefaultPaths = new Map<string, Set<string>>();
    const mediaSegments = ['Project', ...segments];
    let mediaAccum = '/sitecore/media library';
    for (const seg of mediaSegments) {
      const childPath = `${mediaAccum}/${seg}`;
      mediaDefaultPaths.set(mediaAccum, new Set([childPath]));
      mediaAccum = childPath;
    }
    // At the site media folder, show everything (no entry = no filtering)

    return {
      segments,
      relativePath,
      contentLockedPaths,
      contentDefaultPaths,
      contentAncestorPaths,
      mediaDefaultPaths,
      mediaFinalPath: mediaAccum,
    };
  }, [rootPath]);

  // Background drift walk. Declared before the initial-load effect so the walker
  // exists by the time loadTrees seeds it. No target means no walk.
  useEffect(() => {
    if (targetContextId === null) {
      walkerRef.current = null;
      setWalkProgress({ checked: 0, pending: 0, inFlight: 0, paused: false });
      return;
    }

    const walker = new TreeWalker({
      fetch: (p) => fetchDualTreeChildrenStrict(client, contextId, targetContextId, p),
      isCached: (p) => childrenCacheRef.current.has(p),
      next: walkableChildPaths,
      onLoaded: (path, children) => {
        setChildrenCache((prev) => {
          if (prev.has(path)) return prev;
          const next = new Map(prev);
          next.set(path, children);
          return next;
        });
        // onChildrenLoaded still emits the source-side TreeNode[] for selection math.
        const sourceOnly = children.map((c) => c.source).filter((n): n is TreeNode => !!n);
        onChildrenLoadedRef.current?.(path, sourceOnly);
      },
      onProgress: setWalkProgress,
    });
    walkerRef.current = walker;

    return () => {
      walker.reset();
      if (walkerRef.current === walker) walkerRef.current = null;
    };
  }, [client, contextId, targetContextId]);

  // A migration is starting: stop the walk. Deliberately nothing happens when
  // `disabled` goes false again - the parent clears it before its post-run checks,
  // so only the soft refresh or a full reset may resume the walk.
  useEffect(() => {
    if (disabled) {
      walkerRef.current?.pause();
      setAwaitingSettle(true);
    }
  }, [disabled]);

  // Fetch both trees on mount
  useEffect(() => {
    let cancelled = false;
    setAwaitingSettle(false);
    setContentNode(null);
    setMediaLibraryNode(null);
    setExpandedNodes(new Set());
    setChildrenCache(new Map());
    setIsLoading(true);

    const loadTrees = async () => {
      if (!pathInfo) return;

      walkerRef.current?.reset(); // drop any walk from a previous load

      try {
        const sitecoreChildren = await fetchDualTreeChildren(
          client, contextId, targetContextId, '/sitecore'
        );
        if (cancelled) return;

        const contentN = sitecoreChildren.find((n) => n.name === 'content') ?? null;
        const mediaLibN = sitecoreChildren.find(
          (n) => n.name.toLowerCase() === 'media library'
        ) ?? null;

        setContentNode(contentN);
        setMediaLibraryNode(mediaLibN);

        const newCache = new Map<string, DualTreeNode[]>();
        const expandPaths = new Set<string>();
        const roots: string[] = [];

        const emitChildrenLoaded = (path: string, dual: DualTreeNode[]) => {
          const sourceOnly = dual.map((d) => d.source).filter((n): n is TreeNode => !!n);
          onChildrenLoadedRef.current?.(path, sourceOnly);
        };

        if (contentN) {
          expandPaths.add(contentN.path);
          let currentPath = contentN.path;
          let contentMatched = true;

          for (const seg of pathInfo.segments) {
            if (cancelled) return;
            const children = await fetchDualTreeChildren(client, contextId, targetContextId, currentPath);
            newCache.set(currentPath, children);
            emitChildrenLoaded(currentPath, children);

            const match = children.find((c) => c.name === seg);
            if (!match) {
              console.warn(`[Rift] Content path segment "${seg}" not found under ${currentPath}`);
              contentMatched = false;
              break;
            }
            expandPaths.add(match.path);
            currentPath = match.path;
          }
          if (contentMatched) roots.push(currentPath);

          if (cancelled) return;
          try {
            const siteChildren = await fetchDualTreeChildren(client, contextId, targetContextId, currentPath);
            newCache.set(currentPath, siteChildren);
            emitChildrenLoaded(currentPath, siteChildren);
          } catch {}
        }

        if (mediaLibN) {
          expandPaths.add(mediaLibN.path);
          const mediaSegments = ['Project', ...pathInfo.segments];
          let currentPath = mediaLibN.path;
          let mediaMatched = true;

          for (const seg of mediaSegments) {
            if (cancelled) return;
            const children = await fetchDualTreeChildren(client, contextId, targetContextId, currentPath);
            newCache.set(currentPath, children);
            emitChildrenLoaded(currentPath, children);

            const match = children.find((c) => c.name === seg);
            if (!match) {
              console.warn(`[Rift] Media path segment "${seg}" not found under ${currentPath}`);
              mediaMatched = false;
              break;
            }
            currentPath = match.path;
            // Expand intermediate nodes but not the final media folder
            if (seg !== mediaSegments[mediaSegments.length - 1]) {
              expandPaths.add(match.path);
            }
          }
          if (mediaMatched) roots.push(currentPath);

          if (cancelled) return;
          try {
            const siteMediaChildren = await fetchDualTreeChildren(client, contextId, targetContextId, currentPath);
            newCache.set(currentPath, siteMediaChildren);
            emitChildrenLoaded(currentPath, siteMediaChildren);
          } catch {}
        }

        if (cancelled) return;

        setChildrenCache((prev) => {
          const next = new Map(prev);
          for (const [k, v] of newCache) next.set(k, v);
          return next;
        });
        setExpandedNodes(expandPaths);
        setIsLoading(false);
        setWalkRoots(roots);
        walkerRef.current?.enqueue(missingFolders(newCache, roots));
      } catch (err) {
        console.error('[Rift] Failed to load content trees:', err);
        if (!cancelled) setIsLoading(false);
      }
    };

    loadTrees();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, refreshKey, targetContextId]);

  // Soft refresh: re-fetch the children of every currently-expanded node and of
  // the parent of every selected path, drop the migrated subtrees from the cache,
  // and merge the fresh reads in WITHOUT resetting expansion. Triggered after a
  // migration once the parent's post-run check and repairs are done, so the target
  // side picks up newly-created items while the user keeps their place in the tree.
  // It then clears the settle flag and re-walks whatever is now missing beneath the
  // walk roots. Skipped on mount (key starts at 0).
  useEffect(() => {
    if (!preserveExpansionRefreshKey) return;
    const selectedItemPaths = selectedPathsRef.current.map((p) => p.itemPath);
    const paths = Array.from(
      new Set([
        ...expandedNodesRef.current,
        ...selectedItemPaths.map((path) => path.slice(0, path.lastIndexOf('/'))),
      ])
    );

    let cancelled = false;
    walkerRef.current?.reset(); // drop any in-flight walk reads; we are re-reading

    (async () => {
      const results = await Promise.all(
        paths.map(async (path) => {
          try {
            const children = await fetchDualTreeChildren(client, contextId, targetContextId, path);
            return { path, children };
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;

      const valid = results.filter(
        (r): r is { path: string; children: DualTreeNode[] } => r !== null
      );
      const next = new Map(evictSubtrees(childrenCacheRef.current, selectedItemPaths));
      for (const r of valid) next.set(r.path, r.children);
      setChildrenCache(next);
      for (const r of valid) {
        const sourceOnly = r.children.map((c) => c.source).filter((n): n is TreeNode => !!n);
        onChildrenLoadedRef.current?.(r.path, sourceOnly);
      }
      setAwaitingSettle(false);
      walkerRef.current?.enqueue(missingFolders(next, walkRootsRef.current));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preserveExpansionRefreshKey]);

  const getVisibleChildPaths = useCallback(
    (node: DualTreeNode, isMedia: boolean): Set<string> | undefined => {
      if (!pathInfo) return undefined;

      if (isMedia) {
        if (!showHiddenItems) {
          return pathInfo.mediaDefaultPaths.get(node.path);
        }
        return undefined;
      }

      const locked = pathInfo.contentLockedPaths.get(node.path);
      if (locked) return locked;

      if (!showHiddenItems) {
        const defaults = pathInfo.contentDefaultPaths.get(node.path);
        if (defaults) {
          // Also show any selected paths that are direct children of this node
          const merged = new Set(defaults);
          for (const sp of selectedPaths) {
            if (sp.itemPath.startsWith(node.path + '/') && !sp.itemPath.slice(node.path.length + 1).includes('/')) {
              merged.add(sp.itemPath);
            }
          }
          return merged;
        }
      }

      return undefined;
    },
    [pathInfo, showHiddenItems, selectedPaths]
  );

  const handleExpand = useCallback(
    async (node: DualTreeNode) => {
      const key = node.path;
      // An uncached folder would read the target child list while it may still be writing.
      if (expansionBlocked && !childrenCacheRef.current.has(node.path)) return;

      let wasExpanded = false;
      setExpandedNodes((prev) => {
        if (prev.has(key)) {
          wasExpanded = true;
          const next = new Set(prev);
          next.delete(key);
          return next;
        }
        return new Set(prev).add(key);
      });

      if (wasExpanded) return;

      if (!childrenCacheRef.current.has(node.path)) {
        setLoadingNodes((prev) => new Set(prev).add(key));
        try {
          const children = await fetchDualTreeChildren(client, contextId, targetContextId, node.path);
          setChildrenCache((prev) => new Map(prev).set(node.path, children));
          const sourceOnly = children.map((c) => c.source).filter((n): n is TreeNode => !!n);
          onChildrenLoadedRef.current?.(node.path, sourceOnly);
          // Only folders beneath a walk root feed the walk; the roll-up never covers the rest.
          if (isUnderRoot(node.path, walkRootsRef.current)) {
            walkerRef.current?.enqueue(walkableChildPaths(children), 'front');
          }
        } catch {
          // Silently handle
        } finally {
          setLoadingNodes((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        }
      }
    },
    [client, contextId, targetContextId, expansionBlocked],
  );

  const driftRollup = useMemo(
    () =>
      targetContextId !== null && walkRoots.length > 0
        ? computeDriftRollup(childrenCache, walkRoots)
        : EMPTY_ROLLUP,
    [childrenCache, walkRoots, targetContextId],
  );

  const baseTreeRowProps = {
    expandedNodes,
    loadingNodes,
    selectedPathSet,
    inheritedPaths,
    childrenCache,
    onExpand: handleExpand,
    onTogglePath,
    showHiddenItems,
    disabledAncestorPaths: pathInfo?.contentAncestorPaths,
    targetContextId,
    onCompareItem,
    compareTargetPath,
    driftRollup,
    expansionBlocked,
  };

  // Render a branch of the tree with per-level filtering
  const renderFilteredBranch = (node: DualTreeNode, depth: number, isMedia: boolean) => {
    const isExpanded = expandedNodes.has(node.path);
    const isLoadingNode = loadingNodes.has(node.path);
    const hasSource = !!node.source;
    const isSelected = hasSource && selectedPathSet.has(node.path);
    const isInherited = hasSource && inheritedPaths.has(node.path);
    const isAncestorDisabled = !isMedia && (pathInfo?.contentAncestorPaths.has(node.path) ?? false);
    let children = childrenCache.get(node.path) ?? [];

    const visiblePaths = getVisibleChildPaths(node, isMedia);
    if (visiblePaths) {
      children = children.filter((c) => visiblePaths.has(c.path));
    }

    return (
      <div key={node.path}>
        <div
          className="flex items-center gap-2 leading-8 text-sm"
          style={{ paddingLeft: depth * 20 }}
        >
          <ExpandArrow
            hasChildren={node.hasChildren}
            isExpanded={isExpanded}
            isLoading={isLoadingNode}
            blocked={expansionBlocked && !childrenCache.has(node.path)}
            onClick={() => handleExpand(node)}
          />

          <div className="flex-1 min-w-0">
            <SourceCell
              node={node}
              isSelected={isSelected}
              isInherited={isInherited}
              isAncestorDisabled={isAncestorDisabled}
              onTogglePath={onTogglePath}
              onCompareItem={onCompareItem}
              isCompareTarget={compareTargetPath === node.path}
              rollup={driftRollup.get(node.path)}
            />
          </div>

          {targetContextId !== null && (
            <div className="flex-1 min-w-0">
              <TargetCell
                node={node}
                targetContextId={targetContextId}
                onCompareItem={onCompareItem}
                isCompareTarget={compareTargetPath === node.path}
                rollup={driftRollup.get(node.path)}
              />
            </div>
          )}
        </div>

        {isExpanded &&
          children.map((child) => {
            const childVisiblePaths = getVisibleChildPaths(child, isMedia);
            if (childVisiblePaths) {
              return renderFilteredBranch(child, depth + 1, isMedia);
            }
            return (
              <TreeNodeRow
                key={child.path}
                node={child}
                depth={depth + 1}
                {...baseTreeRowProps}
              />
            );
          })}
      </div>
    );
  };

  return (
    <div className="relative min-h-full">
      {/* Continuous column divider between Source and Target — hidden while loading so it doesn't cut through the spinner, and hidden until a target is selected. */}
      {!isLoading && targetContextId !== null && (
        <div
          className="absolute top-0 bottom-0 w-px bg-border pointer-events-none"
          style={{ left: '50%' }}
          aria-hidden="true"
        />
      )}

      <div className="flex justify-between items-center mb-3">
        <div className="text-xs font-semibold text-muted-foreground">
          CONTENT TREE
        </div>
        <div className="flex items-center gap-4">
          {walkProgress.pending + walkProgress.inFlight > 0 &&
            (awaitingSettle ? (
              <span className="text-xs text-muted-foreground">
                Drift scan paused until the tree is refreshed
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Spinner className="h-3 w-3" />
                Scanning for drift: {walkProgress.checked} folders checked
              </span>
            ))}
          <label className="text-sm text-muted-foreground flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={showHiddenItems}
              onCheckedChange={(checked) => setShowHiddenItems(checked === true)}
            />
            Show hidden items
          </label>
        </div>
      </div>

      {targetContextId === null && (
        <div className="text-xs text-muted-foreground mb-2 italic">
          Select a target environment to populate &rarr;
        </div>
      )}

      {/* Column headers */}
      <div className="flex items-center gap-2 mb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
        <span className="w-4 shrink-0" />
        <div className="flex-1">Source</div>
        {targetContextId !== null && <div className="flex-1">Target</div>}
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
          <Spinner className="h-6 w-6" />
          <span className="text-sm">Loading content tree...</span>
        </div>
      ) : (
        <>
          {/* Content tree */}
          {contentNode && renderFilteredBranch(contentNode, 0, false)}

          {/* Media library */}
          {mediaLibraryNode && renderFilteredBranch(mediaLibraryNode, 0, true)}
        </>
      )}
    </div>
  );
}
