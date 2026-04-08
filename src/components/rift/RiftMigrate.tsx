'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RiftPreset, RiftEnvironment, MigrationPath, MigrationHistoryEntry, MigrationLogLevel, TreeNode, SiteInfo, DEFAULT_SETTINGS } from '@/lib/rift/types';
import { getEnvironments, getPresets, savePreset, addHistoryEntry, getSettings, saveSettings, saveEnvironment } from '@/lib/rift/storage';
import { authenticate, authenticateFromStored } from '@/lib/rift/sitecore-auth';
import { fetchSites, storeCredentialsApi } from '@/lib/rift/api-client';
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
import { Checkbox } from '@/components/ui/checkbox';
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

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [targetSessionId, setTargetSessionId] = useState<string | null>(null);
  const [sites, setSites] = useState<(SiteInfo & { collection: string })[]>([]);
  const [isLoadingSites, setIsLoadingSites] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingSiteRootPath, setPendingSiteRootPath] = useState<string | null>(null);
  const [loadedTreeNodes, setLoadedTreeNodes] = useState<Map<string, TreeNode[]>>(new Map());
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [recycleOrphans, setRecycleOrphans] = useState(true);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [pendingDangerousNode, setPendingDangerousNode] = useState<TreeNode | null>(null);
  const [showIarSecondWarning, setShowIarSecondWarning] = useState(false);
  const [showIarMigrationWarning, setShowIarMigrationWarning] = useState(false);
  const [showIarPresetWarning, setShowIarPresetWarning] = useState(false);
  const [iarPresetPaths, setIarPresetPaths] = useState<string[]>([]);
  const [pendingMediaLibraryNode, setPendingMediaLibraryNode] = useState<TreeNode | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationMessages, setMigrationMessages] = useState<MigrationMessage[]>([]);
  const [migrationComplete, setMigrationComplete] = useState(false);
  const migrationStartRef = useRef<number>(0);
  const [splitPercent, setSplitPercent] = useState(60);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const splitterContainerRef = useRef<HTMLDivElement>(null);
  const [showPresetInput, setShowPresetInput] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [overwritePresetId, setOverwritePresetId] = useState<string | null>(null);
  const [confirmingOverwrite, setConfirmingOverwrite] = useState(false);
  const [existingPresets, setExistingPresets] = useState<RiftPreset[]>([]);
  const [isRestoringPreset, setIsRestoringPreset] = useState(!!loadedPreset?.sourceEnvId);

  const [credPromptEnvId, setCredPromptEnvId] = useState<string | null>(null);
  const [credPromptClientId, setCredPromptClientId] = useState('');
  const [credPromptClientSecret, setCredPromptClientSecret] = useState('');
  const [credPromptError, setCredPromptError] = useState<string | null>(null);
  const [isCredPrompting, setIsCredPrompting] = useState(false);
  const [credPromptRemember, setCredPromptRemember] = useState(false);
  const [showCredRememberModal, setShowCredRememberModal] = useState(false);
  const [credPromptRole, setCredPromptRole] = useState<'source' | 'target'>('source');

  // Track whether we're still waiting for the full workspace to be ready
  const isWorkspaceLoading = isRestoringPreset || (!!loadedPreset?.sourceEnvId && isLoadingSites) || (!!loadedPreset?.siteRootPath && pendingSiteRootPath !== null);

  const handleChildrenLoaded = useCallback((parentPath: string, children: TreeNode[]) => {
    setLoadedTreeNodes((prev) => new Map(prev).set(parentPath, children));
  }, []);

  // Paths that are typically managed by IAR files and should not be migrated
  const IAR_DANGEROUS_NAMES = new Set(['presentation', 'settings', 'dictionary', 'media']);

  const isDangerousPath = useCallback((path: string): boolean => {
    if (!path.toLowerCase().startsWith('/sitecore/content/')) return false;
    const segments = path.toLowerCase().split('/').slice(3); // after /sitecore/content/
    return segments.some(seg => IAR_DANGEROUS_NAMES.has(seg));
  }, []);

  // Returns the IAR segment name if the path is directly an IAR item (last segment matches)
  const isDirectIarItem = useCallback((path: string): boolean => {
    const lastSegment = path.split('/').pop()?.toLowerCase() ?? '';
    return IAR_DANGEROUS_NAMES.has(lastSegment);
  }, []);

  // Returns the IAR ancestor name if the path is under an IAR item (not the IAR item itself)
  const getIarAncestorName = useCallback((path: string): string | null => {
    if (!path.toLowerCase().startsWith('/sitecore/content/')) return null;
    const segments = path.split('/').slice(3); // after /sitecore/content/
    for (const seg of segments.slice(0, -1)) { // exclude last segment
      if (IAR_DANGEROUS_NAMES.has(seg.toLowerCase())) return seg;
    }
    return null;
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
      // Check if the path itself is or is under an IAR item
      if (isDangerousPath(sp.itemPath)) {
        found.push(sp.itemPath);
        continue;
      }
      // Check if descendants scope would include dangerous children
      if (sp.scope === 'ItemAndDescendants' || sp.scope === 'ItemAndChildren' || sp.scope === 'ChildrenOnly' || sp.scope === 'DescendantsOnly') {
        const children = loadedTreeNodes.get(sp.itemPath) ?? [];
        for (const c of children) {
          if (IAR_DANGEROUS_NAMES.has(c.name.toLowerCase())) {
            found.push(c.path);
          }
        }
      }
    }
    return found;
  }, [selectedPaths, loadedTreeNodes, isDangerousPath]);

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

      // Check if selecting the entire media library
      if (node.path.toLowerCase() === '/sitecore/media library') {
        setPendingMediaLibraryNode(node);
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

      if (sp.scope === 'ItemAndDescendants' || sp.scope === 'DescendantsOnly') {
        // Check all loaded nodes — any whose path starts with selectedPath + "/" is inherited
        for (const [, children] of loadedTreeNodes) {
          for (const child of children) {
            if (child.path !== sp.itemPath && child.path.startsWith(sp.itemPath + '/')) {
              inherited.add(child.path);
            }
          }
        }
      } else if (sp.scope === 'ItemAndChildren' || sp.scope === 'ChildrenOnly') {
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
    setEnvironments(getEnvironments());
  }, []);

  const handleEnvChange = useCallback(
    async (envId: string) => {
      setSelectedEnvId(envId);
      setSelectedSiteRootPath(null);
      setSites([]);
      setSessionId(null);
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
        let result;
        if (env.hasStoredCredentials) {
          result = await authenticateFromStored(env.id, env.cmUrl, env.name);
        } else {
          setCredPromptEnvId(env.id);
          setCredPromptRole('source');
          setCredPromptClientId('');
          setCredPromptClientSecret('');
          setCredPromptError(null);
          setCredPromptRemember(false);
          return;
        }
        setSessionId(result.sessionId);
        const fetchedSites = await fetchSites();
        setSites(fetchedSites);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Authentication failed');
        setSites([]);
        setSessionId(null);
      } finally {
        setIsLoadingSites(false);
      }
    },
    [selectedTargetEnvId]
  );

  // Authenticate a target environment and set targetSessionId
  const handleTargetEnvChange = useCallback(async (envId: string) => {
    setSelectedTargetEnvId(envId);
    setTargetSessionId(null);
    const envs = await getEnvironments();
    const env = envs.find((e) => e.id === envId);
    if (env) {
      try {
        let result;
        if (env.hasStoredCredentials) {
          result = await authenticateFromStored(env.id, env.cmUrl, env.name);
        } else {
          setCredPromptEnvId(env.id);
          setCredPromptRole('target');
          setCredPromptClientId('');
          setCredPromptClientSecret('');
          setCredPromptError(null);
          setCredPromptRemember(false);
          return;
        }
        setTargetSessionId(result.sessionId);
      } catch {
        setAuthError('Failed to authenticate target environment');
      }
    }
  }, []);

  async function handleCredPromptSubmit() {
    if (!credPromptEnvId) return;
    setIsCredPrompting(true);
    setCredPromptError(null);

    const envs = getEnvironments();
    const env = envs.find((e) => e.id === credPromptEnvId);
    if (!env) return;

    try {
      const result = await authenticate(
        credPromptClientId,
        credPromptClientSecret,
        env.id,
        env.cmUrl,
        env.name
      );

      if (credPromptRemember) {
        await storeCredentialsApi(env.id, credPromptClientId, credPromptClientSecret);
        saveEnvironment({ ...env, hasStoredCredentials: true });
      }

      if (credPromptRole === 'source') {
        setSessionId(result.sessionId);
        const fetchedSites = await fetchSites();
        setSites(fetchedSites);
      } else {
        setTargetSessionId(result.sessionId);
      }

      setCredPromptEnvId(null);
    } catch (err) {
      setCredPromptError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsCredPrompting(false);
    }
  }

  // Sync state when loadedPreset changes (e.g. loading from Presets page)
  useEffect(() => {
    if (!loadedPreset) return;
    if (loadedPreset.paths) {
      setSelectedPaths(loadedPreset.paths);
      // Check if preset contains IAR-dangerous paths and warn
      const dangerousPaths = loadedPreset.paths
        .filter((p) => isDangerousPath(p.itemPath))
        .map((p) => p.itemPath);
      if (dangerousPaths.length > 0) {
        setIarPresetPaths(dangerousPaths);
        setShowIarPresetWarning(true);
      }
    }
    if (loadedPreset.sourceEnvId) {
      handleEnvChange(loadedPreset.sourceEnvId);
    }
    if (loadedPreset.targetEnvId) {
      handleTargetEnvChange(loadedPreset.targetEnvId);
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
    selectedEnvId && selectedSiteRootPath && selectedTargetEnvId && sessionId && targetSessionId && selectedPaths.length > 0 && !isMigrating;

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
          <Select value={selectedTargetEnvId ?? undefined} onValueChange={handleTargetEnvChange} disabled={isMigrating}>
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

        {/* Refresh Tree */}
        <Button
          variant="outline"
          size="sm"
          disabled={!sessionId || !selectedSiteRootPath || isMigrating}
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
          recycleOrphans={recycleOrphans}
          onRecycleOrphansChange={setRecycleOrphans}
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
                    sourceSessionId: sessionId,
                    targetSessionId: targetSessionId,
                    paths: [{ itemPath: p.itemPath, scope: p.scope }],
                    batchSize,
                    logLevel,
                    recycleOrphans,
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
              const totalFailed = completeMsgs.reduce((s, m) => s + ((m.failed as number) || 0), 0);
              const totalCreated = completeMsgs.reduce((s, m) => s + ((m.created as number) || 0), 0);
              const totalUpdated = completeMsgs.reduce((s, m) => s + ((m.updated as number) || 0), 0);
              const totalMoved = completeMsgs.reduce((s, m) => s + ((m.moved as number) || 0), 0);
              const totalRenamed = completeMsgs.reduce((s, m) => s + ((m.renamed as number) || 0), 0);
              const totalRecycled = completeMsgs.reduce((s, m) => s + ((m.recycled as number) || 0), 0);
              const totalItems = completeMsgs.reduce((s, m) => s + ((m.totalItems as number) || 0), 0);
              const totalSucceeded = completeMsgs.reduce((s, m) => s + ((m.succeeded as number) || 0), 0);
              const hasErrors = localMessages.some((m) => m.type === 'error');

              const statParts: string[] = [];
              if (totalCreated > 0) statParts.push(`${totalCreated} created`);
              if (totalUpdated > 0) statParts.push(`${totalUpdated} updated`);
              if (totalMoved > 0) statParts.push(`${totalMoved} moved`);
              if (totalRenamed > 0) statParts.push(`${totalRenamed} renamed`);
              if (totalRecycled > 0) statParts.push(`${totalRecycled} recycled`);
              statParts.push(`${totalFailed} failed`);

              const statsMessage = statParts.join(', ');

              addMsg({
                type: 'complete',
                totalItems,
                created: totalCreated,
                updated: totalUpdated,
                moved: totalMoved,
                renamed: totalRenamed,
                recycled: totalRecycled,
                succeeded: totalSucceeded,
                failed: totalFailed,
                pushed: totalSucceeded,
                message: hasErrors && totalSucceeded === 0
                  ? `Migration failed: ${statsMessage}.`
                  : statParts.length === 1 && totalFailed === 0
                    ? 'Migration complete: no changes needed.'
                    : `Migration complete: ${statsMessage}.`,
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
                  placeholder="e.g. Full Site Content"
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
            {sessionId && selectedSiteRootPath && selectedEnvId ? (
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
                messages={migrationMessages}
                parallelPaths={parallelPaths}
                onCancel={() => setShowCancelConfirm(true)}
                onClose={() => {
                  setMigrationComplete(false);
                  setMigrationMessages([]);
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
                Are you sure you want to cancel this migration? Content that has already been pushed to the target environment will not be rolled back. This may leave the target in a partially updated state.
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

        {/* Entire media library selection warning */}
        <AlertDialog open={!!pendingMediaLibraryNode} onOpenChange={(open) => { if (!open) setPendingMediaLibraryNode(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Entire Media Library</AlertDialogTitle>
              <AlertDialogDescription>
                You are about to select the entire media library. This could include a very large number of items and may take a long time to migrate. Are you sure you want to include all media library items?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (pendingMediaLibraryNode) {
                    addPathToSelection(pendingMediaLibraryNode);
                  }
                  setPendingMediaLibraryNode(null);
                }}
              >
                Select All Media
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* IAR warning when preset is loaded with dangerous paths */}
        <AlertDialog open={showIarPresetWarning} onOpenChange={setShowIarPresetWarning}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Preset Contains IAR-Managed Paths</AlertDialogTitle>
              <AlertDialogDescription>
                This preset includes paths that are typically managed by Sitecore&apos;s Items as Resource (IAR) files: <strong>{iarPresetPaths.map(p => p.split('/').pop()).join(', ')}</strong>. Migrating these items will create database versions that override the IAR-deployed items on the target. You can remove them from the selected paths before starting the migration.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setShowIarPresetWarning(false)}>
                OK
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
                className="bg-red-600 text-white hover:bg-red-700 active:bg-red-800"
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
        <AlertDialog open={!!pendingDangerousNode && !showIarSecondWarning}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Warning: IAR-Managed Content</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDangerousNode && isDirectIarItem(pendingDangerousNode.path) ? (
                  <>
                    <strong>{pendingDangerousNode.path.split('/').pop()}</strong> typically contains items managed by Sitecore&apos;s Items as Resource (IAR) files.
                  </>
                ) : pendingDangerousNode && getIarAncestorName(pendingDangerousNode.path) ? (
                  <>
                    This item is located under <strong>{getIarAncestorName(pendingDangerousNode.path)}</strong>, which is typically managed by Sitecore&apos;s Items as Resource (IAR) files.
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
                className="bg-red-600 text-white hover:bg-red-700 active:bg-red-800"
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
                className="bg-red-600 text-white hover:bg-red-700 active:bg-red-800"
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

      {/* Credential prompt for environments without stored credentials */}
      <Dialog open={!!credPromptEnvId} onOpenChange={(open) => { if (!open) setCredPromptEnvId(null); }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Enter Credentials</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Enter credentials for {credPromptRole === 'source' ? 'the source' : 'the target'} environment.
            </p>
            <div>
              <Label className="text-xs font-semibold text-foreground mb-1">Client ID</Label>
              <Input
                type="text"
                value={credPromptClientId}
                onChange={(e) => setCredPromptClientId(e.target.value)}
                placeholder="Enter your Sitecore Client ID"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-foreground mb-1">Client Secret</Label>
              <Input
                type="password"
                value={credPromptClientSecret}
                onChange={(e) => setCredPromptClientSecret(e.target.value)}
                placeholder="Enter your Sitecore Client Secret"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={credPromptRemember}
                onCheckedChange={(checked) => {
                  if (checked === true) {
                    setShowCredRememberModal(true);
                  } else {
                    setCredPromptRemember(false);
                  }
                }}
                id="rememberCredsMigrate"
              />
              <Label htmlFor="rememberCredsMigrate" className="text-sm text-foreground">
                Remember Credentials
              </Label>
            </div>
            {credPromptError && (
              <div className="text-xs text-destructive px-3 py-2 bg-destructive/10 rounded border border-destructive/30">
                {credPromptError}
              </div>
            )}
            <DialogFooter className="mt-2">
              <Button variant="outline" onClick={() => setCredPromptEnvId(null)}>Cancel</Button>
              <Button
                onClick={handleCredPromptSubmit}
                disabled={isCredPrompting || !credPromptClientId || !credPromptClientSecret}
              >
                {isCredPrompting ? 'Connecting...' : 'Connect'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remember Credentials info modal (migrate page) */}
      <AlertDialog open={showCredRememberModal} onOpenChange={(open) => { if (!open) setShowCredRememberModal(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Credential Storage</AlertDialogTitle>
            <AlertDialogDescription>
              Your credentials will be encrypted and stored securely on our servers. Only the application can access them — no person can view or retrieve your credentials. You can delete them at any time from the Environments page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowCredRememberModal(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setCredPromptRemember(true); setShowCredRememberModal(false); }}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
