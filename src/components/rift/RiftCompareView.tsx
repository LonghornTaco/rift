'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { DualTreeNode } from '@/lib/rift/types';
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
  /** Lifted to the parent so the user's preference persists across item switches and panel open/close cycles. */
  showAllFields: boolean;
  onShowAllFieldsChange: (value: boolean) => void;
  showStandardFields: boolean;
  onShowStandardFieldsChange: (value: boolean) => void;
}

export function RiftCompareView({
  client,
  sourceContextId,
  targetContextId,
  node,
  onClose,
  showAllFields,
  onShowAllFieldsChange,
  showStandardFields,
  onShowStandardFieldsChange,
}: RiftCompareViewProps) {
  const [ownFields, setOwnFields] = useState<CompareFieldSets | null>(null);
  const [standardFields, setStandardFields] = useState<CompareFieldSets | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStandard, setLoadingStandard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sideErrors, setSideErrors] = useState<{ source?: boolean; target?: boolean }>({});

  // Resizable column widths (null = use default/auto).
  const [fieldColWidth, setFieldColWidth] = useState<number | null>(null);
  const [sourceColWidth, setSourceColWidth] = useState<number | null>(null);
  const fieldThRef = useRef<HTMLTableCellElement>(null);
  const sourceThRef = useRef<HTMLTableCellElement>(null);

  const startColumnResize = useCallback((col: 'field' | 'source', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ref = col === 'field' ? fieldThRef : sourceThRef;
    const startWidth = ref.current?.offsetWidth ?? 0;
    const startX = e.clientX;
    const setWidth = col === 'field' ? setFieldColWidth : setSourceColWidth;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      setWidth(Math.max(60, startWidth + delta));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // Reset fetched data when the compared item changes. Toggle preferences
  // (showAllFields / showStandardFields) are intentionally not reset — they live
  // in the parent so the user's selection persists across items and close/reopen.
  const nodePath = node.path;
  useEffect(() => {
    setOwnFields(null);
    setStandardFields(null);
    setLoading(true);
    setLoadingStandard(false);
    setError(null);
    setSideErrors({});
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
              onCheckedChange={(v) => onShowAllFieldsChange(v === true)}
            />
            Show all fields
          </label>
        )}
        <label className="text-xs flex items-center gap-1.5 cursor-pointer shrink-0">
          <Checkbox
            checked={showStandardFields}
            onCheckedChange={(v) => onShowStandardFieldsChange(v === true)}
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
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-sm text-muted-foreground text-center px-4">
            {isPaired && !showAllFields ? (
              <>
                <span>No own-field differences.</span>
                {node.diff === 'different' && !showStandardFields && !loadingStandard && (
                  <span className="text-xs max-w-md">
                    This item is flagged as drifted — the difference may be in standard fields. Toggle <strong>Show standard fields</strong> above.
                  </span>
                )}
              </>
            ) : (
              <span>No fields to display</span>
            )}
          </div>
        ) : (
          <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
            <thead className="sticky top-0 bg-card z-10">
              <tr>
                <th
                  ref={fieldThRef}
                  style={{ width: fieldColWidth ?? 180 }}
                  className="relative text-left px-3 py-2 pr-6 font-semibold text-muted-foreground text-xs uppercase tracking-wide border-b border-border whitespace-nowrap"
                >
                  Field
                  {(hasSource || hasTarget) && (
                    <span
                      onMouseDown={(e) => startColumnResize('field', e)}
                      className="absolute top-1/4 right-0 h-1/2 w-px bg-muted-foreground/40 cursor-col-resize hover:bg-muted-foreground/70"
                      aria-hidden="true"
                    />
                  )}
                </th>
                {hasSource && (
                  <th
                    ref={sourceThRef}
                    style={{ width: sourceColWidth ?? undefined }}
                    className="relative text-left px-3 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide border-b border-border"
                  >
                    Source{sideErrors.source && <span className="text-red-500 ml-1">(error)</span>}
                    {hasTarget && (
                      <span
                        onMouseDown={(e) => startColumnResize('source', e)}
                        className="absolute top-1/4 right-0 h-1/2 w-px bg-muted-foreground/40 cursor-col-resize hover:bg-muted-foreground/70"
                        aria-hidden="true"
                      />
                    )}
                  </th>
                )}
                {hasTarget && (
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide border-b border-border">
                    Target{sideErrors.target && <span className="text-red-500 ml-1">(error)</span>}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="border-t border-border align-top">
                  <td className="px-3 py-2 pr-6 font-mono text-xs text-muted-foreground break-words">{row.name}</td>
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
