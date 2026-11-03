# Drift Descendant Counts Design

**Date:** 2026-11-03
**Component:** `RiftContentTree` (with a new pure helper in `src/lib/rift/`)
**Status:** Draft - ready for implementation planning
**Builds on:** `2026-04-20-dual-tree-diff-design.md` (per-row drift indicator)

## Intent and the why

Today a row turns amber when the item's `__Updated` timestamp differs between
source and target. That only helps once the row is on screen. A collapsed
folder such as Home gives no hint whether anything beneath it drifted, so the
user ends up expanding every branch to hunt for amber. This feature makes a
folder say, without being expanded, how many drifted items sit beneath it, and
it finds that out by itself.

Jason (the user) rejected a "scan" button: if he has to click something per
folder he might as well expand the folders. The tree must learn the whole site
on its own after it loads.

## Goals

- Every folder under the site root, and under the site's media folder, shows a
  count of drifted items beneath it, with no user action.
- The counts appear progressively while the tree is being walked, and the
  header says the walk is still running.
- A folder the walk has already passed expands instantly (its children are
  already cached). This is a side effect of the walk, not extra work.
- Counts stay correct after a migration: the migrated branches are re-read and
  their counts fall.

## Non-goals

- Field-level comparison, or which direction the drift goes.
- Acting on a count (for example "select everything drifted beneath"). The
  count is a signpost; the user still expands and ticks boxes as today.
- Items that exist only on target. Rift cannot act on them, so they do not
  count as drift.
- Counts on rows above the site root (`content`, `mayocliniccloud` in the
  content tree; `media library`, `Project` in the media tree). Their siblings
  are not walked, so a count there would be misleading. Those rows show no
  pill. (My call.)
- Replacing the folder-by-folder walk with a search-index query. Worth a
  spike later if the walk proves too slow on a large site; out of scope here.

## Anti-goals

- The walk must never make the tree feel slower. A user expansion is served
  ahead of the walk, exactly as it is today.
- The walk must not add load beyond what the tree already generates per
  folder: the same children query, the same two environments, the same
  concurrency as today's one-level prefetch.
- The walk must not run while a migration is in progress. The target is
  changing under it and the counts would be wrong; the transfer also needs the
  bandwidth.
- No new button in the tree. Jason was explicit.

## What exists today (constraints)

- `fetchDualTreeChildren` in `src/lib/rift/api-client.ts` reads one folder's
  children from both environments via the Authoring GraphQL `children` query
  and zips them (`zipDualTreeChildren`) into `DualTreeNode[]`, setting `diff`
  to `'match'` or `'different'` when both sides carry an `__Updated` value.
  The zip is the only place drift is decided and the walk reuses it, so a
  count can never disagree with what the rows show once expanded.
- The reads behind it are lenient: `fetchTreeChildren` returns `[]` on an SDK
  error envelope, on a GraphQL `errors` body (timeouts included) and on a
  missing item, and `fetchDualTreeChildren` turns a failed target read into
  source-only pairs. That is fine for a row the user is looking at, but
  poison for a count: a failed source read would cache as "empty and clean",
  a failed target read as "everything beneath is missing on target". The
  strict variant `fetchTreeChildrenStrict` already exists for exactly this
  reason (the post-run stale-list check).
- `disabled` (true while a migration runs) is accepted by the tree but not
  used. In `RiftMigrate`, `isMigrating` goes false in a `finally` before the
  post-run stale-list check and automatic repairs run, and before
  `preserveExpansionRefreshKey` is bumped. When any path's write is still
  unconfirmed (`targetStillWriting`), the tree is deliberately not refreshed
  at all and the overlay tells the user to Refresh later, because reading a
  target child list while the transfer lock is still held caches a wrong
  list on the CM (the v0.7.16 to v0.7.18 stale-listing work).
- `RiftContentTree` keeps `childrenCache: Map<path, DualTreeNode[]>` and a
  prefetch queue (`prefetchQueueRef`, `MAX_PREFETCH_CONCURRENT = 2`,
  `prefetchGenRef` as a generation counter that drops in-flight results after
  a reset). The queue currently goes one level below each expanded folder and
  stops.
- The initial load walks from `/sitecore` down the site root path and the
  media `Project/<site>` path, expands those, and seeds the prefetch queue
  with the site root's child folders.
- `refreshKey` (the Refresh button in `RiftMigrate`) and a change of
  `targetContextId` or `rootPath` reset the cache and reload.
  `preserveExpansionRefreshKey` fires after a successful migration (and after
  a listing repair) and re-reads only the expanded folders, keeping the
  user's place.
- `selectedPaths` (with `scope` SingleItem or ItemAndDescendants) is still set
  when the post-migration soft refresh fires; the selection is not cleared on
  success.
- The `disabled` prop is true while a migration runs.
- Rows are rendered by two near-identical pieces of code (`TreeNodeRow` and
  `renderFilteredBranch`), both of which delegate the cell contents to
  `SourceCell` and `TargetCell`. Anything new in a row goes in those two cells
  so it is written once.
- Hidden items: with "Show hidden items" off, the content root shows only
  Home, Data and any selected direct children; media intermediate folders are
  hidden too. The hidden folders still exist in the cache.
- Tests are vitest in a node environment under `src/__tests__/lib/rift/`.
  There are no component tests; the pure pieces are what get tested.

## Prerequisite: confirm the children query is not capped

`childrenQuery` asks for `children { nodes { ... } }` with no page size. Nobody
knows whether the Authoring API caps that list (the Experience Edge schema
defaults `first` to 10; the Authoring docs only mention a configurable
`GraphQL.DefaultPageSize`). If it is capped, a large media folder already
shows a partial list today, a count beneath it would be wrong, and the walk
would never descend into unlisted child folders. Jason does not know, so this
is the first task of the plan, before anything else is built:

1. Against the dev environment, through the same SDK call the tree uses, run
   an introspection query for the `Item.children` field (its arguments and
   return type) and a children query on the largest media folder available,
   comparing the returned count to what the Content Editor shows.
2. If the list is capped: extend `childrenQuery` to page with `first`/`after`
   and `pageInfo`, looping until the last page, inside `fetchTreeChildren`
   and `fetchTreeChildrenStrict` (one shared loop), with a vitest case for a
   multi-page response. This changes "same load as today" for big folders,
   which is accepted.
3. If it is not capped: record that in this document's status line and move
   on.

## Decided by Jason

- Automatic. The walk starts as soon as the tree loads. No button, no click.
- Mark: a count pill after the folder name, amber, showing how many drifted
  items are beneath. A grey "?" pill while the folder's subtree is not yet
  known. No pill when the subtree is fully known and clean.
- The pill shows in both the Source and Target columns (as in the approved
  mockup).
- Source-only items (the amber hatched ghost on target) count as drift beneath
  a parent, since they need migrating too.
- Hand expansion is gated the same way as the walk. While the walk is paused
  (a migration is running, or the target has not settled since one),
  expanding a folder whose children are not cached is blocked: the arrow is
  dimmed and its hover text says "Target is still writing; refresh the tree
  to continue". Expanding or collapsing an already-cached folder still works,
  since that needs no read.

## My calls (marked so they can be overturned)

- **What counts.** A descendant counts when `diff === 'different'`, or when it
  has a source and no target. It does not count when it is target-only or
  when `diff` is undefined for lack of a timestamp. The folder itself never
  counts toward its own pill; its icon colour already says whether it drifted.
- **A source-only folder counts as one and is not walked.** If a folder is
  missing on target, everything beneath it is missing too, so descending
  would only add calls and inflate the number. It counts as one drifted item
  and its subtree is treated as fully known, even if the user has expanded
  it by hand. Target-only folders are neither counted nor walked. The walk
  only descends into folders present on both sides.
- **No walk without a target.** Today's one-level prefetch also stops when no
  target is selected; hand expansion still fetches on click. The no-target
  state is transient and a source-only crawl would be thrown away the moment
  a target is chosen.
- **Hidden items count.** A pill may say 3 while only 2 drifted rows are
  visible with "Show hidden items" off. The pill's hover text says "N items
  beneath differ or are missing on target", and turning hidden items on
  reveals the rest.
- **Partial knowledge shows a running count.** While the walk is still inside
  a folder's subtree, the pill shows the drift found so far as an amber count
  as soon as it is above zero, and the grey "?" until then. Counts only grow
  during a walk, so an early number is a lower bound. A fully known, clean
  folder shows nothing.
- **The walk reads strictly.** It uses a strict dual fetch (a new
  `fetchDualTreeChildrenStrict` built on `fetchTreeChildrenStrict` for both
  sides, sharing `zipDualTreeChildren`). A failure on either side caches
  nothing: the folder stays "?" and is retried a bounded number of times with
  a short backoff (the builder picks the numbers; three tries is plenty).
  After the last failure it stays "?" for good and its ancestors' counts
  exclude it. Failures are silent, as prefetch failures are today.
- **Hand expansion and the initial load keep their lenient reads.** They are
  unchanged. Whatever they cache is what the rows show, so the count still
  equals the rows by construction; in the rare failure case both are wrong
  the same way, which is the pre-existing behaviour and out of scope.
- **Walk order.** Breadth-first from the two walk roots (the site root and the
  site media folder), so shallow folders near what the user is looking at get
  their counts first. A folder the user expands by hand is fetched right away
  as today and its child folders go to the front of the queue.
- **Concurrency.** Keep today's limit of two folders in flight (each is two
  HTTP calls, one per environment). The builder may tune it but must not
  raise it without saying so.
- **Pause during migration, resume only when the target has settled.** When
  `disabled` becomes true the queue stops taking new work; in-flight reads
  finish normally. It does NOT resume when `disabled` returns to false,
  because that happens before the post-run check and repairs. It resumes on
  the next `preserveExpansionRefreshKey` bump (which `RiftMigrate` only
  fires once the post-run check and repairs are done) or on any full reset
  (Refresh button, target or site change). In the still-writing case neither
  arrives, so the walk stays paused and the header status reads "Drift scan
  paused until the tree is refreshed". No new prop is needed for this.
- **After a migration** (`preserveExpansionRefreshKey`): in addition to the
  existing re-read of expanded folders, drop the cached subtree of every
  selected path (the path itself and everything under it) and re-read each
  selected path's parent list, so the path's own row updates even when its
  parent is not expanded (a preset-loaded selection may sit under a collapsed
  folder). The walk then re-fills the dropped subtrees. Counts above those
  paths fall as the re-reads land. Nothing else is re-walked. Paths whose
  reads were in flight when the generation bumped are re-enqueued, not
  dropped, so they do not become permanent "?" holes.
- **Reset.** The Refresh button, a target change and a site-root change
  already clear the cache. The walk restarts from scratch with them, under a
  new generation so stale results are dropped, exactly as prefetch does today.
- **No target selected.** No diff exists, so no pills and no walk. The walk
  only runs when `targetContextId` is set.
- **Header status.** While the walk has work outstanding, the header row
  (where "CONTENT TREE" and "Show hidden items" live) shows a small spinner
  and "Scanning for drift: N folders checked", placed to the left of "Show
  hidden items". When the queue drains the status disappears. No "done"
  message.

## How it fits together

- **One queue, not two.** The existing one-level prefetch becomes the walk:
  same queue, same generation counter, same concurrency, but every folder
  fetched inside a walk root enqueues its own child folders. There must not be
  a second crawler alongside the prefetch.
- **Roll-up is pure and tested.** A function in `src/lib/rift/` (name left to
  the builder) takes the cache and a root path and returns, per folder, the
  drift count beneath it and whether its subtree is fully known. The tree
  memoises it on the cache. The counting rules above are unit-tested there
  with vitest; the component is not tested.
- **The pill is one component** rendered by `SourceCell` and `TargetCell`,
  taking the roll-up result for that row. Neither row renderer grows a third
  copy of anything. A source-only folder (ghost on target) shows its pill in
  the source column only.
- **Every walked folder emits `onChildrenLoaded`** with its source-side
  nodes, as prefetch does today, so inherited checkboxes work when a walked
  folder is expanded instantly.
- **Walk roots** are the site root (`rootPath`) and the site media folder
  (`/sitecore/media library/Project/<same segments>`), both of which the
  initial load already resolves. Pills render only on those roots and their
  descendants.

## Left to the builder

- The exact roll-up algorithm and whether it is incremental. A full pass over
  the cache on each change is acceptable if it stays well under a frame on a
  cache of tens of thousands of nodes; measure it.
- How "fully known" is tracked (a per-folder flag, a set of pending paths, or
  derived from the cache).
- Where the post-migration subtree eviction lives and how it coordinates with
  the existing soft-refresh effect.
- Whether the status text needs a lower bound ("of about M") or just the
  running "N checked"; the source side's `hasChildren` flags give one level of
  look-ahead if a bound is wanted.
- Pill sizing and exact classes, matching the existing amber tokens
  (`text-amber-500`, `fill-amber-500/30`) and the muted grey for "?".
- Version bump to 0.7.19 (`package.json` and `version.ts`) before the first
  push, per the project rule.
