'use client';

import type { DriftRollup } from '@/lib/rift/drift-rollup';
import { cn } from '@/lib/utils';

const BASE_CLASSES =
  'inline-flex items-center shrink-0 ml-1 rounded-full border px-1.5 text-[10px] leading-4';

/**
 * Small pill shown after a folder name: how many items beneath it differ or are missing on
 * target. Renders nothing when there is no roll-up or the subtree is fully scanned and clean.
 */
export function DriftPill({ rollup }: { rollup?: DriftRollup }) {
  if (!rollup) return null;

  if (rollup.count > 0) {
    const label = `${rollup.count} items beneath differ or are missing on target${
      rollup.complete ? '' : ' (still scanning)'
    }`;
    return (
      <span
        className={cn(BASE_CLASSES, 'border-amber-500/50 bg-amber-500/15 text-amber-500')}
        title={label}
        aria-label={label}
      >
        {rollup.count}
      </span>
    );
  }

  if (!rollup.complete) {
    return (
      <span
        className={cn(BASE_CLASSES, 'border-border text-muted-foreground/70')}
        title="Not scanned yet"
        aria-label="Not scanned yet"
      >
        ?
      </span>
    );
  }

  return null;
}
