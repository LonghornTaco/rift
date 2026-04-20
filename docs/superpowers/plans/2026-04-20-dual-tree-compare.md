# Dual Tree Field-Diff Panel Implementation Plan (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bottom field-diff panel to Rift's dual tree view — clicking any tree item's icon or name opens a table comparing source and target field values. Bundled tweak: fill folder icons green on match / amber on drift.

**Architecture:** New `RiftCompareView` component rendered below the tree inside the tree column (not spanning the selection pane). State lives in `RiftMigrate`. Pure helper `computeCompareRows` handles diff logic. Lazy-loads standard fields. Existing `fetchItemFields` gains an `{ includeStandard }` option.

**Tech Stack:** Next.js 15 / React 18 / TypeScript, Vitest (node env), Sitecore Marketplace Client SDK, Authoring GraphQL, lucide-react.

**Spec:** `docs/superpowers/specs/2026-04-20-dual-tree-compare-design.md`
**Builds on:** v1 (`2026-04-19-dual-tree-view-design.md`), v2 (`2026-04-20-dual-tree-diff-design.md`)

---

## File Structure

- Modify `src/lib/rift/api-client.ts` — add optional `{ includeStandard }` arg to `fetchItemFields`; toggles the GraphQL `excludeStandardFields` flag.
- Modify `src/__tests__/lib/rift/api-client.test.ts` — test for the new option.
- Create `src/lib/rift/compare-rows.ts` — pure helper `computeCompareRows`.
- Create `src/__tests__/lib/rift/compare-rows.test.ts` — unit tests for the helper.
- Create `src/components/rift/RiftCompareView.tsx` — the bottom panel component.
- Modify `src/components/rift/RiftContentTree.tsx` — wrap icon+name in click-button, add `onCompareItem` / `compareTargetPath` props, tweak folder icon fill classes.
- Modify `src/components/rift/RiftMigrate.tsx` — restructure tree column into vertical split, add compare state + splitter handler, auto-close triggers.
- Modify `src/lib/version.ts` — bump to 0.7.6.
- Modify `package.json` — bump to 0.7.6.

---

## Task 1: Extend `fetchItemFields` with `{ includeStandard }` option

**Files:**
- Modify: `src/lib/rift/api-client.ts`
- Modify: `src/__tests__/lib/rift/api-client.test.ts`

- [ ] **Step 1: Write a failing test**

Append to `src/__tests__/lib/rift/api-client.test.ts`:

```ts
import { fetchItemFields } from '@/lib/rift/api-client';

describe('fetchItemFields', () => {
  it('uses excludeStandardFields=true by default', async () => {
    const mutate = vi.fn().mockResolvedValue({
      data: {
        data: {
          item: {
            itemId: 'i', name: 'n', path: '/p',
            template: { templateId: 't', name: 'T' },
            fields: { nodes: [{ name: 'Title', value: 'Home' }] },
          },
        },
      },
    });
    const client = { mutate, query: vi.fn() } as unknown as ClientSDK;

    await fetchItemFields(client, 'ctx', '/p');

    const call = mutate.mock.calls[0][1];
    expect(call.params.body.query).toContain('excludeStandardFields: true');
    expect(call.params.body.query).toContain('ownFields: true');
  });

  it('uses excludeStandardFields=false when includeStandard is true', async () => {
    const mutate = vi.fn().mockResolvedValue({
      data: {
        data: {
          item: {
            itemId: 'i', name: 'n', path: '/p',
            template: { templateId: 't', name: 'T' },
            fields: { nodes: [] },
          },
        },
      },
    });
    const client = { mutate, query: vi.fn() } as unknown as ClientSDK;

    await fetchItemFields(client, 'ctx', '/p', { includeStandard: true });

    const call = mutate.mock.calls[0][1];
    expect(call.params.body.query).toContain('excludeStandardFields: false');
    expect(call.params.body.query).toContain('ownFields: true');
  });
});
```

- [ ] **Step 2: Run tests — verify the second test fails**

Run: `npm test -- api-client`
Expected: The `includeStandard: true` test FAILS because the current implementation hardcodes `excludeStandardFields: true` regardless of arguments.

- [ ] **Step 3: Update `fetchItemFields` to accept the option**

In `src/lib/rift/api-client.ts`, replace the entire `fetchItemFields` function with:

```ts
/**
 * Fetch item fields via Authoring GraphQL API.
 * - Default: returns item's own non-standard fields.
 * - `includeStandard: true`: returns own fields INCLUDING standard fields (`__Updated`,
 *   `__Revision`, security metadata, etc.). Used for on-demand compare view expansion.
 */
export async function fetchItemFields(
  client: ClientSDK,
  contextId: string,
  itemPath: string,
  options?: { includeStandard?: boolean },
): Promise<{ itemId: string; name: string; path: string; templateId: string; templateName: string; fields: Record<string, string> }> {
  const excludeStandard = !options?.includeStandard;
  const query = {
    query: `query GetItemFields($path: String!) {
      item(where: { path: $path }) {
        itemId name path
        template { templateId: itemId name }
        fields(ownFields: true, excludeStandardFields: ${excludeStandard}) {
          nodes { name value }
        }
      }
    }`,
    variables: { path: itemPath },
  };

  const response = await client.mutate('xmc.authoring.graphql', {
    params: { query: { sitecoreContextId: contextId }, body: query },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const item = (response.data as any)?.data?.item;
  if (!item) throw new Error(`Item not found: ${itemPath}`);

  const fields: Record<string, string> = {};
  for (const f of item.fields?.nodes ?? []) {
    fields[f.name] = f.value;
  }

  return {
    itemId: item.itemId,
    name: item.name,
    path: item.path,
    templateId: item.template?.templateId ?? '',
    templateName: item.template?.name ?? '',
    fields,
  };
}
```

Note the template-literal injection of `excludeStandard` is safe — it's a bool, not user input.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- api-client`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/api-client.ts src/__tests__/lib/rift/api-client.test.ts
git commit -m "rift api-client: fetchItemFields gains includeStandard option for v3"
```

---

## Task 2: Pure helper `computeCompareRows` + tests

**Files:**
- Create: `src/lib/rift/compare-rows.ts`
- Create: `src/__tests__/lib/rift/compare-rows.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/lib/rift/compare-rows.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeCompareRows } from '@/lib/rift/compare-rows';

describe('computeCompareRows', () => {
  const own = {
    source: { Title: 'Home', Body: 'Welcome' },
    target: { Title: 'Home', Body: 'Howdy' },
  };

  it('defaults to only-different rows when showAllFields is false', () => {
    const result = computeCompareRows(own, null, false, false);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'Body', source: 'Welcome', target: 'Howdy', isDifferent: true });
  });

  it('returns all own fields when showAllFields is true', () => {
    const result = computeCompareRows(own, null, true, false);
    expect(result.map((r) => r.name)).toEqual(['Body', 'Title']);
    expect(result.find((r) => r.name === 'Title')?.isDifferent).toBe(false);
    expect(result.find((r) => r.name === 'Body')?.isDifferent).toBe(true);
  });

  it('flags a field present on one side but not the other as different', () => {
    const partial = {
      source: { Title: 'Home', Only: 'X' },
      target: { Title: 'Home' },
    };
    const result = computeCompareRows(partial, null, true, false);
    const onlyRow = result.find((r) => r.name === 'Only');
    expect(onlyRow?.isDifferent).toBe(true);
    expect(onlyRow?.source).toBe('X');
    expect(onlyRow?.target).toBe('');
  });

  it('merges standard fields when showStandardFields is true', () => {
    const std = {
      source: { __Updated: '20260419T120000Z' },
      target: { __Updated: '20260420T090000Z' },
    };
    const result = computeCompareRows(own, std, true, true);
    expect(result.map((r) => r.name)).toEqual(['__Updated', 'Body', 'Title']);
    expect(result.find((r) => r.name === '__Updated')?.isDifferent).toBe(true);
  });

  it('omits standard fields when showStandardFields is false even if provided', () => {
    const std = {
      source: { __Updated: '20260419T120000Z' },
      target: { __Updated: '20260419T120000Z' },
    };
    const result = computeCompareRows(own, std, true, false);
    expect(result.map((r) => r.name)).not.toContain('__Updated');
  });

  it('handles one-sided data (source-only row)', () => {
    const sourceOnly = { source: { Title: 'Home' }, target: undefined };
    const result = computeCompareRows(sourceOnly, null, true, false);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'Title', source: 'Home', target: '', isDifferent: true });
  });

  it('handles null ownFields gracefully (still loading)', () => {
    const result = computeCompareRows(null, null, true, false);
    expect(result).toEqual([]);
  });

  it('sorts fields alphabetically', () => {
    const unsorted = {
      source: { zebra: '1', apple: '2', mango: '3' },
      target: { zebra: '1', apple: '2', mango: '3' },
    };
    const result = computeCompareRows(unsorted, null, true, false);
    expect(result.map((r) => r.name)).toEqual(['apple', 'mango', 'zebra']);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- compare-rows`
Expected: All 8 tests fail with "computeCompareRows is not a function" (file doesn't exist yet).

- [ ] **Step 3: Implement `computeCompareRows`**

Create `src/lib/rift/compare-rows.ts`:

```ts
export interface CompareRow {
  name: string;
  source: string;
  target: string;
  isDifferent: boolean;
}

export interface CompareFieldSets {
  source?: Record<string, string>;
  target?: Record<string, string>;
}

/**
 * Derive the rows rendered in the compare panel's table from fetched field data.
 *
 * - Merges own and (when showStandardFields) standard fields per side.
 * - Computes the union of field names across sides, sorted alphabetically.
 * - A field missing on one side counts as different against an empty string.
 * - When showAllFields is false, filters out rows where source equals target.
 * - Returns [] when ownFields is null (initial load has not completed).
 */
export function computeCompareRows(
  ownFields: CompareFieldSets | null,
  standardFields: CompareFieldSets | null,
  showAllFields: boolean,
  showStandardFields: boolean,
): CompareRow[] {
  if (!ownFields) return [];

  const sourceMap = {
    ...(ownFields.source ?? {}),
    ...(showStandardFields ? standardFields?.source ?? {} : {}),
  };
  const targetMap = {
    ...(ownFields.target ?? {}),
    ...(showStandardFields ? standardFields?.target ?? {} : {}),
  };

  const names = new Set<string>([
    ...Object.keys(sourceMap),
    ...Object.keys(targetMap),
  ]);

  const rows: CompareRow[] = [];
  for (const name of Array.from(names).sort()) {
    const source = sourceMap[name] ?? '';
    const target = targetMap[name] ?? '';
    rows.push({ name, source, target, isDifferent: source !== target });
  }

  return showAllFields ? rows : rows.filter((r) => r.isDifferent);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- compare-rows`
Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rift/compare-rows.ts src/__tests__/lib/rift/compare-rows.test.ts
git commit -m "rift: add pure computeCompareRows helper for field-diff panel"
```

---

## Task 3: `RiftCompareView` component

**Files:**
- Create: `src/components/rift/RiftCompareView.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/rift/RiftCompareView.tsx`:

```tsx
'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { DualTreeNode, TreeNode } from '@/lib/rift/types';
import { fetchItemFields } from '@/lib/rift/api-client';
import { computeCompareRows, type CompareFieldSets } from '@/lib/rift/compare-rows';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

interface RiftCompareViewProps {
  client: ClientSDK;
  sourceContextId: string;
  targetContextId: string | null;
  node: DualTreeNode;
  onClose: () => void;
}

export function RiftCompareView({
  client,
  sourceContextId,
  targetContextId,
  node,
  onClose,
}: RiftCompareViewProps) {
  const [ownFields, setOwnFields] = useState<CompareFieldSets | null>(null);
  const [standardFields, setStandardFields] = useState<CompareFieldSets | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStandard, setLoadingStandard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sideErrors, setSideErrors] = useState<{ source?: boolean; target?: boolean }>({});
  const [showAllFields, setShowAllFields] = useState(false);
  const [showStandardFields, setShowStandardFields] = useState(false);

  // Reset state when the compared item changes.
  const nodePath = node.path;
  useEffect(() => {
    setOwnFields(null);
    setStandardFields(null);
    setLoading(true);
    setLoadingStandard(false);
    setError(null);
    setSideErrors({});
    setShowStandardFields(false);
  }, [nodePath]);

  const hasSource = !!node.source;
  const hasTarget = !!node.target && targetContextId !== null;
  const isPaired = hasSource && hasTarget;

  // Initial own-fields fetch on node change.
  useEffect(() => {
    let cancelled = false;

    const fetchOwn = async () => {
      const sourcePromise: Promise<Record<string, string> | undefined> = hasSource
        ? fetchItemFields(client, sourceContextId, node.path)
            .then((r) => r.fields)
            .catch(() => {
              if (!cancelled) setSideErrors((prev) => ({ ...prev, source: true }));
              return undefined;
            })
        : Promise.resolve(undefined);

      const targetPromise: Promise<Record<string, string> | undefined> = hasTarget && targetContextId
        ? fetchItemFields(client, targetContextId, node.path)
            .then((r) => r.fields)
            .catch(() => {
              if (!cancelled) setSideErrors((prev) => ({ ...prev, target: true }));
              return undefined;
            })
        : Promise.resolve(undefined);

      const [source, target] = await Promise.all([sourcePromise, targetPromise]);
      if (cancelled) return;
      setOwnFields({ source, target });
      setLoading(false);

      if (!source && !target) {
        setError('Failed to load fields from both environments.');
      }
    };

    fetchOwn();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.path, sourceContextId, targetContextId]);

  // Lazy-fetch standard fields only when the toggle flips on for the first time.
  useEffect(() => {
    if (!showStandardFields) return;
    if (standardFields) return; // already fetched for this item

    let cancelled = false;
    setLoadingStandard(true);

    const fetchStandard = async () => {
      const sourcePromise: Promise<Record<string, string> | undefined> = hasSource
        ? fetchItemFields(client, sourceContextId, node.path, { includeStandard: true })
            .then((r) => r.fields)
            .catch(() => undefined)
        : Promise.resolve(undefined);

      const targetPromise: Promise<Record<string, string> | undefined> = hasTarget && targetContextId
        ? fetchItemFields(client, targetContextId, node.path, { includeStandard: true })
            .then((r) => r.fields)
            .catch(() => undefined)
        : Promise.resolve(undefined);

      const [source, target] = await Promise.all([sourcePromise, targetPromise]);
      if (cancelled) return;
      setStandardFields({ source, target });
      setLoadingStandard(false);
    };

    fetchStandard();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStandardFields, node.path]);

  // Escape-key close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = useMemo(
    () => computeCompareRows(ownFields, standardFields, showAllFields, showStandardFields),
    [ownFields, standardFields, showAllFields, showStandardFields],
  );

  return (
    <div className="flex flex-col h-full min-h-0 bg-card">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border shrink-0">
        <div className="flex-1 min-w-0 text-xs font-mono text-muted-foreground truncate" title={node.path}>
          {node.path}
        </div>
        {isPaired && (
          <label className="text-xs flex items-center gap-1.5 cursor-pointer shrink-0">
            <Checkbox
              checked={showAllFields}
              onCheckedChange={(v) => setShowAllFields(v === true)}
            />
            Show all fields
          </label>
        )}
        <label className="text-xs flex items-center gap-1.5 cursor-pointer shrink-0">
          <Checkbox
            checked={showStandardFields}
            onCheckedChange={(v) => setShowStandardFields(v === true)}
          />
          Show standard fields
          {loadingStandard && <span className="text-muted-foreground">...</span>}
        </label>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-xl leading-none px-1 shrink-0"
          aria-label="Close compare panel"
          title="Close (Esc)"
        >
          &times;
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground gap-2">
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading fields...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-8 text-sm text-red-500">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            {isPaired && !showAllFields ? 'No field differences' : 'No fields to display'}
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-card z-10">
              <tr>
                <th className="text-left px-3 py-2 w-[30%] font-semibold text-muted-foreground text-xs uppercase tracking-wide border-b border-border">Field</th>
                {hasSource && (
                  <th className="text-left px-3 py-2 w-[35%] font-semibold text-muted-foreground text-xs uppercase tracking-wide border-b border-border">
                    Source{sideErrors.source && <span className="text-red-500 ml-1">(error)</span>}
                  </th>
                )}
                {hasTarget && (
                  <th className="text-left px-3 py-2 w-[35%] font-semibold text-muted-foreground text-xs uppercase tracking-wide border-b border-border">
                    Target{sideErrors.target && <span className="text-red-500 ml-1">(error)</span>}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground break-words">{row.name}</td>
                  {hasSource && (
                    <td className="px-3 py-2 whitespace-pre-wrap break-words">
                      {sideErrors.source ? <span className="text-red-500">Failed to load</span> : row.source}
                    </td>
                  )}
                  {hasTarget && (
                    <td className={cn(
                      'px-3 py-2 whitespace-pre-wrap break-words',
                      row.isDifferent && isPaired && 'bg-amber-500/10',
                    )}>
                      {sideErrors.target ? <span className="text-red-500">Failed to load</span> : row.target}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (ignore the pre-existing `content-transfer.test.ts` tuple error).

- [ ] **Step 3: Commit**

```bash
git add src/components/rift/RiftCompareView.tsx
git commit -m "rift: add RiftCompareView component for v3 field-diff panel"
```

---

## Task 4: Wire click handling into `RiftContentTree`

**Files:**
- Modify: `src/components/rift/RiftContentTree.tsx`

- [ ] **Step 1: Add new props to `RiftContentTreeProps`**

In `src/components/rift/RiftContentTree.tsx`, find `interface RiftContentTreeProps` and add two fields:

```ts
interface RiftContentTreeProps {
  client: ClientSDK;
  contextId: string;
  targetContextId: string | null;
  rootPath: string;
  selectedPaths: MigrationPath[];
  onTogglePath: (node: TreeNode) => void;
  inheritedPaths: Set<string>;
  onChildrenLoaded?: (parentPath: string, children: TreeNode[]) => void;
  disabled?: boolean;
  refreshKey?: number;
  onCompareItem: (node: DualTreeNode) => void;
  compareTargetPath: string | null;
}
```

Destructure both in the component function signature.

- [ ] **Step 2: Add same props to `TreeNodeRowProps`**

Find `interface TreeNodeRowProps` and add:

```ts
interface TreeNodeRowProps {
  // ...existing fields...
  onCompareItem: (node: DualTreeNode) => void;
  compareTargetPath: string | null;
}
```

Also destructure `onCompareItem` and `compareTargetPath` in the `TreeNodeRow` function signature, and pass both down in its recursive child render.

- [ ] **Step 3: Add both props to `baseTreeRowProps`**

Inside `RiftContentTree`, find `const baseTreeRowProps = { ... }` and add the two new fields:

```ts
const baseTreeRowProps = {
  expandedNodes,
  loadingNodes,
  selectedPathSet,
  inheritedPaths,
  childrenCache,
  onExpand: handleExpand,
  onTogglePath,
  showHiddenItems,
  disabledAncestorPaths: pathInfo?.contentAncestorPaths,
  targetContextId,
  onCompareItem,
  compareTargetPath,
};
```

- [ ] **Step 4: Update `SourceCell` to accept click props and wrap icon+name in a button**

Replace `SourceCellProps` and the `SourceCell` function. `SourceCellProps` gains two fields; the rendered markup wraps `Icon + name` in a `<button>`:

```tsx
interface SourceCellProps {
  node: DualTreeNode;
  isSelected: boolean;
  isInherited: boolean;
  isAncestorDisabled: boolean;
  onTogglePath: (node: TreeNode) => void;
  onCompareItem: (node: DualTreeNode) => void;
  isCompareTarget: boolean;
}

function SourceCell({
  node,
  isSelected,
  isInherited,
  isAncestorDisabled,
  onTogglePath,
  onCompareItem,
  isCompareTarget,
}: SourceCellProps) {
  if (!node.source) {
    return <GhostSlot />;
  }

  const Icon = node.hasChildren ? Folder : File;

  return (
    <div className="flex items-center gap-1 min-w-0">
      <Checkbox
        checked={isSelected || isInherited}
        onCheckedChange={() => onTogglePath(node.source!)}
        disabled={isInherited || isAncestorDisabled}
        className={cn(
          'shrink-0',
          (isInherited || isAncestorDisabled) && 'opacity-50 pointer-events-none'
        )}
      />

      <button
        type="button"
        onClick={() => onCompareItem(node)}
        className={cn(
          'flex items-center gap-1 min-w-0 text-left rounded-sm px-1 -mx-1',
          isCompareTarget && 'bg-accent/60',
        )}
      >
        <Icon
          className={cn('w-4 h-4 shrink-0 text-muted-foreground', isAncestorDisabled && 'opacity-40')}
          aria-hidden="true"
        />
        <span
          className={cn(
            'truncate',
            isSelected ? 'font-bold' : 'font-normal',
            (isInherited || isAncestorDisabled) ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {node.name}
        </span>
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Update `TargetCell` to accept click props and wrap icon+name in a button**

Replace `TargetCellProps` and the inner rendering. The em-dash and ghost branches stay unchanged (no click there):

```tsx
interface TargetCellProps {
  node: DualTreeNode;
  targetContextId: string | null;
  onCompareItem: (node: DualTreeNode) => void;
  isCompareTarget: boolean;
}

function TargetCell({ node, targetContextId, onCompareItem, isCompareTarget }: TargetCellProps) {
  if (targetContextId === null) {
    return (
      <div className="flex items-center min-w-0 text-muted-foreground/60 text-sm">
        &mdash;
      </div>
    );
  }

  if (!node.target) {
    return <GhostSlot tone="warning" />;
  }

  const tint = node.diff === 'different' ? 'text-amber-500' : 'text-muted-foreground';
  const Icon = node.hasChildren ? Folder : File;

  return (
    <button
      type="button"
      onClick={() => onCompareItem(node)}
      className={cn(
        'flex items-center gap-1 min-w-0 text-left rounded-sm px-1 -mx-1',
        tint,
        isCompareTarget && 'bg-accent/60',
      )}
      title={node.diff === 'different' ? 'Target differs from source' : undefined}
    >
      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{node.target.name}</span>
    </button>
  );
}
```

- [ ] **Step 6: Update the two `SourceCell` / `TargetCell` call sites to pass the new props**

There are two render paths in `RiftContentTree.tsx` that render rows: `TreeNodeRow` and `renderFilteredBranch`. Each has one `<SourceCell ... />` and one `<TargetCell ... />` invocation.

In both call sites, add `onCompareItem={onCompareItem}` and `isCompareTarget={compareTargetPath === node.path}` props:

```tsx
<SourceCell
  node={node}
  isSelected={isSelected}
  isInherited={isInherited}
  isAncestorDisabled={isAncestorDisabled}
  onTogglePath={onTogglePath}
  onCompareItem={onCompareItem}
  isCompareTarget={compareTargetPath === node.path}
/>
```

```tsx
<TargetCell
  node={node}
  targetContextId={targetContextId}
  onCompareItem={onCompareItem}
  isCompareTarget={compareTargetPath === node.path}
/>
```

- [ ] **Step 7: Type-check + test**

Run: `npx tsc --noEmit && npm test`
Expected: Type-check passes except for the pre-existing `content-transfer.test.ts` error. All tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/rift/RiftContentTree.tsx
git commit -m "rift tree: wire icon+name click to onCompareItem, add compareTargetPath highlight"
```

---

## Task 5: Wire compare panel into `RiftMigrate`

**Files:**
- Modify: `src/components/rift/RiftMigrate.tsx`

- [ ] **Step 1: Import the new component**

At the top of `src/components/rift/RiftMigrate.tsx`, add:

```ts
import { RiftCompareView } from './RiftCompareView';
```

And in the types import from `@/lib/rift/types`, include `DualTreeNode`:

```ts
import {
  // ...existing imports
  DualTreeNode,
} from '@/lib/rift/types';
```

- [ ] **Step 2: Add compare state**

Inside `RiftMigrate`, near the other `useState` / `useRef` declarations (right after `splitPercent` and `treeRefreshKey`):

```ts
const [compareTarget, setCompareTarget] = useState<DualTreeNode | null>(null);
const [comparePercent, setComparePercent] = useState(35);
const compareColumnRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 3: Add click + splitter handlers**

Near the existing `handleSplitterMouseDown`:

```ts
const handleCompareItemClick = useCallback((node: DualTreeNode) => {
  setCompareTarget((prev) => (prev?.path === node.path ? null : node));
}, []);

const handleCompareSplitterMouseDown = useCallback((e: React.MouseEvent) => {
  e.preventDefault();
  const container = compareColumnRef.current;
  if (!container) return;

  const onMouseMove = (moveEvent: MouseEvent) => {
    const rect = container.getBoundingClientRect();
    const y = moveEvent.clientY - rect.top;
    const pct = Math.min(80, Math.max(0, 100 - (y / rect.height) * 100));
    setComparePercent(pct);
    if (pct < 3) setCompareTarget(null);
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

- [ ] **Step 4: Add auto-close triggers**

Below the handlers, add three effects that close the panel on relevant state changes:

```ts
// Close compare panel when target env deselected.
useEffect(() => {
  if (!selectedTargetEnvId && compareTarget?.target) {
    setCompareTarget(null);
  }
}, [selectedTargetEnvId, compareTarget]);

// Close compare panel when tree is refreshed or when source env/site changes.
useEffect(() => {
  setCompareTarget(null);
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [treeRefreshKey, selectedSourceEnvId, selectedSiteRootPath]);

// Close compare panel when a preset is loaded.
useEffect(() => {
  if (loadedPreset) setCompareTarget(null);
}, [loadedPreset]);
```

- [ ] **Step 5: Restructure the tree column to host the compare panel**

Find the tree column (currently at the `<RiftContentTree ... />` usage — around line 624):

```tsx
<div className="flex-1 border-r border-border p-4 overflow-y-auto">
  {selectedSourceEnvId && selectedSiteRootPath ? (
    <RiftContentTree ... />
  ) : (
    <div className="text-sm text-muted-foreground">
      Select a site to browse the content tree
    </div>
  )}
</div>
```

Replace the entire wrapping div with this structure:

```tsx
<div ref={compareColumnRef} className="flex-1 border-r border-border flex flex-col min-h-0">
  <div className="flex-1 min-h-0 overflow-y-auto p-4">
    {selectedSourceEnvId && selectedSiteRootPath ? (
      <RiftContentTree
        client={client}
        contextId={environments.find((e) => e.tenantId === selectedSourceEnvId)!.contextId}
        targetContextId={
          selectedTargetEnvId
            ? environments.find((e) => e.tenantId === selectedTargetEnvId)?.contextId ?? null
            : null
        }
        rootPath={selectedSiteRootPath}
        selectedPaths={selectedPaths}
        onTogglePath={handleTogglePath}
        inheritedPaths={inheritedPaths}
        onChildrenLoaded={handleChildrenLoaded}
        disabled={isMigrating}
        refreshKey={treeRefreshKey}
        onCompareItem={handleCompareItemClick}
        compareTargetPath={compareTarget?.path ?? null}
      />
    ) : (
      <div className="text-sm text-muted-foreground">
        Select a site to browse the content tree
      </div>
    )}
  </div>

  {compareTarget && selectedSourceEnvId && (
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
          sourceContextId={environments.find((e) => e.tenantId === selectedSourceEnvId)!.contextId}
          targetContextId={
            selectedTargetEnvId
              ? environments.find((e) => e.tenantId === selectedTargetEnvId)?.contextId ?? null
              : null
          }
          node={compareTarget}
          onClose={() => setCompareTarget(null)}
        />
      </div>
    </>
  )}
</div>
```

Note: the existing wrapper had `overflow-y-auto p-4` at the outer level. The scroll + padding moves inward to the tree's own wrapper so the compare panel hangs below without inheriting scroll.

- [ ] **Step 6: Type-check + test**

Run: `npx tsc --noEmit && npm test`
Expected: Type check passes (aside from pre-existing). All tests pass.

- [ ] **Step 7: Manual sanity check**

Run: `npm run dev`. Open browser. Confirm tree still renders, clicking a folder name opens the compare panel, clicking again closes it, and Escape closes it.

- [ ] **Step 8: Commit**

```bash
git add src/components/rift/RiftMigrate.tsx
git commit -m "rift: wire compare panel into RiftMigrate (state, splitter, auto-close)"
```

---

## Task 6: Bundled tweak — folder icon fill colors

**Files:**
- Modify: `src/components/rift/RiftContentTree.tsx`

- [ ] **Step 1: Helper for icon classes**

Near the top of `src/components/rift/RiftContentTree.tsx` (after imports), add a small helper:

```ts
function getFolderIconClasses(diff: DualTreeNode['diff']): string {
  if (diff === 'match') return 'fill-emerald-500/30 stroke-emerald-500';
  if (diff === 'different') return 'fill-amber-500/30 stroke-amber-500';
  return '';
}
```

Place it right below the other top-level subcomponents (e.g. above `SourceCell`).

- [ ] **Step 2: Apply to `SourceCell`'s Icon**

In `SourceCell`, find the `<Icon ... />` invocation and extend its className with the helper. Replace:

```tsx
<Icon
  className={cn('w-4 h-4 shrink-0 text-muted-foreground', isAncestorDisabled && 'opacity-40')}
  aria-hidden="true"
/>
```

with:

```tsx
<Icon
  className={cn(
    'w-4 h-4 shrink-0 text-muted-foreground',
    getFolderIconClasses(node.diff),
    isAncestorDisabled && 'opacity-40',
  )}
  aria-hidden="true"
/>
```

- [ ] **Step 3: Apply to `TargetCell`'s Icon**

In `TargetCell`, find the `<Icon ... />` inside the real-target branch. Replace:

```tsx
<Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
```

with:

```tsx
<Icon
  className={cn('w-4 h-4 shrink-0', getFolderIconClasses(node.diff))}
  aria-hidden="true"
/>
```

Since the button wrapper already applies the `tint` color (`text-amber-500` or `text-muted-foreground`) on the parent, leave that alone. The `fill-*` / `stroke-*` utilities override the text tint for the SVG paths, which is what we want.

- [ ] **Step 4: Type-check + test**

Run: `npx tsc --noEmit && npm test`
Expected: All green.

- [ ] **Step 5: Commit**

```bash
git add src/components/rift/RiftContentTree.tsx
git commit -m "rift tree: fill folder icons emerald on match, amber on drift"
```

---

## Task 7: Version bump + final sanity

**Files:**
- Modify: `src/lib/version.ts`
- Modify: `package.json`

- [ ] **Step 1: Bump the version**

In `src/lib/version.ts`:

```ts
export const APP_VERSION = '0.7.6';
```

In `package.json`:

```json
"version": "0.7.6",
```

- [ ] **Step 2: Final type-check + test**

Run: `npx tsc --noEmit && npm test`
Expected: Only the pre-existing unrelated `content-transfer.test.ts` tuple error. All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/version.ts package.json
git commit -m "bump to 0.7.6 for dual tree compare panel (v3)"
```

- [ ] **Step 4: Manual QA checklist**

Run `npm run dev`. In browser (http://localhost:3001):

1. Pick source + target envs + site. Tree renders as before.
2. Click a folder name with both sides present and drift → compare panel opens with three-column table defaulting to only-different rows.
3. Toggle "Show all fields" on → all own fields appear; matching ones visible.
4. Toggle "Show standard fields" on → brief inline spinner, then standard fields (including `__Updated`, `__Revision`) appear mixed in.
5. Click same folder again → panel closes.
6. Click a different folder → panel content swaps; "Show standard fields" resets to off for the new item.
7. Press Escape → panel closes.
8. Click X button → panel closes.
9. Drag splitter handle up and down → panel resizes. Drag it near the bottom (small height) → panel auto-closes.
10. Click a source-only folder (gray ghost on target) → panel opens with two-column table ("Field" | "Value").
11. Click target-only folder → mirror of 10.
12. Deselect target env while panel is open → panel closes.
13. Refresh tree → panel closes.
14. Load a preset → panel closes.
15. Folder icons: match rows show green-filled icon, drift rows show amber-filled icon on both source AND target sides.
16. About dialog bottom-left shows `0.7.6`.

---

## Self-Review Checklist

- [x] **Spec coverage**: every requirement in `2026-04-20-dual-tree-compare-design.md` maps to a task (fetchItemFields option → T1; compute helper → T2; RiftCompareView with all states + Esc + lazy standard fetch → T3; click plumbing → T4; layout + state + auto-close → T5; folder fill → T6; version bump → T7).
- [x] **No placeholders** — every code step shows exact code.
- [x] **Type consistency** — `DualTreeNode.diff`, `CompareFieldSets`, `computeCompareRows(ownFields, standardFields, showAllFields, showStandardFields)`, `onCompareItem(node)`, `compareTargetPath` all match across tasks.
- [x] **Scope check** — single feature with one bundled polish tweak, appropriate for a single plan.
