'use client';

import { useState, useEffect } from 'react';
import { RiftPreset } from '@/lib/rift/types';
import { getPresets } from '@/lib/rift/storage';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RiftWelcomeProps {
  onNewMigration: () => void;
  onLoadPreset: (preset: RiftPreset) => void;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function RiftWelcome({ onNewMigration, onLoadPreset }: RiftWelcomeProps) {
  const [presets, setPresets] = useState<RiftPreset[]>([]);

  useEffect(() => {
    setPresets(getPresets());
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-full flex-1 p-8">
      {/* Icon */}
      <div className="text-5xl mb-4">{'\u21C4'}</div>

      {/* Heading */}
      <div className="text-[22px] font-bold text-foreground mb-2">
        Start a Migration
      </div>

      {/* Subtitle */}
      <div className="text-[13px] text-muted-foreground max-w-[480px] leading-relaxed text-center mb-6">
        Select an environment and site to browse content, or load a saved preset to pick up where
        you left off.
      </div>

      {/* Buttons */}
      <div className="mb-8">
        <Button onClick={onNewMigration}>
          New Migration
        </Button>
      </div>

      {/* Saved Presets Section */}
      <div className="w-full max-w-[520px]">
        <div className="text-[11px] font-semibold text-muted-foreground mb-2 tracking-wide">
          SAVED PRESETS
        </div>

        {presets.length === 0 ? (
          <div className="text-[13px] text-muted-foreground text-center p-6">
            No saved presets yet
          </div>
        ) : (
          <div className="bg-card border border-border rounded-md">
            {presets.map((preset, index) => (
              <div
                key={preset.id}
                onClick={() => onLoadPreset(preset)}
                className={cn(
                  'px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-muted',
                  index > 0 && 'border-t border-border'
                )}
              >
                <div>
                  <div className="text-[13px] font-semibold text-foreground">
                    {preset.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {preset.paths.length} {preset.paths.length === 1 ? 'path' : 'paths'} &middot; Last used {formatDate(preset.lastUsed)}
                  </div>
                </div>
                <div className="text-xs text-primary font-medium">
                  Load &rarr;
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
