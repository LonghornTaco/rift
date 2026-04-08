'use client';

import { useEffect, useRef, useState } from 'react';
import { TransferProgress } from '@/lib/rift/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RiftProgressOverlayProps {
  isActive: boolean;
  transferProgress: TransferProgress[];
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

export function RiftProgressOverlay({ isActive, transferProgress, onClose, onCancel }: RiftProgressOverlayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
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
      setFinalElapsed(Date.now() - startTimeRef.current);
      startTimeRef.current = null;
    }
  }, [isActive]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transferProgress]);

  const isComplete = !isActive && transferProgress.length > 0;
  const hasError = transferProgress.some((tp) => tp.phase === 'error');
  const displayElapsed = finalElapsed ?? elapsed;

  if (!isActive && transferProgress.length === 0) return null;

  return (
    <div className="bg-card border-t border-border shadow-lg flex flex-col min-h-0 overflow-hidden h-full">
      {/* Header */}
      <div className={cn(
        'px-4 py-2.5 flex items-center justify-between shrink-0 border-b',
        isComplete && !hasError
          ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'
          : isComplete && hasError
            ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
            : 'border-border'
      )}>
        <span className="text-sm font-medium">
          {isComplete
            ? (hasError ? 'Migration completed with errors.' : 'Migration complete.')
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

      {/* Timer row */}
      <div className="px-4 py-2 shrink-0 border-b border-border flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          {isActive ? 'Migration in progress' : 'Migration finished'}
        </span>
        <span className="text-xs font-mono text-muted-foreground tabular-nums">
          {isComplete ? `Total: ${formatElapsed(displayElapsed)}` : formatElapsed(displayElapsed)}
        </span>
      </div>

      {/* Transfer progress rows */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-2"
      >
        {transferProgress.map((tp) => (
          <div key={tp.itemPath} className="flex items-center gap-2 py-1">
            <span className="truncate flex-1">{tp.itemPath.split('/').pop()}</span>
            <span className={`text-xs ${tp.phase === 'error' ? 'text-destructive' : tp.phase === 'complete' ? 'text-green-500' : 'text-muted-foreground'}`}>
              {tp.phase}{tp.chunksComplete ? ` (${tp.chunksComplete})` : ''}
            </span>
          </div>
        ))}
        {transferProgress.length === 0 && isActive && (
          <div className="text-xs text-muted-foreground py-1">Starting transfer...</div>
        )}
      </div>
    </div>
  );
}
