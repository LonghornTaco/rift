# Dual Tree View Design

**Date:** 2026-04-19
**Component:** `RiftContentTree` (with knock-on changes to `RiftMigrate`, `types.ts`, `api-client.ts`)
**Status:** Draft — ready for implementation planning

## Motivation

Today, `RiftContentTree` shows only the source environment's content/media trees. Users picking paths to migrate have no visibility into what already exists on the target. They cannot tell at a glance:

- Whether a site exists on target at all
- Whether specific items they're about to copy already exist on target
- Whether there is content on target that originated elsewhere

The goal is to render a second, paired tree of the target environment alongside the source, with the two views aligned row-by-row. A future iteration (v2) will add field-level diff indicators for items present on both sides.

## Scope

**In scope (v1):**
- Render source and target trees side-by-side as paired rows
- Single, shared expand/collapse state — arrow drives both sides
- Ghost placeholders (dashed, hatched) for items missing on either side
- Checkboxes remain on the source side only
- Behavior identical to today for content tree and media library tree

**Out of scope (v1):**
- Field-level or modification-time diffs between paired items (v2)
- Target-site remapping (target assumed to use the same root path as source)
- Rename detection / matching by item GUID across envs

## Requirements

1. Both trees render side-by-side in a single scroll container; rows align horizontally by path.
2. Expanding or collapsing any node affects both trees together.
3. Only source rows carry checkboxes. Target-only rows have no checkbox and cannot be selected for migration.
4. When an item exists on one side but not the other, the absent side renders a ghost slot (dashed border, hatched fill) at the same row height and indent as a real row.
5. When no target environment is selected, every target cell is a muted placeholder. Layout stays stable — the target column does not collapse or disappear.
6. Applied across both the content tree and the media library tree.

## Layout

The containing layout in `RiftMigrate` does not change: the content-tree area on the left, the selection panel on the right. All changes are internal to `RiftContentTree`, which now renders both source and target within its existing area.

Each row is a single flex container:

```
[indent] [arrow] [ source cell ][ divider ][ target cell ]
```

- **Indent**: shared; both cells render at the same depth.
- **Arrow**: one per row, at the start; toggles the shared expansion state.
- **Source cell**: checkbox, icon, name (or ghost slot if source is absent).
- **Divider**: thin vertical line separating the two halves.
- **Target cell**: icon, name only (or ghost slot if target is absent, or placeholder if no target env selected).
- **Row height**: always identical across the two cells, regardless of which side is real vs. ghost.

## Data model

New type in `src/lib/rift/types.ts`:

```ts
interface DualTreeNode {
  path: string;           // shared identity key
  name: string;           // from source if present, else target
  hasChildren: boolean;   // true if either side has children
  source?: TreeNode;      // undefined = not on source
  target?: TreeNode;      // undefined = not on target
}
```

Matching uses `path` as the identity key. Items renamed on the target surface as two separate rows (one source-only, one target-only). This is acceptable for v1 — renames are rare in content-migration workflows.

## Fetch layer

New function in `src/lib/rift/api-client.ts`:

```ts
async function fetchDualTreeChildren(
  client: ClientSDK,
  sourceContextId: string,
  targetContextId: string | null,
  parentPath: string,
): Promise<DualTreeNode[]>
```

Behavior:

- Calls the existing single-env `fetchTreeChildren` against both context IDs in parallel using `Promise.allSettled`.
- When `targetContextId` is `null`, skips the target fetch entirely; every returned pair has `target: undefined`.
- When the target fetch rejects (e.g. site doesn't exist at that path on target), treats target children as an empty list; pairs still render with `target: undefined`.
- Zips children by path: walks source children in source order, attaches a target child when one with the same path exists. Any target-only children are appended in target order at the end.
- `hasChildren` is the OR of both sides.

The single-env `fetchTreeChildren` is not modified.

## Component structure

`RiftContentTree.tsx` updates:

- Replace `childrenCache: Map<string, TreeNode[]>` with `Map<string, DualTreeNode[]>`, still keyed by parent path.
- `expandedNodes: Set<string>` is keyed by **path** instead of itemId (allowing target-only rows to participate in expansion state).
- New `targetContextId: string | null` prop, passed from `RiftMigrate`.
- New internal `DualTreeRow` component renders the paired row.
- New internal `SourceCell` / `TargetCell` components render each half, including ghost-slot and "no target env" placeholder states.
- `handleExpand` calls `fetchDualTreeChildren` instead of `fetchTreeChildren`.
- Prefetch queue mechanism unchanged — just feeds into the dual fetcher.
- Filtering (`getVisibleChildPaths`, `show hidden items`) remains path-keyed and applies to the paired row — hiding a path removes both halves at once.
- Locked-ancestor disabled state applies only to the source cell (matches today's behavior).

Cache invalidation on target-env change is treated as a full refresh: clear the cache, clear expansion state, re-run the initial-load effect.

## No-target-env state

When `targetContextId === null`:

- Every target cell renders a muted em-dash placeholder at the correct row height.
- A single hint banner above the tree reads "Select a target environment to populate →".
- Source side is fully interactive — users can browse and select paths without committing to a target.

This placeholder is visually distinct from a ghost slot. A ghost (dashed border, hatched fill) says "this item doesn't exist on target." A placeholder (muted em-dash) says "we haven't asked target yet."

## Edge cases

| Situation | Behavior |
|-----------|----------|
| Target env picked, site path missing on target | Every target cell is a ghost. No banner. |
| Source fetch fails | Row fails to expand (existing behavior). |
| Target fetch fails for one node | Source renders normally; that node's target children render as ghosts. Logged silently. |
| Target env changed mid-session | Full cache invalidation and refresh. |
| Target-only row | No checkbox. Source cell is a ghost. |
| Paired node where only one side has children | Arrow renders. Expanding shows real children on the side that has them, ghost children on the other. |
| Refresh button | Clears the dual cache, re-fetches both sides. |
| Loaded preset | Same `refreshKey` flow as today. |

## Testing

**Unit (`api-client`):**
- `fetchDualTreeChildren` with four fixtures — source-only children, target-only children, both match, both differ.
- Target-context-null case (no target fetch attempted).
- Target-fetch-rejects case (graceful degradation to ghosts).

**Component (`RiftContentTree`):**
- Snapshot/RTL coverage for each ghost state: no target env, target-only row, source-only row, both-present row.
- Checkbox renders only on source cells; target cells never carry a checkbox.
- Expanding a paired node triggers exactly one `fetchDualTreeChildren` call.
- Collapsing preserves the cached `DualTreeNode[]`.

**Regression:**
- Existing source-only interactions remain green: locked-ancestor disable, show-hidden-items toggle, preset load, refresh.

## v2 hook-in point

v2 will add per-row match/diff indicators. `DualTreeNode` gains one optional field:

```ts
diff?: 'match' | 'different';
```

Populated by `fetchDualTreeChildren` (or a follow-up call) when both `source` and `target` are present. `TargetCell` reads the field and renders a subtle badge (or leaves the row unstyled when `'match'`). No refactor needed — the data model already holds both halves.
