'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import {
  RiftPreset,
  RiftEnvironment,
  MigrationPath,
  MigrationHistoryEntry,
  TreeNode,
  SiteInfo,
  RiftSettings,
  DEFAULT_SETTINGS,
  TransferProgress,
  TransferPhase,
} from '@/lib/rift/types';
import { getPresets, savePreset, getSettings, saveSettings, addHistoryEntry } from '@/lib/rift/local-storage';
import { fetchSites, fetchTreeChildren } from '@/lib/rift/api-client';
import { transferPath } from '@/lib/rift/content-transfer';
import { RiftContentTree } from './RiftContentTree';
import { RiftSelectionPanel } from './RiftSelectionPanel';
import { RiftConfirmDialog } from './RiftConfirmDialog';
import { RiftProgressOverlay, MigrationMessage } from './RiftProgressOverlay';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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

// --- Component ---

interface RiftMigrateProps {
  client: ClientSDK;
  environments: RiftEnvironment[];
  loadedPreset: RiftPreset | null;
  onBack: () => void;
}

export function RiftMigrate({ client, environments, loadedPreset, onBack }: RiftMigrateProps) {
  const [parallelPaths, setParallelPaths] = useState(DEFAULT_SETTINGS.parallelPaths);

  // Load persisted settings
  useEffect(() => {
    const s = getSettings();
    setParallelPaths(s.parallelPaths);
  }, []);

  const [selectedSourceEnvId, setSelectedSourceEnvId] = useState<string | null>(null);
  const [selectedTargetEnvId, setSelectedTargetEnvId] = useState<string | null>(null);
  const [selectedSiteRootPath, setSelectedSiteRootPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<MigrationPath[]>(
    loadedPreset?.paths ?? []
  );

  const [sites, setSites] = useState<(SiteInfo & { collection: string })[]>([]);
  const [isLoadingSites, setIsLoadingSites] = useState(false);
  const [loadedTreeNodes, setLoadedTreeNodes] = useState<Map<string, TreeNode[]>>(new Map());
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationComplete, setMigrationComplete] = useState(false);
  const [transferProgress, setTransferProgress] = useState<TransferProgress[]>([]);

  const [splitPercent, setSplitPercent] = useState(60);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const splitterContainerRef = useRef<HTMLDivElement>(null);
  const [showPresetInput, setShowPresetInput] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [overwritePresetId, setOverwritePresetId] = useState<string | null>(null);
  const [confirmingOverwrite, setConfirmingOverwrite] = useState(false);
  const [existingPresets, setExistingPresets] = useState<RiftPreset[]>([]);

  const handleChildrenLoaded = useCallback((parentPath: string, children: TreeNode[]) => {
    setLoadedTreeNodes((prev) => new Map(prev).set(parentPath, children));
  }, []);

  const addPathToSelection = useCallback((node: TreeNode) => {
    setSelectedPaths((prev) => {
      if (prev.find((p) => p.itemPath === node.path)) {
        return prev.filter((p) => p.itemPath !== node.path);
      }
      return [...prev, { itemPath: node.path, itemId: node.itemId, scope: 'ItemAndDescendants' }];
    });
  }, []);

  const handleTogglePath = useCallback(
    (node: TreeNode) => {
      const exists = selectedPaths.find((p) => p.itemPath === node.path);
      if (exists) {
        setSelectedPaths((prev) => prev.filter((p) => p.itemPath !== node.path));
        return;
      }
      addPathToSelection(node);
    },
    [selectedPaths, addPathToSelection]
  );

  const handleRemovePath = useCallback((itemPath: string) => {
    setSelectedPaths((prev) => prev.filter((p) => p.itemPath !== itemPath));
  }, []);

  const handleChangeScope = useCallback((itemPath: string, scope: MigrationPath['scope']) => {
    setSelectedPaths((prev) =>
      prev.map((p) => (p.itemPath === itemPath ? { ...p, scope } : p))
    );
  }, []);

  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitterContainerRef.current;
    if (!container) return;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const y = moveEvent.clientY - rect.top;
      const pct = Math.min(80, Math.max(20, (y / rect.height) * 100));
      setSplitPercent(pct);
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

  const handleSavePreset = useCallback(() => {
    setShowPresetInput(true);
    setPresetName('');
    setOverwritePresetId(null);
    setConfirmingOverwrite(false);
    setExistingPresets(getPresets());
  }, []);

  const confirmSavePreset = useCallback(() => {
    if (!presetName.trim() && !overwritePresetId) return;
    const preset: RiftPreset = {
      id: overwritePresetId ?? crypto.randomUUID(),
      name: presetName.trim() || existingPresets.find((p) => p.id === overwritePresetId)?.name || 'Unnamed',
      paths: selectedPaths,
      lastUsed: new Date().toISOString(),
      sourceTenantId: selectedSourceEnvId ?? undefined,
      targetTenantId: selectedTargetEnvId ?? undefined,
      siteRootPath: selectedSiteRootPath ?? undefined,
    };
    savePreset(preset);
    setShowPresetInput(false);
    setPresetName('');
    setOverwritePresetId(null);
  }, [presetName, overwritePresetId, existingPresets, selectedPaths, selectedSourceEnvId, selectedTargetEnvId, selectedSiteRootPath]);

  const inheritedPaths = useMemo(() => {
    const inherited = new Set<string>();
    for (const sp of selectedPaths) {
      if (sp.scope === 'SingleItem') continue;

      if (sp.scope === 'ItemAndDescendants') {
        for (const [, children] of loadedTreeNodes) {
          for (const child of children) {
            if (child.path !== sp.itemPath && child.path.startsWith(sp.itemPath + '/')) {
              inherited.add(child.path);
            }
          }
        }
      } else if (sp.scope === 'ItemAndChildren') {
        const directChildren = loadedTreeNodes.get(sp.itemPath);
        if (directChildren) {
          for (const child of directChildren) {
            inherited.add(child.path);
          }
        }
      }
    }
    for (const sp of selectedPaths) {
      inherited.delete(sp.itemPath);
    }
    return inherited;
  }, [selectedPaths, loadedTreeNodes]);

  // Handle source environment change
  const handleSourceEnvChange = useCallback(
    async (tenantId: string) => {
      setSelectedSourceEnvId(tenantId);
      setSelectedSiteRootPath(null);
      setSites([]);
      setSelectedPaths([]);
      setLoadedTreeNodes(new Map());

      if (!tenantId) return;

      // Clear target if it matches the new source
      if (selectedTargetEnvId === tenantId) {
        setSelectedTargetEnvId(null);
      }

      const env = environments.find((e) => e.tenantId === tenantId);
      if (!env) return;

      try {
        setIsLoadingSites(true);
        const fetchedSites = await fetchSites(client, env.contextId);
        setSites(fetchedSites);
      } catch (err) {
        console.error('[Rift] Failed to load sites:', err);
        setSites([]);
      } finally {
        setIsLoadingSites(false);
      }
    },
    [client, environments, selectedTargetEnvId]
  );

  // Handle target environment change
  const handleTargetEnvChange = useCallback((tenantId: string) => {
    setSelectedTargetEnvId(tenantId);
  }, []);

  // Sync state when loadedPreset changes
  useEffect(() => {
    if (!loadedPreset) return;
    if (loadedPreset.paths) {
      setSelectedPaths(loadedPreset.paths);
    }
    if (loadedPreset.sourceTenantId) {
      handleSourceEnvChange(loadedPreset.sourceTenantId);
    }
    if (loadedPreset.targetTenantId) {
      setSelectedTargetEnvId(loadedPreset.targetTenantId);
    }
  }, [loadedPreset]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply pending site selection once sites finish loading
  useEffect(() => {
    if (loadedPreset?.siteRootPath && sites.length > 0 && !isLoadingSites) {
      const match = sites.find((s) => s.rootPath === loadedPreset.siteRootPath);
      if (match) {
        setSelectedSiteRootPath(loadedPreset.siteRootPath);
      }
    }
  }, [loadedPreset?.siteRootPath, sites, isLoadingSites]);

  const targetEnvironments = environments.filter(
    (e) => e.tenantId !== selectedSourceEnvId
  );

  const canStartMigration =
    selectedSourceEnvId && selectedSiteRootPath && selectedTargetEnvId && selectedPaths.length > 0 && !isMigrating;

  const canSavePreset = selectedPaths.length > 0;

  // --- Migration execution ---

  async function executeMigration(paths: MigrationPath[]) {
    setIsMigrating(true);
    setMigrationComplete(false);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const startTime = Date.now();

    const sourceEnv = environments.find((e) => e.tenantId === selectedSourceEnvId)!;
    const targetEnv = environments.find((e) => e.tenantId === selectedTargetEnvId)!;

    const progress: TransferProgress[] = paths.map((p) => ({
      itemPath: p.itemPath,
      phase: 'creating' as TransferPhase,
    }));
    setTransferProgress([...progress]);

    const settings = getSettings();
    const transfers = paths.map((path, index) => {
      return transferPath(client, {
        sourceContextId: sourceEnv.contextId,
        targetContextId: targetEnv.contextId,
        itemPath: path.itemPath,
        scope: path.scope,
        signal: controller.signal,
        onProgress: (phase, detail) => {
          progress[index] = { ...progress[index], phase, chunksComplete: detail ? parseInt(detail) : undefined };
          setTransferProgress([...progress]);
        },
      }).catch((err) => {
        progress[index] = { ...progress[index], phase: 'error', error: err.message };
        setTransferProgress([...progress]);
      });
    });

    try {
      if (settings.parallelPaths) {
        await Promise.allSettled(transfers);
      } else {
        for (const transfer of transfers) {
          await transfer;
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled — handled gracefully
      } else {
        console.error('[Rift] Migration failed:', err);
      }
    } finally {
      abortControllerRef.current = null;
      setIsMigrating(false);
      setMigrationComplete(true);

      // Save history entry
      const elapsed = Date.now() - startTime;
      const hasErrors = progress.some((p) => p.phase === 'error');
      addHistoryEntry({
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        sourceEnvName: sourceEnv.tenantDisplayName,
        targetEnvName: targetEnv.tenantDisplayName,
        paths: paths.map((p) => ({ itemPath: p.itemPath, scope: p.scope })),
        elapsedMs: elapsed,
        status: hasErrors ? (progress.every((p) => p.phase === 'error') ? 'failed' : 'partial') : 'success',
      });
    }
  }

  // --- Render ---

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Top Bar */}
      <div className="bg-card border-b border-border px-5 py-3 flex items-center gap-4 shrink-0">
        {/* Back button */}
        <Button variant="ghost" size="sm" onClick={onBack}>
          &larr; Back
        </Button>

        {/* Source Environment */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-0.5">SOURCE ENVIRONMENT</div>
          <Select value={selectedSourceEnvId ?? undefined} onValueChange={handleSourceEnvChange} disabled={isMigrating}>
            <SelectTrigger size="sm">
              <SelectValue placeholder="Select environment..." />
            </SelectTrigger>
            <SelectContent>
              {environments.map((env) => (
                <SelectItem key={env.tenantId} value={env.tenantId}>
                  {env.tenantDisplayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Site */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-0.5">SITE</div>
          <Select
            value={selectedSiteRootPath ?? undefined}
            onValueChange={(val) => setSelectedSiteRootPath(val)}
            disabled={!selectedSourceEnvId || isLoadingSites || isMigrating}
          >
            <SelectTrigger size="sm">
              <SelectValue
                placeholder={
                  isLoadingSites
                    ? 'Loading sites...'
                    : !selectedSourceEnvId
                      ? 'Select environment first'
                      : 'Select site...'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {sites.map((site) => (
                <SelectItem key={site.rootPath} value={site.rootPath}>
                  {site.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Arrow separator */}
        <div className="text-lg text-muted-foreground">&rarr;</div>

        {/* Target Environment */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-0.5">TARGET ENVIRONMENT</div>
          <Select value={selectedTargetEnvId ?? undefined} onValueChange={handleTargetEnvChange} disabled={isMigrating}>
            <SelectTrigger size="sm">
              <SelectValue placeholder="Select target..." />
            </SelectTrigger>
            <SelectContent>
              {targetEnvironments.map((env) => (
                <SelectItem key={env.tenantId} value={env.tenantId}>
                  {env.tenantDisplayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Refresh Tree */}
        <Button
          variant="outline"
          size="sm"
          disabled={!selectedSourceEnvId || !selectedSiteRootPath || isMigrating}
          onClick={() => setTreeRefreshKey((k) => k + 1)}
          title="Refresh content tree"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 21h5v-5" />
          </svg>
          Refresh
        </Button>

        {/* Save Preset */}
        <Button
          variant="outline"
          size="sm"
          disabled={!canSavePreset}
          onClick={handleSavePreset}
        >
          {'\u2605'} Save Preset
        </Button>

        {/* Start Migration + Settings */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!canStartMigration}
            onClick={() => {
              if (canStartMigration) {
                setShowConfirmDialog(true);
              }
            }}
          >
            {'\u26A1'} Start Migration
          </Button>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="text-xl text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Migration settings"
          >
            {'\u2699\uFE0F'}
          </button>
        </div>
      </div>

      {/* Migration Settings Modal */}
      <Dialog open={showSettingsModal} onOpenChange={setShowSettingsModal}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Migration Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs font-semibold text-foreground">Migrate Paths in Parallel</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Process all selected paths simultaneously instead of one at a time. Faster, but uses more resources.
                </p>
              </div>
              <Switch
                checked={parallelPaths}
                onCheckedChange={(checked) => {
                  setParallelPaths(checked);
                  saveSettings({ ...getSettings(), parallelPaths: checked });
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowSettingsModal(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      {showConfirmDialog && selectedSourceEnvId && selectedTargetEnvId && (
        <RiftConfirmDialog
          sourceName={environments.find((e) => e.tenantId === selectedSourceEnvId)?.tenantDisplayName ?? selectedSourceEnvId}
          targetName={environments.find((e) => e.tenantId === selectedTargetEnvId)?.tenantDisplayName ?? selectedTargetEnvId}
          paths={selectedPaths}
          onCancel={() => setShowConfirmDialog(false)}
          onConfirm={() => {
            setShowConfirmDialog(false);
            executeMigration(selectedPaths);
          }}
        />
      )}

      {/* Preset save modal */}
      <Dialog open={showPresetInput} onOpenChange={(open) => { if (!open) { setShowPresetInput(false); setConfirmingOverwrite(false); } }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Save Preset</DialogTitle>
          </DialogHeader>

          {confirmingOverwrite && overwritePresetId ? (
            <div className="space-y-3">
              <p className="text-sm text-foreground">
                Are you sure you want to overwrite <strong>{existingPresets.find((p) => p.id === overwritePresetId)?.name}</strong>?
              </p>
              <p className="text-xs text-muted-foreground">
                This will replace the saved paths and settings with your current selection.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setConfirmingOverwrite(false); setOverwritePresetId(null); }}>
                  Back
                </Button>
                <Button onClick={confirmSavePreset}>
                  Overwrite
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-semibold text-foreground mb-1">
                  Preset Name
                </Label>
                <Input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && presetName.trim()) confirmSavePreset(); }}
                  autoFocus
                  placeholder="e.g. Full Site Content"
                />
              </div>

              {existingPresets.length > 0 && (
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1">
                    Existing Presets
                  </Label>
                  <div className="border border-border rounded-md max-h-[160px] overflow-y-auto">
                    {existingPresets.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => {
                          setOverwritePresetId(p.id);
                          setConfirmingOverwrite(true);
                        }}
                        className="px-3 py-2 text-sm cursor-pointer border-b border-border last:border-b-0 flex justify-between items-center text-foreground hover:bg-muted"
                      >
                        <span>{p.name}</span>
                        <span className="text-xs text-muted-foreground">{p.paths.length} {p.paths.length === 1 ? 'path' : 'paths'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPresetInput(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => { setOverwritePresetId(null); confirmSavePreset(); }}
                  disabled={!presetName.trim()}
                >
                  Save as New
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Main content area with optional bottom splitter */}
      <div ref={splitterContainerRef} className="flex flex-col flex-1 min-h-0">
        {/* Two-panel layout (tree + selection) */}
        <div
          className="flex min-h-0 overflow-hidden"
          style={{
            flex: (isMigrating || migrationComplete) ? `0 0 ${splitPercent}%` : '1 1 auto',
          }}
        >
          {/* Left panel — content tree */}
          <div className="flex-1 border-r border-border p-4 overflow-y-auto">
            {selectedSourceEnvId && selectedSiteRootPath ? (
              <RiftContentTree
                rootPath={selectedSiteRootPath}
                selectedPaths={selectedPaths}
                onTogglePath={handleTogglePath}
                inheritedPaths={inheritedPaths}
                onChildrenLoaded={handleChildrenLoaded}
                disabled={isMigrating}
                refreshKey={treeRefreshKey}
              />
            ) : (
              <div className="text-sm text-muted-foreground">
                Select a site to browse the content tree
              </div>
            )}
          </div>

          {/* Right panel — selected paths */}
          <div className="w-[300px] p-4 bg-card overflow-y-auto">
            <RiftSelectionPanel
              selectedPaths={selectedPaths}
              onRemovePath={handleRemovePath}
              onChangeScope={handleChangeScope}
              onClearAll={() => setSelectedPaths([])}
            />
          </div>
        </div>

        {/* Draggable splitter + Migration progress */}
        {(isMigrating || migrationComplete) && (
          <>
            {/* Splitter handle */}
            <div
              onMouseDown={handleSplitterMouseDown}
              className="h-1.5 bg-border hover:bg-primary/40 cursor-row-resize flex items-center justify-center shrink-0 transition-colors"
            >
              <div className="w-8 h-0.5 bg-muted-foreground/40 rounded-full" />
            </div>

            {/* Progress panel */}
            <div className="min-h-0" style={{ flex: `0 0 ${100 - splitPercent}%` }}>
              <RiftProgressOverlay
                isActive={isMigrating}
                messages={transferProgress as unknown as MigrationMessage[]}
                parallelPaths={parallelPaths}
                onCancel={() => setShowCancelConfirm(true)}
                onClose={() => {
                  setMigrationComplete(false);
                  setTransferProgress([]);
                  setSplitPercent(60);
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* Cancel confirmation */}
      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Migration</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this migration? Content that has already been transferred to the target environment will not be rolled back. This may leave the target in a partially updated state.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Migration</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700 active:bg-red-800"
              onClick={() => {
                abortControllerRef.current?.abort();
              }}
            >
              Cancel Migration
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
