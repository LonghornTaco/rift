'use client';

import { useState, useEffect } from 'react';
import { RiftPreset, RiftEnvironment } from '@/lib/rift/types';
import { getPresets } from '@/lib/rift/local-storage';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RiftWelcomeProps {
  environments: RiftEnvironment[];
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

export function RiftWelcome({ environments, onNewMigration, onLoadPreset }: RiftWelcomeProps) {
  const [presets, setPresets] = useState<RiftPreset[]>([]);

  useEffect(() => {
    setPresets(getPresets());
  }, []);

  const envName = (tenantId?: string) =>
    environments.find((e) => e.tenantId === tenantId)?.tenantDisplayName ?? '';
  const siteName = (path?: string) => path?.split('/').pop() ?? '';

  return (
    <div className="flex flex-col items-center justify-center min-h-full flex-1 p-8">
      {/* Logo */}
      <img src="/rift-logo.svg" alt="Rift" className="w-16 h-16 mb-4" />

      {/* Heading */}
      <div className="text-[26px] font-bold text-foreground mb-6">
        Welcome to Rift!
      </div>

      {/* Buttons */}
      <div className="mb-8">
        <Button onClick={onNewMigration}>
          New Migration
        </Button>
      </div>

      {/* Saved Presets Section */}
      {presets.length > 0 && (
      <div className="w-full max-w-[520px]">
        <div className="text-[11px] font-semibold text-muted-foreground mb-2 tracking-wide">
          SAVED PRESETS
        </div>

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
                {(preset.sourceTenantId || preset.targetTenantId || preset.siteRootPath) && (
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {envName(preset.sourceTenantId) && <span>{envName(preset.sourceTenantId)}</span>}
                    {envName(preset.targetTenantId) && <span> &rarr; {envName(preset.targetTenantId)}</span>}
                    {siteName(preset.siteRootPath) && <span> &middot; {siteName(preset.siteRootPath)}</span>}
                  </div>
                )}
              </div>
              <div className="text-xs text-primary font-medium">
                Load &rarr;
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}
