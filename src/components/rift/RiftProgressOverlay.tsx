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
