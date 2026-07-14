# Friendlier Per-Path Migration Progress - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the developer-console migration status in `RiftProgressOverlay` with friendly, compact per-path rows plus an opt-in debug log.

**Architecture:** A new pure, unit-tested helper (`progress-format.ts`) maps a `TransferProgress` to a friendly status line, coarse stage, percent, and state. `RiftProgressOverlay` is rewritten to render the approved compact "Option B" rows, consuming that helper, with the raw event log collapsed behind a per-row chevron and a header master toggle. `RiftMigrate` is tweaked to feed env display names and populate `chunksTotal` so the bar is accurate. The transfer pipeline is unchanged.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Tailwind + shadcn tokens, lucide-react icons, vitest.

**Visual source of truth:** approved mockup at `scratchpad/progress-mockups.html` (Option B, served at http://localhost:4173/progress-mockups.html during design). Spec: `docs/superpowers/specs/2026-07-13-friendly-progress-overlay-design.md`.

## Global Constraints

- No em-dash characters anywhere (code, comments, copy). Use hyphens.
- Data model unchanged: do NOT edit `TransferProgress` / `TransferPhase` / `TransferProgressEvent` in `src/lib/rift/types.ts` (`chunksTotal?: number` already exists).
- Stay strictly per-path: no overlay-level overall progress bar or stage stepper.
- Use existing shadcn token classes (`bg-card`, `border-border`, `text-muted-foreground`, `bg-muted`, `text-destructive`, `bg-primary`) and lucide-react icons, matching the current component.
- Do NOT add (deferred): per-row direction chip, per-path elapsed time, persisting the debug toggle in settings.
- Commit after each task. Do NOT push (commit-only).
- Version bump (`package.json` + `src/lib/version.ts`) is Task 4, before any future deploy.

---

## File Structure

- Create: `src/lib/rift/progress-format.ts` - pure presentation logic (no React). One responsibility: phase/error -> friendly display fields.
- Create: `src/__tests__/lib/rift/progress-format.test.ts` - unit tests for the helper.
- Modify: `src/components/rift/RiftProgressOverlay.tsx` - full render rewrite to Option B + debug log; consumes the helper; gains optional `sourceEnvName`/`targetEnvName` props.
- Modify: `src/components/rift/RiftMigrate.tsx` - parse `chunksTotal` in `onProgress`; pass env display names to the overlay.
- Modify: `package.json`, `src/lib/version.ts` - version bump.

---

## Task 1: Pure `progress-format` helper + tests

**Files:**
- Create: `src/lib/rift/progress-format.ts`
- Test: `src/__tests__/lib/rift/progress-format.test.ts`

**Interfaces:**
- Consumes: `TransferProgress` from `@/lib/rift/types` (fields used: `phase`, `chunksComplete?`, `chunksTotal?`, `error?`).
- Produces:
  - `type MigrationStage = 'Prepare' | 'Package' | 'Transfer' | 'Import' | 'Done' | 'Failed'`
  - `interface ProgressEnvNames { source?: string; target?: string }`
  - `interface FormattedProgress { stage: MigrationStage; statusLine: string; percent: number | null; state: 'active' | 'complete' | 'error' }`
  - `function formatProgress(tp: TransferProgress, envs?: ProgressEnvNames): FormattedProgress`
  - `function classifyError(message: string | undefined): string`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/rift/progress-format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatProgress, classifyError } from '@/lib/rift/progress-format';
import type { TransferProgress } from '@/lib/rift/types';

const base = (over: Partial<TransferProgress>): TransferProgress => ({
  itemPath: '/sitecore/content/Home',
  phase: 'creating',
  ...over,
});

describe('formatProgress', () => {
  it('maps creating to Prepare with an indeterminate bar', () => {
    const r = formatProgress(base({ phase: 'creating' }));
    expect(r).toEqual({ stage: 'Prepare', statusLine: 'Preparing transfer', percent: null, state: 'active' });
  });

  it('uses the source env name when packaging', () => {
    const r = formatProgress(base({ phase: 'exporting' }), { source: 'prod' });
    expect(r.stage).toBe('Package');
    expect(r.statusLine).toBe('Packaging content on prod...');
  });

  it('falls back to generic "target" when no name is given', () => {
    const r = formatProgress(base({ phase: 'uploading', chunksComplete: 6, chunksTotal: 10 }));
    expect(r.statusLine).toBe('Uploading to target (6 of 10)');
  });

  it('computes percent from chunk counts while uploading', () => {
    const r = formatProgress(base({ phase: 'uploading', chunksComplete: 6, chunksTotal: 10 }), { target: 'dev' });
    expect(r).toEqual({ stage: 'Transfer', statusLine: 'Uploading to dev (6 of 10)', percent: 60, state: 'active' });
  });

  it('reports 100 percent and complete state when done', () => {
    const r = formatProgress(base({ phase: 'complete' }));
    expect(r).toEqual({ stage: 'Done', statusLine: 'Done', percent: 100, state: 'complete' });
  });

  it('holds the last known percent on error using retained chunk counts', () => {
    const r = formatProgress(base({ phase: 'error', chunksComplete: 1, chunksTotal: 6, error: 'boom' }));
    expect(r.state).toBe('error');
    expect(r.stage).toBe('Failed');
    expect(r.percent).toBe(17);
  });

  it('omits the chunk suffix and percent when counts are unknown', () => {
    const r = formatProgress(base({ phase: 'downloading' }));
    expect(r.statusLine).toBe('Downloading content');
    expect(r.percent).toBeNull();
  });
});

describe('classifyError', () => {
  it('gives friendly CORS copy for preflight/method errors', () => {
    const msg = 'saveChunk PUT blocked: Method PUT is not allowed by Access-Control-Allow-Methods in preflight response';
    expect(classifyError(msg)).toBe('Upload was blocked by the target environment (CORS). This is an environment-side setting, not a Rift issue.');
  });

  it('gives a generic message for other errors', () => {
    expect(classifyError('Maximum call stack size exceeded')).toBe('Migration failed for this item.');
  });

  it('handles undefined', () => {
    expect(classifyError(undefined)).toBe('Migration failed for this item.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- progress-format`
Expected: FAIL - cannot resolve `@/lib/rift/progress-format` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/rift/progress-format.ts`:

```ts
import type { TransferProgress } from './types';

export type MigrationStage = 'Prepare' | 'Package' | 'Transfer' | 'Import' | 'Done' | 'Failed';

export interface ProgressEnvNames {
  source?: string;
  target?: string;
}

export interface FormattedProgress {
  /** Coarse user-facing stage - used for wording, not shown as a stepper. */
  stage: MigrationStage;
  /** Plain-English status line for the row. */
  statusLine: string;
  /** 0-100 when known; null means indeterminate (show "-" and an animated bar). */
  percent: number | null;
  /** Drives icon and colour. */
  state: 'active' | 'complete' | 'error';
}

const CORS_PATTERN = /cors|access-control|preflight|method (put|delete)/i;

/**
 * Turn a raw transfer error message into human-readable copy. The raw message
 * is still shown in the per-row debug log.
 */
export function classifyError(message: string | undefined): string {
  if (message && CORS_PATTERN.test(message)) {
    return 'Upload was blocked by the target environment (CORS). This is an environment-side setting, not a Rift issue.';
  }
  return 'Migration failed for this item.';
}

function chunkSuffix(tp: TransferProgress): string {
  const { chunksComplete, chunksTotal } = tp;
  if (chunksComplete != null && chunksTotal != null && chunksTotal > 0) {
    return ` (${chunksComplete} of ${chunksTotal})`;
  }
  return '';
}

function percentFor(tp: TransferProgress): number | null {
  if (tp.phase === 'complete') return 100;
  const { chunksComplete, chunksTotal } = tp;
  if (chunksComplete != null && chunksTotal != null && chunksTotal > 0) {
    return Math.round((chunksComplete / chunksTotal) * 100);
  }
  return null;
}

/**
 * Map a TransferProgress to friendly display fields. `envs.source`/`envs.target`
 * are the environment display names; fall back to generic "source"/"target".
 */
export function formatProgress(tp: TransferProgress, envs: ProgressEnvNames = {}): FormattedProgress {
  const source = envs.source ?? 'source';
  const target = envs.target ?? 'target';

  switch (tp.phase) {
    case 'creating':
      return { stage: 'Prepare', statusLine: 'Preparing transfer', percent: null, state: 'active' };
    case 'exporting':
      return { stage: 'Package', statusLine: `Packaging content on ${source}...`, percent: null, state: 'active' };
    case 'downloading':
      return { stage: 'Package', statusLine: `Downloading content${chunkSuffix(tp)}`, percent: percentFor(tp), state: 'active' };
    case 'uploading':
      return { stage: 'Transfer', statusLine: `Uploading to ${target}${chunkSuffix(tp)}`, percent: percentFor(tp), state: 'active' };
    case 'assembling':
      return { stage: 'Transfer', statusLine: `Assembling package on ${target}`, percent: null, state: 'active' };
    case 'consuming':
      return { stage: 'Import', statusLine: `Importing into ${target}`, percent: null, state: 'active' };
    case 'cleanup':
      return { stage: 'Import', statusLine: 'Finishing up', percent: null, state: 'active' };
    case 'complete':
      return { stage: 'Done', statusLine: 'Done', percent: 100, state: 'complete' };
    case 'error':
      return { stage: 'Failed', statusLine: classifyError(tp.error), percent: percentFor(tp), state: 'error' };
    default:
      return { stage: 'Prepare', statusLine: 'Working...', percent: null, state: 'active' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- progress-format`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/progress-format.ts src/__tests__/lib/rift/progress-format.test.ts
git commit -m "rift: add pure progress-format helper for friendly per-path status"
```

---

## Task 2: Rewrite `RiftProgressOverlay` to Option B + debug log

**Files:**
- Modify (full render rewrite): `src/components/rift/RiftProgressOverlay.tsx`

**Interfaces:**
- Consumes: `formatProgress` from `@/lib/rift/progress-format` (Task 1); `TransferProgress` from `@/lib/rift/types`.
- Produces: `RiftProgressOverlay` component with props `{ isActive: boolean; transferProgress: TransferProgress[]; sourceEnvName?: string; targetEnvName?: string; onClose: () => void; onCancel?: () => void }`. Task 3 passes `sourceEnvName`/`targetEnvName`.

Note: no unit test - the project has no React Testing Library. Verify by typecheck + existing suite + manual visual check against the mockup states.

- [ ] **Step 1: Replace the file contents**

Overwrite `src/components/rift/RiftProgressOverlay.tsx` with:

```tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';
import { TransferProgress } from '@/lib/rift/types';
import { formatProgress } from '@/lib/rift/progress-format';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RiftProgressOverlayProps {
  isActive: boolean;
  transferProgress: TransferProgress[];
  sourceEnvName?: string;
  targetEnvName?: string;
  onClose: () => void;
  onCancel?: () => void;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

export function RiftProgressOverlay({
  isActive,
  transferProgress,
  sourceEnvName,
  targetEnvName,
  onClose,
  onCancel,
}: RiftProgressOverlayProps) {
  const startTimeRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finalElapsed, setFinalElapsed] = useState<number | null>(null);
  const [debugAll, setDebugAll] = useState(false);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isActive && !startTimeRef.current) {
      startTimeRef.current = Date.now();
      setFinalElapsed(null);
      setElapsed(0);
    }

    if (isActive) {
      const interval = setInterval(() => {
        if (startTimeRef.current) {
          setElapsed(Date.now() - startTimeRef.current);
        }
      }, 1000);
      return () => clearInterval(interval);
    } else if (startTimeRef.current) {
      setFinalElapsed(Date.now() - startTimeRef.current);
      startTimeRef.current = null;
    }
  }, [isActive]);

  const envs = useMemo(
    () => ({ source: sourceEnvName, target: targetEnvName }),
    [sourceEnvName, targetEnvName]
  );

  const isComplete = !isActive && transferProgress.length > 0;
  const hasError = transferProgress.some((tp) => tp.phase === 'error');
  const displayElapsed = finalElapsed ?? elapsed;
  const doneCount = transferProgress.filter(
    (tp) => tp.phase === 'complete' || tp.phase === 'error'
  ).length;

  if (!isActive && transferProgress.length === 0) return null;

  const toggleRow = (path: string) => {
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="bg-card border-t border-border shadow-lg flex flex-col min-h-0 overflow-hidden h-full">
      {/* Header */}
      <div
        className={cn(
          'px-4 py-2.5 flex items-center justify-between shrink-0 border-b',
          isComplete && !hasError
            ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
            : isComplete && hasError
              ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
              : 'border-border'
        )}
      >
        <span className="text-sm font-medium flex items-center gap-2">
          {isActive && <Loader2 className="w-4 h-4 animate-spin" />}
          {isComplete
            ? hasError
              ? 'Migration completed with errors'
              : 'Migration complete'
            : 'Migrating content'}
        </span>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            {doneCount} of {transferProgress.length} paths done
          </span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {isComplete ? `Total: ${formatElapsed(displayElapsed)}` : formatElapsed(displayElapsed)}
          </span>
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-muted-foreground">
            <input
              type="checkbox"
              checked={debugAll}
              onChange={(e) => setDebugAll(e.target.checked)}
              className="accent-primary"
            />
            Debug log
          </label>
          {isActive && onCancel && (
            <Button variant="ghost" size="sm" colorScheme="danger" onClick={onCancel}>
              Cancel
            </Button>
          )}
          {isComplete && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Back to migrate
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-lg leading-none px-2"
            title="Close"
          >
            &times;
          </Button>
        </div>
      </div>

      {/* Per-path rows */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border">
        {transferProgress.map((tp) => {
          const f = formatProgress(tp, envs);
          const open = debugAll || openRows.has(tp.itemPath);
          const start = tp.events?.[0]?.timestamp;
          const relTime = (ts: number) => (start ? `+${((ts - start) / 1000).toFixed(1)}s` : '');
          const barColor =
            f.state === 'complete'
              ? 'bg-green-500'
              : f.state === 'error'
                ? 'bg-destructive'
                : 'bg-primary';
          const indeterminate = f.percent == null && f.state === 'active';
          return (
            <div key={tp.itemPath}>
              <div
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
                onClick={() => toggleRow(tp.itemPath)}
              >
                {f.state === 'complete' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                ) : f.state === 'error' ? (
                  <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                ) : (
                  <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                )}
                <span className="text-sm font-medium truncate w-44 shrink-0">{tp.itemPath}</span>
                <span
                  className={cn(
                    'text-xs flex-1 truncate',
                    f.state === 'error'
                      ? 'text-destructive'
                      : f.state === 'complete'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-muted-foreground'
                  )}
                >
                  {f.statusLine}
                </span>
                <div className="h-1.5 w-24 rounded-full bg-muted overflow-hidden shrink-0">
                  <div
                    className={cn('h-full rounded-full', barColor, indeterminate && 'animate-pulse')}
                    style={{
                      width: f.percent == null ? '100%' : `${f.percent}%`,
                      opacity: indeterminate ? 0.4 : 1,
                    }}
                  />
                </div>
                <span className="text-[11px] font-mono tabular-nums text-muted-foreground w-8 text-right">
                  {f.percent == null ? '-' : `${f.percent}%`}
                </span>
                <ChevronRight
                  className={cn(
                    'w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform',
                    open && 'rotate-90'
                  )}
                />
              </div>
              {open && (
                <div className="px-3 pb-3 space-y-2">
                  {tp.error && <p className="text-xs text-destructive">{tp.error}</p>}
                  {tp.events && tp.events.length > 0 && (
                    <ul className="font-mono text-[11px] text-muted-foreground space-y-0.5 bg-muted/50 rounded p-2 border border-border max-h-40 overflow-y-auto">
                      {tp.events.map((ev, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="tabular-nums text-muted-foreground/60 w-12 shrink-0">
                            {relTime(ev.timestamp)}
                          </span>
                          <span className="w-20 shrink-0">{ev.phase}</span>
                          <span className="flex-1 break-all">{ev.detail ?? ''}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {transferProgress.length === 0 && isActive && (
          <div className="text-xs text-muted-foreground px-3 py-2">Starting transfer...</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run existing tests to confirm nothing broke**

Run: `npm test`
Expected: PASS (all suites, including Task 1's).

- [ ] **Step 4: Commit**

```bash
git add src/components/rift/RiftProgressOverlay.tsx
git commit -m "rift: friendlier per-path progress overlay with opt-in debug log"
```

---

## Task 3: Wire env names and chunk totals in `RiftMigrate`

**Files:**
- Modify: `src/components/rift/RiftMigrate.tsx` (the `onProgress` callback ~line 361-370, and the `<RiftProgressOverlay ... />` call site ~line 762-771)

**Interfaces:**
- Consumes: `RiftProgressOverlay` (Task 2) new props `sourceEnvName`/`targetEnvName`; `environments`, `selectedSourceEnvId`, `selectedTargetEnvId` already in component scope (used at lines 343-344).
- Produces: nothing new for later tasks.

Note: no unit test (no RTL). Verify by typecheck + existing suite.

- [ ] **Step 1: Populate `chunksTotal` in the progress callback**

In `src/components/rift/RiftMigrate.tsx`, replace this block (inside `onProgress`, currently ~line 362-370):

```ts
        onProgress: (phase, detail) => {
          const chunksComplete = detail ? parseInt(detail.split('/')[0]) : undefined;
          const prev = progress[index];
          const events = [...(prev.events ?? [])];
          const last = events[events.length - 1];
          // Collapse consecutive events with identical phase+detail (uploading 1/10 → 10/10 shouldn't spam)
          if (!last || last.phase !== phase || last.detail !== detail) {
            events.push({ timestamp: Date.now(), phase, detail });
          }
          progress[index] = { ...prev, phase, chunksComplete, events };
          setTransferProgress([...progress]);
        },
```

with:

```ts
        onProgress: (phase, detail) => {
          const [rawComplete, rawTotal] = (detail ?? '').split('/');
          const chunksComplete =
            rawComplete && !Number.isNaN(Number(rawComplete)) ? Number(rawComplete) : undefined;
          const chunksTotal =
            rawTotal && !Number.isNaN(Number(rawTotal)) ? Number(rawTotal) : undefined;
          const prev = progress[index];
          const events = [...(prev.events ?? [])];
          const last = events[events.length - 1];
          // Collapse consecutive events with identical phase+detail (uploading 1/10 -> 10/10 shouldn't spam)
          if (!last || last.phase !== phase || last.detail !== detail) {
            events.push({ timestamp: Date.now(), phase, detail });
          }
          progress[index] = { ...prev, phase, chunksComplete, chunksTotal, events };
          setTransferProgress([...progress]);
        },
```

(Note: this also replaces the one em-dash in the existing comment with a hyphen, per the global no-em-dash rule.)

- [ ] **Step 2: Pass env display names to the overlay**

In the same file, replace the `<RiftProgressOverlay ... />` element (~line 762-771):

```tsx
              <RiftProgressOverlay
                isActive={isMigrating}
                transferProgress={transferProgress}
                onCancel={() => setShowCancelConfirm(true)}
                onClose={() => {
                  setMigrationComplete(false);
                  setTransferProgress([]);
                  setSplitPercent(60);
                }}
              />
```

with:

```tsx
              <RiftProgressOverlay
                isActive={isMigrating}
                transferProgress={transferProgress}
                sourceEnvName={
                  environments.find((e) => e.tenantId === selectedSourceEnvId)?.tenantDisplayName
                }
                targetEnvName={
                  environments.find((e) => e.tenantId === selectedTargetEnvId)?.tenantDisplayName
                }
                onCancel={() => setShowCancelConfirm(true)}
                onClose={() => {
                  setMigrationComplete(false);
                  setTransferProgress([]);
                  setSplitPercent(60);
                }}
              />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run existing tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/rift/RiftMigrate.tsx
git commit -m "rift: feed env names and chunk totals to the progress overlay"
```

---

## Task 4: Version bump and final verification

**Files:**
- Modify: `package.json` (line 3), `src/lib/version.ts` (line 2)

- [ ] **Step 1: Bump `src/lib/version.ts`**

Change:

```ts
export const APP_VERSION = '0.7.10';
```

to:

```ts
export const APP_VERSION = '0.7.11';
```

- [ ] **Step 2: Bump `package.json`**

Change line 3:

```json
  "version": "0.7.10",
```

to:

```json
  "version": "0.7.11",
```

- [ ] **Step 3: Full test + typecheck**

Run: `npm test`
Expected: PASS (all suites).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual visual check (recommended)**

Run: `npm run dev` and open the app inside the Marketplace host (or review the mockup at http://localhost:4173/progress-mockups.html). Confirm: friendly status lines per path; per-row chevron expands the debug log; header "Debug log" toggle expands all; complete row is green, error row is red with the friendly CORS copy and the raw error inside the debug panel.

- [ ] **Step 5: Commit**

```bash
git add package.json src/lib/version.ts
git commit -m "rift: bump to 0.7.11 for friendlier progress overlay"
```

---

## Self-Review

- **Spec coverage:** Option B layout (Task 2); friendly phase mapping + env-name substitution (Task 1 `formatProgress`, Task 3 feeds names); percent incl. error-hold + indeterminate (Task 1 `percentFor`, Task 2 bar); friendly CORS error copy with raw preserved (Task 1 `classifyError`, Task 2 debug panel); debug log per-row + master toggle, default off (Task 2); `chunksTotal` populated (Task 3); data model unchanged (no `types.ts` edits); version bump (Task 4). All spec sections map to a task.
- **Deferred items honoured:** no direction chip, no per-path elapsed, no debug persistence.
- **Type consistency:** `formatProgress`/`classifyError` signatures and the `FormattedProgress` shape are identical across Task 1 (definition), Task 1 tests, and Task 2 (consumer). Overlay props (`sourceEnvName`/`targetEnvName`) defined in Task 2 match what Task 3 passes.
- **No placeholders:** every code step contains complete code.
