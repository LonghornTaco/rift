# Dual Tree Field-Diff Panel Design (v3)

**Date:** 2026-04-20
**Component:** new `RiftCompareView` + modifications to `RiftContentTree` and `RiftMigrate`
**Status:** Draft — ready for implementation planning
**Builds on:**
- `2026-04-19-dual-tree-view-design.md` (v1 — paired source/target tree)
- `2026-04-20-dual-tree-diff-design.md` (v2 — timestamp drift indicator)

## Motivation

v2 tells the user *that* two items differ (via the amber tint when `__Updated` diverges). v3 tells them *what* differs — a field-level comparison panel that opens when the user clicks a tree item. No API heroics required: the existing `fetchItemFields` helper already returns the data we need.

Also bundled: a small visual polish — fill the Lucide folder/file icons on both sides with green (match) or amber (different), so at-a-glance drift reading is even stronger.

## Scope

**In scope (v3):**
- Click an item's icon or name (not the checkbox, not the expand arrow) → bottom panel opens inside the tree column showing a field-level comparison.
- Panel spans only the tree-column width (not the whole layout).
- Three-column table (Field | Source value | Target value) for paired rows; two-column table (Field | Value) for one-sided rows.
- "Show all fields" checkbox — off by default (only fields with differences); on = all own fields.
- "Show standard fields" checkbox — off by default; on = lazy-fetch and include Sitecore standard fields (`__Updated`, `__Revision`, etc.).
- Close via: click same item again, X button in panel header, or Escape key.
- Drag-handle splitter above the panel, resizable height; panel body scrolls vertically.
- Field values wrap within their cell.
- Green/amber fill on source AND target folder icons reflecting `diff` state.

**Out of scope (v3.1+):**
- Copy field-name / copy-value affordances per row.
- Per-field "overwrite target with source" action.
- Field-level history / author info.

## Requirements

1. Clicking the icon or name of any tree row opens the compare panel for that row. The checkbox and expand-arrow keep their current behaviors.
2. The compare panel sits at the bottom of the tree column and only spans the tree column's width. The selection panel on the right stays put.
3. When the panel is open, clicking the same tree row closes it. Clicking a different row swaps its contents.
4. The panel header shows the item's path, a "Show all fields" checkbox, a "Show standard fields" checkbox, and an X close button.
5. The panel body defaults to showing only fields with different source/target values. Toggling "Show all fields" includes all own fields.
6. Standard fields are not fetched until "Show standard fields" is toggled on; after one fetch, toggling off/on doesn't re-fetch.
7. The Escape key closes the panel from anywhere in the app.
8. The panel is vertically resizable via a drag-handle splitter. When the user drags it to near zero height, the panel closes.
9. Folder/file icons on both source and target sides render with a green fill when `diff === 'match'` and an amber fill when `diff === 'different'`. No fill when `diff` is undefined.

## Data flow

### Fetch strategy

`fetchItemFields` gains an optional `{ includeStandard?: boolean }` argument. The GraphQL query flips between:
- `includeStandard !== true`: `fields(ownFields: true, excludeStandardFields: true)` — current behavior.
- `includeStandard === true`: `fields(ownFields: false, excludeStandardFields: false)` — all fields.

Two fetches are cached per compare session, inside `RiftCompareView` state:
- On mount or when `node` changes: fetch own fields from source and target in parallel via `Promise.allSettled`. If `targetContextId` is null, only source. If the clicked row has one side missing, only fetch the side that exists.
- On first toggle of "Show standard fields" to on: fetch all-fields-including-standard from whichever sides exist; intersect with own-fields on the client to isolate just the standard-field set and store separately. Subsequent toggles don't re-fetch.

Fetch errors per-side are isolated: if source succeeds and target fails, source renders normally and target column shows "Failed to load" in place of values.

### Component state

```ts
interface CompareState {
  ownFields: { source?: Record<string,string>; target?: Record<string,string> } | null;
  standardFields: { source?: Record<string,string>; target?: Record<string,string> } | null;
  loading: boolean;
  error: string | null;
  showAllFields: boolean;       // default false
  showStandardFields: boolean;  // default false — flipping to true triggers lazy fetch
}
```

Swapping which item is shown (prop change of `node.path`) resets all state and re-fetches.

### Row computation

Extract a pure helper for testability:

```ts
interface CompareRow {
  name: string;
  source: string;
  target: string;
  isDifferent: boolean;
}

export function computeCompareRows(
  ownFields: { source?: Record<string,string>; target?: Record<string,string> } | null,
  standardFields: { source?: Record<string,string>; target?: Record<string,string> } | null,
  showAllFields: boolean,
  showStandardFields: boolean,
): CompareRow[]
```

Logic:
- Merge own + standard (when `showStandardFields`) per side.
- Compute the union of field names, sort alphabetically.
- For each name: source value (or empty), target value (or empty), `isDifferent = source !== target`.
- Missing field on one side counts as different (the values compare as `''` vs the present value).
- Filter to `isDifferent` rows unless `showAllFields` is true.

## Layout / DOM

### `RiftMigrate` changes

The current tree column:
```tsx
<div className="flex-1 border-r border-border p-4 overflow-y-auto">
  <RiftContentTree ... />
</div>
```

becomes:
```tsx
<div className="flex-1 border-r border-border flex flex-col min-h-0">
  <div className="flex-1 min-h-0 overflow-y-auto p-4">
    <RiftContentTree
      ...existing props
      onCompareItem={handleCompareItemClick}
      compareTargetPath={compareTarget?.path ?? null}
    />
  </div>
  {compareTarget && (
    <>
      <div
        onMouseDown={handleCompareSplitterMouseDown}
        className="h-1.5 bg-border hover:bg-primary/40 cursor-row-resize flex items-center justify-center shrink-0 transition-colors"
      >
        <div className="w-8 h-0.5 bg-muted-foreground/40 rounded-full" />
      </div>
      <div className="min-h-0 overflow-hidden" style={{ flex: `0 0 ${comparePercent}%` }}>
        <RiftCompareView
          client={client}
          sourceContextId={...sourceCtx}
          targetContextId={...targetCtx}
          node={compareTarget}
          onClose={() => setCompareTarget(null)}
        />
      </div>
    </>
  )}
</div>
```

New state in `RiftMigrate`:
```ts
const [compareTarget, setCompareTarget] = useState<DualTreeNode | null>(null);
const [comparePercent, setComparePercent] = useState(35);
const compareSplitterContainerRef = useRef<HTMLDivElement>(null);
```

`handleCompareItemClick(node)` toggles: if `compareTarget?.path === node.path`, clear it; else set it.

`handleCompareSplitterMouseDown` mirrors the existing `handleSplitterMouseDown` but measures against the tree column's bounding rect (not the whole splitter container). When drag drops panel below ~3% height, treat as close (`setCompareTarget(null)`).

The right-side selection panel and the existing bottom migration-progress panel are not touched.

### `RiftContentTree` changes

Two new props pushed through `TreeNodeRowProps` and both render sites (`TreeNodeRow` and `renderFilteredBranch`):

```ts
onCompareItem: (node: DualTreeNode) => void;
compareTargetPath: string | null;
```

`SourceCell` and `TargetCell` each wrap their own icon+name region in a clickable `<button>`. For a paired row this means two buttons (one per side), each calling `onCompareItem(node)` with the same `DualTreeNode`. Clicking either has the same effect. For a one-sided row, only the existing side has a button; the ghost slot remains unclickable.

```tsx
<button
  type="button"
  onClick={() => onCompareItem(node)}
  className={cn(
    'flex items-center gap-1 min-w-0 text-left rounded-sm px-1 -mx-1',
    compareTargetPath === node.path && 'bg-accent/60',
  )}
>
  <Icon className={iconClasses} />
  <span className={nameClasses}>{node.name}</span>
</button>
```

The button's hit area excludes the checkbox and the expand arrow because those render as separate siblings earlier in the row. Both cells' buttons receive the `bg-accent/60` highlight when the row is the current compare target, so the whole row reads as "active".

### Folder icon fill (bundled tweak)

`SourceCell` and `TargetCell` both build an `iconClasses` string that varies by `node.diff`:

- `node.diff === 'match'` → `'fill-emerald-500/30 stroke-emerald-500'`
- `node.diff === 'different'` → `'fill-amber-500/30 stroke-amber-500'` (plus keep the existing text tint on target for name color)
- otherwise → current classes

Lucide icons accept `fill` / `stroke` utility classes because the SVG paths inherit them. Preserve existing `opacity-40` for ancestor-disabled rows.

## Behaviors

### Click resolution

- **Expand arrow** (current `<span>` with the arrow glyph) → `onExpand(node)`, unchanged.
- **Checkbox** (current `<Checkbox>`) → `onTogglePath(node.source)`, unchanged.
- **Icon + name** (new wrapping `<button>`) → `onCompareItem(node)`.
- No stopPropagation needed — the three hit regions are siblings in the flex row, not nested.

### Close triggers

- Click current compare target again → close.
- X button in `RiftCompareView` header → calls `onClose`.
- Escape key (listener on `window`, attached when panel is open, removed when closed).
- `targetContextId` flips to null (target env deselected) while panel is open → close.
- Tree refresh button pressed → close (stale node references).
- Preset load → close.
- Splitter dragged below ~3% height → close.

### Panel header

```tsx
<div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-card shrink-0">
  <div className="flex-1 min-w-0 text-xs font-mono text-muted-foreground truncate" title={node.path}>
    {node.path}
  </div>
  <label className="text-xs flex items-center gap-1.5 cursor-pointer shrink-0">
    <Checkbox checked={showAllFields} onCheckedChange={setShowAllFields} />
    Show all fields
  </label>
  <label className="text-xs flex items-center gap-1.5 cursor-pointer shrink-0">
    <Checkbox checked={showStandardFields} onCheckedChange={setShowStandardFields} />
    Show standard fields
  </label>
  <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
    &times;
  </button>
</div>
```

### Panel body

Scrollable table (`overflow-auto` on the body container):

```tsx
<table className="w-full text-sm border-collapse">
  <thead className="sticky top-0 bg-card">
    <tr>
      <th className="text-left px-3 py-2 w-[30%] font-semibold text-muted-foreground text-xs uppercase tracking-wide">Field</th>
      {hasSource && <th className="text-left px-3 py-2 w-[35%] ...">Source</th>}
      {hasTarget && <th className="text-left px-3 py-2 w-[35%] ...">Target</th>}
    </tr>
  </thead>
  <tbody>
    {rows.map(row => (
      <tr key={row.name} className="border-t border-border align-top">
        <td className="px-3 py-2 font-mono text-xs text-muted-foreground break-words">{row.name}</td>
        {hasSource && <td className="px-3 py-2 whitespace-pre-wrap break-words">{row.source}</td>}
        {hasTarget && (
          <td className={cn(
            'px-3 py-2 whitespace-pre-wrap break-words',
            row.isDifferent && hasSource && 'bg-amber-500/10',
          )}>
            {row.target}
          </td>
        )}
      </tr>
    ))}
  </tbody>
</table>
```

`whitespace-pre-wrap break-words` satisfies the "values wrap in horizontal space" requirement — long URLs and JSON payloads stay contained.

### Loading / empty / error states

- While the initial own-fields fetch is pending: body shows centered spinner + "Loading fields...".
- If "Show standard fields" is toggled on and standard-field fetch is pending: small inline spinner after the checkbox; table keeps rendering own fields.
- Empty state (filtered rows count is zero with "Show all fields" off): body shows "No field differences" centered.
- Fetch error on both sides: body shows error text and a Retry button.
- Fetch error on one side: that side's value cells show "Failed to load" in red-ish text; the other side renders normally.

## Edge cases

| Situation | Behavior |
|-----------|----------|
| Paired row click | Two-side fetch; three-column table. |
| Source-only row click | One-side fetch (source); two-column table; "Show standard fields" still works for source; amber/diff highlighting disabled (no target to compare). |
| Target-only row click | Mirror of source-only. |
| Ancestor-disabled row click (e.g. site root `content`) | Still opens — the item is real and its fields are inspectable. |
| Click currently-open item | Close panel. |
| Click different item | Reset state, re-fetch. |
| Target env deselected while panel open | Close panel. |
| Tree refresh while panel open | Close panel. |
| Preset load while panel open | Close panel. |
| `Escape` pressed | Close panel. |
| X button | Close panel. |
| Splitter dragged below ~3% | Close panel. |
| Fetch error, one side | Per-cell "Failed to load" text on the erroring column. |
| Fetch error, both sides | Body shows error + Retry. |
| Row's icon in ancestor-disabled state | Fill still applied (if `diff` is match/different); `opacity-40` wrapper still dims the whole row including the fill. |

## Testing

- Unit test: `fetchItemFields` with `{ includeStandard: true }` sends the correct GraphQL args; default (no options) stays identical to today.
- Unit test: `computeCompareRows` across all relevant combinations — both sides match, one side missing field, showAllFields on/off, showStandardFields on/off merging correctly with own fields.
- Regression: existing `fetchItemFields` test unaffected by the new optional arg.
- Component-level tests remain out of scope (no RTL).

## v3.1 hook-in point

Future: per-row inline action buttons in the compare table (copy field name, copy value, overwrite target). The row data model already carries `name, source, target, isDifferent`; adding an action column is one more `<td>` per row and doesn't require touching the data layer.
