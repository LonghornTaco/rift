# Dual Tree Diff Indicator Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a subtle amber dot to any paired row where source and target `__Updated` timestamps differ, plus two small cleanups (make the column divider faintly visible and drop the undocumented `ItemAndChildren` scope value).

**Architecture:** Extend the existing GraphQL tree query to include `__Updated`, propagate it through `TreeNode`, compute a `diff: 'match' | 'different'` field at pair time inside the existing `zipDualTreeChildren` helper, render a dot in `TargetCell` when `diff === 'different'`. No new endpoints, no extra round-trips, no new caches.

**Tech Stack:** Next.js 15 / React 18 / TypeScript, Vitest (node env), Sitecore Marketplace Client SDK, Authoring GraphQL.

**Spec:** `docs/superpowers/specs/2026-04-20-dual-tree-diff-design.md`
**Builds on v1:** `docs/superpowers/specs/2026-04-19-dual-tree-view-design.md`

---

## File Structure

- Modify `src/lib/rift/types.ts` — add `updated?: string` to `TreeNode`, add `diff?: 'match' | 'different'` to `DualTreeNode`, drop `'ItemAndChildren'` from `MigrationPath.scope`.
- Modify `src/lib/rift/api-client.ts` — extend the GraphQL query in `fetchTreeChildren` to request `__Updated`, map it onto `TreeNode.updated`. Extend `zipDualTreeChildren` to set `diff` when both sides have `updated`.
- Modify `src/__tests__/lib/rift/api-client.test.ts` — update existing `fetchTreeChildren` test to verify `updated` is mapped; add three new `zipDualTreeChildren` tests for the diff states.
- Modify `src/components/rift/RiftContentTree.tsx` — render amber dot in `TargetCell`; update per-row divider classes (two spots) and header divider class (one spot).
- Modify `src/components/rift/RiftSelectionPanel.tsx` — remove the "Item + Children" scope option.
- Modify `src/components/rift/RiftConfirmDialog.tsx` — remove the `ItemAndChildren` label mapping.
- Modify `src/components/rift/RiftPresets.tsx` — remove the `ItemAndChildren` label mapping.
- Modify `src/components/rift/RiftMigrate.tsx` — remove the `scope === 'ItemAndChildren'` branch from the `inheritedPaths` memo.
- Modify `src/components/rift/RiftContentTree.tsx` (again in Task 6) — drop `ItemAndChildren` from the `selectedPathSet` filter.

---

## Task 1: Add `updated` to `TreeNode` and `diff` to `DualTreeNode`

**Files:**
- Modify: `src/lib/rift/types.ts`

- [ ] **Step 1: Update `TreeNode` interface**

In `src/lib/rift/types.ts`, find `export interface TreeNode` and add the optional `updated` field:

```ts
export interface TreeNode {
  itemId: string;
  name: string;
  path: string;
  hasChildren: boolean;
  templateName: string;
  updated?: string;
  children?: TreeNode[];
  isExpanded?: boolean;
}
```

- [ ] **Step 2: Update `DualTreeNode` interface**

Find `export interface DualTreeNode` (added in v1) and add the optional `diff` field:

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
  diff?: 'match' | 'different';
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. Adding optional fields is additive — no existing consumers break.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rift/types.ts
git commit -m "rift types: add TreeNode.updated and DualTreeNode.diff for v2 drift indicator"
```

---

## Task 2: Extend GraphQL query + update `fetchTreeChildren` + update existing test

This task changes the existing GraphQL query to request `__Updated` and extends the response parser. The only test for `fetchTreeChildren` uses a `toEqual` assertion that will break unless updated in the same commit.

**Files:**
- Modify: `src/lib/rift/api-client.ts`
- Modify: `src/__tests__/lib/rift/api-client.test.ts`

- [ ] **Step 1: Update the existing `fetchTreeChildren` test to cover the new field**

Find the test `it('returns parsed tree nodes from GraphQL response', ...)` in `src/__tests__/lib/rift/api-client.test.ts`. Replace its mock response and assertion to include the new `updated` data:

```ts
it('returns parsed tree nodes from GraphQL response', async () => {
  const client = mockClient({
    item: {
      children: {
        nodes: [
          {
            itemId: 'id1',
            name: 'Home',
            path: '/sitecore/content/Home',
            hasChildren: true,
            template: { name: 'Page' },
            updated: { value: '20260419T153045Z' },
          },
          {
            itemId: 'id2',
            name: 'About',
            path: '/sitecore/content/About',
            hasChildren: false,
            template: { name: 'Page' },
            updated: null,
          },
        ],
      },
    },
  });

  const result = await fetchTreeChildren(client, 'ctx-123', '/sitecore/content');
  expect(result).toHaveLength(2);
  expect(result[0]).toEqual({
    itemId: 'id1',
    name: 'Home',
    path: '/sitecore/content/Home',
    hasChildren: true,
    templateName: 'Page',
    updated: '20260419T153045Z',
  });
  expect(result[1].updated).toBeUndefined();
});
```

- [ ] **Step 2: Run the updated test to verify it fails**

Run: `npm test -- api-client`
Expected: The `returns parsed tree nodes from GraphQL response` test FAILS — the current implementation doesn't include `updated` in the mapped result.

- [ ] **Step 3: Extend the GraphQL query and parser**

In `src/lib/rift/api-client.ts`, update the `fetchTreeChildren` function. Change the query string:

```ts
const query = {
  query: `query GetChildren($path: String!) {
    item(where: { path: $path }) {
      children { nodes { itemId name path hasChildren template { name } updated: field(name: "__Updated") { value } } }
    }
  }`,
  variables: { path: parentPath },
};
```

Then update the parser to map the new field. Replace the existing `.map(...)` call:

```ts
return nodes.map(
  (n: {
    itemId: string;
    name: string;
    path: string;
    hasChildren: boolean;
    template: { name: string };
    updated?: { value?: string } | null;
  }) => {
    const mapped: TreeNode = {
      itemId: n.itemId,
      name: n.name,
      path: n.path,
      hasChildren: n.hasChildren,
      templateName: n.template?.name ?? '',
    };
    const updatedValue = n.updated?.value;
    if (updatedValue) mapped.updated = updatedValue;
    return mapped;
  },
);
```

Note: only assign `mapped.updated` when the string is present and non-empty. Missing or empty values leave the field undefined — the diff logic in Task 3 treats undefined as "no signal, no dot".

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- api-client`
Expected: All tests pass, including the updated `fetchTreeChildren` test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/api-client.ts src/__tests__/lib/rift/api-client.test.ts
git commit -m "rift api-client: fetch __Updated per tree node for drift detection"
```

---

## Task 3: Extend `zipDualTreeChildren` to compute `diff` + tests

**Files:**
- Modify: `src/lib/rift/api-client.ts`
- Modify: `src/__tests__/lib/rift/api-client.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/lib/rift/api-client.test.ts`, inside the existing `describe('zipDualTreeChildren', ...)` block (or at the end if that's easier):

```ts
describe('zipDualTreeChildren diff computation', () => {
  function nodeWithUpdated(path: string, updated: string | undefined): TreeNode {
    const name = path.split('/').filter(Boolean).pop() ?? '';
    return {
      itemId: `id-${path}`,
      name,
      path,
      hasChildren: false,
      templateName: 'Page',
      ...(updated !== undefined ? { updated } : {}),
    };
  }

  it('sets diff to match when both sides have equal updated timestamps', () => {
    const source = [nodeWithUpdated('/a/Home', '20260419T120000Z')];
    const target = [nodeWithUpdated('/a/Home', '20260419T120000Z')];

    const result = zipDualTreeChildren(source, target);

    expect(result).toHaveLength(1);
    expect(result[0].diff).toBe('match');
  });

  it('sets diff to different when updated timestamps differ', () => {
    const source = [nodeWithUpdated('/a/Home', '20260419T120000Z')];
    const target = [nodeWithUpdated('/a/Home', '20260420T090000Z')];

    const result = zipDualTreeChildren(source, target);

    expect(result[0].diff).toBe('different');
  });

  it('leaves diff undefined when only source has updated', () => {
    const source = [nodeWithUpdated('/a/Home', '20260419T120000Z')];
    const target = [nodeWithUpdated('/a/Home', undefined)];

    const result = zipDualTreeChildren(source, target);

    expect(result[0].diff).toBeUndefined();
  });

  it('leaves diff undefined when only target has updated', () => {
    const source = [nodeWithUpdated('/a/Home', undefined)];
    const target = [nodeWithUpdated('/a/Home', '20260419T120000Z')];

    const result = zipDualTreeChildren(source, target);

    expect(result[0].diff).toBeUndefined();
  });

  it('leaves diff undefined when target side is absent (source-only row)', () => {
    const source = [nodeWithUpdated('/a/Home', '20260419T120000Z')];
    const target: TreeNode[] = [];

    const result = zipDualTreeChildren(source, target);

    expect(result[0].diff).toBeUndefined();
    expect(result[0].target).toBeUndefined();
  });

  it('leaves diff undefined when source side is absent (target-only row)', () => {
    const source: TreeNode[] = [];
    const target = [nodeWithUpdated('/a/Home', '20260419T120000Z')];

    const result = zipDualTreeChildren(source, target);

    expect(result[0].diff).toBeUndefined();
    expect(result[0].source).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- api-client`
Expected: The six new tests fail — current `zipDualTreeChildren` never sets `diff`.

- [ ] **Step 3: Update `zipDualTreeChildren`**

In `src/lib/rift/api-client.ts`, update the body of `zipDualTreeChildren`. The existing function pushes paired objects into `paired`. Extend both push sites to compute `diff` when both sides have non-empty `updated` strings. Here is the full updated function:

```ts
/**
 * Merge two same-level TreeNode lists into DualTreeNode pairs, keyed by path.
 *
 * - Preserves source order for paths present in source.
 * - Appends target-only paths at the end in target order.
 * - `name` comes from source when present, otherwise target.
 * - `hasChildren` is true if either side reports hasChildren.
 * - When `target` is null or undefined, every pair has `target: undefined`.
 * - `diff` is set only when both sides are present AND both have non-empty `updated` strings.
 *   'match' when updated values are equal, 'different' otherwise. Undefined in all other cases.
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
    const pair: DualTreeNode = {
      path: s.path,
      name: s.name,
      hasChildren: s.hasChildren || (t?.hasChildren ?? false),
      source: s,
      target: t,
    };
    if (t && s.updated && t.updated) {
      pair.diff = s.updated === t.updated ? 'match' : 'different';
    }
    paired.push(pair);
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

Only the paired-branch push gets a `diff`. Target-only pairs always leave `diff` undefined (nothing to compare against).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- api-client`
Expected: All tests pass — the 6 new tests plus all existing tests remain green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/api-client.ts src/__tests__/lib/rift/api-client.test.ts
git commit -m "rift api-client: compute DualTreeNode.diff from __Updated timestamps"
```

---

## Task 4: Render the amber dot in `TargetCell`

**Files:**
- Modify: `src/components/rift/RiftContentTree.tsx`

- [ ] **Step 1: Update `TargetCell` to render the dot**

In `src/components/rift/RiftContentTree.tsx`, find the `TargetCell` function. Replace the final return (the real-target branch) with this markup that includes the diff dot:

```tsx
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
```

Only the dot is new. The icon span and name span are unchanged. The dot renders before the folder icon.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (pre-existing unrelated `content-transfer.test.ts` error can be ignored — it existed before this plan).

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All 19 tests pass (13 v1 + 6 new v2 zip tests from Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/components/rift/RiftContentTree.tsx
git commit -m "rift tree: amber drift dot in TargetCell when diff is 'different'"
```

---

## Task 5: Make the column divider faintly visible

**Files:**
- Modify: `src/components/rift/RiftContentTree.tsx`

There are three divider spots: two per-row dividers (one in `TreeNodeRow`, one in `renderFilteredBranch`) and one in the column-headers block.

- [ ] **Step 1: Update the per-row dividers**

In `src/components/rift/RiftContentTree.tsx`, find both occurrences of `<div className="w-px h-6 bg-border shrink-0" />` (one inside `TreeNodeRow`, one inside `renderFilteredBranch`). Replace both with:

```tsx
<div className="w-px h-6 bg-muted-foreground/20 shrink-0" />
```

Same size, new color token — ~20% opacity of the muted text color.

- [ ] **Step 2: Update the column-headers divider**

Still in `src/components/rift/RiftContentTree.tsx`, find the column-headers block (the one containing the "Source" and "Target" labels — it has `text-[10px] font-semibold text-muted-foreground uppercase tracking-wide`). Inside it the divider is `<div className="w-px h-4 bg-border/50" />`. Replace with:

```tsx
<div className="w-px h-4 bg-muted-foreground/20" />
```

- [ ] **Step 3: Type-check + test**

Run: `npx tsc --noEmit && npm test`
Expected: All still green.

- [ ] **Step 4: Commit**

```bash
git add src/components/rift/RiftContentTree.tsx
git commit -m "rift tree: make column divider faintly visible"
```

---

## Task 6: Remove `ItemAndChildren` scope across the codebase

The v1 plan shipped with a UI option for "Item + Children" that the Sitecore Content Transfer API does not document as an allowed scope value. This task removes it from every file it touches. Six files.

**Files:**
- Modify: `src/lib/rift/types.ts`
- Modify: `src/components/rift/RiftSelectionPanel.tsx`
- Modify: `src/components/rift/RiftMigrate.tsx`
- Modify: `src/components/rift/RiftContentTree.tsx`
- Modify: `src/components/rift/RiftConfirmDialog.tsx`
- Modify: `src/components/rift/RiftPresets.tsx`

- [ ] **Step 1: Update `types.ts` — drop `ItemAndChildren` from the scope union**

In `src/lib/rift/types.ts`, find `MigrationPath` and narrow the scope union:

```ts
export interface MigrationPath {
  itemPath: string;
  itemId: string;
  scope: 'SingleItem' | 'ItemAndDescendants';
}
```

- [ ] **Step 2: Update `RiftSelectionPanel.tsx` — remove the scope dropdown option**

In `src/components/rift/RiftSelectionPanel.tsx`, find the `scopeValues` array and remove the `'Item + Children'` entry. After the edit, it should be:

```ts
const scopeValues: { label: string; value: MigrationPath['scope'] }[] = [
  { label: 'Item Only', value: 'SingleItem' },
  { label: 'Item + Descendants', value: 'ItemAndDescendants' },
];
```

- [ ] **Step 3: Update `RiftMigrate.tsx` — remove the `ItemAndChildren` branch in `inheritedPaths`**

In `src/components/rift/RiftMigrate.tsx`, find the `inheritedPaths` memo (around line 185). Delete the `else if (sp.scope === 'ItemAndChildren') { ... }` branch entirely. The remaining branches should be:

```ts
const inheritedPaths = useMemo(() => {
  const inherited = new Set<string>();
  for (const sp of selectedPaths) {
    if (sp.scope === 'SingleItem') continue;

    if (sp.scope === 'ItemAndDescendants') {
      for (const [, children] of loadedTreeNodes) {
        for (const child of children) {
          if (child.path !== sp.itemPath && child.path.startsWith(sp.itemPath + '/')) {
            inherited.add(child.path);
          }
        }
      }
    }
  }
  for (const sp of selectedPaths) {
    inherited.delete(sp.itemPath);
  }
  return inherited;
}, [selectedPaths, loadedTreeNodes]);
```

- [ ] **Step 4: Update `RiftContentTree.tsx` — simplify the `selectedPathSet` filter**

In `src/components/rift/RiftContentTree.tsx`, find the line (around line 316):

```ts
.filter((p) => p.scope === 'SingleItem' || p.scope === 'ItemAndChildren' || p.scope === 'ItemAndDescendants')
```

Because the `scope` union is now restricted to the two remaining values, this filter is tautological — every `MigrationPath` now has a scope that passes. Remove the `.filter(...)` call entirely:

```ts
const selectedPathSet = new Set(
  selectedPaths.map((p) => p.itemPath)
);
```

- [ ] **Step 5: Update `RiftConfirmDialog.tsx` — remove the label mapping**

In `src/components/rift/RiftConfirmDialog.tsx`, find the scope label map (around line 25) and remove the `ItemAndChildren: 'Item + children'` entry:

```ts
const scopeLabels = {
  SingleItem: 'Item only',
  ItemAndDescendants: 'Item + descendants',
};
```

(The exact property names in the file may differ slightly; preserve whatever capitalization/wording is there for the two remaining scopes and only drop the `ItemAndChildren` line.)

- [ ] **Step 6: Update `RiftPresets.tsx` — remove the label mapping**

In `src/components/rift/RiftPresets.tsx`, find the same-shape scope label map (around line 27) and drop the `ItemAndChildren` entry. Same principle as Step 5 — keep the other two entries verbatim.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. Any remaining reference to `'ItemAndChildren'` in the codebase will fail the type-check now that the union is narrowed.

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: All 19 tests still pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/rift/types.ts src/components/rift/RiftSelectionPanel.tsx src/components/rift/RiftMigrate.tsx src/components/rift/RiftContentTree.tsx src/components/rift/RiftConfirmDialog.tsx src/components/rift/RiftPresets.tsx
git commit -m "rift: remove ItemAndChildren scope (not supported by Content Transfer API)"
```

---

## Task 7: Manual QA

No code changes. A short browser pass to confirm the feature reads the way we expect.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open http://localhost:3001.

- [ ] **Step 2: Confirm the scope dropdown shows exactly two options**

Select any item from the tree to add it to the selection panel on the right. Open the scope dropdown. Expected: only "Item Only" and "Item + Descendants" appear. "Item + Children" is gone.

- [ ] **Step 3: Confirm the column divider is visible**

Observe the vertical line between Source and Target columns. It should read as a thin faint guide down the tree — not invisible, not heavy.

- [ ] **Step 4: Confirm the drift dot appears when expected**

Pick source + target envs where you know at least one item has drifted (e.g. edit an item on target via the Sitecore Pages UI, then reload Rift). Expected: an amber dot appears immediately before the target-side folder icon for that row. The source side is unchanged. Rows that match show no dot.

- [ ] **Step 5: Confirm the dot is absent for ghosts and no-target states**

With target env unselected, every target cell shows an em-dash (no dots anywhere). With target env selected but the site missing, every target cell is a ghost (no dots). With target-only rows (items not on source), no dot.

- [ ] **Step 6: Smoke-test existing flows**

Save a preset → reload preset → tree renders at the correct expansion point. Start a real migration on a small single-item path → completes successfully (the new GraphQL field didn't break the fetch). Toggle "Show hidden items".

---

## Self-Review Checklist

- [x] **Spec coverage:** Every requirement in the v2 spec maps to a task.
  - "Extend GraphQL for `__Updated`" → Task 2.
  - "Compute `diff` at pair time" → Task 3.
  - "Render dot in target cell" → Task 4.
  - "Faint column divider" → Task 5.
  - "Drop `ItemAndChildren`" → Task 6.
  - Edge cases (ghost, no-target, undefined updated) are all exercised in Task 3 tests.
- [x] **No placeholders** — every code step shows the exact code.
- [x] **Type consistency** — `TreeNode.updated`, `DualTreeNode.diff`, `'match' | 'different'`, and the scope narrowing are named identically across tasks.
- [x] **Scope check** — single feature + two small cleanups in the same area. Correctly one plan.
