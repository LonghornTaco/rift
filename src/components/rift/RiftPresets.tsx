'use client';

import { useState, useEffect } from 'react';
import { RiftPreset, RiftEnvironment, MigrationPath } from '@/lib/rift/types';
import { getPresets, getEnvironments, savePreset, deletePreset, updatePresetLastUsed } from '@/lib/rift/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

interface RiftPresetsProps {
  onLoadPreset: (preset: RiftPreset) => void;
}

const scopeLabels: Record<MigrationPath['scope'], string> = {
  SingleItem: 'Item only',
  ItemAndChildren: 'Item + children',
  ItemAndDescendants: 'Item + descendants',
  ChildrenOnly: 'Children only',
  DescendantsOnly: 'Descendants only',
};

function truncatePath(path: string): string {
  const segments = path.split('/');
  if (segments.length <= 4) return path;
  return '.../' + segments.slice(-3).join('/');
}

export function RiftPresets({ onLoadPreset }: RiftPresetsProps) {
  const [presets, setPresets] = useState<RiftPreset[]>([]);
  const [environments, setEnvironments] = useState<RiftEnvironment[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const refreshPresets = () => {
    setPresets(getPresets());
  };

  useEffect(() => {
    refreshPresets();
    setEnvironments(getEnvironments());
  }, []);

  const handleLoad = (preset: RiftPreset) => {
    updatePresetLastUsed(preset.id);
    onLoadPreset({ ...preset, lastUsed: new Date().toISOString() });
  };

  const startRename = (preset: RiftPreset) => {
    setRenamingId(preset.id);
    setRenameValue(preset.name);
  };

  const confirmRename = (preset: RiftPreset) => {
    if (!renameValue.trim()) return;
    savePreset({ ...preset, name: renameValue.trim() });
    setRenamingId(null);
    setRenameValue('');
    refreshPresets();
  };

  const confirmDelete = () => {
    if (!deleteConfirmId) return;
    deletePreset(deleteConfirmId);
    setDeleteConfirmId(null);
    refreshPresets();
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Top bar */}
      <div className="px-5 py-3 bg-card border-b border-border">
        <div className="text-base font-semibold text-foreground">Presets</div>
      </div>

      {/* Main area */}
      <div className="p-5 flex-1 overflow-y-auto">
        {presets.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No presets saved yet. Create one from the Migrate screen.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {presets.map((preset) => (
            <Card
              key={preset.id}
              style="outline"
              padding="md"
              className="flex flex-col"
            >
              {/* Name / Rename */}
              {renamingId === preset.id ? (
                <div className="flex gap-2 items-center mb-2">
                  <Input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(preset); if (e.key === 'Escape') setRenamingId(null); }}
                    autoFocus
                    className="flex-1 text-sm font-bold"
                  />
                  <Button size="sm" onClick={() => confirmRename(preset)}>Save</Button>
                  <Button size="sm" variant="outline" onClick={() => setRenamingId(null)}>Cancel</Button>
                </div>
              ) : (
                <div className="font-bold text-sm text-foreground">
                  {preset.name}
                </div>
              )}

              {/* Meta line */}
              <div className="text-xs text-muted-foreground mt-1">
                {preset.paths.length} path{preset.paths.length !== 1 ? 's' : ''} &middot; Last used {formatDate(preset.lastUsed)}
              </div>

              {/* Source, target, site */}
              {(preset.sourceEnvId || preset.targetEnvId || preset.siteRootPath) && (
                <div className="text-xs text-muted-foreground mt-2">
                  <div className="flex gap-4">
                    {preset.sourceEnvId && (
                      <span>
                        <span className="font-semibold text-muted-foreground">Source:</span>{' '}
                        {environments.find((e) => e.id === preset.sourceEnvId)?.name ?? 'Unknown'}
                      </span>
                    )}
                    {preset.siteRootPath && (
                      <span>
                        <span className="font-semibold text-muted-foreground">Site:</span>{' '}
                        {preset.siteRootPath.split('/').pop() ?? preset.siteRootPath}
                      </span>
                    )}
                  </div>
                  {preset.targetEnvId && (
                    <div className="mt-0.5">
                      <span className="font-semibold text-muted-foreground">Target:</span>{' '}
                      {environments.find((e) => e.id === preset.targetEnvId)?.name ?? 'Unknown'}
                    </div>
                  )}
                </div>
              )}

              {/* Path list */}
              {preset.paths.length > 0 && (
                <div className="mt-2 px-2.5 py-2 bg-muted rounded border border-border text-xs font-mono leading-[1.8] max-h-[120px] overflow-y-auto">
                  {preset.paths.map((p) => (
                    <div key={p.itemPath} className="flex justify-between gap-2">
                      <span className="text-foreground" title={p.itemPath}>
                        {truncatePath(p.itemPath)}
                      </span>
                      <span className="text-muted-foreground shrink-0">
                        {scopeLabels[p.scope]}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={() => handleLoad(preset)}>
                  Load
                </Button>
                <Button size="sm" variant="outline" onClick={() => startRename(preset)}>
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  colorScheme="danger"
                  onClick={() => setDeleteConfirmId(preset.id)}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Preset</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this preset? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-white hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
