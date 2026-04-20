'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { TreeNode, MigrationPath, DualTreeNode } from '@/lib/rift/types';
import { fetchDualTreeChildren } from '@/lib/rift/api-client';
import { Checkbox } from '@/components/ui/checkbox';

import { cn } from '@/lib/utils';

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
}

function SourceCell({
  node,
  isSelected,
  isInherited,
  isAncestorDisabled,
  onTogglePath,
}: SourceCellProps) {
  if (!node.source) {
    return <GhostSlot />;
  }

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

      <span className={cn("text-muted-foreground shrink-0", isAncestorDisabled && 'opacity-40')}>
        {node.hasChildren ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}
      </span>

      <span
        className={cn(
          'truncate',
          isSelected ? 'font-bold' : 'font-normal',
          (isInherited || isAncestorDisabled) ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {node.name}
      </span>
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
}

function TargetCell({ node, targetContextId }: TargetCellProps) {
  if (targetContextId === null) {
    return (
      <div className="flex items-center min-w-0 text-muted-foreground/60 text-sm">
        &mdash;
      </div>
    );
  }

  if (!node.target) {
    return <GhostSlot />;
  }

  return (
    <div className="flex items-center gap-1 min-w-0">
      {node.diff === 'different' && (
        <span
          className="text-amber-500 shrink-0 text-[10px] leading-none"
          aria-label="differs from source"
          title="Target differs from source"
        >
          {'\u25CF'}
        </span>
      )}
      <span className="text-muted-foreground shrink-0">
        {node.hasChildren ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}
      </span>
      <span className="truncate text-foreground">{node.target.name}</span>
    </div>
  );
}

/**
 * A dashed, hatched box of uniform row height, used when an item exists on one side but
 * not the other.
 */
function GhostSlot() {
  return (
    <div
      className="inline-block border border-dashed border-muted-foreground/50 rounded-sm h-4 w-20"
      style={{
        backgroundImage:
          'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(127,127,127,0.15) 3px, rgba(127,127,127,0.15) 6px)',
      }}
      role="img"
      aria-label="not present"
      title="not present"
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
        {/* Shared expand arrow with loading spinner overlay */}
        <span className="w-4 shrink-0 relative text-center">
          {node.hasChildren ? (
            <span
              onClick={() => onExpand(node)}
              className="cursor-pointer text-muted-foreground select-none"
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

        {/* Source half */}
        <div className="flex-1 min-w-0">
          <SourceCell
            node={node}
            isSelected={isSelected}
            isInherited={isInherited}
            isAncestorDisabled={isAncestorDisabled}
            onTogglePath={onTogglePath}
          />
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-muted-foreground/20 shrink-0" />

        {/* Target half */}
        <div className="flex-1 min-w-0">
          <TargetCell node={node} targetContextId={targetContextId} />
        </div>
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
}: RiftContentTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [childrenCache, setChildrenCache] = useState<Map<string, DualTreeNode[]>>(new Map());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [showHiddenItems, setShowHiddenItems] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const prefetchQueueRef = useRef<string[]>([]);
  const prefetchActiveRef = useRef(0);
  const prefetchGenRef = useRef(0);
  const MAX_PREFETCH_CONCURRENT = 2;

  // The two top-level nodes: "content" and "media library" from /sitecore
  const [contentNode, setContentNode] = useState<DualTreeNode | null>(null);
  const [mediaLibraryNode, setMediaLibraryNode] = useState<DualTreeNode | null>(null);

  const childrenCacheRef = useRef(childrenCache);
  childrenCacheRef.current = childrenCache;

  const onChildrenLoadedRef = useRef(onChildrenLoaded);
  onChildrenLoadedRef.current = onChildrenLoaded;

  const processPrefetchQueue = useCallback(async () => {
    while (
      prefetchQueueRef.current.length > 0 &&
      prefetchActiveRef.current < MAX_PREFETCH_CONCURRENT
    ) {
      const path = prefetchQueueRef.current.shift();
      if (!path || childrenCacheRef.current.has(path)) continue;

      const gen = prefetchGenRef.current;
      prefetchActiveRef.current++;
      try {
        const children = await fetchDualTreeChildren(client, contextId, targetContextId, path);
        if (prefetchGenRef.current !== gen) return; // stale — drop
        setChildrenCache((prev) => {
          if (prev.has(path)) return prev;
          const next = new Map(prev);
          next.set(path, children);
          return next;
        });
        // onChildrenLoaded still emits the source-side TreeNode[] for selection math.
        const sourceOnly = children.map((c) => c.source).filter((n): n is TreeNode => !!n);
        onChildrenLoadedRef.current?.(path, sourceOnly);
      } catch {
        // Silent — prefetch failures are not user-facing
      } finally {
        prefetchActiveRef.current--;
        processPrefetchQueue();
      }
    }
  }, [client, contextId, targetContextId]);

  const enqueuePrefetch = useCallback((children: DualTreeNode[]) => {
    const toFetch = children
      .filter((c) => c.hasChildren && !childrenCacheRef.current.has(c.path))
      .map((c) => c.path);
    if (toFetch.length === 0) return;
    prefetchQueueRef.current.push(...toFetch);
    processPrefetchQueue();
  }, [processPrefetchQueue]);

  const selectedPathSet = new Set(
    selectedPaths
      .filter((p) => p.scope === 'SingleItem' || p.scope === 'ItemAndChildren' || p.scope === 'ItemAndDescendants')
      .map((p) => p.itemPath)
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

  // Fetch both trees on mount
  useEffect(() => {
    let cancelled = false;
    setContentNode(null);
    setMediaLibraryNode(null);
    setExpandedNodes(new Set());
    setChildrenCache(new Map());
    setIsLoading(true);

    const loadTrees = async () => {
      if (!pathInfo) return;

      prefetchQueueRef.current = [];
      prefetchActiveRef.current = 0;
      prefetchGenRef.current++; // invalidate any in-flight prefetches

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

        const emitChildrenLoaded = (path: string, dual: DualTreeNode[]) => {
          const sourceOnly = dual.map((d) => d.source).filter((n): n is TreeNode => !!n);
          onChildrenLoadedRef.current?.(path, sourceOnly);
        };

        if (contentN) {
          expandPaths.add(contentN.path);
          let currentPath = contentN.path;

          for (const seg of pathInfo.segments) {
            if (cancelled) return;
            const children = await fetchDualTreeChildren(client, contextId, targetContextId, currentPath);
            newCache.set(currentPath, children);
            emitChildrenLoaded(currentPath, children);

            const match = children.find((c) => c.name === seg);
            if (!match) {
              console.warn(`[Rift] Content path segment "${seg}" not found under ${currentPath}`);
              break;
            }
            expandPaths.add(match.path);
            currentPath = match.path;
          }

          if (cancelled) return;
          try {
            const siteChildren = await fetchDualTreeChildren(client, contextId, targetContextId, currentPath);
            newCache.set(currentPath, siteChildren);
            emitChildrenLoaded(currentPath, siteChildren);

            for (const child of siteChildren.filter((c) => c.hasChildren)) {
              if (!newCache.has(child.path)) prefetchQueueRef.current.push(child.path);
            }
          } catch {}
        }

        if (mediaLibN) {
          expandPaths.add(mediaLibN.path);
          const mediaSegments = ['Project', ...pathInfo.segments];
          let currentPath = mediaLibN.path;

          for (const seg of mediaSegments) {
            if (cancelled) return;
            const children = await fetchDualTreeChildren(client, contextId, targetContextId, currentPath);
            newCache.set(currentPath, children);
            emitChildrenLoaded(currentPath, children);

            const match = children.find((c) => c.name === seg);
            if (!match) {
              console.warn(`[Rift] Media path segment "${seg}" not found under ${currentPath}`);
              break;
            }
            currentPath = match.path;
            // Expand intermediate nodes but not the final media folder
            if (seg !== mediaSegments[mediaSegments.length - 1]) {
              expandPaths.add(match.path);
            }
          }

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
        processPrefetchQueue();
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
          enqueuePrefetch(children);
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
    [enqueuePrefetch, client, contextId, targetContextId],
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
          {/* Shared expand arrow with loading spinner overlay */}
          <span className="w-4 shrink-0 relative text-center">
            {node.hasChildren ? (
              <span
                onClick={() => handleExpand(node)}
                className="cursor-pointer text-muted-foreground select-none"
              >
                {isExpanded ? '\u25BC' : '\u25B6'}
              </span>
            ) : null}
            {isLoadingNode && (
              <span className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs bg-background">
                ...
              </span>
            )}
          </span>

          <div className="flex-1 min-w-0">
            <SourceCell
              node={node}
              isSelected={isSelected}
              isInherited={isInherited}
              isAncestorDisabled={isAncestorDisabled}
              onTogglePath={onTogglePath}
            />
          </div>

          <div className="w-px h-6 bg-muted-foreground/20 shrink-0" />

          <div className="flex-1 min-w-0">
            <TargetCell node={node} targetContextId={targetContextId} />
          </div>
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
    <div>
      <div className="flex justify-between items-center mb-3">
        <div className="text-xs font-semibold text-muted-foreground">
          CONTENT TREE
        </div>
        <label className="text-sm text-muted-foreground flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={showHiddenItems}
            onCheckedChange={(checked) => setShowHiddenItems(checked === true)}
          />
          Show hidden items
        </label>
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
        <div className="w-px h-4 bg-muted-foreground/20" />
        <div className="flex-1">Target</div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
          <svg className="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
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
