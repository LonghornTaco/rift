# Wait For Transferred Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a path "complete" only once the target has finished writing its items (blob state `Transferred`), never read or refresh the target tree before then, and tell the user precisely when the target tree is lagging instead of painting it as data loss.

**Architecture:** `pollBlobState` becomes a state machine over the CM's `BlobState` enum with its own longer budget and reports a new `finalizing` phase; `transferPath` returns a `TransferResult` carrying any `TransferredWithErrors` warning. Pure helpers in a new `post-transfer.ts` decide run status, parent snapshots and cache-lag detection so `RiftMigrate` only wires fetches and state; the overlay renders the new phase, warnings and notices from props.

**Tech Stack:** Next.js 15 / React 19 / TypeScript strict, Vitest 4, `@sitecore-marketplace-sdk/client` 0.4.1 + `xmc` 0.4.4 (already bumped in the working tree).

**Spec:** `docs/superpowers/specs/2026-11-02-wait-for-transferred-design.md`

## Global Constraints

- No em-dashes anywhere (code, comments, copy, commits). Use `-`.
- Commit only, never push. No `Co-Authored-By` lines in commit messages. Commit subject style: `rift: <what>`.
- Blob states are the CM enum verbatim: `Unknown`, `Uploading`, `Uploaded`, `Initializing`, `Error`, `Consumed`, `Transferred`, `TransferredWithErrors`, `Discarded`, `ValidationFailed`. Plus `NotFound` and `Failed` as failures.
- Success is only `Transferred`. `Consumed` is in-progress. Unknown tokens keep polling and are shown as the phase detail.
- Nothing proportional to transfer size: the pre/post snapshot is one fetch per distinct parent of the selected roots, never per item.
- No automatic cache clear, no `cleanUpDatabases`, no saves on target items.
- Finalizing budget: poll every 3000 ms, at most 800 attempts (40 min), separate from the existing export/consume `MAX_POLL_ATTEMPTS`.
- Version bump before the final commit: `package.json` and `src/lib/version.ts` from `0.7.15` to `0.7.16`.

## Review Focus

- A future or unexpected `BlobState` token (e.g. `Validating`) must keep polling and surface as the row detail, not resolve or fail. Pinned in Task 2.
- Cancel during finalizing must stop polling immediately with an abort error and make no further `getBlobState` calls. Pinned in Task 2.
- A selected root at the top of the tree (no parent segment) must be skipped by the snapshot, not crash path math. Pinned in Task 4.
- A parent whose pre- or post-snapshot fetch failed must be silently excluded from cache-lag detection, never reported. Pinned in Task 4.
- A run where one path ends `TransferredWithErrors` and the rest succeed must record history `partial` and show "completed with warnings", not success and not failure. Pinned in Task 4.

---

### Task 1: Commit the approved design and the SDK bump

**Files:**
- Commit: `docs/superpowers/specs/2026-11-02-wait-for-transferred-design.md`, `package.json`, `package-lock.json`

**Interfaces:**
- Produces: a clean baseline commit; every later task diffs against it.

- [ ] **Step 1: Verify the tree is green before committing**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc exits 0; `4 passed (4)` files, `45 passed (45)` tests.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-11-02-wait-for-transferred-design.md package.json package-lock.json
git commit -m "rift: design for waiting on Transferred before touching the target tree; bump Marketplace SDK to xmc 0.4.4 / client 0.4.1"
```

---

### Task 2: `pollBlobState` waits for `Transferred` and reports `finalizing`

**Files:**
- Modify: `src/lib/rift/types.ts` (`TransferPhase` union, `TransferProgress`, add constant)
- Modify: `src/lib/rift/content-transfer.ts` (`TransferOptions`, `transferPath` return, `pollBlobState`)
- Test: `src/__tests__/lib/rift/content-transfer.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  - `TransferPhase` gains `'finalizing'`, inserted between `'consuming'` and `'cleanup'`.
  - `TransferProgress` gains `warning?: string`.
  - `export const FINALIZING_TIMEOUT_PREFIX = 'Target is still finalizing';`
- Produces, in `content-transfer.ts`:
  - `export interface FinalizePolling { intervalMs: number; maxAttempts: number }`
  - `export const DEFAULT_FINALIZE_POLLING: FinalizePolling = { intervalMs: 3000, maxAttempts: 800 };`
  - `TransferOptions` gains `finalizePolling?: Partial<FinalizePolling>` (merged over the default).
  - `export interface TransferResult { warning?: string }`
  - `transferPath(client, options): Promise<TransferResult>` (was `Promise<void>`).
  - `pollBlobState(client, contextId, fileName, report, finalize: FinalizePolling, signal?): Promise<string | undefined>` returns the warning text for `TransferredWithErrors`, `undefined` for `Transferred`.
- Consumes: nothing new.

- [ ] **Step 1: Extend the mock so `getBlobState` returns a sequence**

In `createMockClient`, add option `blobStates?: string[]` (default `['Consumed', 'Transferred']`). Each `getBlobState` call returns `wrap({ BlobState: next })`, repeating the last value once the array is exhausted. Replace the current `wrap({ status: 'OK' })`.

- [ ] **Step 2: Write the failing tests**

```ts
it('keeps polling through Consumed and completes only on Transferred, reporting finalizing', async () => {
  const { client, query } = createMockClient({ blobStates: ['Uploaded', 'Consumed', 'Consumed', 'Transferred'] });
  const events: { phase: TransferPhase; detail?: string }[] = [];
  const result = await transferPath(client, {
    sourceContextId: 'src-ctx', targetContextId: 'tgt-ctx',
    itemPath: '/sitecore/content/Home', scope: 'SingleItem',
    finalizePolling: { intervalMs: 0 },
    onProgress: (phase, detail) => events.push({ phase, detail }),
  });
  expect(result).toEqual({});
  const blobCalls = query.mock.calls.filter((c) => c[0] === 'xmc.contentTransfer.getBlobState');
  expect(blobCalls).toHaveLength(4);
  const phases = events.map((e) => e.phase);
  expect(phases.indexOf('finalizing')).toBeGreaterThan(phases.indexOf('consuming'));
  expect(phases.indexOf('finalizing')).toBeLessThan(phases.indexOf('cleanup'));
  expect(phases[phases.length - 1]).toBe('complete');
  expect(events.find((e) => e.phase === 'finalizing')?.detail).toBe('Consumed');
});

it('never resolves on Consumed alone and times out with the finalizing message', async () => {
  const { client } = createMockClient({ blobStates: ['Consumed'] });
  await expect(transferPath(client, {
    sourceContextId: 'src-ctx', targetContextId: 'tgt-ctx',
    itemPath: '/sitecore/content/Home', scope: 'SingleItem',
    finalizePolling: { intervalMs: 0, maxAttempts: 3 },
  })).rejects.toThrow(FINALIZING_TIMEOUT_PREFIX);
});

it('treats TransferredWithErrors as complete with a warning', async () => {
  const { client } = createMockClient({ blobStates: ['Consumed', 'TransferredWithErrors'] });
  const phases: TransferPhase[] = [];
  const result = await transferPath(client, {
    sourceContextId: 'src-ctx', targetContextId: 'tgt-ctx',
    itemPath: '/sitecore/content/Home', scope: 'SingleItem',
    finalizePolling: { intervalMs: 0 },
    onProgress: (phase) => phases.push(phase),
  });
  expect(result.warning).toMatch(/reported errors/i);
  expect(phases[phases.length - 1]).toBe('complete');
});

it.each(['Error', 'ValidationFailed', 'Discarded', 'NotFound'])('fails on blob state %s', async (state) => {
  const { client } = createMockClient({ blobStates: [state] });
  await expect(transferPath(client, {
    sourceContextId: 'src-ctx', targetContextId: 'tgt-ctx',
    itemPath: '/sitecore/content/Home', scope: 'SingleItem',
    finalizePolling: { intervalMs: 0 },
  })).rejects.toThrow(state);
});

it('keeps polling on an unknown token and shows it as the detail', async () => {
  const { client } = createMockClient({ blobStates: ['Validating', 'Transferred'] });
  const events: { phase: TransferPhase; detail?: string }[] = [];
  await transferPath(client, {
    sourceContextId: 'src-ctx', targetContextId: 'tgt-ctx',
    itemPath: '/sitecore/content/Home', scope: 'SingleItem',
    finalizePolling: { intervalMs: 0 },
    onProgress: (phase, detail) => events.push({ phase, detail }),
  });
  expect(events.some((e) => e.detail === 'Validating')).toBe(true);
});

it('stops polling immediately when cancelled during finalizing', async () => {
  const { client, query } = createMockClient({ blobStates: ['Consumed'] });
  const controller = new AbortController();
  const run = transferPath(client, {
    sourceContextId: 'src-ctx', targetContextId: 'tgt-ctx',
    itemPath: '/sitecore/content/Home', scope: 'SingleItem',
    finalizePolling: { intervalMs: 5, maxAttempts: 1000 },
    signal: controller.signal,
    onProgress: (phase) => { if (phase === 'finalizing') controller.abort(); },
  });
  await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  const after = query.mock.calls.filter((c) => c[0] === 'xmc.contentTransfer.getBlobState').length;
  expect(after).toBeLessThanOrEqual(2);
});
```

Add `import { FINALIZING_TIMEOUT_PREFIX } from '@/lib/rift/types';` at the top of the test file (the existing `TransferPhase` import stays).

Also update the existing lifecycle test: the default mock now yields `Consumed` then `Transferred`, so it keeps passing unchanged; add `expect(phases).toContain('finalizing')` to it.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/rift/content-transfer.test.ts`
Expected: FAIL. The new tests fail on `finalizePolling` being unknown / `finalizing` never reported / `FINALIZING_TIMEOUT_PREFIX` not exported.

- [ ] **Step 4: Add the types and constant in `src/lib/rift/types.ts`**

Insert `| 'finalizing'` after `| 'consuming'` in `TransferPhase`. Add `warning?: string;` to `TransferProgress`. Add `export const FINALIZING_TIMEOUT_PREFIX = 'Target is still finalizing';` next to `DEFAULT_SETTINGS`.

- [ ] **Step 5: Implement the state machine in `src/lib/rift/content-transfer.ts`**

Add `FinalizePolling`, `DEFAULT_FINALIZE_POLLING`, `TransferResult`, and the `finalizePolling` option. In `transferPath`, merge `{ ...DEFAULT_FINALIZE_POLLING, ...options.finalizePolling }`, capture `const warning = await pollBlobState(...)` for each file (keep the first non-undefined), and `return { warning }` (omit the key when undefined so `toEqual({})` holds). The `report('complete')` stays last.

Replace `pollBlobState` with the table below. Read the state as today (`body?.status ?? body?.BlobState ?? ''`). Loop `finalize.maxAttempts` times, `signal?.throwIfAborted()` at the top of each iteration, `delay(finalize.intervalMs)` at the bottom.

| state | action |
|---|---|
| `Transferred` | `return undefined` |
| `TransferredWithErrors` | `return \`Target reported errors while writing ${fileName}\`` |
| `Error`, `Failed`, `ValidationFailed`, `Discarded`, `NotFound` | `throw new Error(\`Consume failed (state=${state}): ${JSON.stringify(body?.details ?? body?.Error ?? body)}\`)` |
| `Consumed` | `report('finalizing', state)` then wait |
| anything else (incl. `Unknown`, `Uploading`, `Uploaded`, `Initializing`, unknown tokens) | `report('consuming', state)` then wait |

After the loop: `throw new Error(\`${FINALIZING_TIMEOUT_PREFIX} (last state=${lastState})\`)`.

Remove the old `OK` / `Complete` / `Completed` / `Consumed` / `Success` early exits. Update the comment block above the call to say the blob advances `Consumed` -> `Transferred` when the target's background materialization job finishes and that Rift must not report completion before that.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/rift/content-transfer.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: all tests in the file PASS; tsc exits 0 (the `Promise<void>` to `Promise<TransferResult>` change is source-compatible with the existing `.catch` in `RiftMigrate`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/rift/types.ts src/lib/rift/content-transfer.ts src/__tests__/lib/rift/content-transfer.test.ts
git commit -m "rift: wait for blob state Transferred before completing a path; report a finalizing phase"
```

---

### Task 3: Progress copy for finalizing, warnings and the finalizing timeout

**Files:**
- Modify: `src/lib/rift/progress-format.ts`
- Test: `src/__tests__/lib/rift/progress-format.test.ts`

**Interfaces:**
- Consumes: `'finalizing'`, `TransferProgress.warning`, `FINALIZING_TIMEOUT_PREFIX` from Task 2.
- Produces: `formatProgress` handles `finalizing` and a complete-with-warning row; `classifyError` has a finalizing-timeout pattern. Exact copy:
  - finalizing statusLine: `` `Finalizing on ${target}...` ``
  - complete-with-warning statusLine: `'Done (target reported errors)'`
  - timeout copy: `"The target is still finalizing this item. It may still appear once the target finishes writing; check the target environment's transfer history."`

- [ ] **Step 1: Write the failing tests**

```ts
it('maps finalizing to Import, indeterminate, active, with the target name', () => {
  const r = formatProgress(base({ phase: 'finalizing', chunksComplete: 3, chunksTotal: 3 }), { target: 'dev' });
  expect(r).toEqual({ stage: 'Import', statusLine: 'Finalizing on dev...', percent: null, state: 'active' });
});

it('renders a complete row with a warning as done-with-errors, still complete', () => {
  const r = formatProgress(base({ phase: 'complete', warning: 'Target reported errors while writing x.raif' }));
  expect(r).toEqual({ stage: 'Done', statusLine: 'Done (target reported errors)', percent: 100, state: 'complete' });
});

it('classifies the finalizing timeout to the still-finalizing copy', () => {
  expect(classifyError(`${FINALIZING_TIMEOUT_PREFIX} (last state=Consumed)`)).toBe(
    "The target is still finalizing this item. It may still appear once the target finishes writing; check the target environment's transfer history."
  );
});
```

Import `FINALIZING_TIMEOUT_PREFIX` from `@/lib/rift/types` in the test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/rift/progress-format.test.ts`
Expected: FAIL on the three new tests (finalizing falls to the default branch; warning ignored; timeout gets the generic copy).

- [ ] **Step 3: Implement in `src/lib/rift/progress-format.ts`**

Add `case 'finalizing'` returning stage `Import`, the finalizing statusLine, `percent: null`, `state: 'active'`. In `case 'complete'`, use the warning statusLine when `tp.warning` is set. In `classifyError`, before the CORS check, return the timeout copy when the message starts with `FINALIZING_TIMEOUT_PREFIX` (import it from `./types`). Note `percentFor` already returns 100 for `complete`; leave it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/rift/progress-format.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/progress-format.ts src/__tests__/lib/rift/progress-format.test.ts
git commit -m "rift: friendly copy for the finalizing phase, target warnings and finalizing timeouts"
```

---

### Task 4: Pure post-transfer helpers (run status, parent snapshots, cache-lag detection)

**Files:**
- Create: `src/lib/rift/post-transfer.ts`
- Test: `src/__tests__/lib/rift/post-transfer.test.ts`

**Interfaces:**
- Consumes: `TreeNode`, `TransferProgress`, `FINALIZING_TIMEOUT_PREFIX` from `./types`.
- Produces (all pure, no SDK):
  - `export function parentPathOf(itemPath: string): string` - the path up to the last `/`; `''` when there is no parent segment (input without `/` or `/` only, or `/sitecore`).
  - `export function distinctParentPaths(itemPaths: string[]): string[]` - unique, order-preserving, empties removed.
  - `export function findMissingChildren(before: TreeNode[], after: TreeNode[]): TreeNode[]` - entries of `before` whose `itemId` is absent from `after`.
  - `export interface CacheLagNotice { parentPath: string; missing: string[] }`
  - `export function buildCacheLagNotices(before: Map<string, TreeNode[]>, after: Map<string, TreeNode[]>): CacheLagNotice[]` - one notice per parent present in BOTH maps with at least one missing child; `missing` holds names; parents absent from either map are skipped.
  - `export function hasFinalizingTimeout(progress: TransferProgress[]): boolean` - any `phase === 'error'` whose `error` starts with `FINALIZING_TIMEOUT_PREFIX`.
  - `export type RunStatus = 'success' | 'partial' | 'failed'`
  - `export function runStatus(progress: TransferProgress[]): RunStatus` - `failed` if every path is `error`; `partial` if any path is `error` or any path has a `warning`; else `success`.

- [ ] **Step 1: Write the failing tests**

```ts
const node = (itemId: string, name: string): TreeNode => ({ itemId, name, path: `/x/${name}`, hasChildren: false, templateName: 'T' });

describe('parentPathOf / distinctParentPaths', () => {
  it('returns the parent and skips roots', () => {
    expect(parentPathOf('/sitecore/content/mcc/Home')).toBe('/sitecore/content/mcc');
    expect(parentPathOf('/sitecore')).toBe('');
    expect(parentPathOf('Home')).toBe('');
    expect(distinctParentPaths(['/a/b/c', '/a/b/d', '/sitecore', '/a/b/c'])).toEqual(['/a/b']);
  });
});

describe('findMissingChildren', () => {
  it('keys on itemId, ignores extras and renames', () => {
    const before = [node('1', 'about'), node('2', 'case-studies')];
    const after = [node('1', 'about-renamed'), node('3', 'new-item')];
    expect(findMissingChildren(before, after).map((n) => n.name)).toEqual(['case-studies']);
  });
  it('passes when before is a subset of after', () => {
    expect(findMissingChildren([node('1', 'a')], [node('1', 'a'), node('2', 'b')])).toEqual([]);
  });
});

describe('buildCacheLagNotices', () => {
  it('reports only parents present in both snapshots with missing children', () => {
    const before = new Map([['/p', [node('1', 'a'), node('2', 'b')]], ['/q', [node('9', 'z')]]]);
    const after = new Map([['/p', [node('1', 'a')]]]);
    expect(buildCacheLagNotices(before, after)).toEqual([{ parentPath: '/p', missing: ['b'] }]);
  });
});

describe('hasFinalizingTimeout / runStatus', () => {
  const tp = (over: Partial<TransferProgress>): TransferProgress => ({ itemPath: '/x', phase: 'complete', ...over });
  it('detects a finalizing timeout error', () => {
    expect(hasFinalizingTimeout([tp({ phase: 'error', error: `${FINALIZING_TIMEOUT_PREFIX} (last state=Consumed)` })])).toBe(true);
    expect(hasFinalizingTimeout([tp({ phase: 'error', error: 'boom' })])).toBe(false);
  });
  it('is partial when one path carries a warning and the rest succeed', () => {
    expect(runStatus([tp({}), tp({ warning: 'w' })])).toBe('partial');
  });
  it('is failed only when every path errored, success when none did', () => {
    expect(runStatus([tp({ phase: 'error', error: 'x' }), tp({ phase: 'error', error: 'y' })])).toBe('failed');
    expect(runStatus([tp({ phase: 'error', error: 'x' }), tp({})])).toBe('partial');
    expect(runStatus([tp({}), tp({})])).toBe('success');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/lib/rift/post-transfer.test.ts`
Expected: FAIL with the module `@/lib/rift/post-transfer` not found.

- [ ] **Step 3: Implement `src/lib/rift/post-transfer.ts` with the signatures above**

Keep it dependency-free beyond `./types`. `buildCacheLagNotices` iterates `before.keys()`, so the output order follows the snapshot order.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/lib/rift/post-transfer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/post-transfer.ts src/__tests__/lib/rift/post-transfer.test.ts
git commit -m "rift: pure helpers for run status, parent snapshots and cache-lag detection"
```

---

### Task 5: Wire snapshots, warnings, refresh gating and history into `RiftMigrate`

**Files:**
- Modify: `src/components/rift/RiftMigrate.tsx` (`executeMigration`, lines 340-435; state near line 91; overlay props near line 779)

**Interfaces:**
- Consumes: `transferPath(): Promise<TransferResult>` (Task 2); `fetchTreeChildren(client, contextId, parentPath): Promise<TreeNode[]>` from `@/lib/rift/api-client`; `distinctParentPaths`, `buildCacheLagNotices`, `hasFinalizingTimeout`, `runStatus`, `CacheLagNotice` from `@/lib/rift/post-transfer`.
- Produces: two new state values passed to the overlay in Task 6: `cacheLagNotices: CacheLagNotice[]` and `finalizingTimedOut: boolean`.

- [ ] **Step 1: Add state**

Next to `transferProgress`: `const [cacheLagNotices, setCacheLagNotices] = useState<CacheLagNotice[]>([]);` and `const [finalizingTimedOut, setFinalizingTimedOut] = useState(false);`. Reset both to empty / false at the top of `executeMigration`.

- [ ] **Step 2: Snapshot target parents before starting transfers**

Add a local helper inside the component file (not exported): `async function snapshotParents(parents: string[], contextId: string): Promise<Map<string, TreeNode[]>>` that runs `fetchTreeChildren` for each parent with `Promise.allSettled` and only inserts fulfilled results. In `executeMigration`, before `const transfers = ...`: `const parents = distinctParentPaths(paths.map((p) => p.itemPath)); const before = await snapshotParents(parents, targetEnv.contextId);`.

- [ ] **Step 3: Capture warnings from each transfer**

Change the `transferPath(...)` call chain to `.then((result) => { if (result.warning) { progress[index] = { ...progress[index], warning: result.warning }; setTransferProgress([...progress]); } }).catch(...)` keeping the existing catch body.

- [ ] **Step 4: Gate the refresh and run the post-check in `finally`**

Replace the history `status` expression with `runStatus(progress)`. Replace the existing refresh block with:

- `const timedOut = hasFinalizingTimeout(progress); setFinalizingTimedOut(timedOut);`
- If `!timedOut && progress.some((p) => p.phase === 'complete')`: bump `setTreeSoftRefreshKey`, then `const after = await snapshotParents(parents, targetEnv.contextId); setCacheLagNotices(buildCacheLagNotices(before, after));`.
- If `timedOut`: do not bump the refresh key and leave `cacheLagNotices` empty.

`finally` blocks may `await`; make the enclosing function body `async` as it already is.

- [ ] **Step 5: Pass the new props to the overlay**

At the `<RiftProgressOverlay ...>` call add `cacheLagNotices={cacheLagNotices}` and `finalizingTimedOut={finalizingTimedOut}`. This will not type-check until Task 6 adds the props; do Task 6 before running tsc, or temporarily hold this step until then.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected (after Task 6 is in place): tsc exits 0; all tests PASS.

- [ ] **Step 7: Commit (together with Task 6 if Step 5 was held)**

```bash
git add src/components/rift/RiftMigrate.tsx
git commit -m "rift: snapshot target parents around a run, gate the refresh on finalizing, record warnings as partial"
```

---

### Task 6: Overlay renders finalizing, warnings and notices

**Files:**
- Modify: `src/components/rift/RiftProgressOverlay.tsx`

**Interfaces:**
- Consumes: `CacheLagNotice` from `@/lib/rift/post-transfer`; `TransferProgress.warning`; `'finalizing'` events.
- Produces: props `cacheLagNotices?: CacheLagNotice[]` and `finalizingTimedOut?: boolean` on `RiftProgressOverlayProps`.

Exact copy:
- Finalizing hint (shown under a row while `tp.phase === 'finalizing'` and more than 30000 ms have passed since the first `finalizing` event): `The target is writing items to its database. Items with many versions can take several minutes.`
- Header when complete, no errors, at least one warning: `Migration completed with warnings` (amber styling: `bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200`).
- Still-finalizing notice (when complete and `finalizingTimedOut`): `One or more items are still being written on the target. The tree was not refreshed; use Refresh once the target finishes.`
- Cache-lag notice (when complete and `cacheLagNotices.length > 0`), one block headed `Target tree may be lagging` followed by one line per notice: `` `${parentPath}: ${missing.length} item(s) that existed before are not listed (${missing.join(', ')}). They are still in the database; the target environment's cache has not caught up. Clear the target's caches (Sitecore admin, cache.aspx, Clear All) or wait, then Refresh.` ``

- [ ] **Step 1: Add the props and the derived flags**

Add the two optional props. Add `const hasWarnings = transferProgress.some((tp) => tp.warning);`. Extend the header class and label: error takes precedence (red, existing copy), then warnings (amber, new copy), then success (green, existing copy).

- [ ] **Step 2: Render the notices**

Between the header and the rows container, when `isComplete`, render the still-finalizing notice and the cache-lag block as small `text-xs` panels (reuse the amber classes). Nothing renders while active.

- [ ] **Step 3: Render the per-row hint and warning**

Inside the row map: compute `const finalizingStart = tp.events?.find((e) => e.phase === 'finalizing')?.timestamp;` and show the hint line under the status when `tp.phase === 'finalizing' && finalizingStart && Date.now() - finalizingStart > 30000` (the overlay already re-renders every second while active, so no new timer is needed). In the expanded section, render `tp.warning` the same way `tp.error` is rendered but with an amber text class.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: tsc exits 0; all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/rift/RiftProgressOverlay.tsx src/components/rift/RiftMigrate.tsx
git commit -m "rift: show finalizing progress, target warnings, and cache-lag or still-writing notices after a run"
```

---

### Task 7: Version bump and full verification

**Files:**
- Modify: `package.json` (`"version"`), `src/lib/version.ts` (`APP_VERSION`)

- [ ] **Step 1: Bump the version**

Set `"version": "0.7.16"` in `package.json` and `APP_VERSION = '0.7.16'` in `src/lib/version.ts`.

- [ ] **Step 2: Full verification**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run build`
Expected: tsc exits 0; all test files PASS (the previous 45 plus the new ones); the Next build completes without errors.

- [ ] **Step 3: Commit**

```bash
git add package.json src/lib/version.ts
git commit -m "rift: bump to 0.7.16 - wait for Transferred before completing and refreshing"
```

- [ ] **Step 4: Manual validation on dev (not automated)**

Run a real prod -> dev transfer of a small path through Rift and confirm: the row shows `Finalizing on dev...` after import; the tree refresh happens only after the row completes; the target tree is complete with no cache clear; dev's `ItemsTransfer/Status` shows the consumed source at `BlobState: Transferred` when the row completes. If a many-version item is available, confirm the 30 second hint appears.
