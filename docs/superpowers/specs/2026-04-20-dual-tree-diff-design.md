# Dual Tree Diff Indicator Design (v2)

**Date:** 2026-04-20
**Component:** `RiftContentTree` (with knock-on changes to `types.ts`, `api-client.ts`, `RiftSelectionPanel.tsx`, `RiftMigrate.tsx`)
**Status:** Draft — ready for implementation planning
**Builds on:** `2026-04-19-dual-tree-view-design.md` (v1)

## Motivation

v1 shipped a paired source/target tree with ghost slots for items missing on either side. Users can now see which items exist where. The next question they ask is: "of the items that exist on both sides, which ones have drifted?"

v2 answers that visually — a small indicator on any paired row where the source and target `__Updated` timestamps disagree. It tells the user, at a glance, which items need re-transferring.

Also in scope: two small cleanup items flagged after v1 shipped.

## Scope

**In scope (v2):**
- Extend the tree GraphQL query to also fetch the `__Updated` timestamp.
- Compute a `diff` state per paired row at zip time.
- Render a subtle dot on the target cell when `diff === 'different'`.
- Make the column divider faintly visible instead of essentially-invisible.
- Drop the undocumented `'ItemAndChildren'` scope value from the UI and types.

**Out of scope (v3):**
- Field-level comparison (requires per-row `fetchItemFields` calls).
- "Compare" action / popover exposing which fields diverge.
- Direction indicator (source-newer vs target-newer).

## Requirements

1. When both source and target sides of a paired row exist and their `__Updated` timestamps differ, a small indicator renders on the target cell.
2. The indicator must NOT appear on rows where one side is absent (ghost slots already convey that asymmetry).
3. The indicator must NOT appear when no target environment is selected.
4. A faint but continuous vertical line separates the source and target columns down the tree height.
5. "Item + Children" is removed from the scope UI and type.

## Data model

`TreeNode` gains one optional field in `src/lib/rift/types.ts`:

```ts
export interface TreeNode {
  itemId: string;
  name: string;
  path: string;
  hasChildren: boolean;
  templateName: string;
  updated?: string;   // NEW — ISO timestamp from Sitecore's __Updated field
  children?: TreeNode[];
  isExpanded?: boolean;
}
```

`DualTreeNode` gains the derived diff state:

```ts
export interface DualTreeNode {
  path: string;
  name: string;
  hasChildren: boolean;
  source?: TreeNode;
  target?: TreeNode;
  diff?: 'match' | 'different';   // NEW — only set when BOTH source and target are present
}
```

`MigrationPath.scope` drops `'ItemAndChildren'`:

```ts
export interface MigrationPath {
  itemPath: string;
  itemId: string;
  scope: 'SingleItem' | 'ItemAndDescendants';
}
```

## Fetch layer

Extend the GraphQL query inside `fetchTreeChildren` in `src/lib/rift/api-client.ts`:

```graphql
query GetChildren($path: String!) {
  item(where: { path: $path }) {
    children {
      nodes {
        itemId name path hasChildren
        template { name }
        updated: field(name: "__Updated") { value }
      }
    }
  }
}
```

Parse the new field into `TreeNode.updated`. If the field is missing or empty, leave `updated` undefined. No separate endpoint, no extra round-trips.

`zipDualTreeChildren` computes `diff` at pair time. For every paired `DualTreeNode` where `source` and `target` are both defined:

- If both `source.updated` and `target.updated` are strings and equal → `diff = 'match'`.
- If both are strings and differ → `diff = 'different'`.
- If either is undefined or empty → `diff` stays undefined.

`fetchDualTreeChildren` does not change — it already delegates pairing to `zipDualTreeChildren`.

## Rendering

### Diff indicator

In `TargetCell` (inside `src/components/rift/RiftContentTree.tsx`), render a small amber dot before the icon when `node.diff === 'different'`:

```tsx
{node.diff === 'different' && (
  <span
    className="text-amber-500 shrink-0 text-[10px] leading-none"
    aria-label="differs from source"
    title="Target differs from source"
  >
    {'\u25CF'}
  </span>
)}
```

Amber is chosen because:
- Red reads as error/missing, which is already occupied by ghost slots.
- The folder icons are already a gold tone — amber at 500 weight is distinct.
- Amber is a common convention for "drift" / "needs attention".

The dot renders only inside `TargetCell`, only when both `node.source` and `node.target` are present (guaranteed by the `diff` field only being set in that case), and only when `targetContextId !== null` (enforced by `TargetCell`'s existing three-state logic — the dot is inside the real-target branch).

### Column divider

Two small visual changes:

1. Per-row divider (used in both `TreeNodeRow` and `renderFilteredBranch`): `bg-border` → `bg-muted-foreground/20`. Same width (`w-px`), same height (`h-6`).
2. Column-headers divider (currently `w-px h-4 bg-border/50`): → `w-px h-4 bg-muted-foreground/20` for visual continuity with the row dividers.

No container box around the halves. The effect is a thin vertical guide running the length of the tree.

### Scope cleanup

Three places need changes:
- `src/lib/rift/types.ts` — drop `'ItemAndChildren'` from `MigrationPath.scope`.
- `src/components/rift/RiftSelectionPanel.tsx` — remove the `{ label: 'Item + Children', value: 'ItemAndChildren' }` entry from `scopeValues`.
- `src/components/rift/RiftMigrate.tsx` — remove the `scope === 'ItemAndChildren'` branch from the `inheritedPaths` memo.

No localStorage migration. Old presets containing `'ItemAndChildren'` will be deleted by users manually.

## Edge cases

| Situation | Behavior |
|-----------|----------|
| Target env not selected | `diff` stays undefined; no dot renders. `TargetCell` renders em-dash as in v1. |
| Source-only row (target ghost) | `diff` is undefined; no dot. Ghost already communicates the asymmetry. |
| Target-only row (source ghost) | `diff` is undefined; no dot. Target cell renders normally, but nothing to compare against. |
| `__Updated` field unreadable on one side | Treat as undefined; no dot. Never assume "different" from a missing field (false positive risk). |
| Timestamp strings identical | `'match'` — no dot. |
| Timestamp strings differ | `'different'` — dot renders. |
| Refresh button | Re-fetches, recomputes diff automatically. |
| Target env change | Existing cache invalidation from v1 handles this; new diff is computed for every row on reload. |
| Preset load with `'ItemAndChildren'` scope | Type-wise invalid, ignored by the scope dropdown. User re-selects. No runtime error. |

## Testing

**Unit tests (`api-client.test.ts`):**
- `zipDualTreeChildren` sets `diff: 'match'` when both sides present and `updated` strings equal.
- `zipDualTreeChildren` sets `diff: 'different'` when both sides present and `updated` strings differ.
- `zipDualTreeChildren` leaves `diff` undefined when either side is absent, or either `updated` is undefined.
- `fetchTreeChildren` maps the GraphQL `updated` field onto `TreeNode.updated`.

**Regression:**
- All existing v1 tests stay green (both-match, source-only, target-only, null target, reject paths).

**Component tests:** still out of scope — no RTL setup in the repo.

## v3 hook-in point

v3 introduces an on-demand "Compare" action per paired row. Clicking it calls `fetchItemFields` for both `source.itemId` and `target.itemId`, diffs at the field level, and surfaces the result (popover, side panel, or modal — design TBD in v3).

v2 doesn't block v3:
- `DualTreeNode` already carries both `source` and `target` TreeNodes.
- `fetchItemFields` already exists in `api-client.ts`.
- The amber dot from v2 can coexist with a "Compare" button — v3 can add the button in `TargetCell` only when `node.diff === 'different'`, so it's surfaced exactly where the user expects to act on it.
