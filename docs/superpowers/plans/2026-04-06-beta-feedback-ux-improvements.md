# Beta Feedback UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 5 UX improvements from Antony's beta feedback: draggable splitter, clearer completion messages, progressive tree preloading, tree refresh button, and failure reporting.

**Architecture:** All changes are in the existing Next.js SPA. Tasks 1-2 modify server-side migration route for better error messages. Tasks 3-5 modify client-side React components for UI improvements. No new dependencies needed — splitter uses native mouse events, preloading uses existing fetch infrastructure.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 4, Vitest

---

### Task 1: Clearer Migration Complete Message (Server-Side)

**Files:**
- Modify: `src/app/api/rift/migrate/route.ts:942-966`

The server-side `complete` message currently reads `"X operations (summary)."` We need it to list operation counts directly with failed always shown.

- [ ] **Step 1: Update `buildStatsSummary` to always include failed count**

In `src/app/api/rift/migrate/route.ts`, replace the `buildStatsSummary` call and message construction at lines 942-966:

```typescript
// Replace lines 942-966 with:
const statParts: string[] = [];
if (totalCreated > 0) statParts.push(`${totalCreated} created`);
if (totalUpdated > 0) statParts.push(`${totalUpdated} updated`);
if (totalMoved > 0) statParts.push(`${totalMoved} moved`);
if (totalRenamed > 0) statParts.push(`${totalRenamed} renamed`);
if (totalRecycled > 0) statParts.push(`${totalRecycled} recycled`);
statParts.push(`${totalFailed} failed`);

const statsMessage = statParts.join(', ');
const message = totalSucceeded === 0 && totalFailed > 0
  ? `Migration failed: ${statsMessage}.`
  : statParts.length === 1 && totalFailed === 0
    ? 'Migration complete: no changes needed.'
    : `Migration complete: ${statsMessage}.`;

send({
  type: 'complete',
  totalItems: totalPulled,
  created: totalCreated,
  updated: totalUpdated,
  moved: totalMoved,
  renamed: totalRenamed,
  recycled: totalRecycled,
  skipped: totalSkipped,
  succeeded: totalSucceeded,
  failed: totalFailed,
  pushed: totalSucceeded,
  message,
});
```

Note: `buildStatsSummary` is no longer called here. If it has no other callers, it can be removed. Check first — it is also NOT used elsewhere in the file so it can be deleted.

- [ ] **Step 2: Verify the dev server starts without errors**

Run: `npm run dev` — check for TypeScript compilation errors. Navigate to the app and confirm it loads.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/rift/migrate/route.ts
git commit -m "feat: clearer migration complete message format (server-side)"
```

---

### Task 2: Clearer Migration Complete Message (Client-Side)

**Files:**
- Modify: `src/components/rift/RiftMigrate.tsx:708-729`

The client-side aggregates per-path `complete` messages into a final summary. Update to match the new format.

- [ ] **Step 1: Update the client-side final summary message builder**

In `src/components/rift/RiftMigrate.tsx`, replace lines 708-729 (the `// Final summary` block):

```typescript
// Final summary
const completeMsgs = localMessages.filter((m) => m.type === 'complete');
const totalFailed = completeMsgs.reduce((s, m) => s + ((m.failed as number) || 0), 0);
const totalCreated = completeMsgs.reduce((s, m) => s + ((m.created as number) || 0), 0);
const totalUpdated = completeMsgs.reduce((s, m) => s + ((m.updated as number) || 0), 0);
const totalMoved = completeMsgs.reduce((s, m) => s + ((m.moved as number) || 0), 0);
const totalRenamed = completeMsgs.reduce((s, m) => s + ((m.renamed as number) || 0), 0);
const totalRecycled = completeMsgs.reduce((s, m) => s + ((m.recycled as number) || 0), 0);
const totalItems = completeMsgs.reduce((s, m) => s + ((m.totalItems as number) || 0), 0);
const totalSucceeded = completeMsgs.reduce((s, m) => s + ((m.succeeded as number) || 0), 0);
const hasErrors = localMessages.some((m) => m.type === 'error');

const statParts: string[] = [];
if (totalCreated > 0) statParts.push(`${totalCreated} created`);
if (totalUpdated > 0) statParts.push(`${totalUpdated} updated`);
if (totalMoved > 0) statParts.push(`${totalMoved} moved`);
if (totalRenamed > 0) statParts.push(`${totalRenamed} renamed`);
if (totalRecycled > 0) statParts.push(`${totalRecycled} recycled`);
statParts.push(`${totalFailed} failed`);

const statsMessage = statParts.join(', ');

addMsg({
  type: 'complete',
  totalItems,
  created: totalCreated,
  updated: totalUpdated,
  moved: totalMoved,
  renamed: totalRenamed,
  recycled: totalRecycled,
  succeeded: totalSucceeded,
  failed: totalFailed,
  pushed: totalSucceeded,
  message: hasErrors && totalSucceeded === 0
    ? `Migration failed: ${statsMessage}.`
    : statParts.length === 1 && totalFailed === 0
      ? 'Migration complete: no changes needed.'
      : `Migration complete: ${statsMessage}.`,
});
```

- [ ] **Step 2: Verify the dev server compiles and the message format looks correct**

Run: `npm run dev` — confirm no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/rift/RiftMigrate.tsx
git commit -m "feat: clearer migration complete message format (client-side)"
```

---

### Task 3: Failure Reporting — Server-Side Item Failure Messages

**Files:**
- Modify: `src/app/api/rift/migrate/route.ts:618-627,651-657`

Currently, individual item failures emit `type: 'warning'` with a 200-char truncated message. We need to:
1. Emit a new `type: 'item-failure'` message with structured data (path, operation, full reason)
2. Remove the 200-char truncation
3. Keep the existing `warning` message for backward compat in the log

- [ ] **Step 1: Update failure handling in the main batch loop**

In `src/app/api/rift/migrate/route.ts`, find the failure handling at lines 618-627. Replace:

```typescript
// Old (lines 623-626):
          } else {
            failed++;
            send({ type: 'warning', message: `Failed: ${r.name}: ${errorMsg.substring(0, 200)}` });
          }
```

With:

```typescript
          } else {
            failed++;
            send({ type: 'warning', message: `Failed: ${r.name}: ${errorMsg}` });
            send({
              type: 'item-failure',
              itemName: r.name,
              operation: activeCommands[ri]?.isCreate ? 'CREATE' : 'UPDATE',
              reason: errorMsg,
            });
          }
```

- [ ] **Step 2: Update failure handling in the retry loop**

Find the retry failure handling at lines 651-657. Replace:

```typescript
// Old (lines 654-657):
              failed++;
              const errorMsg = r.messages?.map((m) => m.message).join('; ') ?? 'Unknown error';
              send({ type: 'warning', message: `Failed (retry): ${r.name}: ${errorMsg.substring(0, 200)}` });
```

With:

```typescript
              failed++;
              const errorMsg = r.messages?.map((m) => m.message).join('; ') ?? 'Unknown error';
              send({ type: 'warning', message: `Failed (retry): ${r.name}: ${errorMsg}` });
              send({
                type: 'item-failure',
                itemName: r.name,
                operation: 'UPDATE',
                reason: errorMsg,
              });
```

- [ ] **Step 3: Verify dev server compiles**

Run: `npm run dev` — confirm no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/rift/migrate/route.ts
git commit -m "feat: emit structured item-failure messages with full error detail"
```

---

### Task 4: Failure Reporting — Client-Side Failures Section

**Files:**
- Modify: `src/components/rift/RiftProgressOverlay.tsx`

Add a collapsible "Failures" section between the progress section and the details log. Shows when there are `item-failure` messages. Includes a "Copy Failures" button.

- [ ] **Step 1: Add failures computation in the component**

In `src/components/rift/RiftProgressOverlay.tsx`, add a `useMemo` for extracting failure messages after the existing `pathStatuses` useMemo (after line 135):

```typescript
const failures = useMemo(() => {
  return messages
    .filter((m) => m.type === 'item-failure')
    .map((m) => ({
      itemName: m.itemName as string,
      operation: m.operation as string,
      reason: m.reason as string,
    }));
}, [messages]);
```

- [ ] **Step 2: Add state for failures section and copy button**

After the existing `copyLabel` state (line 39), add:

```typescript
const [failuresOpen, setFailuresOpen] = useState(false);
const [copyFailuresLabel, setCopyFailuresLabel] = useState('Copy Failures');
```

- [ ] **Step 3: Add the Failures section JSX**

In the JSX, between the progress section closing `</div>` (after line 287) and the collapsible details `<div className="shrink-0">` (line 290), add:

```tsx
{/* Collapsible failures section */}
{failures.length > 0 && (
  <div className="shrink-0 border-b border-border">
    <button
      onClick={() => setFailuresOpen((prev) => !prev)}
      className="w-full px-4 py-1.5 text-xs font-medium text-destructive hover:text-red-400 text-left flex items-center gap-1 cursor-pointer"
    >
      <span className="inline-block transition-transform" style={{ transform: failuresOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
        {'\u25B6'}
      </span>
      Failures ({failures.length} items)
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto text-xs h-5 px-2"
        onClick={async (e) => {
          e.stopPropagation();
          const lines = failures.map((f) =>
            `${f.itemName} [${f.operation}] — ${f.reason}`
          );
          const content = [
            `Rift Migration Failures — ${new Date().toLocaleString()}`,
            `Total: ${failures.length} items`,
            '---',
            ...lines,
          ].join('\n');

          try {
            await navigator.clipboard.writeText(content);
            setCopyFailuresLabel('Copied!');
            setTimeout(() => setCopyFailuresLabel('Copy Failures'), 2000);
          } catch {
            const w = window.open('', '_blank');
            if (w) {
              w.document.write(`<pre>${content.replace(/</g, '&lt;')}</pre>`);
              w.document.close();
            }
          }
        }}
      >
        {copyFailuresLabel}
      </Button>
    </button>
    {failuresOpen && (
      <div className="px-4 py-2 max-h-40 overflow-y-auto font-mono text-xs space-y-0.5">
        {failures.map((f, i) => (
          <div key={i} className="text-destructive">
            <span className="text-muted-foreground mr-1">[{f.operation}]</span>
            <span className="font-medium">{f.itemName}</span>
            <span className="text-destructive/80"> — {f.reason}</span>
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 4: Verify dev server compiles and the failures section renders**

Run: `npm run dev` — confirm no errors. The failures section won't appear unless there are actual failures during migration, which is expected.

- [ ] **Step 5: Commit**

```bash
git add src/components/rift/RiftProgressOverlay.tsx
git commit -m "feat: add collapsible failures section with copy button in progress overlay"
```

---

### Task 5: Draggable Splitter — Replace Overlay with Split Panel

**Files:**
- Modify: `src/components/rift/RiftProgressOverlay.tsx`
- Modify: `src/components/rift/RiftMigrate.tsx:856-899`

Convert the progress overlay from `absolute bottom-0` positioning to a flex child with a draggable splitter between the tree area and the progress panel.

- [ ] **Step 1: Remove absolute positioning from RiftProgressOverlay**

In `src/components/rift/RiftProgressOverlay.tsx`, change the root container at line 152 from:

```tsx
<div className="absolute bottom-0 left-0 right-0 bg-card border-t border-border shadow-lg z-10 flex flex-col max-h-[60%]">
```

To:

```tsx
<div className="bg-card border-t border-border shadow-lg flex flex-col min-h-0 overflow-hidden">
```

The parent will now control sizing via flex layout.

- [ ] **Step 2: Update RiftMigrate layout to use flex column with splitter**

In `src/components/rift/RiftMigrate.tsx`, replace the two-panel layout section (lines 856-899). The current structure is:

```tsx
{/* Two-panel layout */}
<div className="flex flex-1 min-h-0 relative">
  {/* Left panel — content tree */}
  <div className="flex-1 border-r border-border p-4 overflow-y-auto">
    ...tree...
  </div>
  {/* Right panel — selected paths */}
  <div className="w-[300px] p-4 bg-card overflow-y-auto">
    ...selection...
  </div>
  {/* Migration progress overlay */}
  {(isMigrating || migrationComplete) && (
    <RiftProgressOverlay ... />
  )}
</div>
```

Replace with:

```tsx
{/* Main content area with optional bottom splitter */}
<div className="flex flex-col flex-1 min-h-0">
  {/* Two-panel layout (tree + selection) */}
  <div
    className="flex min-h-0 overflow-hidden"
    style={{
      flex: (isMigrating || migrationComplete) ? `0 0 ${splitPercent}%` : '1 1 auto',
    }}
  >
    {/* Left panel — content tree */}
    <div className="flex-1 border-r border-border p-4 overflow-y-auto">
      {accessToken && selectedSiteRootPath && selectedEnvId ? (
        <RiftContentTree
          cmUrl={environments.find((e) => e.id === selectedEnvId)?.cmUrl ?? ''}
          accessToken={accessToken}
          rootPath={selectedSiteRootPath}
          selectedPaths={selectedPaths}
          onTogglePath={handleTogglePath}
          inheritedPaths={inheritedPaths}
          onChildrenLoaded={handleChildrenLoaded}
        />
      ) : (
        <div className="text-sm text-muted-foreground">
          Select a site to browse the content tree
        </div>
      )}
    </div>

    {/* Right panel — selected paths */}
    <div className="w-[300px] p-4 bg-card overflow-y-auto">
      <RiftSelectionPanel
        selectedPaths={selectedPaths}
        onRemovePath={handleRemovePath}
        onChangeScope={handleChangeScope}
        onClearAll={() => setSelectedPaths([])}
      />
    </div>
  </div>

  {/* Draggable splitter + Migration progress */}
  {(isMigrating || migrationComplete) && (
    <>
      {/* Splitter handle */}
      <div
        onMouseDown={handleSplitterMouseDown}
        className="h-1.5 bg-border hover:bg-primary/40 cursor-row-resize flex items-center justify-center shrink-0 transition-colors"
      >
        <div className="w-8 h-0.5 bg-muted-foreground/40 rounded-full" />
      </div>

      {/* Progress panel */}
      <div className="min-h-0" style={{ flex: `0 0 ${100 - splitPercent}%` }}>
        <RiftProgressOverlay
          isActive={isMigrating}
          messages={migrationMessages}
          parallelPaths={parallelPaths}
          onCancel={() => setShowCancelConfirm(true)}
          onClose={() => {
            setMigrationComplete(false);
            setMigrationMessages([]);
          }}
        />
      </div>
    </>
  )}
</div>
```

- [ ] **Step 3: Add splitter state and drag handlers to RiftMigrate**

In `src/components/rift/RiftMigrate.tsx`, add the following state and handlers near the other state declarations (after the existing state variables around line 50):

```typescript
const [splitPercent, setSplitPercent] = useState(60);
const splitterContainerRef = useRef<HTMLDivElement>(null);
```

Update the outer `<div className="flex flex-col flex-1 min-h-0">` to add the ref:

```tsx
<div ref={splitterContainerRef} className="flex flex-col flex-1 min-h-0">
```

Add the drag handler near the other handlers:

```typescript
const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
  e.preventDefault();
  const container = splitterContainerRef.current;
  if (!container) return;

  const onMouseMove = (moveEvent: MouseEvent) => {
    const rect = container.getBoundingClientRect();
    const y = moveEvent.clientY - rect.top;
    const pct = Math.min(80, Math.max(20, (y / rect.height) * 100));
    setSplitPercent(pct);
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}, []);
```

- [ ] **Step 4: Reset split percent when migration completes or is dismissed**

In the `onClose` callback for RiftProgressOverlay, also reset the split:

```typescript
onClose={() => {
  setMigrationComplete(false);
  setMigrationMessages([]);
  setSplitPercent(60);
}}
```

- [ ] **Step 5: Verify dev server compiles and test the splitter**

Run: `npm run dev` — confirm the layout switches to split mode during migration, and the divider is draggable between tree and logs.

- [ ] **Step 6: Commit**

```bash
git add src/components/rift/RiftProgressOverlay.tsx src/components/rift/RiftMigrate.tsx
git commit -m "feat: replace bottom overlay with draggable splitter for tree vs logs"
```

---

### Task 6: Progressive Tree Preloading

**Files:**
- Modify: `src/components/rift/RiftContentTree.tsx`

Add "one level ahead" background preloading. When a node's children are loaded, queue background fetches for each child with `hasChildren: true`.

- [ ] **Step 1: Add prefetch queue state and processing logic**

In `src/components/rift/RiftContentTree.tsx`, add prefetch infrastructure after the existing state declarations (after line 148):

```typescript
const prefetchQueueRef = useRef<string[]>([]);
const prefetchActiveRef = useRef(0);
const MAX_PREFETCH_CONCURRENT = 2;
```

Add the prefetch processor function after the `childrenCacheRef` setup (after line 158):

```typescript
const processPrefetchQueue = useCallback(async () => {
  while (
    prefetchQueueRef.current.length > 0 &&
    prefetchActiveRef.current < MAX_PREFETCH_CONCURRENT
  ) {
    const path = prefetchQueueRef.current.shift();
    if (!path || childrenCacheRef.current.has(path)) continue;

    prefetchActiveRef.current++;
    try {
      const children = await fetchTreeChildren(cmUrl, accessToken, path);
      setChildrenCache((prev) => {
        if (prev.has(path)) return prev;
        const next = new Map(prev);
        next.set(path, children);
        return next;
      });
      onChildrenLoadedRef.current?.(path, children);
    } catch {
      // Silent — prefetch failures are not user-facing
    } finally {
      prefetchActiveRef.current--;
      // Continue processing queue
      processPrefetchQueue();
    }
  }
}, [cmUrl, accessToken]);

const enqueuePrefetch = useCallback((children: TreeNode[]) => {
  const toFetch = children
    .filter((c) => c.hasChildren && !childrenCacheRef.current.has(c.path))
    .map((c) => c.path);
  if (toFetch.length === 0) return;
  prefetchQueueRef.current.push(...toFetch);
  processPrefetchQueue();
}, [processPrefetchQueue]);
```

- [ ] **Step 2: Trigger prefetch after initial tree load**

In the `loadTrees` async function inside the mount `useEffect` (around line 222), add prefetch calls after children are loaded. After the content tree's site children are fetched (after line 263, the `newCache.set(currentPath, siteChildren)` line), add:

```typescript
// Queue prefetch for site children's children
const childrenToPreload = siteChildren.filter((c) => c.hasChildren);
for (const child of childrenToPreload) {
  if (!newCache.has(child.path)) {
    prefetchQueueRef.current.push(child.path);
  }
}
```

After the `setIsLoading(false)` call at line 306, add:

```typescript
processPrefetchQueue();
```

Note: Add `processPrefetchQueue` to the dependency array won't be needed since it's inside the effect that runs on mount. Since `processPrefetchQueue` is a ref-heavy callback, we call it directly.

- [ ] **Step 3: Trigger prefetch after manual node expansion**

In the `handleExpand` callback (around line 354), after children are fetched and cached (after line 376), add:

```typescript
enqueuePrefetch(children);
```

So the try block becomes:

```typescript
try {
  const children = await fetchTreeChildren(cmUrl, accessToken, node.path);
  setChildrenCache((prev) => new Map(prev).set(node.path, children));
  onChildrenLoadedRef.current?.(node.path, children);
  enqueuePrefetch(children);
} catch {
```

- [ ] **Step 4: Clear prefetch queue on tree reset**

In the mount `useEffect` cleanup (line 315-317) and at the start of `loadTrees`, clear the queue. At line 220 (after `setIsLoading(true)`), add:

```typescript
prefetchQueueRef.current = [];
prefetchActiveRef.current = 0;
```

- [ ] **Step 5: Verify dev server compiles and test preloading**

Run: `npm run dev` — expand a node, then expand its children. The second expansion should be instant (cached from prefetch). Check the browser Network tab to confirm background fetches are happening.

- [ ] **Step 6: Commit**

```bash
git add src/components/rift/RiftContentTree.tsx
git commit -m "feat: progressive one-level-ahead tree preloading"
```

---

### Task 7: Tree Refresh Button

**Files:**
- Modify: `src/components/rift/RiftContentTree.tsx:482-495`
- Modify: `src/components/rift/RiftMigrate.tsx` (pass `isMigrating` prop)

Add a refresh icon button next to the "Show hidden items" checkbox.

- [ ] **Step 1: Add `onRefresh` and `disabled` props to RiftContentTree**

In `src/components/rift/RiftContentTree.tsx`, update the `RiftContentTreeProps` interface (line 125):

```typescript
interface RiftContentTreeProps {
  cmUrl: string;
  accessToken: string;
  rootPath: string;
  selectedPaths: MigrationPath[];
  onTogglePath: (node: TreeNode) => void;
  inheritedPaths: Set<string>;
  onChildrenLoaded?: (parentPath: string, children: TreeNode[]) => void;
  disabled?: boolean;
}
```

Update the destructuring at line 135 to include `disabled`:

```typescript
export function RiftContentTree({
  cmUrl,
  accessToken,
  rootPath,
  selectedPaths,
  onTogglePath,
  inheritedPaths,
  onChildrenLoaded,
  disabled,
}: RiftContentTreeProps) {
```

- [ ] **Step 2: Add a refreshKey state and refresh handler**

Add state for triggering refresh (after line 148):

```typescript
const [refreshKey, setRefreshKey] = useState(0);
```

Add the refresh key to the `useEffect` dependency array at line 319. Change:

```typescript
}, [cmUrl, accessToken, rootPath]);
```

To:

```typescript
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [cmUrl, accessToken, rootPath, refreshKey]);
```

Remove the duplicate eslint-disable comment if present (line 318).

- [ ] **Step 3: Add the refresh button to the header**

In the header section (lines 484-495), update to include a refresh button:

```tsx
<div className="flex justify-between items-center mb-3">
  <div className="text-xs font-semibold text-muted-foreground">
    CONTENT TREE
  </div>
  <div className="flex items-center gap-3">
    <button
      onClick={() => setRefreshKey((k) => k + 1)}
      disabled={disabled || isLoading}
      className={cn(
        'text-muted-foreground hover:text-foreground transition-colors',
        (disabled || isLoading) && 'opacity-40 pointer-events-none'
      )}
      title="Refresh tree"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
        <path d="M16 21h5v-5" />
      </svg>
    </button>
    <label className="text-sm text-muted-foreground flex items-center gap-2 cursor-pointer">
      <Checkbox
        checked={showHiddenItems}
        onCheckedChange={(checked) => setShowHiddenItems(checked === true)}
      />
      Show hidden items
    </label>
  </div>
</div>
```

- [ ] **Step 4: Pass `disabled` prop from RiftMigrate**

In `src/components/rift/RiftMigrate.tsx`, update the `RiftContentTree` usage (around line 861) to pass `disabled`:

```tsx
<RiftContentTree
  cmUrl={environments.find((e) => e.id === selectedEnvId)?.cmUrl ?? ''}
  accessToken={accessToken}
  rootPath={selectedSiteRootPath}
  selectedPaths={selectedPaths}
  onTogglePath={handleTogglePath}
  inheritedPaths={inheritedPaths}
  onChildrenLoaded={handleChildrenLoaded}
  disabled={isMigrating}
/>
```

- [ ] **Step 5: Verify dev server compiles and test the refresh button**

Run: `npm run dev` — confirm the refresh icon appears, clicking it reloads the tree, and it's disabled during migration.

- [ ] **Step 6: Commit**

```bash
git add src/components/rift/RiftContentTree.tsx src/components/rift/RiftMigrate.tsx
git commit -m "feat: add tree refresh button with circular arrow icon"
```
