# Friendlier per-path migration progress - design

Date: 2026-07-13
Branch: `feature/marketplace-sdk-auth`
Status: approved (visual mockup approved; awaiting spec review)

## Problem

`RiftProgressOverlay` currently renders migration status in developer terms:

- Per-path rows show the raw internal phase name (`creating`, `exporting`, `downloading`, `uploading`, `assembling`, `consuming`, `cleanup`) plus a monospace `+0.0s phase detail` event log that is always visible.
- No plain-English "what's happening / how far along" at a glance.
- Errors surface the raw failure text (e.g., a CORS/stack message) with no human explanation.

The result reads like a debug console. We want a friendlier real-time status while keeping the full technical detail available on demand.

## Scope

In scope:
- Rewrite the presentation of `RiftProgressOverlay` to the approved "Option B" compact, per-path layout.
- Add a pure, tested formatting helper that maps a `TransferProgress` to a friendly status line, a coarse stage, and a percent.
- Human-readable error copy for the known CORS failure, with the raw error preserved in the debug log.
- A debug log that is collapsed by default and expandable per-row (chevron) and all-at-once (header master toggle).

Out of scope (explicitly deferred "for now"):
- Per-row direction chip (`prod -> dev`) and per-path elapsed time.
- Persisting the debug-toggle state in settings.
- Any overlay-level overall progress bar / stage stepper (we stay strictly per-path because migrations run async/in parallel).
- Changes to the transfer pipeline itself (`content-transfer.ts`) beyond what is needed to feed the UI.

## Approved layout (Option B)

Per-path row, collapsed by default, one line each:

`[status icon] [item path] [friendly status] [mini progress bar] [percent] [chevron]`

- **Status icon:** spinner (in progress), check (done, emerald), alert (error, red).
- **Friendly status:** plain-English text derived from the phase (see mapping).
- **Mini bar + percent:** chunk-based during transfer; 100% on done; last-known value held on error (red). Indeterminate/low hint before chunk counts are known.
- **Chevron:** expands that row's debug panel.

Overlay header keeps: title ("Migrating content" / "Migration complete" / "Migration completed with errors"), overall elapsed timer, "N of M paths done", Cancel (while active), Back/Close, and a new **"Debug log"** master toggle.

States rendered: in-progress (indigo accents), complete (emerald), error (red). Matches the approved mockup at `scratchpad/progress-mockups.html`.

## Phase -> friendly mapping

Coarse user-facing stages (for status wording; not shown as a stepper):

| Internal phase | Stage | Friendly status line |
|---|---|---|
| `creating` | Prepare | "Preparing transfer" |
| `exporting` | Package | "Packaging content on {source}..." |
| `downloading` | Package | "Downloading content ({n} of {N})" |
| `uploading` | Transfer | "Uploading to {target} ({n} of {N})" |
| `assembling` | Transfer | "Assembling package on {target}" |
| `consuming` | Import | "Importing into {target}" |
| `cleanup` | Import | "Finishing up" |
| `complete` | Done | "Done - {elapsed}" |
| `error` | Failed | friendly message (see below) |

`{source}` / `{target}` use the environment display names, passed into the overlay from `RiftMigrate` (which already holds the selected source/target env). If a name is unavailable, fall back to "source"/"target".

## Percent

- `downloading` / `uploading`: `chunksComplete / chunksTotal` when known.
- `complete`: 100.
- `error`: hold the last known percent, render the bar red.
- All other phases (`creating`, `exporting`, `assembling`, `consuming`, `cleanup`): no numeric percent; render a thin indeterminate (animated) bar and show "-" for the number.

`chunksTotal` must be populated. Today `RiftMigrate`'s `onProgress` parses `chunksComplete` from the `"n/N"` detail but does not set `chunksTotal`. Fix: parse both `n` and `N` from that detail and set `chunksTotal` on the `TransferProgress`. No change to `content-transfer.ts` reporting is required.

## Friendly error copy

A small pure classifier maps an error to friendly text while always keeping the raw string in the debug log:

- CORS / preflight (`Access-Control-Allow-Methods`, "Method PUT", "Method DELETE", "blocked by CORS"): "Upload was blocked by the target environment (CORS). This is an environment-side setting, not a Rift issue."
- Anything else: "Migration failed for this item." (raw text in debug log)

## Debug log

- Collapsed by default.
- Per-row: the chevron toggles that row's panel. Panel content = the existing `TransferProgress.events` timeline (relative timestamp, phase, detail) rendered monospace, plus the raw `error` string for failed rows. This is the same information shown today, just opt-in.
- Global: the header "Debug log" toggle expands/collapses every row's panel at once. Local component state, default off, resets each run. (Persistence deferred.)

## Components and boundaries

- **`src/lib/rift/progress-format.ts` (new, pure, tested):** the presentation logic, no React. Exposes small pure functions, e.g. `formatPhase(tp, envNames)` returning `{ stage, statusLine, percent }`, and `classifyError(message)` returning friendly copy. Isolated so it can be unit-tested without rendering (consistent with `compare-rows.ts`).
- **`src/components/rift/RiftProgressOverlay.tsx` (rewrite render):** same props/data model (`isActive`, `transferProgress`, `onClose`, `onCancel`) plus new optional `sourceEnvName` / `targetEnvName`. Owns the debug expand state (per-row set + master toggle). Consumes `progress-format.ts` for all wording/percent.
- **`src/components/rift/RiftMigrate.tsx` (minor):** pass `sourceEnvName` / `targetEnvName` to the overlay; set `chunksTotal` when parsing progress detail.

Data model (`TransferProgress`, `TransferPhase`, `TransferProgressEvent`) is unchanged.

## Testing

- Unit-test `progress-format.ts` with vitest: each phase -> expected stage/status line (including name substitution and fallback), percent logic (known/unknown/complete/error-hold), and error classification (CORS vs generic).
- The project has no RTL, so component render tests are deferred (per prior sessions). Manual verification against the mockup states (in-progress at each stage, complete, error, debug expand per-row and global).

## Rollout

- Version bump (`package.json` + `src/lib/version.ts`) before any deploy, per project rule.
- Ships on `feature/marketplace-sdk-auth`; reaches `rift-prod` only via a manual `deploy-azure.yml` `workflow_dispatch`.
