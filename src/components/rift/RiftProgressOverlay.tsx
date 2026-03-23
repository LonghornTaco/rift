'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export interface MigrationMessage {
  type: string;
  message?: string;
  [key: string]: unknown;
}

interface RiftProgressOverlayProps {
  isActive: boolean;
  messages: MigrationMessage[];
  onClose: () => void;
  onCancel?: () => void;
  parallelPaths?: boolean;
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

export function RiftProgressOverlay({ isActive, messages, onClose, onCancel, parallelPaths }: RiftProgressOverlayProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [copyLabel, setCopyLabel] = useState('Copy Log');
  const startTimeRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finalElapsed, setFinalElapsed] = useState<number | null>(null);

  // Start/stop the timer based on isActive
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
      // Migration just finished — capture final time
      setFinalElapsed(Date.now() - startTimeRef.current);
      startTimeRef.current = null;
    }
  }, [isActive]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const isComplete = lastMessage?.type === 'complete';
  const hasError = messages.some((m) => m.type === 'error');
  const isFinished = isComplete || (!isActive && messages.length > 0);

  const lastPushBatch = [...messages].reverse().find((m) => m.type === 'push-batch');
  const totalItems = (lastMessage?.type === 'complete' ? lastMessage.totalItems : lastPushBatch?.total) as number | undefined;
  const pushedItems = (lastMessage?.type === 'complete' ? lastMessage.pushed : lastPushBatch?.succeeded) as number | undefined;
  const progressPercent = totalItems && pushedItems != null
    ? Math.round((pushedItems / totalItems) * 100)
    : undefined;

  const statusText = (() => {
    if (isComplete) return lastMessage?.message as string;
    const lastStatus = [...messages].reverse().find((m) => m.type === 'status');
    return (lastStatus?.message as string) ?? 'Starting migration...';
  })();

  const pullCompleteMessages = messages.filter((m) => m.type === 'pull-complete');
  const totalPulled = pullCompleteMessages.reduce((sum, m) => sum + ((m.itemCount as number) || 0), 0);

  const displayElapsed = finalElapsed ?? elapsed;

  // Per-path status tracking
  interface PathStatus {
    label: string;
    pulled: number;
    pushed: number;
    total: number;
    complete: boolean;
    hasError: boolean;
    lastStatus: string;
  }

  const pathStatuses = useMemo(() => {
    const map = new Map<number, PathStatus>();
    for (const msg of messages) {
      const idx = msg.pathIndex as number | undefined;
      const label = msg.pathLabel as string | undefined;
      if (idx == null || !label) continue;

      if (!map.has(idx)) {
        map.set(idx, { label, pulled: 0, pushed: 0, total: 0, complete: false, hasError: false, lastStatus: '' });
      }
      const s = map.get(idx)!;

      if (msg.type === 'pull-complete') {
        s.pulled += (msg.itemCount as number) || 0;
      } else if (msg.type === 'push-batch') {
        s.pushed = (msg.succeeded as number) || 0;
        s.total = (msg.total as number) || 0;
      } else if (msg.type === 'complete') {
        s.complete = true;
        s.pushed = (msg.succeeded as number) || 0;
        s.total = (msg.totalItems as number) || 0;
      } else if (msg.type === 'error') {
        s.hasError = true;
      }
      if (msg.type === 'status' && msg.message) {
        s.lastStatus = msg.message as string;
      }
    }
    return Array.from(map.values());
  }, [messages]);

  const getMessageColor = (type: string) => {
    switch (type) {
      case 'error': return 'text-destructive';
      case 'warning': return 'text-amber-600 dark:text-amber-400';
      case 'pull-complete': return 'text-blue-600 dark:text-blue-400';
      case 'push-batch': return 'text-green-600 dark:text-green-400';
      case 'complete': return 'text-green-600 dark:text-green-400 font-semibold';
      case 'debug': return 'text-muted-foreground/60 italic';
      default: return 'text-muted-foreground';
    }
  };

  if (!isActive && messages.length === 0) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-card border-t border-border shadow-lg z-10 flex flex-col max-h-[60%]">
      {/* Header with close button */}
      <div className={cn(
        'px-4 py-2.5 flex items-center justify-between shrink-0 border-b',
        isFinished && !hasError && isComplete && (lastMessage.failed as number) === 0
          ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
          : isFinished && hasError
            ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
            : isFinished
              ? 'bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
              : 'border-border'
      )}>
        <span className="text-sm font-medium">
          {isFinished
            ? (isComplete ? lastMessage?.message as string : 'Migration ended with errors.')
            : 'Migration in progress...'}
        </span>
        <div className="flex items-center gap-1">
          {isActive && onCancel && (
            <Button
              variant="ghost"
              size="sm"
              colorScheme="danger"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
          {isFinished && messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const lines = messages.map((msg) => {
                  const { type, message, ...details } = msg;
                  const extra = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
                  return `[${type}] ${(message as string) ?? ''}${extra}`;
                });

                const complete = messages.find((m) => m.type === 'complete');
                const header = [
                  `Rift Migration Log — ${new Date().toLocaleString()}`,
                  `Elapsed: ${formatElapsed(displayElapsed)}`,
                  complete ? `Result: ${complete.message}` : 'Result: In progress / incomplete',
                  `Total messages: ${messages.length}`,
                  '---',
                ];

                const content = [...header, ...lines].join('\n');

                try {
                  await navigator.clipboard.writeText(content);
                  setCopyLabel('Copied!');
                  setTimeout(() => setCopyLabel('Copy Log'), 2000);
                } catch {
                  // Fallback: open in new window if clipboard fails
                  const w = window.open('', '_blank');
                  if (w) {
                    w.document.write(`<pre>${content.replace(/</g, '&lt;')}</pre>`);
                    w.document.close();
                  }
                }
              }}
              title="Copy migration log to clipboard"
            >
              {copyLabel}
            </Button>
          )}
          {isFinished && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Dismiss
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

      {/* Progress section */}
      <div className="px-4 py-3 shrink-0 border-b border-border">
        {parallelPaths && pathStatuses.length > 1 ? (
          // Per-path compact status rows
          <div className="space-y-1.5">
            <div className="flex items-center justify-end mb-1">
              <span className="text-xs font-mono text-muted-foreground tabular-nums">
                {isFinished ? `Total: ${formatElapsed(displayElapsed)}` : formatElapsed(displayElapsed)}
              </span>
            </div>
            {pathStatuses.map((ps, i) => {
              const pct = ps.total > 0 ? Math.round((ps.pushed / ps.total) * 100) : (ps.complete ? 100 : 0);
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-32 truncate font-medium text-foreground shrink-0" title={ps.label}>{ps.label}</span>
                  <div className="flex-1 min-w-0">
                    <Progress value={ps.complete ? 100 : pct} isIndeterminate={!ps.complete && ps.total === 0 && !ps.hasError} className="h-1.5" />
                  </div>
                  <span className="w-28 text-right text-muted-foreground shrink-0 tabular-nums">
                    {ps.hasError && !ps.complete && <span className="text-destructive">error</span>}
                    {ps.complete && <span className="text-green-600 dark:text-green-400">{ps.pushed} items {'\u2713'}</span>}
                    {!ps.complete && !ps.hasError && ps.total > 0 && <span>{ps.pushed}/{ps.total}</span>}
                    {!ps.complete && !ps.hasError && ps.total === 0 && ps.pulled > 0 && <span>{ps.pulled} pulled</span>}
                    {!ps.complete && !ps.hasError && ps.total === 0 && ps.pulled === 0 && <span>starting...</span>}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          // Single path: original progress bar
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">
                {isActive ? 'Migration in progress' : 'Migration finished'}
              </span>
              <span className="text-xs font-mono text-muted-foreground tabular-nums">
                {isFinished ? `Total: ${formatElapsed(displayElapsed)}` : formatElapsed(displayElapsed)}
              </span>
            </div>
            {isActive && (
              <Progress
                value={progressPercent ?? undefined}
                isIndeterminate={progressPercent == null}
                className="mb-2"
              />
            )}
            <div className="text-xs text-muted-foreground truncate">{statusText}</div>
          </>
        )}
      </div>

      {/* Collapsible details log */}
      <div className="shrink-0">
        <button
          onClick={() => setDetailsOpen((prev) => !prev)}
          className="w-full px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground text-left flex items-center gap-1 cursor-pointer"
        >
          <span className="inline-block transition-transform" style={{ transform: detailsOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            {'\u25B6'}
          </span>
          Details ({messages.length} messages)
        </button>
      </div>

      {detailsOpen && (
        <div
          ref={logRef}
          className="flex-1 min-h-0 overflow-y-auto px-4 py-2 font-mono text-xs space-y-0.5"
        >
          {messages.map((msg, i) => (
            <div key={i} className={getMessageColor(msg.type)}>
              <span className="text-muted-foreground mr-2">[{msg.type}]</span>
              {(msg.message as string) ?? JSON.stringify(msg)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
