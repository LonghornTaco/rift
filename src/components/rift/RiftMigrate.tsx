'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RiftPreset, RiftEnvironment, MigrationPath, MigrationHistoryEntry, MigrationLogLevel, TreeNode, SiteInfo, DEFAULT_SETTINGS } from '@/lib/rift/types';
import { getEnvironments, getPresets, savePreset, addHistoryEntry, getSettings, saveSettings } from '@/lib/rift/storage';
import { authenticate } from '@/lib/rift/sitecore-auth';
import { fetchSites } from '@/lib/rift/api-client';
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

interface RiftMigrateProps {
  loadedPreset: RiftPreset | null;
  onBack: () => void;
}

export function RiftMigrate({ loadedPreset, onBack }: RiftMigrateProps) {
  const [batchSize, setBatchSize] = useState(DEFAULT_SETTINGS.batchSize);
  const [logLevel, setLogLevel] = useState<MigrationLogLevel>(DEFAULT_SETTINGS.logLevel);
  const [parallelPaths, setParallelPaths] = useState(DEFAULT_SETTINGS.parallelPaths);

  // Load persisted settings
  useEffect(() => {
    const s = getSettings();
    setBatchSize(s.batchSize);
    setLogLevel(s.logLevel);
    setParallelPaths(s.parallelPaths ?? false);
  }, []);
  const [environments, setEnvironments] = useState<RiftEnvironment[]>([]);
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);
  const [selectedSiteRootPath, setSelectedSiteRootPath] = useState<string | null>(null);
  const [selectedTargetEnvId, setSelectedTargetEnvId] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<MigrationPath[]>(
    loadedPreset?.paths ?? []
  );

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [sites, setSites] = useState<(SiteInfo & { collection: string })[]>([]);
  const [isLoadingSites, setIsLoadingSites] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingSiteRootPath, setPendingSiteRootPath] = useState<string | null>(null);
  const [loadedTreeNodes, setLoadedTreeNodes] = useState<Map<string, TreeNode[]>>(new Map());
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [pendingDangerousNode, setPendingDangerousNode] = useState<TreeNode | null>(null);
  const [showIarSecondWarning, setShowIarSecondWarning] = useState(false);
  const [showIarMigrationWarning, setShowIarMigrationWarning] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationMessages, setMigrationMessages] = useState<MigrationMessage[]>([]);
  const [migrationComplete, setMigrationComplete] = useState(false);
  const migrationStartRef = useRef<number>(0);
  const [showPresetInput, setShowPresetInput] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [overwritePresetId, setOverwritePresetId] = useState<string | null>(null);
  const [confirmingOverwrite, setConfirmingOverwrite] = useState(false);
  const [existingPresets, setExistingPresets] = useState<RiftPreset[]>([]);
  const [isRestoringPreset, setIsRestoringPreset] = useState(!!loadedPreset?.sourceEnvId);
  // Track whether we're still waiting for the full workspace to be ready
  const isWorkspaceLoading = isRestoringPreset || (!!loadedPreset?.sourceEnvId && isLoadingSites) || (!!loadedPreset?.siteRootPath && pendingSiteRootPath !== null);

  const handleChildrenLoaded = useCallback((parentPath: string, children: TreeNode[]) => {
    setLoadedTreeNodes((prev) => new Map(prev).set(parentPath, children));
  }, []);

  // Paths that are typically managed by IAR files and should not be migrated
  const IAR_DANGEROUS_NAMES = new Set(['presentation', 'settings', 'dictionary', 'media']);

  const isDangerousPath = useCallback((path: string): boolean => {
    if (!path.toLowerCase().startsWith('/sitecore/content/')) return false;
    const lastSegment = path.split('/').pop()?.toLowerCase() ?? '';
    return IAR_DANGEROUS_NAMES.has(lastSegment);
  }, []);

  const isAncestorOfDangerousPaths = useCallback((path: string): string[] => {
    if (!path.toLowerCase().startsWith('/sitecore/content/')) return [];
    const children = loadedTreeNodes.get(path) ?? [];
    return children
      .filter((c) => IAR_DANGEROUS_NAMES.has(c.name.toLowerCase()))
      .map((c) => c.name);
  }, [loadedTreeNodes]);

  const selectedPathsContainIarItems = useCallback((): string[] => {
    const found: string[] = [];
    for (const sp of selectedPaths) {
      if (!sp.itemPath.toLowerCase().startsWith('/sitecore/content/')) continue;
      const lastSegment = sp.itemPath.split('/').pop()?.toLowerCase() ?? '';
      if (IAR_DANGEROUS_NAMES.has(lastSegment)) {
        found.push(sp.itemPath);
        continue;
      }
      // Check if descendants scope would include dangerous children
      if (sp.scope === 'ItemAndDescendants' || sp.scope === 'ItemAndChildren') {
        const children = loadedTreeNodes.get(sp.itemPath) ?? [];
        for (const c of children) {
          if (IAR_DANGEROUS_NAMES.has(c.name.toLowerCase())) {
            found.push(c.path);
          }
        }
      }
    }
    return found;
  }, [selectedPaths, loadedTreeNodes]);

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
      // If deselecting, just remove
      const exists = selectedPaths.find((p) => p.itemPath === node.path);
      if (exists) {
        setSelectedPaths((prev) => prev.filter((p) => p.itemPath !== node.path));
        return;
      }

      // Check if the path itself is dangerous
      if (isDangerousPath(node.path)) {
        setPendingDangerousNode(node);
        return;
      }

      // Check if selecting with descendants would include dangerous children
      const dangerousChildren = isAncestorOfDangerousPaths(node.path);
      if (dangerousChildren.length > 0) {
        setPendingDangerousNode(node);
        return;
      }

      addPathToSelection(node);
    },
    [selectedPaths, isDangerousPath, isAncestorOfDangerousPaths, addPathToSelection]
  );

  const handleRemovePath = useCallback((itemPath: string) => {
    setSelectedPaths((prev) => prev.filter((p) => p.itemPath !== itemPath));
  }, []);

  const handleChangeScope = useCallback((itemPath: string, scope: MigrationPath['scope']) => {
    setSelectedPaths((prev) =>
      prev.map((p) => (p.itemPath === itemPath ? { ...p, scope } : p))
    );
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
      sourceEnvId: selectedEnvId ?? undefined,
      targetEnvId: selectedTargetEnvId ?? undefined,
      siteRootPath: selectedSiteRootPath ?? undefined,
    };
    savePreset(preset);
    setShowPresetInput(false);
    setPresetName('');
    setOverwritePresetId(null);
  }, [presetName, overwritePresetId, existingPresets, selectedPaths, selectedEnvId, selectedTargetEnvId, selectedSiteRootPath]);

  const inheritedPaths = useMemo(() => {
    const inherited = new Set<string>();
    for (const sp of selectedPaths) {
      if (sp.scope === 'SingleItem') continue;

      if (sp.scope === 'ItemAndDescendants') {
        // Check all loaded nodes — any whose path starts with selectedPath + "/" is inherited
        for (const [, children] of loadedTreeNodes) {
          for (const child of children) {
            if (child.path !== sp.itemPath && child.path.startsWith(sp.itemPath + '/')) {
              inherited.add(child.path);
            }
          }
        }
      } else if (sp.scope === 'ItemAndChildren') {
        // Only direct children of the selected node
        const directChildren = loadedTreeNodes.get(sp.itemPath);
        if (directChildren) {
          for (const child of directChildren) {
            inherited.add(child.path);
          }
        }
      }
    }
    // Don't mark explicitly selected items as inherited
    for (const sp of selectedPaths) {
      inherited.delete(sp.itemPath);
    }
    return inherited;
  }, [selectedPaths, loadedTreeNodes]);

  useEffect(() => {
    getEnvironments().then(setEnvironments);
  }, []);

  const handleEnvChange = useCallback(
    async (envId: string) => {
      setSelectedEnvId(envId);
      setSelectedSiteRootPath(null);
      setSites([]);
      setAccessToken(null);
      setAuthError(null);

      if (!envId) return;

      const envs = await getEnvironments();
      const env = envs.find((e) => e.id === envId);
      if (!env) return;

      // Clear target if it matches the new source
      if (selectedTargetEnvId === envId) {
        setSelectedTargetEnvId(null);
      }

      try {
        setIsLoadingSites(true);
        const result = await authenticate(env.clientId, env.clientSecret);
        setAccessToken(result.accessToken);
        const fetchedSites = await fetchSites(env.cmUrl, result.accessToken);
        setSites(fetchedSites);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Authentication failed');
        setSites([]);
        setAccessToken(null);
      } finally {
        setIsLoadingSites(false);
      }
    },
    [selectedTargetEnvId]
  );

  // Sync state when loadedPreset changes (e.g. loading from Presets page)
  useEffect(() => {
    if (!loadedPreset) return;
    if (loadedPreset.paths) {
      setSelectedPaths(loadedPreset.paths);
    }
    if (loadedPreset.sourceEnvId) {
      handleEnvChange(loadedPreset.sourceEnvId);
    }
    if (loadedPreset.targetEnvId) {
      setSelectedTargetEnvId(loadedPreset.targetEnvId);
    }
    if (loadedPreset.siteRootPath) {
      setPendingSiteRootPath(loadedPreset.siteRootPath);
    }
  }, [loadedPreset]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply pending site selection once sites finish loading
  useEffect(() => {
    if (pendingSiteRootPath && sites.length > 0 && !isLoadingSites) {
      const match = sites.find((s) => s.rootPath === pendingSiteRootPath);
      if (match) {
        setSelectedSiteRootPath(pendingSiteRootPath);
      }
      setPendingSiteRootPath(null);
      setIsRestoringPreset(false);
    }
  }, [pendingSiteRootPath, sites, isLoadingSites]);

  // Also clear restoring state if there's no pending site (preset had no site saved)
  useEffect(() => {
    if (isRestoringPreset && !pendingSiteRootPath && !isLoadingSites && selectedEnvId) {
      setIsRestoringPreset(false);
    }
  }, [isRestoringPreset, pendingSiteRootPath, isLoadingSites, selectedEnvId]);

  const targetEnvironments = environments.filter(
    (e) => e.id !== selectedEnvId && e.allowWrite
  );

  const canStartMigration =
    selectedEnvId && selectedSiteRootPath && selectedTargetEnvId && selectedPaths.length > 0 && !isMigrating;

  const canSavePreset = selectedPaths.length > 0;

  if (isWorkspaceLoading) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 text-muted-foreground">
        <svg className="animate-spin h-12 w-12" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-base">
          {isLoadingSites ? 'Connecting to environment...' : 'Loading preset...'}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Top Bar */}
      <div className="bg-card border-b border-border px-5 py-3 flex items-center gap-4 shrink-0">
        {/* Back button */}
        <Button variant="ghost" size="sm" onClick={onBack}>
          &larr; Back
        </Button>

        {/* Environment */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-0.5">SOURCE ENVIRONMENT</div>
          <Select value={selectedEnvId ?? undefined} onValueChange={handleEnvChange} disabled={isMigrating}>
            <SelectTrigger size="sm">
              <SelectValue placeholder="Select environment..." />
            </SelectTrigger>
            <SelectContent>
              {environments.map((env) => (
                <SelectItem key={env.id} value={env.id}>
                  {env.name}
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
            disabled={!selectedEnvId || isLoadingSites || isMigrating}
          >
            <SelectTrigger size="sm">
              <SelectValue
                placeholder={
                  isLoadingSites
                    ? 'Loading sites...'
                    : !selectedEnvId
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

        {/* Target */}
        <div>
          <div className="text-xs font-semibold text-muted-foreground mb-0.5">TARGET ENVIRONMENT</div>
          <Select value={selectedTargetEnvId ?? undefined} onValueChange={(val) => setSelectedTargetEnvId(val)} disabled={isMigrating}>
            <SelectTrigger size="sm">
              <SelectValue placeholder="Select target..." />
            </SelectTrigger>
            <SelectContent>
              {targetEnvironments.map((env) => (
                <SelectItem key={env.id} value={env.id}>
                  {env.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Auth error */}
        {authError && (
          <div className="text-xs text-destructive max-w-[200px]">{authError}</div>
        )}

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
                const iarPaths = selectedPathsContainIarItems();
                if (iarPaths.length > 0) {
                  setShowIarMigrationWarning(true);
                } else {
                  setShowConfirmDialog(true);
                }
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
            <div>
              <Label className="text-xs font-semibold text-foreground mb-1">Batch Size</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Number of items pushed per request. Larger batches are faster but may timeout on slow connections.
              </p>
              <Select
                value={String(batchSize)}
                onValueChange={(val) => {
                  const size = Number(val);
                  setBatchSize(size);
                  saveSettings({ ...getSettings(), batchSize: size });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25 (conservative)</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="200">200 (default)</SelectItem>
                  <SelectItem value="500">500 (aggressive)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold text-foreground mb-1">Log Level</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Controls the detail level of messages in the migration log.
              </p>
              <Select
                value={logLevel}
                onValueChange={(val) => {
                  const level = val as MigrationLogLevel;
                  setLogLevel(level);
                  saveSettings({ ...getSettings(), logLevel: level });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ERROR">Error — only failures</SelectItem>
                  <SelectItem value="WARNING">Warning — failures and warnings</SelectItem>
                  <SelectItem value="INFORMATION">Information — standard detail (default)</SelectItem>
                  <SelectItem value="DEBUG">Debug — maximum detail</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border">
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
      {showConfirmDialog && selectedEnvId && selectedTargetEnvId && (
        <RiftConfirmDialog
          sourceName={environments.find((e) => e.id === selectedEnvId)?.name ?? selectedEnvId}
          targetName={environments.find((e) => e.id === selectedTargetEnvId)?.name ?? selectedTargetEnvId}
          paths={selectedPaths}
          onCancel={() => setShowConfirmDialog(false)}
          onConfirm={async () => {
            setShowConfirmDialog(false);
            setIsMigrating(true);
            setMigrationMessages([]);
            setMigrationComplete(false);
            migrationStartRef.current = Date.now();
            const abortController = new AbortController();
            abortControllerRef.current = abortController;

            const localMessages: MigrationMessage[] = [];
            const addMsg = (msg: MigrationMessage) => {
              localMessages.push(msg);
              setMigrationMessages((prev) => [...prev, msg]);
            };

            try {
              const sourceEnv = environments.find((e) => e.id === selectedEnvId);
              const targetEnv = environments.find((e) => e.id === selectedTargetEnvId);
              if (!sourceEnv || !targetEnv) return;

              console.log('[Rift] Starting migration with', selectedPaths.length, 'paths...');

              // Sort: media first, then content
              const sortedPaths = [...selectedPaths].sort((a, b) => {
                const aMedia = a.itemPath.toLowerCase().startsWith('/sitecore/media library');
                const bMedia = b.itemPath.toLowerCase().startsWith('/sitecore/media library');
                if (aMedia && !bMedia) return -1;
                if (!aMedia && bMedia) return 1;
                return 0;
              });

              const src = sourceEnv;
              const tgt = targetEnv;

              // Migrate a single path via streaming API
              async function migratePath(p: MigrationPath, index: number, suppressAuth: boolean) {
                const isMedia = p.itemPath.toLowerCase().startsWith('/sitecore/media library');
                const pathLabel = (isMedia ? 'Media: ' : 'Content: ') + p.itemPath.split('/').pop();
                const tagMsg = (msg: MigrationMessage): MigrationMessage => ({
                  ...msg,
                  pathIndex: index,
                  pathLabel,
                });
                addMsg(tagMsg({ type: 'status', message: `[${index + 1}/${sortedPaths.length}] Starting: ${p.itemPath} (${p.scope})...` }));

                const response = await fetch('/api/rift/migrate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  signal: abortController.signal,
                  body: JSON.stringify({
                    source: {
                      cmUrl: src.cmUrl,
                      clientId: src.clientId,
                      clientSecret: src.clientSecret,
                    },
                    target: {
                      cmUrl: tgt.cmUrl,
                      clientId: tgt.clientId,
                      clientSecret: tgt.clientSecret,
                    },
                    paths: [{ itemPath: p.itemPath, scope: p.scope }],
                    batchSize,
                    logLevel,
                  }),
                });

                if (!response.ok) {
                  const errData = await response.json().catch(() => ({}));
                  addMsg(tagMsg({ type: 'error', message: `${p.itemPath}: ${errData.error || `Request failed: ${response.status}`}` }));
                  return;
                }

                const reader = response.body!.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let gotComplete = false;

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split('\n');
                  buffer = lines.pop() || '';
                  for (const line of lines) {
                    if (line.trim()) {
                      try {
                        const msg = JSON.parse(line) as MigrationMessage;
                        if (msg.type === 'complete') gotComplete = true;
                        if (suppressAuth && msg.type === 'status' && (msg.message as string)?.startsWith('Authenticat')) continue;
                        addMsg(tagMsg(msg));
                      } catch (parseErr) {
                        console.warn('[Rift] Failed to parse stream line:', line, parseErr);
                      }
                    }
                  }
                }

                if (buffer.trim()) {
                  try {
                    const msg = JSON.parse(buffer) as MigrationMessage;
                    if (msg.type === 'complete') gotComplete = true;
                    addMsg(tagMsg(msg));
                  } catch {
                    console.warn('[Rift] Failed to parse final buffer:', buffer);
                  }
                }

                if (!gotComplete) {
                  addMsg(tagMsg({
                    type: 'error',
                    message: `${p.itemPath}: Connection lost — the server stopped responding. This usually means the request timed out. Try reducing the scope or batch size.`,
                  }));
                }
              }

              if (parallelPaths && sortedPaths.length > 1) {
                // Run all paths concurrently
                await Promise.all(
                  sortedPaths.map((p, i) => migratePath(p, i, i > 0))
                );
              } else {
                // Run paths sequentially
                for (let pi = 0; pi < sortedPaths.length; pi++) {
                  await migratePath(sortedPaths[pi], pi, pi > 0);
                }
              }

              // Final summary
              const completeMsgs = localMessages.filter((m) => m.type === 'complete');
              const totalSucceeded = completeMsgs.reduce((s, m) => s + ((m.succeeded as number) || 0), 0);
              const totalFailed = completeMsgs.reduce((s, m) => s + ((m.failed as number) || 0), 0);
              const totalCreated = completeMsgs.reduce((s, m) => s + ((m.created as number) || 0), 0);
              const totalUpdated = completeMsgs.reduce((s, m) => s + ((m.updated as number) || 0), 0);
              const totalItems = completeMsgs.reduce((s, m) => s + ((m.totalItems as number) || 0), 0);
              const hasErrors = localMessages.some((m) => m.type === 'error');

              addMsg({
                type: 'complete',
                totalItems,
                created: totalCreated,
                updated: totalUpdated,
                succeeded: totalSucceeded,
                failed: totalFailed,
                pushed: totalSucceeded,
                message: hasErrors && totalSucceeded === 0
                  ? 'Migration failed.'
                  : totalFailed === 0 && !hasErrors
                    ? `Migration complete: ${totalSucceeded} items migrated (${totalCreated} created, ${totalUpdated} updated).`
                    : `Migration complete: ${totalSucceeded} migrated (${totalCreated} created, ${totalUpdated} updated), ${totalFailed} failed.`,
              });
            } catch (err) {
              if (err instanceof DOMException && err.name === 'AbortError') {
                addMsg({ type: 'warning', message: 'Migration cancelled by user. Content already pushed to the target has not been rolled back.' });
              } else {
                console.error('[Rift] Migration failed:', err);
                addMsg({ type: 'error', message: err instanceof Error ? err.message : String(err) });
              }
            } finally {
              abortControllerRef.current = null;
              setMigrationComplete(true);
              setIsMigrating(false);

              // Save migration history
              const elapsedMs = Date.now() - migrationStartRef.current;
              // Use the last complete message (the client-side aggregate)
              const completeMsgs = localMessages.filter((m) => m.type === 'complete');
              const completeMsg = completeMsgs.length > 0 ? completeMsgs[completeMsgs.length - 1] : null;
              const hasErrors = localMessages.some((m) => m.type === 'error');
              const sourceEnv = environments.find((e) => e.id === selectedEnvId);
              const targetEnv = environments.find((e) => e.id === selectedTargetEnvId);

              const entry: MigrationHistoryEntry = {
                id: crypto.randomUUID(),
                date: new Date().toISOString(),
                sourceEnvName: sourceEnv?.name ?? 'Unknown',
                targetEnvName: targetEnv?.name ?? 'Unknown',
                paths: selectedPaths.map((p) => ({ itemPath: p.itemPath, scope: p.scope })),
                elapsedMs,
                totalItems: (completeMsg?.totalItems as number) ?? 0,
                succeeded: (completeMsg?.succeeded as number) ?? 0,
                failed: (completeMsg?.failed as number) ?? 0,
                created: (completeMsg?.created as number) ?? 0,
                updated: (completeMsg?.updated as number) ?? 0,
                status: completeMsg && !hasErrors ? 'success' : completeMsg && hasErrors ? 'partial' : 'failed',
              };
              addHistoryEntry(entry);
            }
          }}
        />
      )}

      {/* Migration Progress Overlay is rendered at the bottom of the layout */}

      {/* Preset save modal */}
      <Dialog open={showPresetInput} onOpenChange={(open) => { if (!open) { setShowPresetInput(false); setConfirmingOverwrite(false); } }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Save Preset</DialogTitle>
          </DialogHeader>

          {confirmingOverwrite && overwritePresetId ? (
            // Overwrite confirmation
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
            // Main save form
            <div className="space-y-4">
              {/* New preset name */}
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
                  placeholder="e.g. Full MCC Content"
                />
              </div>

              {/* Existing presets */}
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

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Left panel — content tree */}
        <div className="flex-1 border-r border-border p-4 overflow-y-auto">
          {accessToken && selectedSiteRootPath && selectedEnvId ? (
            <RiftContentTree
              cmUrl={environments.find((e) => e.id === selectedEnvId)?.cmUrl ?? ''}
              accessToken={accessToken}
              rootPath={selectedSiteRootPath}
              selectedPaths={selectedPaths}
              onTogglePath={handleTogglePath}
              inheritedPaths={inheritedPaths}
              onChildrenLoaded={handleChildrenLoaded}
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

        {/* Migration progress overlay */}
        {(isMigrating || migrationComplete) && (
          <RiftProgressOverlay
            isActive={isMigrating}
            messages={migrationMessages}
            parallelPaths={parallelPaths}
            onCancel={() => setShowCancelConfirm(true)}
            onClose={() => {
              setMigrationComplete(false);
              setMigrationMessages([]);
            }}
          />
        )}

        {/* Cancel confirmation */}
        <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel Migration</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to cancel this migration? Content that has already been pushed to the target environment will not be rolled back. This may leave the target in a partially updated state.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Continue Migration</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => {
                  abortControllerRef.current?.abort();
                }}
              >
                Cancel Migration
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* IAR warning at migration start (e.g., loaded from preset) */}
        <AlertDialog open={showIarMigrationWarning} onOpenChange={setShowIarMigrationWarning}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Warning: IAR-Managed Content Detected</AlertDialogTitle>
              <AlertDialogDescription>
                Your selected paths include items that are typically managed by Sitecore&apos;s Items as Resource (IAR) files: <strong>{selectedPathsContainIarItems().map(p => p.split('/').pop()).join(', ')}</strong>. Migrating these items will create database versions that override the IAR-deployed items on the target. This can cause unexpected behavior and is difficult to reverse.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => {
                  setShowIarMigrationWarning(false);
                  setShowConfirmDialog(true);
                }}
              >
                Proceed Anyway
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* IAR dangerous path warning — first warning */}
        <AlertDialog open={!!pendingDangerousNode && !showIarSecondWarning} onOpenChange={(open) => { if (!open) setPendingDangerousNode(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Warning: IAR-Managed Content</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDangerousNode && isDangerousPath(pendingDangerousNode.path) ? (
                  <>
                    <strong>{pendingDangerousNode.path.split('/').pop()}</strong> typically contains items managed by Sitecore&apos;s Items as Resource (IAR) files.
                  </>
                ) : (
                  <>
                    This path contains children (<strong>{pendingDangerousNode ? isAncestorOfDangerousPaths(pendingDangerousNode.path).join(', ') : ''}</strong>) that are typically managed by Sitecore&apos;s Items as Resource (IAR) files.
                  </>
                )}
                {' '}Migrating these items will create database versions that override the IAR-deployed items on the target environment. This can cause unexpected behavior and is generally not recommended.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingDangerousNode(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => setShowIarSecondWarning(true)}
              >
                I Understand the Risk
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* IAR dangerous path warning — second confirmation */}
        <AlertDialog open={showIarSecondWarning} onOpenChange={(open) => { if (!open) { setShowIarSecondWarning(false); setPendingDangerousNode(null); } }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are You Absolutely Sure?</AlertDialogTitle>
              <AlertDialogDescription>
                Overwriting IAR-managed items can break your target environment&apos;s deployed configuration. This action is difficult to reverse. Only proceed if you have a specific reason to migrate these items and understand the consequences.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setShowIarSecondWarning(false); setPendingDangerousNode(null); }}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => {
                  if (pendingDangerousNode) {
                    addPathToSelection(pendingDangerousNode);
                  }
                  setShowIarSecondWarning(false);
                  setPendingDangerousNode(null);
                }}
              >
                Proceed Anyway
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
