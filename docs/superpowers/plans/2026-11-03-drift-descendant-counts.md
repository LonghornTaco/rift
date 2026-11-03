# Drift Descendant Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every folder under the site root and the site media folder shows a count of drifted items beneath it, found by a background walk that starts itself when the tree loads, pauses while the target is being written, and never caches a failed read as a wrong number.

**Architecture:** The tree's one-level prefetch queue is replaced by a generic `TreeWalker` (bounded concurrency, retry, pause, generation reset) that keeps filling the holes in `childrenCache` beneath two walk roots. A pure `drift-rollup` module turns the cache into per-folder `{ count, complete }` and decides which folders are walkable, which are missing, and what a post-migration eviction removes. The tree memoises the roll-up and renders one `DriftPill` from `SourceCell` and `TargetCell`; a header status and an expansion gate read the walker's progress.

**Tech Stack:** Next.js 15 / React 19 / TypeScript strict, Vitest 4 (node environment, no DOM), `@sitecore-marketplace-sdk/client`, Tailwind classes already used in the tree.

**Spec:** `docs/superpowers/specs/2026-11-03-drift-descendant-counts-design.md`

## Global Constraints

- No em-dashes anywhere (code, comments, copy, commits). Use `-`.
- Commit only, never push. No `Co-Authored-By`, `Claude-Session` or any other attribution line in commit messages. Subject style: `rift: <what>`.
- Repo files are CRLF. Edit with the Edit tool; a multi-line replace script must normalise line endings or it matches nothing.
- Walk concurrency 2 folders in flight. Retry a failed read up to 3 attempts in total, waiting 1000 ms then 2000 ms. These are the `TreeWalker` defaults.
- Drift beneath a folder: a child counts when `diff === 'different'` or when it has `source` and no `target`. Target-only children and children with `diff` undefined do not count. A folder never counts itself.
- The walk and the roll-up descend only into folders that have `hasChildren` and both `source` and `target`. A source-only folder counts as one and is never descended, even when its children are cached.
- No walk and no pills when `targetContextId` is null. Hand expansion and the initial load keep using the lenient `fetchDualTreeChildren`; only the walker uses the strict fetch.
- Copy, verbatim: pill hover `"{n} items beneath differ or are missing on target"` with `" (still scanning)"` appended while incomplete; unknown pill hover `"Not scanned yet"`; header `"Scanning for drift: {n} folders checked"` and `"Drift scan paused until the tree is refreshed"`; blocked arrow hover `"Target is still writing; refresh the tree to continue"`.
- Pills render only on the walk roots and their descendants. Rows above the roots (`content`, `media library`, `Project`, the site collection) never get one.
- Version bump before the final commit: `package.json` and `src/lib/version.ts` from `0.7.18` to `0.7.19`.
- Verification commands: `npm test`, `npm run lint`, `npm run build`.

## Review Focus

- A source-only folder the user has expanded by hand (ghost children cached) must count as exactly one beneath its parent, not one plus its children. Pinned in Task 3.
- A walker read that fails three times must be dropped: `checked` unchanged, nothing stored, and the queue must drain to `pending 0, inFlight 0` so the header status disappears. Pinned in Task 4.
- A read still in flight when `reset()` is called must not be stored or counted when it lands. Pinned in Task 4.
- A strict dual fetch where only the target read fails must reject, never return source-only ghosts. Pinned in Task 2.
- Evicting `/site/Home` after a migration must not evict `/site/Homepage`. Pinned in Task 3.

---

### Task 1: Commit the design, then probe whether the children list is capped

**Files:**
- Commit: `docs/superpowers/specs/2026-11-03-drift-descendant-counts-design.md`, `docs/superpowers/plans/2026-11-03-drift-descendant-counts.md`
- Modify (record only): the spec's `**Status:**` line

**Interfaces:**
- Produces: a yes/no answer "the Authoring `children { nodes }` list is capped at N" recorded in the spec. Task 1b runs only on "yes".

- [ ] **Step 1: Commit the design and this plan**

```bash
git add docs/superpowers/specs/2026-11-03-drift-descendant-counts-design.md docs/superpowers/plans/2026-11-03-drift-descendant-counts.md
git commit -m "rift: design and plan for drift descendant counts"
```

- [ ] **Step 2: Run the probe (needs a Sitecore login, so this is Jason's step; the executor hands him the two queries and waits)**

In the dev CM's Authoring GraphQL IDE (`https://<dev cm host>/sitecore/api/authoring/graphql/playground/`), run:

```graphql
{ __type(name: "Item") { fields { name args { name } type { name kind ofType { name } } } } }
```

Note the `children` field's argument names and its return type name. Then, on the media folder with the most direct children on dev (ask Jason which; the Content Editor shows the count):

```graphql
{ item(where: { path: "/sitecore/media library/Project/<site>/<big folder>" }) {
    children { nodes { name } } } }
```

Count `nodes`. If the introspection showed `totalCount` or `pageInfo { hasNextPage }` on the connection type, add them to the query and read them directly.

If the IDE is not reachable, the fallback is a temporary `console.info(parentPath, nodes.length)` in `fetchTreeChildren` plus the introspection query sent through `client.mutate('xmc.authoring.graphql', ...)` once in the tree's initial load, read from the browser console while Jason runs the app against dev, then reverted before any commit.

- [ ] **Step 3: Record the result**

Edit the spec's `**Status:**` line to `Draft - probe done: children list not capped (N returned = N in Content Editor)` or `Draft - probe done: children list capped at N; paging added in Task 1b`, and note the argument and field names the introspection showed.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-03-drift-descendant-counts-design.md
git commit -m "rift: record the children paging probe result"
```

### Task 1b (only if Task 1 found a cap): page the children query

**Files:**
- Modify: `src/lib/rift/api-client.ts:70-128` (`childrenQuery`, `fetchTreeChildren`) and `:168-184` (`fetchTreeChildrenStrict`)
- Test: `src/__tests__/lib/rift/api-client.test.ts`

**Interfaces:**
- Produces: `childrenQuery(parentPath: string, after: string | null)` and `readAllChildren(run: (after: string | null) => Promise<RawChildrenPage>): Promise<RawChildNode[]>` where `type RawChildrenPage = { nodes: RawChildNode[]; pageInfo?: { hasNextPage: boolean; endCursor: string | null } }`. Both exported fetches return every page concatenated. Use the argument and field names Task 1 recorded; the names below are the GraphQL.NET relay defaults.

- [ ] **Step 1: Write the failing tests**

In the `fetchTreeChildren` describe block, add a test that gives the mock client two responses, the first with `pageInfo: { hasNextPage: true, endCursor: 'c1' }` and two nodes, the second with `hasNextPage: false` and one node, and asserts: the result has three nodes in order, `mutate` was called twice, and the second call's `params.body.variables.after` is `'c1'`. Add one test in the `fetchTreeChildrenStrict` block asserting a second page is fetched and a GraphQL `errors` body on the second page rejects.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/rift/api-client.test.ts`
Expected: FAIL, result has 2 nodes and `mutate` called once.

- [ ] **Step 3: Implement paging**

`childrenQuery` takes `after` and requests `children(first: $first, after: $after) { nodes { ...unchanged } pageInfo { hasNextPage endCursor } }` with `variables: { path, first: 100, after }`. `readAllChildren` loops until `pageInfo` is missing or `hasNextPage` is false. `fetchTreeChildren` passes a `run` that resolves `{ nodes: [], pageInfo: undefined }` on any failure (keeps today's lenient `[]`); `fetchTreeChildrenStrict` passes one built on `authoringStrict` so a failed page rejects.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS, including the existing single-response tests (a response without `pageInfo` is one page).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/api-client.ts src/__tests__/lib/rift/api-client.test.ts
git commit -m "rift: page the children query so large folders list fully"
```

### Task 2: Strict dual fetch for the walker

**Files:**
- Modify: `src/lib/rift/api-client.ts` (after `fetchDualTreeChildren`, ends at line 269)
- Test: `src/__tests__/lib/rift/api-client.test.ts`

**Interfaces:**
- Consumes: `fetchTreeChildrenStrict(client, contextId, parentPath)`, `zipDualTreeChildren(source, target)`.
- Produces: `fetchDualTreeChildrenStrict(client: ClientSDK, sourceContextId: string, targetContextId: string | null, parentPath: string): Promise<DualTreeNode[]>`. Rejects if either side rejects; with a null target it reads the source only and zips against `null`.

- [ ] **Step 1: Write the failing tests**

New describe block `fetchDualTreeChildrenStrict` using the file's existing `mockClientWithResponses` and `treeResponse` helpers:

```ts
it('pairs both sides and sets diff like the lenient fetch', async () => {
  const client = mockClientWithResponses([
    treeResponse([{ itemId: 's1', name: 'Home', path: '/site/Home', updated: 'A' }]),
    treeResponse([{ itemId: 't1', name: 'Home', path: '/site/Home', updated: 'B' }]),
  ]);
  const result = await fetchDualTreeChildrenStrict(client, 'src', 'tgt', '/site');
  expect(result).toEqual([expect.objectContaining({ path: '/site/Home', diff: 'different' })]);
});
it('rejects when only the target read fails instead of returning ghosts', async () => {
  const client = mockClientWithResponses([
    treeResponse([{ itemId: 's1', name: 'Home', path: '/site/Home' }]),
    { errors: [{ message: 'timeout' }] },
  ]);
  await expect(fetchDualTreeChildrenStrict(client, 'src', 'tgt', '/site')).rejects.toThrow(/timeout/);
});
it('rejects when the source parent does not exist', ...)   // first response { item: null }
it('reads the source only when targetContextId is null', ...)  // one mutate call, target undefined
```

Note: the mock resolves `{ data: { data: r } }`, so for the errors case the response must be `{ data: { errors: [...] } }`; add a small helper or inline a `mutate` mock for that call.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/rift/api-client.test.ts -t fetchDualTreeChildrenStrict`
Expected: FAIL, `fetchDualTreeChildrenStrict` is not exported.

- [ ] **Step 3: Implement `fetchDualTreeChildrenStrict`**

`Promise.all` over `fetchTreeChildrenStrict` for the source and, when `targetContextId` is set, the target; `zipDualTreeChildren(source, target ?? null)`. Add a doc comment saying it exists for the drift walk, where a lenient `[]` would be cached as a wrong count.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/rift/api-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/api-client.ts src/__tests__/lib/rift/api-client.test.ts
git commit -m "rift: strict dual children fetch for the drift walk"
```

### Task 3: Pure roll-up module

**Files:**
- Create: `src/lib/rift/drift-rollup.ts`
- Test: `src/__tests__/lib/rift/drift-rollup.test.ts`

**Interfaces:**
- Consumes: `DualTreeNode` from `src/lib/rift/types.ts`.
- Produces (all exported):

```ts
export interface DriftRollup { count: number; complete: boolean }
export function countsAsDrift(node: DualTreeNode): boolean
export function isWalkableFolder(node: DualTreeNode): boolean
export function walkableChildPaths(children: readonly DualTreeNode[]): string[]
export function isUnderRoot(path: string, roots: readonly string[]): boolean
export function computeDriftRollup(cache: ReadonlyMap<string, DualTreeNode[]>, roots: readonly string[]): Map<string, DriftRollup>
export function missingFolders(cache: ReadonlyMap<string, DualTreeNode[]>, roots: readonly string[]): string[]
export function evictSubtrees(cache: ReadonlyMap<string, DualTreeNode[]>, paths: readonly string[]): Map<string, DualTreeNode[]>
```

Semantics the tests pin:
- `computeDriftRollup` has an entry for every root and every walkable folder reachable from a root through cached lists. A folder not in the cache is `{ count: 0, complete: false }`. A cached folder's `count` is the sum over its children of `(countsAsDrift ? 1 : 0) + (isWalkableFolder ? child.count : 0)`; `complete` is true when every walkable child is complete. Nothing else gets an entry.
- `missingFolders` is breadth-first from the roots: an uncached root is returned itself; for a cached folder, each walkable child that is not cached is returned and each cached one is descended. No duplicates.
- `evictSubtrees` drops keys equal to a path or starting with `path + '/'`. When nothing matches it returns the input map instance.

- [ ] **Step 1: Write the failing tests**

Build nodes with a small helper `n(path, opts: { source?: boolean; target?: boolean; diff?: 'match' | 'different'; hasChildren?: boolean })` (defaults: both sides present, leaf). Tests, one `it` each:

```ts
// countsAsDrift
'counts different'            -> n('/r/a', { diff: 'different' }) true
'counts source-only'          -> n('/r/a', { target: false }) true
'ignores target-only'         -> n('/r/a', { source: false }) false
'ignores match and undefined' -> both false
// isWalkableFolder
'walks folders on both sides only' -> hasChildren + both true; source-only folder false; leaf false
// computeDriftRollup, cache = { '/r': [a(diff different, folder), b(leaf match)], '/r/a': [x(source-only leaf), y(different leaf)] }
'sums drift beneath nested folders'      -> get('/r') = { count: 3, complete: true }, get('/r/a') = { count: 2, complete: true }
'marks a folder incomplete while a walkable child is uncached' -> cache without '/r/a': get('/r') = { count: 1, complete: false }, get('/r/a') = { count: 0, complete: false }
'counts a source-only folder as one and ignores its cached children' -> '/r': [f(source-only folder)], '/r/f': [two different leaves]; get('/r') = { count: 1, complete: true }, has('/r/f') false
'never emits entries above or outside the roots' -> cache has '/sitecore/content' listing '/r'; roots ['/r']; has('/sitecore/content') false
'handles several roots' -> roots ['/r', '/m'], both present
// missingFolders
'returns uncached walkable folders breadth-first' -> cache { '/r': [a(folder), b(folder)], '/r/a': [c(folder)] } -> ['/r/b', '/r/a/c']
'returns an uncached root itself'                  -> cache empty, roots ['/r'] -> ['/r']
'skips source-only folders and returns [] when complete'
// evictSubtrees
'drops the path and its descendants but not a sibling sharing the prefix' -> keys '/site/Home', '/site/Home/About', '/site/Homepage'; evict ['/site/Home'] -> keys ['/site/Homepage']
'returns the same map when nothing matches'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/rift/drift-rollup.test.ts`
Expected: FAIL, cannot resolve `@/lib/rift/drift-rollup`.

- [ ] **Step 3: Implement `src/lib/rift/drift-rollup.ts`**

Signatures above. `computeDriftRollup` is a depth-first visit from each root with a results map used as the memo; `missingFolders` a queue-based BFS. Each function gets a one-line doc comment stating the rule it encodes (the spec's wording is fine).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/rift/drift-rollup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/drift-rollup.ts src/__tests__/lib/rift/drift-rollup.test.ts
git commit -m "rift: pure drift roll-up over the children cache"
```

### Task 4: TreeWalker

**Files:**
- Create: `src/lib/rift/tree-walker.ts`
- Test: `src/__tests__/lib/rift/tree-walker.test.ts`

**Interfaces:**
- Consumes: `DualTreeNode`.
- Produces:

```ts
export interface WalkProgress { checked: number; pending: number; inFlight: number; paused: boolean }
export interface TreeWalkerOptions {
  fetch: (path: string) => Promise<DualTreeNode[]>;
  isCached: (path: string) => boolean;
  next: (children: DualTreeNode[]) => string[];
  onLoaded: (path: string, children: DualTreeNode[]) => void;
  onProgress: (progress: WalkProgress) => void;
  concurrency?: number;   // default 2
  maxAttempts?: number;   // default 3
  retryDelayMs?: number;  // default 1000, doubled per retry
}
export class TreeWalker {
  constructor(options: TreeWalkerOptions);
  enqueue(paths: readonly string[], position?: 'back' | 'front'): void;  // default 'back'
  pause(): void;
  resume(): void;
  reset(): void;
  get progress(): WalkProgress;
}
```

Semantics the tests pin:
- `enqueue` ignores paths that are cached, queued, in flight or waiting to retry, then pumps.
- The pump takes from the front while not paused and `inFlight < concurrency`; a path that became cached meanwhile is skipped.
- Success: `onLoaded(path, children)`, `checked + 1`, then `enqueue(next(children), 'back')`.
- Failure: after `retryDelayMs * 2^(attempt - 1)` the path goes to the back of the queue; after `maxAttempts` failures it is dropped. `pending` counts queued paths plus those waiting to retry.
- `pause()` stops taking new paths; in-flight reads finish and are stored. `resume()` pumps.
- `reset()` increments a generation, clears the queue, the in-flight set, retry timers and attempt counts, sets `checked` to 0 and `paused` to false, so `progress.inFlight` is 0 right after it and the same path can be enqueued and read again. A read from an older generation is ignored when it lands: no `onLoaded`, no `checked`, no `next`, no change to the in-flight set.
- `onProgress` fires with a fresh object after every change (enqueue, take, settle, pause, resume, reset).

- [ ] **Step 1: Write the failing tests**

Use `vi.useFakeTimers()` and a `deferred()` helper so each fetch is resolved by hand. A `folder(path)` helper returns a `DualTreeNode` with both sides and `hasChildren: true`. Tests:

```ts
'takes paths in order with at most two in flight'      // enqueue 3; fetch called with 1st and 2nd only; resolve 1st; fetch called with 3rd
'puts front insertions ahead of the queue'             // concurrency 1; enqueue [a, b]; enqueue [c], 'front'; resolve a; next fetch is c
'skips cached and duplicate paths'                     // isCached true for a; enqueue [a, b, b]; fetch called once, with b
'stores a result, counts it and follows next()'        // next returns ['/r/a/x']; after resolve: onLoaded called, progress.checked 1, fetch called with '/r/a/x'
'retries a failed read after 1000 then 2000 ms, then drops it'  // reject 3 times; advance timers 1000, 2000; fetch called 3 times; checked 0; onLoaded never; progress { pending: 0, inFlight: 0 }
'pauses before taking the next path and resumes later' // concurrency 1; enqueue [a, b]; pause(); resolve a -> onLoaded(a) called, fetch not called with b; resume() -> fetch called with b
'drops a read that lands after reset()'                // enqueue [a]; reset() -> progress.inFlight 0; enqueue [a] again -> fetch called a second time; resolve the first -> onLoaded not called, checked 0; resolve the second -> onLoaded called once, checked 1
'reports progress after every change'                  // onProgress call count grows on enqueue, settle, pause, reset; last call's object is not the same instance as the previous
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/rift/tree-walker.test.ts`
Expected: FAIL, cannot resolve `@/lib/rift/tree-walker`.

- [ ] **Step 3: Implement `src/lib/rift/tree-walker.ts`**

Class with private `queue: string[]`, `inFlight: Set<string>`, `retrying: Map<string, ReturnType<typeof setTimeout>>`, `attempts: Map<string, number>`, `generation: number`, `checked: number`, `paused: boolean`. The pump is synchronous apart from the awaited fetch and re-enters itself from each settle. Capture `generation` before each fetch and compare after.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/rift/tree-walker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/tree-walker.ts src/__tests__/lib/rift/tree-walker.test.ts
git commit -m "rift: TreeWalker - bounded, retrying, pausable folder walk"
```

### Task 5: DriftPill and the cells that show it

**Files:**
- Create: `src/components/rift/DriftPill.tsx`
- Modify: `src/components/rift/RiftContentTree.tsx:23-85` (`SourceCell`) and `:95-136` (`TargetCell`)

**Interfaces:**
- Consumes: `DriftRollup` from Task 3.
- Produces: `export function DriftPill({ rollup }: { rollup?: DriftRollup }): JSX.Element | null`. `SourceCell` and `TargetCell` gain an optional prop `rollup?: DriftRollup` and render `<DriftPill rollup={rollup} />` immediately after the name span, inside the button. Nothing is wired to the roll-up yet; the prop is simply undefined until Task 6.

- [ ] **Step 1: Implement `DriftPill`**

Rules: `rollup` undefined, or `complete && count === 0`, renders `null`. `count > 0` renders the number in an amber pill with `title` and `aria-label` = `"{count} items beneath differ or are missing on target"` plus `" (still scanning)"` when `!complete`. `count === 0 && !complete` renders `?` in a muted pill with `title` and `aria-label` `"Not scanned yet"`. Classes: shared `inline-flex items-center shrink-0 ml-1 rounded-full border px-1.5 text-[10px] leading-4`; amber `border-amber-500/50 bg-amber-500/15 text-amber-500`; muted `border-border text-muted-foreground/70`. The element is a plain `span`.

- [ ] **Step 2: Add the `rollup` prop to both cells and render the pill**

In `SourceCell`, after the name `<span>` inside the `<button>`; in `TargetCell`, after the name `<span>`. The `GhostSlot` early returns stay as they are, so a source-only row shows its pill in the source column only.

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/rift/DriftPill.tsx src/components/rift/RiftContentTree.tsx
git commit -m "rift: DriftPill rendered by the source and target cells"
```

### Task 6: Replace the prefetch queue with the walker and show counts

**Files:**
- Modify: `src/components/rift/RiftContentTree.tsx` (prefetch block `:335-388`, initial load `:440-563`, `handleExpand` `:643-680`, row props `:163-200` and `:682-694`, header `:790-800`, loading spinner `:813-819`)

**Interfaces:**
- Consumes: `TreeWalker`, `WalkProgress` (Task 4); `computeDriftRollup`, `missingFolders`, `walkableChildPaths`, `DriftRollup` (Task 3); `fetchDualTreeChildrenStrict` (Task 2).
- Produces: `TreeNodeRowProps` and `baseTreeRowProps` gain `driftRollup: ReadonlyMap<string, DriftRollup>`; both row renderers pass `rollup={driftRollup.get(node.path)}` to `SourceCell` and `TargetCell`. A local `Spinner({ className }: { className?: string })` component replaces the inline loading `<svg>` and is reused in the header.

- [ ] **Step 1: Delete the prefetch block and add walker state**

Remove `prefetchQueueRef`, `prefetchActiveRef`, `prefetchGenRef`, `MAX_PREFETCH_CONCURRENT`, `processPrefetchQueue`, `enqueuePrefetch`, and the two places that seed or call them in the initial load. Add `walkerRef = useRef<TreeWalker | null>(null)`, `const [walkProgress, setWalkProgress] = useState<WalkProgress>({ checked: 0, pending: 0, inFlight: 0, paused: false })`, `const [walkRoots, setWalkRoots] = useState<string[]>([])`, and a module-level `const EMPTY_ROLLUP: ReadonlyMap<string, DriftRollup> = new Map()`.

- [ ] **Step 2: Create the walker in an effect declared BEFORE the initial-load effect**

Keyed on `[client, contextId, targetContextId]`. With a null target set `walkerRef.current = null` and reset progress. Otherwise construct `new TreeWalker({ fetch: (p) => fetchDualTreeChildrenStrict(client, contextId, targetContextId, p), isCached: (p) => childrenCacheRef.current.has(p), next: walkableChildPaths, onLoaded, onProgress: setWalkProgress })` where `onLoaded(path, children)` stores into the cache only if absent (same updater prefetch used) and emits `onChildrenLoadedRef.current?.(path, sourceOnly)`. Cleanup calls `reset()` and nulls the ref.

- [ ] **Step 3: Seed the walk from the initial load**

In `loadTrees`, after `setExpandedNodes(expandPaths)` and `setIsLoading(false)`: collect `roots` = the content site root path when every segment matched (the final `currentPath` of the content loop) and the media site folder path when every media segment matched; `setWalkRoots(roots)`; then `walkerRef.current?.reset(); walkerRef.current?.enqueue(missingFolders(newCache, roots))`. Track whether every segment matched with a boolean set to false on the `break`.

- [ ] **Step 4: Feed hand expansions to the front**

In `handleExpand`, replace `enqueuePrefetch(children)` with `walkerRef.current?.enqueue(walkableChildPaths(children), 'front')`.

- [ ] **Step 5: Memoise the roll-up and pass it down**

`const driftRollup = useMemo(() => targetContextId !== null && walkRoots.length > 0 ? computeDriftRollup(childrenCache, walkRoots) : EMPTY_ROLLUP, [childrenCache, walkRoots, targetContextId])`. Add `driftRollup` to `TreeNodeRowProps`, `baseTreeRowProps`, the recursive `TreeNodeRow` call, and pass `rollup={driftRollup.get(node.path)}` to both cells in both renderers.

- [ ] **Step 6: Header status**

Extract `Spinner` from the loading block. In the header `flex justify-between` row, between the title and the label, render when `walkProgress.pending + walkProgress.inFlight > 0`: `<span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Spinner className="h-3 w-3" />Scanning for drift: {walkProgress.checked} folders checked</span>`. (Task 7 adds the paused variant.)

- [ ] **Step 7: Lint, build, test**

Run: `npm run lint && npm run build && npm test`
Expected: all clean. `npm test` still passes because no component test exists.

- [ ] **Step 8: Commit**

```bash
git add src/components/rift/RiftContentTree.tsx
git commit -m "rift: walk the site in the background and show drift counts on folders"
```

### Task 7: Pause while the target is writing; gate hand expansion; re-walk after a migration

**Files:**
- Modify: `src/components/rift/RiftContentTree.tsx` (soft-refresh effect `:570-610`, `handleExpand`, both arrow blocks `:222-238` and `:719-735`, header status)

**Interfaces:**
- Consumes: `evictSubtrees`, `missingFolders` (Task 3); `walkerRef`, `walkRoots`, `walkProgress` (Task 6).
- Produces: `const [awaitingSettle, setAwaitingSettle] = useState(false)`; `expansionBlocked = !!disabled || awaitingSettle`; `ExpandArrow({ hasChildren, isExpanded, isLoading, blocked, onClick }: { hasChildren: boolean; isExpanded: boolean; isLoading: boolean; blocked: boolean; onClick: () => void })` used by both row renderers; `TreeNodeRowProps` and `baseTreeRowProps` gain `expansionBlocked: boolean`.

- [ ] **Step 1: Pause on `disabled`**

`useEffect(() => { if (disabled) { walkerRef.current?.pause(); setAwaitingSettle(true); } }, [disabled])`. Nothing happens when it goes false.

- [ ] **Step 2: Extend the soft-refresh effect**

Keep a `selectedPathsRef` mirroring `selectedPaths` and a `walkRootsRef` mirroring `walkRoots`. Replace `prefetchGenRef.current++` with `walkerRef.current?.reset()`. The re-read list is the expanded paths plus the parent (`path.slice(0, path.lastIndexOf('/'))`) of every selected path, deduplicated. The reads stay on the lenient `fetchDualTreeChildren`. After they land: `const next = new Map(evictSubtrees(childrenCacheRef.current, selectedPaths.map((p) => p.itemPath)))`, set each read result into `next`, `setChildrenCache(next)`, emit `onChildrenLoaded` per read as today, `setAwaitingSettle(false)`, then `walkerRef.current?.enqueue(missingFolders(next, walkRootsRef.current))`.

- [ ] **Step 3: Clear the settle flag on a full reset**

At the top of the initial-load effect, `setAwaitingSettle(false)` (the walker is reset there in Task 6).

- [ ] **Step 4: Extract `ExpandArrow` and block it**

One component replacing the two identical arrow `<span>` blocks. When `blocked`, the arrow gets `opacity-40 cursor-not-allowed`, `title="Target is still writing; refresh the tree to continue"`, and no click handler. Callers pass `blocked={expansionBlocked && !childrenCache.has(node.path)}`. In `handleExpand`, return early without toggling when `expansionBlocked && !childrenCacheRef.current.has(node.path)`.

- [ ] **Step 5: Header paused variant**

When `awaitingSettle && (walkProgress.pending + walkProgress.inFlight > 0)`, render `Drift scan paused until the tree is refreshed` (same muted `text-xs`, no spinner) instead of the scanning text.

- [ ] **Step 6: Lint, build, test**

Run: `npm run lint && npm run build && npm test`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/rift/RiftContentTree.tsx
git commit -m "rift: pause the drift walk and expansion while the target writes; re-walk migrated branches"
```

### Task 8: Version bump and manual check

**Files:**
- Modify: `package.json:3`, `src/lib/version.ts:2`

- [ ] **Step 1: Bump the version**

`0.7.18` to `0.7.19` in both files.

- [ ] **Step 2: Full verification**

Run: `npm test && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add package.json src/lib/version.ts
git commit -m "rift: bump to 0.7.19 - drift counts on folders"
```

- [ ] **Step 4: Manual check (Jason, in the app against dev)**

Open a site with a target selected. Expect: the header shows the scanning status and the count rising; "?" pills turn into amber numbers or disappear as the walk reaches them; expanding a walked folder is instant; the rows above the site root have no pill; after a migration of a selected branch its pill falls and the header shows the scan again; no network traffic to the target while a migration runs.
