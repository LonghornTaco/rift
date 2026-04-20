# Dual Tree View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a target-environment tree alongside the existing source tree inside `RiftContentTree`, paired row-by-row, with shared expand/collapse state and ghost slots for items missing on either side.

**Architecture:** Approach 1 from the spec — pair source and target `TreeNode`s at the fetch layer into a new `DualTreeNode` data model. A pure `zipDualTreeChildren` helper merges children by path. `fetchDualTreeChildren` fetches both envs in parallel and produces paired nodes. `RiftContentTree` renders paired rows via new `SourceCell` / `TargetCell` subcomponents; the outer layout in `RiftMigrate` is unchanged.

**Tech Stack:** Next.js 15 / React 18 / TypeScript, Vitest (node env), Sitecore Marketplace Client SDK.

**Spec:** `docs/superpowers/specs/2026-04-19-dual-tree-view-design.md`

---

## File Structure

- Modify `src/lib/rift/types.ts` — add `DualTreeNode` type.
- Modify `src/lib/rift/api-client.ts` — add pure `zipDualTreeChildren` helper and `fetchDualTreeChildren` function.
- Modify `src/__tests__/lib/rift/api-client.test.ts` — unit tests for both additions.
- Modify `src/components/rift/RiftContentTree.tsx` — swap `TreeNode[]` caches for `DualTreeNode[]`, key expansion by path, add `DualTreeRow` / `SourceCell` / `TargetCell`, render paired rows, add "select target environment" hint.
- Modify `src/components/rift/RiftMigrate.tsx` — pass `targetContextId` prop into `RiftContentTree`.

**Testing note:** This repo has no React Testing Library set up (`vitest.config.ts` uses `environment: 'node'`). Component-level rendering tests are therefore **out of scope for this plan**. Coverage is limited to pure-function unit tests plus a manual browser QA task at the end. Setting up RTL is a separate follow-up, tracked outside this plan.

---

## Task 1: Add `DualTreeNode` type

**Files:**
- Modify: `src/lib/rift/types.ts`

- [ ] **Step 1: Add the `DualTreeNode` interface**

Append after the existing `TreeNode` interface:

```ts
/**
 * A paired tree node representing the same logical item across source and target envs.
 * Identity key is `path`. Either side may be undefined when the item exists on only one side.
 */
export interface DualTreeNode {
  path: string;
  name: string;
  hasChildren: boolean;
  source?: TreeNode;
  target?: TreeNode;
}
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `npx tsc --noEmit`
Expected: PASS with no new errors (the type is only declared, not yet imported).

- [ ] **Step 3: Commit**

```bash
git add src/lib/rift/types.ts
git commit -m "rift types: add DualTreeNode for paired source/target tree rendering"
```

---

## Task 2: Add pure `zipDualTreeChildren` helper + tests

This is a pure, side-effect-free function that merges two `TreeNode[]` lists by path. Splitting it out from the fetcher keeps it unit-testable in the existing node-only vitest environment.

**Files:**
- Modify: `src/lib/rift/api-client.ts`
- Modify: `src/__tests__/lib/rift/api-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/lib/rift/api-client.test.ts`:

```ts
import { fetchTreeChildren, fetchSites, zipDualTreeChildren } from '@/lib/rift/api-client';
import type { TreeNode } from '@/lib/rift/types';

// ... existing tests stay ...

function node(path: string, hasChildren = false): TreeNode {
  const name = path.split('/').filter(Boolean).pop() ?? '';
  return { itemId: `id-${path}`, name, path, hasChildren, templateName: 'Page' };
}

describe('zipDualTreeChildren', () => {
  it('pairs children that exist on both sides by path, in source order', () => {
    const source = [node('/a/Home'), node('/a/About'), node('/a/Data')];
    const target = [node('/a/Data'), node('/a/Home'), node('/a/About')];

    const result = zipDualTreeChildren(source, target);

    expect(result).toHaveLength(3);
    expect(result.map((n) => n.path)).toEqual(['/a/Home', '/a/About', '/a/Data']);
    expect(result.every((n) => n.source && n.target)).toBe(true);
  });

  it('returns source-only pairs when a path is missing on target', () => {
    const source = [node('/a/Home'), node('/a/About')];
    const target = [node('/a/Home')];

    const result = zipDualTreeChildren(source, target);

    expect(result).toHaveLength(2);
    const aboutRow = result.find((n) => n.path === '/a/About')!;
    expect(aboutRow.source).toBeDefined();
    expect(aboutRow.target).toBeUndefined();
  });

  it('appends target-only pairs at the end in target order', () => {
    const source = [node('/a/Home')];
    const target = [node('/a/Home'), node('/a/Legacy'), node('/a/Archive')];

    const result = zipDualTreeChildren(source, target);

    expect(result.map((n) => n.path)).toEqual(['/a/Home', '/a/Legacy', '/a/Archive']);
    const legacyRow = result.find((n) => n.path === '/a/Legacy')!;
    expect(legacyRow.source).toBeUndefined();
    expect(legacyRow.target).toBeDefined();
  });

  it('sets hasChildren when either side has children', () => {
    const source = [node('/a/NoKids', false)];
    const target = [node('/a/NoKids', true)];

    const result = zipDualTreeChildren(source, target);
    expect(result[0].hasChildren).toBe(true);
  });

  it('treats null/undefined target list as source-only', () => {
    const source = [node('/a/Home'), node('/a/About')];
    const result = zipDualTreeChildren(source, null);
    expect(result).toHaveLength(2);
    expect(result.every((n) => n.target === undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `npm test -- api-client`
Expected: The four new `zipDualTreeChildren` tests fail with "zipDualTreeChildren is not a function" or similar import error.

- [ ] **Step 3: Implement `zipDualTreeChildren`**

Add to `src/lib/rift/api-client.ts`, just below the imports:

```ts
import type { TreeNode, SiteInfo, DualTreeNode } from './types';

/**
 * Merge two same-level TreeNode lists into DualTreeNode pairs, keyed by path.
 *
 * - Preserves source order for paths present in source.
 * - Appends target-only paths at the end in target order.
 * - `name` comes from source when present, otherwise target.
 * - `hasChildren` is true if either side reports hasChildren.
 * - When `target` is null or undefined, every pair has `target: undefined`.
 */
export function zipDualTreeChildren(
  source: TreeNode[],
  target: TreeNode[] | null | undefined,
): DualTreeNode[] {
  const targetByPath = new Map<string, TreeNode>();
  if (target) {
    for (const t of target) targetByPath.set(t.path, t);
  }

  const paired: DualTreeNode[] = [];
  const seen = new Set<string>();

  for (const s of source) {
    const t = targetByPath.get(s.path);
    paired.push({
      path: s.path,
      name: s.name,
      hasChildren: s.hasChildren || (t?.hasChildren ?? false),
      source: s,
      target: t,
    });
    seen.add(s.path);
  }

  if (target) {
    for (const t of target) {
      if (seen.has(t.path)) continue;
      paired.push({
        path: t.path,
        name: t.name,
        hasChildren: t.hasChildren,
        source: undefined,
        target: t,
      });
    }
  }

  return paired;
}
```

(Note: the existing `import type { TreeNode, SiteInfo } from './types';` line must be replaced with the three-type import shown above. Edit the existing line in place rather than adding a second import.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- api-client`
Expected: All `zipDualTreeChildren` tests pass. Existing `fetchTreeChildren` and `fetchSites` tests remain green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/api-client.ts src/__tests__/lib/rift/api-client.test.ts
git commit -m "rift api-client: add zipDualTreeChildren pure helper"
```

---

## Task 3: Add `fetchDualTreeChildren` + tests

**Files:**
- Modify: `src/lib/rift/api-client.ts`
- Modify: `src/__tests__/lib/rift/api-client.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/lib/rift/api-client.test.ts`:

```ts
import { fetchDualTreeChildren } from '@/lib/rift/api-client';

function mockClientWithResponses(responses: unknown[]): ClientSDK {
  const mutate = vi.fn();
  for (const r of responses) mutate.mockResolvedValueOnce({ data: { data: r } });
  return { mutate, query: vi.fn() } as unknown as ClientSDK;
}

function rejectingMutateAtIndex(responses: unknown[], rejectIndex: number, error: Error): ClientSDK {
  const mutate = vi.fn();
  responses.forEach((r, i) => {
    if (i === rejectIndex) mutate.mockRejectedValueOnce(error);
    else mutate.mockResolvedValueOnce({ data: { data: r } });
  });
  return { mutate, query: vi.fn() } as unknown as ClientSDK;
}

function treeResponse(children: { itemId: string; name: string; path: string; hasChildren?: boolean }[]) {
  return {
    item: {
      children: {
        nodes: children.map((c) => ({
          itemId: c.itemId,
          name: c.name,
          path: c.path,
          hasChildren: c.hasChildren ?? false,
          template: { name: 'Page' },
        })),
      },
    },
  };
}

describe('fetchDualTreeChildren', () => {
  it('pairs source and target children when both fetches succeed', async () => {
    const client = mockClientWithResponses([
      treeResponse([
        { itemId: 'src-home', name: 'Home', path: '/site/Home' },
        { itemId: 'src-about', name: 'About', path: '/site/About' },
      ]),
      treeResponse([
        { itemId: 'tgt-home', name: 'Home', path: '/site/Home' },
      ]),
    ]);

    const result = await fetchDualTreeChildren(client, 'src-ctx', 'tgt-ctx', '/site');

    expect(result).toHaveLength(2);
    expect(result[0].source?.itemId).toBe('src-home');
    expect(result[0].target?.itemId).toBe('tgt-home');
    expect(result[1].source?.itemId).toBe('src-about');
    expect(result[1].target).toBeUndefined();
  });

  it('skips the target fetch when targetContextId is null', async () => {
    const client = mockClientWithResponses([
      treeResponse([{ itemId: 'src-home', name: 'Home', path: '/site/Home' }]),
    ]);

    const result = await fetchDualTreeChildren(client, 'src-ctx', null, '/site');

    expect(result).toHaveLength(1);
    expect(result[0].source).toBeDefined();
    expect(result[0].target).toBeUndefined();
    expect(client.mutate).toHaveBeenCalledTimes(1);
  });

  it('returns source-only pairs when the target fetch rejects', async () => {
    const client = rejectingMutateAtIndex(
      [
        treeResponse([{ itemId: 'src-home', name: 'Home', path: '/site/Home' }]),
        null,
      ],
      1,
      new Error('target site missing'),
    );

    const result = await fetchDualTreeChildren(client, 'src-ctx', 'tgt-ctx', '/site');

    expect(result).toHaveLength(1);
    expect(result[0].source).toBeDefined();
    expect(result[0].target).toBeUndefined();
  });

  it('propagates the source-side error when the source fetch rejects', async () => {
    const client = rejectingMutateAtIndex(
      [null, treeResponse([])],
      0,
      new Error('source unreachable'),
    );

    await expect(
      fetchDualTreeChildren(client, 'src-ctx', 'tgt-ctx', '/site'),
    ).rejects.toThrow('source unreachable');
  });

  it('includes target-only children appended after source children', async () => {
    const client = mockClientWithResponses([
      treeResponse([{ itemId: 'src-home', name: 'Home', path: '/site/Home' }]),
      treeResponse([
        { itemId: 'tgt-home', name: 'Home', path: '/site/Home' },
        { itemId: 'tgt-legacy', name: 'Legacy', path: '/site/Legacy' },
      ]),
    ]);

    const result = await fetchDualTreeChildren(client, 'src-ctx', 'tgt-ctx', '/site');

    expect(result.map((n) => n.path)).toEqual(['/site/Home', '/site/Legacy']);
    expect(result[1].source).toBeUndefined();
    expect(result[1].target?.itemId).toBe('tgt-legacy');
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- api-client`
Expected: The five new `fetchDualTreeChildren` tests fail with import error.

- [ ] **Step 3: Implement `fetchDualTreeChildren`**

Add to `src/lib/rift/api-client.ts`, immediately after `fetchTreeChildren`:

```ts
/**
 * Fetch children from source and target envs in parallel and zip into DualTreeNode pairs.
 *
 * - When `targetContextId` is null, only the source is fetched.
 * - When the target fetch rejects, degrades gracefully to source-only pairs (logged silently).
 * - When the source fetch rejects, the error is re-thrown (expansion fails like today).
 */
export async function fetchDualTreeChildren(
  client: ClientSDK,
  sourceContextId: string,
  targetContextId: string | null,
  parentPath: string,
): Promise<DualTreeNode[]> {
  const sourcePromise = fetchTreeChildren(client, sourceContextId, parentPath);
  const targetPromise = targetContextId
    ? fetchTreeChildren(client, targetContextId, parentPath)
    : Promise.resolve(null);

  const [sourceResult, targetResult] = await Promise.allSettled([sourcePromise, targetPromise]);

  if (sourceResult.status === 'rejected') {
    throw sourceResult.reason;
  }

  const sourceChildren = sourceResult.value;
  const targetChildren =
    targetResult.status === 'fulfilled' ? targetResult.value : null;

  if (targetResult.status === 'rejected' && targetContextId) {
    console.warn(
      `[Rift] Target tree fetch failed for ${parentPath}:`,
      targetResult.reason,
    );
  }

  return zipDualTreeChildren(sourceChildren, targetChildren);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- api-client`
Expected: All tests pass (original + `zipDualTreeChildren` + new `fetchDualTreeChildren`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/api-client.ts src/__tests__/lib/rift/api-client.test.ts
git commit -m "rift api-client: add fetchDualTreeChildren for paired source/target fetch"
```

---

## Task 4: Pass `targetContextId` prop through `RiftMigrate` → `RiftContentTree`

This task wires the plumbing but does NOT yet use the new fetcher. The component still compiles and behaves identically to today. The prop is received but unused.

**Files:**
- Modify: `src/components/rift/RiftContentTree.tsx`
- Modify: `src/components/rift/RiftMigrate.tsx`

- [ ] **Step 1: Add `targetContextId` to the `RiftContentTreeProps` interface**

In `src/components/rift/RiftContentTree.tsx`, find `interface RiftContentTreeProps` and add:

```ts
interface RiftContentTreeProps {
  client: ClientSDK;
  contextId: string;
  targetContextId: string | null;   // NEW
  rootPath: string;
  selectedPaths: MigrationPath[];
  onTogglePath: (node: TreeNode) => void;
  inheritedPaths: Set<string>;
  onChildrenLoaded?: (parentPath: string, children: TreeNode[]) => void;
  disabled?: boolean;
  refreshKey?: number;
}
```

Destructure `targetContextId` in the function signature at the top of `RiftContentTree`:

```ts
export function RiftContentTree({
  client,
  contextId,
  targetContextId,   // NEW
  rootPath,
  selectedPaths,
  onTogglePath,
  inheritedPaths,
  onChildrenLoaded,
  disabled,
  refreshKey,
}: RiftContentTreeProps) {
```

It's fine to leave `targetContextId` unused in this task — TypeScript will accept an unused destructured param.

- [ ] **Step 2: Pass `targetContextId` from `RiftMigrate`**

In `src/components/rift/RiftMigrate.tsx`, find the `<RiftContentTree ... />` usage (around line 633) and add the `targetContextId` prop:

```tsx
<RiftContentTree
  client={client}
  contextId={environments.find((e) => e.tenantId === selectedSourceEnvId)!.contextId}
  targetContextId={
    selectedTargetEnvId
      ? environments.find((e) => e.tenantId === selectedTargetEnvId)?.contextId ?? null
      : null
  }
  rootPath={selectedSiteRootPath}
  selectedPaths={selectedPaths}
  onTogglePath={handleTogglePath}
  inheritedPaths={inheritedPaths}
  onChildrenLoaded={handleChildrenLoaded}
  disabled={isMigrating}
  refreshKey={treeRefreshKey}
/>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. No existing tests break.

- [ ] **Step 4: Run the dev server sanity check**

Run: `npm run dev` (Ctrl+C after it compiles)
Expected: Compiles successfully, no runtime warnings about missing props.

- [ ] **Step 5: Commit**

```bash
git add src/components/rift/RiftContentTree.tsx src/components/rift/RiftMigrate.tsx
git commit -m "rift tree: thread targetContextId prop (plumbing only, unused)"
```

---

## Task 5: Switch cache + expansion keying in `RiftContentTree` to `DualTreeNode` and path

This is the largest task. It replaces the internal data flow of `RiftContentTree` while keeping the rendered output visually identical to today (ghost + paired rendering lands in Task 6). We do this in two sub-steps: first swap the cache type, then re-render single-tree output from `DualTreeNode.source`.

**Files:**
- Modify: `src/components/rift/RiftContentTree.tsx`

- [ ] **Step 1: Update imports**

At the top of `src/components/rift/RiftContentTree.tsx`:

```ts
import { TreeNode, MigrationPath, DualTreeNode } from '@/lib/rift/types';
import { fetchTreeChildren, fetchDualTreeChildren } from '@/lib/rift/api-client';
```

- [ ] **Step 2: Change cache + expansion state types**

In the body of `RiftContentTree`, change:

```ts
const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
const [childrenCache, setChildrenCache] = useState<Map<string, TreeNode[]>>(new Map());
const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
```

`expandedNodes` and `loadingNodes` remain `Set<string>`, but they are now keyed by **path**, not `itemId`. `childrenCache` becomes `Map<string, DualTreeNode[]>`:

```ts
const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
const [childrenCache, setChildrenCache] = useState<Map<string, DualTreeNode[]>>(new Map());
const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
```

Also update the ref:

```ts
const childrenCacheRef = useRef(childrenCache);
childrenCacheRef.current = childrenCache;
```

(No change needed — just confirm the ref compiles with the new type.)

And the top-level root nodes — change their types to `DualTreeNode`:

```ts
const [contentNode, setContentNode] = useState<DualTreeNode | null>(null);
const [mediaLibraryNode, setMediaLibraryNode] = useState<DualTreeNode | null>(null);
```

- [ ] **Step 3: Update `processPrefetchQueue` to use `fetchDualTreeChildren`**

Replace the existing `processPrefetchQueue` implementation:

```ts
const processPrefetchQueue = useCallback(async () => {
  while (
    prefetchQueueRef.current.length > 0 &&
    prefetchActiveRef.current < MAX_PREFETCH_CONCURRENT
  ) {
    const path = prefetchQueueRef.current.shift();
    if (!path || childrenCacheRef.current.has(path)) continue;

    prefetchActiveRef.current++;
    try {
      const children = await fetchDualTreeChildren(client, contextId, targetContextId, path);
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
```

- [ ] **Step 4: Update `enqueuePrefetch` to use `DualTreeNode[]`**

```ts
const enqueuePrefetch = useCallback((children: DualTreeNode[]) => {
  const toFetch = children
    .filter((c) => c.hasChildren && !childrenCacheRef.current.has(c.path))
    .map((c) => c.path);
  if (toFetch.length === 0) return;
  prefetchQueueRef.current.push(...toFetch);
  processPrefetchQueue();
}, [processPrefetchQueue]);
```

- [ ] **Step 5: Update the initial-load effect**

Replace the body of the `useEffect` that fetches the initial trees (the one watching `rootPath` and `refreshKey`). Key changes:

- Fetch both `/sitecore` children as dual pairs so we can find `content` and `media library` as `DualTreeNode`s.
- Traverse segments via `fetchDualTreeChildren` instead of single-env fetch.
- Expansion set now keyed by path instead of itemId.

```tsx
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
```

Key differences from today:
- `targetContextId` added to the effect's dep array — swapping target env triggers a full re-fetch.
- `expandIds` is now `expandPaths` (paths instead of itemIds).
- Root nodes stored as `DualTreeNode`.
- Prefetch queue still just holds paths.

- [ ] **Step 6: Update `handleExpand` to key by path and use the dual fetcher**

```ts
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
```

- [ ] **Step 7: Update `TreeNodeRow` and `renderFilteredBranch` to operate on `DualTreeNode`**

For this task only — render using `node.source` where checkbox/icon/name appear. We're not yet rendering the target half; that's Task 6. This step keeps the UI visually identical while the types change underneath.

Replace the `TreeNodeRow` component signature and body to accept `DualTreeNode`:

```tsx
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
  disabledAncestorPaths?: Set<string>;
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
  disabledAncestorPaths,
  visibleChildPaths,
}: TreeNodeRowProps) {
  const isExpanded = expandedNodes.has(node.path);
  const isLoading = loadingNodes.has(node.path);
  const isSelected = selectedPathSet.has(node.path);
  const isInherited = inheritedPaths.has(node.path);
  const isAncestorDisabled = disabledAncestorPaths?.has(node.path) ?? false;
  let children = childrenCache.get(node.path) ?? [];

  if (visibleChildPaths) {
    children = children.filter((c) => visibleChildPaths.has(c.path));
  }

  const sourceNode = node.source;

  return (
    <>
      <div
        className="flex items-center gap-1 leading-8 text-sm"
        style={{ paddingLeft: depth * 20 }}
      >
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

        {isLoading && (
          <span className="text-muted-foreground text-xs shrink-0">...</span>
        )}

        <Checkbox
          checked={isSelected || isInherited}
          onCheckedChange={() => sourceNode && onTogglePath(sourceNode)}
          disabled={isInherited || isAncestorDisabled || !sourceNode}
          className={cn(
            'shrink-0',
            (isInherited || isAncestorDisabled || !sourceNode) && 'opacity-50 pointer-events-none'
          )}
        />

        <span className={cn("text-muted-foreground shrink-0", isAncestorDisabled && 'opacity-40')}>
          {node.hasChildren ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}
        </span>

        <span
          className={cn(
            isSelected ? 'font-bold' : 'font-normal',
            (isInherited || isAncestorDisabled) ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {node.name}
        </span>
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
          />
        ))}
    </>
  );
}
```

- [ ] **Step 8: Update `renderFilteredBranch` to accept and render `DualTreeNode`**

Replace the `renderFilteredBranch` function inside `RiftContentTree`:

```tsx
const renderFilteredBranch = (node: DualTreeNode, depth: number, isMedia: boolean) => {
  const isExpanded = expandedNodes.has(node.path);
  const isLoadingNode = loadingNodes.has(node.path);
  const isSelected = selectedPathSet.has(node.path);
  const isInherited = inheritedPaths.has(node.path);
  const isAncestorDisabled = !isMedia && pathInfo?.contentAncestorPaths.has(node.path);
  let children = childrenCache.get(node.path) ?? [];

  const visiblePaths = getVisibleChildPaths(node, isMedia);
  if (visiblePaths) {
    children = children.filter((c) => visiblePaths.has(c.path));
  }

  const sourceNode = node.source;

  return (
    <div key={node.path}>
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
          onCheckedChange={() => sourceNode && onTogglePath(sourceNode)}
          disabled={isInherited || isAncestorDisabled || !sourceNode}
          className={cn(
            'shrink-0',
            (isInherited || isAncestorDisabled || !sourceNode) && 'opacity-50 pointer-events-none'
          )}
        />

        <span className={cn("text-muted-foreground shrink-0", isAncestorDisabled && 'opacity-40')}>
          {node.hasChildren ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}
        </span>

        <span
          className={cn(
            isSelected ? 'font-bold' : 'font-normal',
            (isInherited || isAncestorDisabled) ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {node.name}
        </span>
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
```

Also change `getVisibleChildPaths` signature to accept `DualTreeNode`:

```ts
const getVisibleChildPaths = useCallback(
  (node: DualTreeNode, isMedia: boolean): Set<string> | undefined => {
    // body unchanged — it only reads node.path
    // ...
  },
  [pathInfo, showHiddenItems, selectedPaths]
);
```

(Body is identical — it only uses `node.path`, which both types expose.)

- [ ] **Step 9: Type-check and run existing tests**

Run: `npx tsc --noEmit && npm test`
Expected: Type-check passes. All existing tests still green.

- [ ] **Step 10: Manual browser sanity check**

Run: `npm run dev`

In browser (http://localhost:3001):
1. Load the migrate view
2. Pick a source env + site
3. Don't pick a target env yet
4. Confirm the tree loads and looks identical to before this change
5. Expand / collapse nodes — works as before
6. Select items with checkboxes — works as before
7. Pick a target env — confirm the tree refreshes without errors (even though you can't see target data yet; that's Task 6)
8. Ctrl+C to stop

Expected: Behavior is visually indistinguishable from before. The only observable change is that picking/changing a target env triggers a tree refresh.

- [ ] **Step 11: Commit**

```bash
git add src/components/rift/RiftContentTree.tsx
git commit -m "rift tree: swap internal cache to DualTreeNode, key expansion by path"
```

---

## Task 6: Render the target half — `SourceCell`, `TargetCell`, ghost slots, no-target placeholder

Now the UI actually shows the target tree. Each row gets two halves, a divider, and a shared expand arrow.

**Files:**
- Modify: `src/components/rift/RiftContentTree.tsx`

- [ ] **Step 1: Add `SourceCell` and `TargetCell` subcomponents**

Add these components inside `src/components/rift/RiftContentTree.tsx`, before `TreeNodeRow`:

```tsx
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
      <span className="text-muted-foreground shrink-0">
        {node.hasChildren ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}
      </span>
      <span className="truncate text-foreground">{node.target.name}</span>
    </div>
  );
}

/**
 * A dashed, hatched box of uniform row height, used when an item exists on one side but
 * not the other. Kept deliberately small to match row height exactly.
 */
function GhostSlot() {
  return (
    <div
      className="inline-block border border-dashed border-muted-foreground/50 rounded-sm h-4 w-20"
      style={{
        backgroundImage:
          'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(127,127,127,0.15) 3px, rgba(127,127,127,0.15) 6px)',
      }}
      aria-label="not present"
      title="not present"
    />
  );
}
```

- [ ] **Step 2: Rewrite `TreeNodeRow` to render paired cells**

Replace the `TreeNodeRow` body:

```tsx
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
  const isSelected = selectedPathSet.has(node.path);
  const isInherited = inheritedPaths.has(node.path);
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
        {/* Shared expand arrow */}
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

        {isLoading && (
          <span className="text-muted-foreground text-xs shrink-0">...</span>
        )}

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
        <div className="w-px h-6 bg-border shrink-0" />

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
```

Also add `targetContextId` to `TreeNodeRowProps`:

```ts
interface TreeNodeRowProps {
  // ... existing fields ...
  targetContextId: string | null;
}
```

- [ ] **Step 3: Rewrite `renderFilteredBranch` to render paired cells**

Replace the existing body with the same paired-cell structure:

```tsx
const renderFilteredBranch = (node: DualTreeNode, depth: number, isMedia: boolean) => {
  const isExpanded = expandedNodes.has(node.path);
  const isLoadingNode = loadingNodes.has(node.path);
  const isSelected = selectedPathSet.has(node.path);
  const isInherited = inheritedPaths.has(node.path);
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

        <div className="flex-1 min-w-0">
          <SourceCell
            node={node}
            isSelected={isSelected}
            isInherited={isInherited}
            isAncestorDisabled={isAncestorDisabled}
            onTogglePath={onTogglePath}
          />
        </div>

        <div className="w-px h-6 bg-border shrink-0" />

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
```

Add `targetContextId` to `baseTreeRowProps`:

```ts
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
```

- [ ] **Step 4: Add the "select target environment" hint banner + column headers**

Replace the header row in `RiftContentTree`'s return:

```tsx
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
  <div className="w-px" />
  <div className="flex-1">Target</div>
</div>
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS. No tests were updated in this task but the existing suite still runs cleanly.

- [ ] **Step 7: Commit**

```bash
git add src/components/rift/RiftContentTree.tsx
git commit -m "rift tree: render paired source/target rows with ghost slots"
```

---

## Task 7: Manual end-to-end QA

No code changes. This is a deliberate checkpoint before merging.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open http://localhost:3001.

- [ ] **Step 2: Check no-target state**

1. Navigate to Migrate view.
2. Pick a source env + site; leave target unpicked.
3. Expected: Tree renders; every target cell shows a muted em-dash; hint banner reads "Select a target environment to populate →"; source checkboxes work.

- [ ] **Step 3: Check target-env-picked state with matching site**

1. Pick a target env whose tenant has the same site.
2. Expected: Tree refreshes. Source and target cells align row-by-row. Items present on both sides show normally on both halves. Items only on source (or only on target) show a dashed hatched ghost on the other side.

- [ ] **Step 4: Check target-env-picked state with missing site**

1. Pick a target env whose tenant does NOT have this site.
2. Expected: Source tree renders normally; every target cell is a ghost (not a muted em-dash). The UI clearly signals "nothing exists yet on target".

- [ ] **Step 5: Check expand/collapse sync**

1. Expand a node deep in the source tree.
2. Expected: Both halves of the paired row expand together with one fetch. Ghost children appear on the target side for any items not on target.
3. Collapse — both halves collapse together.

- [ ] **Step 6: Check target-only rows**

1. If your target has items not on source (e.g. a `Legacy` folder under the site), confirm they appear at the bottom of that level with a ghost source cell and no checkbox.

- [ ] **Step 7: Check target env swap**

1. Change the target env to a different tenant.
2. Expected: Tree refreshes; previous cache is invalidated; new target data renders.
3. Change target back to unselected (if possible) — every target cell reverts to muted em-dash.

- [ ] **Step 8: Check existing flows still work**

1. Save Preset → Load Preset → tree renders at the correct expansion point.
2. Refresh button → both caches invalidated, tree re-loads.
3. Show hidden items toggle → both halves show/hide together.
4. Media library tree → same dual-row treatment.
5. Start a real migration → unchanged behavior.

- [ ] **Step 9: Commit any final tweaks discovered during QA**

If styling needs a polish pass (e.g. ghost slot width too wide for tight column widths), make those fixes and commit separately.

```bash
git add src/components/rift/RiftContentTree.tsx
git commit -m "rift tree: polish dual-tree ghost/divider styling after QA"
```

---

## Self-review checklist (already applied)

- [x] Spec coverage: all v1 requirements map to tasks 1–6; QA in task 7. Testing note explicitly scoped to the repo's current test infrastructure.
- [x] No placeholders — every step has complete code or an exact command.
- [x] Type consistency — `DualTreeNode`, `fetchDualTreeChildren`, `zipDualTreeChildren`, `targetContextId` naming kept identical across tasks.
- [x] Scope check — single feature in a single component area; no decomposition needed.
