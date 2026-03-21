'use client';

import { useState, useEffect } from 'react';
import type { MigrationHistoryEntry } from '@/lib/rift/types';
import { getHistory, clearHistory } from '@/lib/rift/storage';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const statusColors: Record<string, string> = {
  success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  partial: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

const statusLabels: Record<string, string> = {
  success: 'Success',
  partial: 'Partial',
  failed: 'Failed',
};

export function RiftHistory() {
  const [history, setHistory] = useState<MigrationHistoryEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setHistory(getHistory());
  }, []);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-foreground">Migration History</h2>
        {history.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            colorScheme="danger"
            onClick={() => {
              clearHistory();
              setHistory([]);
            }}
          >
            Clear History
          </Button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-12">
          No migration runs yet
        </div>
      ) : (
        <div className="space-y-2">
          {history.map((entry) => (
            <div
              key={entry.id}
              className="border border-border rounded-md bg-card"
            >
              <button
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                className="w-full px-4 py-3 flex items-center justify-between text-left cursor-pointer hover:bg-muted/50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', statusColors[entry.status])}>
                    {statusLabels[entry.status]}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {entry.sourceEnvName} &rarr; {entry.targetEnvName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(entry.date)} &middot; {formatElapsed(entry.elapsedMs)} &middot; {entry.paths.length} {entry.paths.length === 1 ? 'path' : 'paths'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-xs text-muted-foreground text-right">
                    {entry.succeeded > 0 && <span className="text-green-600 dark:text-green-400">{entry.succeeded} ok</span>}
                    {entry.failed > 0 && <span className="text-destructive ml-2">{entry.failed} failed</span>}
                  </div>
                  <span className="text-muted-foreground text-xs">{expandedId === entry.id ? '\u25B2' : '\u25BC'}</span>
                </div>
              </button>

              {expandedId === entry.id && (
                <div className="px-4 pb-3 border-t border-border pt-2">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-2">
                    <div><span className="text-muted-foreground">Total items:</span> <span className="text-foreground">{entry.totalItems}</span></div>
                    <div><span className="text-muted-foreground">Elapsed:</span> <span className="text-foreground">{formatElapsed(entry.elapsedMs)}</span></div>
                    <div><span className="text-muted-foreground">Created:</span> <span className="text-foreground">{entry.created}</span></div>
                    <div><span className="text-muted-foreground">Updated:</span> <span className="text-foreground">{entry.updated}</span></div>
                    <div><span className="text-muted-foreground">Succeeded:</span> <span className="text-green-600 dark:text-green-400">{entry.succeeded}</span></div>
                    <div><span className="text-muted-foreground">Failed:</span> <span className={entry.failed > 0 ? 'text-destructive' : 'text-foreground'}>{entry.failed}</span></div>
                  </div>
                  <div className="text-xs text-muted-foreground font-medium mb-1">Paths:</div>
                  <div className="space-y-0.5">
                    {entry.paths.map((p, i) => (
                      <div key={i} className="text-xs font-mono text-foreground truncate">
                        {p.itemPath} <span className="text-muted-foreground">({p.scope})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
