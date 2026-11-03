# Wait for true transfer completion before touching the target tree - design

Date: 2026-11-02
Status: approved direction, pending builder check

## Problem

On 2026-11-02 a prod -> dev migration of `Home` (SingleItem) plus `Home/Data`
(ItemAndDescendants) left dev's content tree showing Home with only `Data`
under it. All 17 sibling pages looked deleted. They were not: every item was
still in SQL with the correct parent, and a cache clear on the dev CM restored
the full child list instantly.

Root cause (verified against the decompiled XM Cloud kernel, the dev transfer
logs, the official Sitecore docs, and controlled dev-to-dev transfers):

- After `consumeFile`, the target CM makes the items visible immediately
  through a transferred-source overlay, then runs a **background job** that
  materializes them into the database (`TransferJobAgent` -> `SourceTransferer`
  -> `ItemTransferer`). For `Home`, which carries 140 versions, that job ran
  from 16:18:21 to 16:21:11.
- `getBlobState` tracks this: the blob goes `Uploaded` -> `Consumed` ->
  **`Transferred`** when the job finishes. Sitecore's docs say items are
  "immediately available while the system completes the sync to the database
  in the background" and that only the finished state is true completion.
- Rift's `pollBlobState` returns at `Consumed`. Rift then reports `complete`
  and soft-refreshes the tree. That read lands inside the materialization
  window, and the transitional child list it receives is cached by the target
  CM (`DataCache.ItemInformation.ChildIDs`). The cache never self-corrects.
- Dev-to-dev transfers that only read the tree after the job finished never
  reproduced the freeze, twice. Rift's early read is the trigger.

The merge strategy was never the problem. `OverrideExistingItem` cannot delete
descendants; only `OverrideExistingTree` runs a cleanup, and Rift never sends
it.

## Goals

- "Complete" means the items are materialized in the target database.
- Rift never reads or refreshes the target tree before that point.
- The longer wait is legible in the progress overlay, not a hung spinner.
- If the target tree still reads incomplete afterward (some other reader hit
  the window), Rift says exactly what happened and that nothing was lost,
  instead of painting ghost rows that look like deletion.

## Non-goals

- No automatic `cleanUpDatabases`. It is a whole-database maintenance job with
  an integrity pass that can delete orphans. Rejected as too heavy.
- No no-op saves on transferred roots. A save only fires cache invalidation
  when a field actually changes, and it bumps revision and audit on roots.
- No per-item mutations of any kind. Nothing proportional to transfer size.
- Not fixing readers outside Rift (an open Content Editor during a long
  transfer). That is a Sitecore-side characteristic; Rift only detects it.

## Anti-goals

- Keeping the UI snappy by declaring success before the target is done.
- Any remedy that mutates target content to repair a cache.

## Constraints

- Rift is a browser-only Marketplace SDK app. The only target operations are
  the `xmc.contentTransfer.*` ops it already uses and the Authoring GraphQL.
- Through the SDK, `getBlobState` returns the CM's `BlobState` enum in the
  response body (Rift already reads `body.status ?? body.BlobState`). The full
  enum is: `Unknown`, `Uploading`, `Uploaded`, `Initializing`, `Error`,
  `Consumed`, `Transferred`, `TransferredWithErrors`, `Discarded`,
  `ValidationFailed`.
- The target processes background jobs one at a time. With parallel paths,
  finalization waits add up. A large or many-version item can exceed the
  current 10 minute poll budget on its own.

## Decisions

### 1. `pollBlobState` waits for `Transferred`

The state machine becomes:

| BlobState | Meaning for Rift |
|---|---|
| `Unknown`, `Uploading`, `Uploaded`, `Initializing`, `Consumed` | still working, keep polling |
| `Transferred` | success |
| `TransferredWithErrors` | success with a warning (see decision 4) |
| `Error`, `ValidationFailed`, `Discarded`, `NotFound` | failure, throw |

The legacy early-exit tokens (`OK`, `Complete`, `Completed`, `Success`,
`Consumed`) are removed. `Consumed` is explicitly in-progress now. Anything not
in the table keeps polling; the raw state is surfaced as the phase detail so an
unexpected token is visible rather than silently treated as done.

Why this table is safe to rely on (builder-check answers):

- The values come from the CM's `Sitecore.Data.ItemsTransfer.Azure.BlobState`
  enum, which is byte-identical across every kernel version in play (decompiled
  1.6 through 1.12.2). The response body carries it in `BlobState`; Rift's
  existing `body.status ?? body.BlobState` read already handles that. Verified
  directly against dev; the shape is not SDK-version dependent.
- The SDK type comment that lists `OK`, `NotFound`, `Error` for `status` is a
  generic description, not what the CM returns. `OK` was never observed; the
  old mock that returned it was a guess.
- A blob record does not vanish mid-poll. Consumed blobs are retained for days
  (`Sitecore.TransferredItems.BlobLifetimeDays`, default 7) before the cleanup
  agent removes them. `NotFound` therefore means a bad filename, which is a
  real failure, consistent with how the export status poll already treats it.

### 2. A new `finalizing` phase

`TransferPhase` gains `finalizing`. Ordering per path:

`creating` -> `exporting` -> `downloading` -> `uploading` -> `assembling` ->
`consuming` -> `finalizing` -> `cleanup` -> `complete`

- `consuming` covers `consumeFile` until the blob reaches `Consumed`.
- `finalizing` covers `Consumed` until `Transferred`, with the raw state as
  detail.
- `cleanup` and `complete` keep their existing contract: cleanup runs in the
  `finally`, `complete` is reported last and only on success. Because
  finalizing sits inside the `try`, the transfer-record cleanup now also runs
  after the target has finished writing.

`formatProgress` maps `finalizing` to stage `Import`, an indeterminate bar, and
the status line `Finalizing on {target}...`. After the phase has been active for
a while the overlay adds a one-line hint that the target is writing items to its
database and that items with many versions can take several minutes. The hint
threshold is the builder's call (around 30 seconds is reasonable).

### 3. A separate, longer budget for finalizing

Finalizing gets its own poll interval and ceiling, independent of the existing
`MAX_POLL_ATTEMPTS` used for export and consume. The builder picks the numbers;
the intent is a few seconds between polls and a ceiling on the order of tens of
minutes, well above the 10 minute export budget.

On timeout the path ends in the existing `error` phase (my call: no new terminal
phase; a timeout is an abnormal end because Rift could not confirm completion).
What changes is the copy: `classifyError` gains a pattern for the finalizing
timeout message so the row reads that the target is still finalizing, items may
still appear, and the target's transfer history is the place to check, rather
than the generic "Migration failed for this item". History status stays as it
is today (`partial` if other paths completed, `failed` if none did).

### 4. `TransferredWithErrors` is a warning, not a failure

The items that did transfer are in the database, so the row ends `complete`,
but `TransferProgress` gains an optional `warning` string. `formatProgress`
renders a complete row whose status line notes that the target reported errors,
and the history entry for the run is `partial` when any path carries a warning.

### 5. Tree refresh waits for every path, and is skipped if any path is still finalizing

The post-migration soft refresh already runs only after every path has settled,
and `complete` now implies `Transferred` per path. One gap remains (my call,
from the builder check): with parallel paths, if one path hits the finalizing
timeout its background job may still be writing, and a refresh at that moment
is exactly the early read this design removes.

So the refresh and the post-completion check (decision 6) are gated on "no
path ended in a finalizing timeout". If any did, skip the automatic refresh
entirely and show a notice that one or more items are still being written on
the target and the tree should be refreshed later. The `Refresh` button remains
available for that.

### 6. Post-completion cache-lag check

This defends against the one case Rift cannot prevent: another reader hitting
the window during a long transfer.

- Before starting transfers, for each distinct parent path of the selected
  roots, fetch the target's child names once (`fetchTreeChildren` against the
  target context). This is a handful of calls, never per item. If any of these
  fetches fail, skip the check for that parent silently; the check must never
  block or fail a migration.
- After the soft refresh, fetch the same parents again and compare. Because
  `OverrideExistingItem` never deletes, the post-transfer set must be a
  superset of the pre-transfer set. Extra items are expected (they were just
  transferred). Any pre-existing item that is now missing is cache lag.
- Compare by `itemId`, not by name (my call, from the builder check). A
  transfer can rename an item in place or a source-side move can relocate a
  GUID, either of which makes a pre-existing name disappear from a healthy
  parent and would false-alarm a name-keyed check. `fetchTreeChildren` already
  returns `itemId`. Report the missing items by name for the notice.
- If anything is missing, show a precise, non-alarming notice in the migration
  summary: the target tree under that parent is not listing N items that
  existed before, they are still in the database, the target environment's
  cache has not caught up, and the remedy is to clear the target's caches
  (Sitecore admin, cache.aspx, Clear All) or wait and refresh. No automatic
  action.
- The comparison is a pure helper (names in, missing names out) so it is unit
  testable without the SDK.

### 7. Version bump

`package.json` and `src/lib/version.ts` are bumped so the About dialog confirms
the new code is running.

## Components and boundaries

- `src/lib/rift/content-transfer.ts`: `pollBlobState` state machine, finalizing
  budget, `finalizing` reporting, warning propagation.
- `src/lib/rift/types.ts`: `finalizing` phase, `warning` on `TransferProgress`.
- `src/lib/rift/progress-format.ts`: `finalizing` mapping, warning copy.
- `src/components/rift/RiftProgressOverlay.tsx`: finalizing hint, warning
  rendering, cache-lag notice.
- `src/components/rift/RiftMigrate.tsx`: pre/post parent snapshots around
  `executeMigration`, `partial` history on warnings, surfacing the notice.
- New pure helper for the superset comparison (location is the builder's call,
  alongside `progress-format.ts` is sensible).

## Testing

- `content-transfer.test.ts`: the mock's `getBlobState` returns a sequence
  (`Consumed`, then `Transferred`) instead of `OK`; assert `finalizing` appears
  between `consuming` and `cleanup` and `complete` is still last; assert
  `Consumed` alone never resolves; assert `TransferredWithErrors` resolves with
  a warning; assert `Error`, `ValidationFailed`, `Discarded` throw; assert the
  finalizing timeout throws the "still finalizing" message.
- `progress-format.test.ts`: `finalizing` maps to Import, indeterminate,
  active; a complete row with a warning renders the warning copy.
- New unit test for the superset helper (keyed on `itemId`): pre subset of post
  passes, a missing pre-existing id is reported with its name, extras are
  ignored, and a renamed item (same id, new name) is not reported.
- `progress-format.test.ts`: the finalizing timeout message classifies to the
  "still finalizing" copy, not the generic failure copy.
- All existing tests continue to pass.

## Rollout and validation

- Run a real prod -> dev transfer of a small path through Rift and confirm the
  `finalizing` phase appears, the tree refresh happens only after the blob
  reads `Transferred`, and the target tree is complete without any cache clear.
- If an item with many versions is available, transfer it to exercise the
  longer finalizing wait and the hint.
- Dev's `ItemsTransfer` status and history endpoints show the consumed source
  reaching `Transferred` / `Finished`; use them to cross-check timing.

## Included: Marketplace SDK bump to latest

Owner's decision: the SDK bump ships with this change. The working tree had
been bumped to `xmc` 0.4.2 / `client` 0.3.6, which was not latest. It is now at
the latest published pair, `@sitecore-marketplace-sdk/xmc` 0.4.4 and
`@sitecore-marketplace-sdk/client` 0.4.1 (xmc 0.4.4 requires client ^0.4.0, so
they move together; `core` stays at 0.3.5).

Verified before adopting: no exported type was removed from either package,
the eight `xmc.contentTransfer.*` operations Rift uses are unchanged,
`query`/`mutate`/`ClientSDK.init` signatures are unchanged, the only noted
change on the client side is the additive `getPageHTML` method, `tsc` passes,
and all 45 tests pass. The bump is not a prerequisite for decision 1: the
blob-state shape was verified against the CM directly and is not SDK-version
dependent.

## Calls I made during the builder check

- `NotFound` from `getBlobState` is a failure, not in-progress.
- A finalizing timeout ends in `error` with friendlier copy, not a new phase.
- The refresh and post-check are skipped when any path timed out finalizing.
- The post-completion check compares by `itemId` and reports names.

## Research note

Only two Content Transfer API apps are listed on the Marketplace: Content
Transfer Studio (Icreon) and Sitecore Content Transfer (Horizontal Digital).
Neither publishes source. Content Transfer Studio's listing signals success
only "when it finishes", consistent with waiting for true completion. The
authoritative reference is Sitecore's own migration documentation, which
mandates polling to the finished state.
