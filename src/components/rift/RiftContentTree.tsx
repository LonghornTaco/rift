'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { TreeNode, MigrationPath } from '@/lib/rift/types';
import { fetchTreeChildren } from '@/lib/rift/api-client';
import { Checkbox } from '@/components/ui/checkbox';

// Items under /sitecore/content that are typically IAR-managed and should not be migrated
const IAR_DISABLED_NAMES = new Set(['presentation', 'settings', 'dictionary', 'media']);
import { cn } from '@/lib/utils';

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  expandedNodes: Set<string>;
  loadingNodes: Set<string>;
  selectedPathSet: Set<string>;
  inheritedPaths: Set<string>;
  childrenCache: Map<string, TreeNode[]>;
  onExpand: (node: TreeNode) => void;
  onTogglePath: (node: TreeNode) => void;
  showHiddenItems: boolean;
  isContentTree?: boolean;
  /** Set of child paths to show when hidden items are off. If undefined, no filtering. */
  visibleChildPaths?: Set<string>;
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
  isContentTree,
  visibleChildPaths,
}: TreeNodeRowProps) {
  const isExpanded = expandedNodes.has(node.itemId);
  const isLoading = loadingNodes.has(node.itemId);
  const isSelected = selectedPathSet.has(node.path);
  const isInherited = inheritedPaths.has(node.path);
  const isIarDisabled = isContentTree && IAR_DISABLED_NAMES.has(node.name.toLowerCase());
  let children = childrenCache.get(node.path) ?? [];

  // Filter children based on visible paths (when hidden items are off)
  if (visibleChildPaths) {
    children = children.filter((c) => visibleChildPaths.has(c.path));
  }

  return (
    <>
      <div
        className="flex items-center gap-1 leading-8 text-sm"
        style={{ paddingLeft: depth * 20 }}
      >
        {/* Expand arrow */}
        {node.hasChildren ? (
          <span
            onClick={() => onExpand(node)}
            className="cursor-pointer text-muted-foreground w-4 text-center shrink-0 select-none"
          >
            {isExpanded ? '\u25BC' : '\u25B6'}
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Loading indicator */}
        {isLoading && (
          <span className="text-muted-foreground text-xs shrink-0">...</span>
        )}

        {/* Checkbox */}
        <Checkbox
          checked={isSelected || isInherited}
          onCheckedChange={() => onTogglePath(node)}
          disabled={isInherited || isIarDisabled}
          className={cn(
            'shrink-0',
            (isInherited || isIarDisabled) && 'opacity-50 pointer-events-none'
          )}
          title={isIarDisabled ? 'This item is typically managed by IAR files and should not be migrated' : undefined}
        />

        {/* Icon */}
        <span className={cn("text-muted-foreground shrink-0", isIarDisabled && 'opacity-40')}>
          {node.hasChildren ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}
        </span>

        {/* Name */}
        <span
          className={cn(
            isSelected ? 'font-bold' : 'font-normal',
            isInherited ? 'text-muted-foreground' : 'text-foreground',
            isIarDisabled && 'text-muted-foreground/40 line-through'
          )}
          title={isIarDisabled ? 'IAR-managed — not available for migration' : undefined}
        >
          {node.name}
        </span>
        {isIarDisabled && (
          <span className="text-[9px] text-muted-foreground/40 ml-1">IAR</span>
        )}
      </div>

      {/* Children — pass visibleChildPaths only to this level, children render without it */}
      {isExpanded &&
        children.map((child) => (
          <TreeNodeRow
            key={child.itemId}
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
            isContentTree={isContentTree}
          />
        ))}
    </>
  );
}

interface RiftContentTreeProps {
  cmUrl: string;
  accessToken: string;
  rootPath: string;
  selectedPaths: MigrationPath[];
  onTogglePath: (node: TreeNode) => void;
  inheritedPaths: Set<string>;
  onChildrenLoaded?: (parentPath: string, children: TreeNode[]) => void;
}

export function RiftContentTree({
  cmUrl,
  accessToken,
  rootPath,
  selectedPaths,
  onTogglePath,
  inheritedPaths,
  onChildrenLoaded,
}: RiftContentTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [childrenCache, setChildrenCache] = useState<Map<string, TreeNode[]>>(new Map());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [showHiddenItems, setShowHiddenItems] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // The two top-level nodes: "content" and "media library" from /sitecore
  const [contentNode, setContentNode] = useState<TreeNode | null>(null);
  const [mediaLibraryNode, setMediaLibraryNode] = useState<TreeNode | null>(null);

  const childrenCacheRef = useRef(childrenCache);
  childrenCacheRef.current = childrenCache;

  const onChildrenLoadedRef = useRef(onChildrenLoaded);
  onChildrenLoadedRef.current = onChildrenLoaded;

  const selectedPathSet = new Set(selectedPaths.map((p) => p.itemPath));

  // Parse rootPath into segments for building filter paths
  const pathInfo = useMemo(() => {
    const contentPrefix = '/sitecore/content/';
    if (!rootPath.toLowerCase().startsWith(contentPrefix.toLowerCase())) return null;
    const relativePath = rootPath.slice(contentPrefix.length);
    const segments = relativePath.split('/').filter(Boolean);

    const contentLockedPaths = new Map<string, Set<string>>();
    const contentDefaultPaths = new Map<string, Set<string>>();

    let contentAccum = '/sitecore/content';
    for (const seg of segments) {
      const childPath = `${contentAccum}/${seg}`;
      contentLockedPaths.set(contentAccum, new Set([childPath]));
      contentAccum = childPath;
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

      try {
        const sitecoreChildren = await fetchTreeChildren(cmUrl, accessToken, '/sitecore');
        if (cancelled) return;

        const contentN = sitecoreChildren.find((n) => n.name === 'content');
        const mediaLibN = sitecoreChildren.find(
          (n) => n.name.toLowerCase() === 'media library'
        );

        if (contentN) setContentNode(contentN);
        if (mediaLibN) setMediaLibraryNode(mediaLibN);

        const newCache = new Map<string, TreeNode[]>();
        const expandIds = new Set<string>();

        if (contentN) {
          expandIds.add(contentN.itemId);
          let currentPath = contentN.path;

          for (const seg of pathInfo.segments) {
            if (cancelled) return;
            const children = await fetchTreeChildren(cmUrl, accessToken, currentPath);
            newCache.set(currentPath, children);
            onChildrenLoadedRef.current?.(currentPath, children);

            const match = children.find((c) => c.name === seg);
            if (!match) {
              console.warn(`[Rift] Content path segment "${seg}" not found under ${currentPath}`);
              break;
            }
            expandIds.add(match.itemId);
            currentPath = match.path;
          }

          if (cancelled) return;
          try {
            const siteChildren = await fetchTreeChildren(cmUrl, accessToken, currentPath);
            newCache.set(currentPath, siteChildren);
            onChildrenLoadedRef.current?.(currentPath, siteChildren);
          } catch {}
        }

        if (mediaLibN) {
          expandIds.add(mediaLibN.itemId);
          const mediaSegments = ['Project', ...pathInfo.segments];
          let currentPath = mediaLibN.path;

          for (const seg of mediaSegments) {
            if (cancelled) return;
            const children = await fetchTreeChildren(cmUrl, accessToken, currentPath);
            newCache.set(currentPath, children);
            onChildrenLoadedRef.current?.(currentPath, children);

            const match = children.find((c) => c.name === seg);
            if (!match) {
              console.warn(`[Rift] Media path segment "${seg}" not found under ${currentPath}`);
              break;
            }
            currentPath = match.path;
            // Expand intermediate nodes but not the final media folder
            if (seg !== mediaSegments[mediaSegments.length - 1]) {
              expandIds.add(match.itemId);
            }
          }

          if (cancelled) return;
          try {
            const siteMediaChildren = await fetchTreeChildren(cmUrl, accessToken, currentPath);
            newCache.set(currentPath, siteMediaChildren);
            onChildrenLoadedRef.current?.(currentPath, siteMediaChildren);
          } catch {}
        }

        if (cancelled) return;

        setChildrenCache((prev) => {
          const next = new Map(prev);
          for (const [k, v] of newCache) next.set(k, v);
          return next;
        });
        setExpandedNodes(expandIds);
        setIsLoading(false);
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
  }, [cmUrl, accessToken, rootPath]);

  const getVisibleChildPaths = useCallback(
    (node: TreeNode, isMedia: boolean): Set<string> | undefined => {
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
        return pathInfo.contentDefaultPaths.get(node.path);
      }

      return undefined;
    },
    [pathInfo, showHiddenItems]
  );

  const handleExpand = useCallback(
    async (node: TreeNode) => {
      const nodeId = node.itemId;

      let wasExpanded = false;
      setExpandedNodes((prev) => {
        if (prev.has(nodeId)) {
          wasExpanded = true;
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        }
        return new Set(prev).add(nodeId);
      });

      if (wasExpanded) return;

      if (!childrenCacheRef.current.has(node.path)) {
        setLoadingNodes((prev) => new Set(prev).add(nodeId));
        try {
          const children = await fetchTreeChildren(cmUrl, accessToken, node.path);
          setChildrenCache((prev) => new Map(prev).set(node.path, children));
          onChildrenLoadedRef.current?.(node.path, children);
        } catch {
          // Silently handle
        } finally {
          setLoadingNodes((prev) => {
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
          });
        }
      }
    },
    [cmUrl, accessToken]
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
  };

  // Render a branch of the tree with per-level filtering
  const renderFilteredBranch = (node: TreeNode, depth: number, isMedia: boolean) => {
    const isExpanded = expandedNodes.has(node.itemId);
    const isLoadingNode = loadingNodes.has(node.itemId);
    const isSelected = selectedPathSet.has(node.path);
    const isInherited = inheritedPaths.has(node.path);
    const isIarDisabled = !isMedia && IAR_DISABLED_NAMES.has(node.name.toLowerCase());
    let children = childrenCache.get(node.path) ?? [];

    const visiblePaths = getVisibleChildPaths(node, isMedia);
    if (visiblePaths) {
      children = children.filter((c) => visiblePaths.has(c.path));
    }

    return (
      <div key={node.itemId}>
        <div
          className="flex items-center gap-1 leading-8 text-sm"
          style={{ paddingLeft: depth * 20 }}
        >
          {node.hasChildren ? (
            <span
              onClick={() => handleExpand(node)}
              className="cursor-pointer text-muted-foreground w-4 text-center shrink-0 select-none"
            >
              {isExpanded ? '\u25BC' : '\u25B6'}
            </span>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {isLoadingNode && (
            <span className="text-muted-foreground text-xs shrink-0">...</span>
          )}

          <Checkbox
            checked={isSelected || isInherited}
            onCheckedChange={() => onTogglePath(node)}
            disabled={isInherited || isIarDisabled}
            className={cn(
              'shrink-0',
              (isInherited || isIarDisabled) && 'opacity-50 pointer-events-none'
            )}
            title={isIarDisabled ? 'This item is typically managed by IAR files and should not be migrated' : undefined}
          />

          <span className={cn("text-muted-foreground shrink-0", isIarDisabled && 'opacity-40')}>
            {node.hasChildren ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}
          </span>

          <span
            className={cn(
              isSelected ? 'font-bold' : 'font-normal',
              isInherited ? 'text-muted-foreground' : 'text-foreground',
              isIarDisabled && 'text-muted-foreground/40 line-through'
            )}
            title={isIarDisabled ? 'IAR-managed — not available for migration' : undefined}
          >
            {node.name}
          </span>
          {isIarDisabled && (
            <span className="text-[9px] text-muted-foreground/40 ml-1">IAR</span>
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
                key={child.itemId}
                node={child}
                depth={depth + 1}
                {...baseTreeRowProps}
                isContentTree={!isMedia}
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
