# Beta Feedback UX Improvements

**Date:** 2026-04-06
**Source:** Antony's beta testing feedback (Slack)
**Items:** #3, #4, #5, #6 (partial), #7

---

## #5 — Draggable Splitter (Tree vs Logs)

### Problem

After migration completes, the progress overlay covers the bottom 60% of the tree panel. Users can't see what's in the lower portion of the content tree. Collapsing log details helps but the overlay still takes significant space.

### Solution

Replace the bottom overlay with a **vertical split panel** layout. During/after migration, the main content area splits into two resizable sections:

- **Top:** Content tree + selection panel (existing two-column layout)
- **Divider:** Draggable horizontal splitter bar with grab handle
- **Bottom:** Migration progress panel (header, progress bars, collapsible log details)

### Behavior

- The splitter only appears when a migration is active or complete (same condition as current overlay)
- Default split: 60% tree / 40% logs
- User can drag the divider to resize between ~20% and ~80%
- Minimum height for each section prevents either from collapsing to zero
- When migration is dismissed, the splitter disappears and tree reclaims full height
- The splitter state does not persist between migrations
- The progress panel retains all existing functionality: header with status/colors, progress bars (single and parallel), collapsible details log, Copy Log button, Cancel/Dismiss buttons

### Implementation Approach

- Convert `RiftProgressOverlay` from `absolute bottom-0` positioning to a flex child within the parent container
- Add a splitter div between the tree area and the progress panel
- Track split position in state via mouse drag handlers (mousedown on splitter, mousemove to resize, mouseup to release)
- Both sections get `overflow-y: auto` for independent scrolling

---

## #7 — Clearer Migration Complete Message

### Problem

The current message format `"Migration complete: 0 items migrated (1 created, 0 updated)"` is confusing. The "0 items migrated" contradicts "1 created." Users don't understand what "migrated" means vs. created/updated.

### Solution

Drop the "X items migrated" wrapper. List operation counts directly, showing only non-zero operations (except always show failed):

```
Migration complete: 1 created, 0 failed.
Migration complete: 10 created, 5 updated, 2 moved, 1 renamed, 0 failed.
Migration complete: 0 created, 0 updated, 3 failed.
```

### Implementation

**Client-side** (`RiftMigrate.tsx`, lines ~708-729):
- Build message from individual operation counts: created, updated, moved, renamed, recycled, failed
- Include only non-zero counts in the message string, except `failed` which always appears
- Remove the `totalSucceeded` / "items migrated" framing

**Server-side** (`migrate/route.ts`, lines ~942-966):
- The `buildStatsSummary()` function already builds per-operation counts — reuse this
- Align the per-path complete messages with the same format
- Final aggregated message uses the same pattern

### Edge Cases

- All items unchanged (no operations): `"Migration complete: no changes needed."`
- Total failure: `"Migration failed: 3 failed."`
- Mixed: show all non-zero operation types + failed count

---

## #3 — Progressive Tree Preloading

### Problem

Tree loads 4 levels deep initially (to site level). Clicking any node under that requires a fetch, causing a noticeable delay. Users expect deeper levels to load instantly.

### Solution

**"One level ahead" background preloading.** After any node's children are loaded (either from initial load or user expansion), automatically fetch children of each child node that has `hasChildren: true` in the background.

### Behavior

- Triggered after children are rendered for any node (initial load or manual expand)
- Queues background fetches for all child nodes with `hasChildren: true`
- Concurrency limit: 2 concurrent background fetches to avoid hammering the API
- User-initiated expands (clicks) take priority — jump ahead of queued background fetches
- Results stored in existing `childrenCache` Map
- No loading indicators for background fetches — completely invisible to user
- If user expands a node before its prefetch completes, normal loading flow (with spinner) kicks in
- Background fetches use the same `fetchTreeChildren` API call

### Implementation Approach

- Add a fetch queue (array of paths to prefetch) managed alongside `childrenCache`
- After `childrenCache` is populated for a node, enqueue its `hasChildren` children
- A processing loop dequeues and fetches with concurrency control
- Skip any path already in `childrenCache`
- User expand calls check cache first, then fetch directly (bypassing queue)

---

## #4 — Tree Refresh Button

### Problem

No way to refresh tree data without re-selecting the environment or reloading the page. If items are added/modified on the source environment, users can't see updates.

### Solution

Add a **refresh button** (circular arrow icon) in the tree panel header, next to the "Show hidden items" checkbox.

### Behavior

- Click clears `childrenCache` entirely
- Re-triggers the initial tree load from site root
- Resets expansion to default site-level (clean slate, no attempt to preserve expansion state)
- Disabled while migration is in progress
- Shows brief loading state during re-fetch

---

## #6 (Partial) — Failure Reporting

### Problem

When items fail (e.g., template doesn't exist on target), the error is buried in log messages, truncated to 200 characters, and the completion summary doesn't explain *why* things failed. Template migration is intentionally not supported (templates are IAR items), but users need clear feedback about what failed and why.

### Solution

**Collapsible "Failures" section** in the progress panel, plus improved error detail.

### Server-Side Changes

- Remove the 200-character truncation on error messages in `migrate/route.ts`
- Include the full error reason from the Management API response
- For each failed item, emit a structured failure message with: item path, operation attempted (CREATE/UPDATE), and error reason
- Categorize common failure reasons: "template not found", "permission denied", "item locked", etc.

### Client-Side Changes

- Add a collapsible **"Failures"** section in `RiftProgressOverlay` between the progress section and the details log
- Section header: `"▶ Failures (N items)"` with a **"Copy Failures"** button
- Expanded view: list of failed items, one per line: `path — reason`
- Section only appears when there are failures (hidden on clean migrations)
- "Copy Failures" copies a formatted list to clipboard: path + operation + full error reason per line
- Failure section is collapsed by default, expandable by clicking the header

### Failure Message Format (Server → Client)

```json
{
  "type": "item-failure",
  "path": "/sitecore/content/Home/Page1",
  "operation": "CREATE",
  "reason": "Template ID {B3E4F2A1-...} does not exist on target environment",
  "itemId": "{...}"
}
```

### Completion Summary with Failure Grouping

When failures exist, the completion message includes a breakdown:

```
Migration complete: 8 created, 2 updated, 3 failed.
```

The failures section in the UI provides the per-item detail.
