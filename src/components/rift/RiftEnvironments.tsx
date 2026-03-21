'use client';

import { useState, useEffect, useCallback } from 'react';
import type { RiftEnvironment, ConnectionStatus } from '@/lib/rift/types';
import {
  getEnvironments,
  saveEnvironment,
  deleteEnvironment,
} from '@/lib/rift/storage';
import { authenticate } from '@/lib/rift/sitecore-auth';
import { fetchProjects, fetchEnvironments } from '@/lib/rift/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { cn } from '@/lib/utils';

const emptyEnv: Omit<RiftEnvironment, 'id'> = {
  name: '',
  cmUrl: '',
  clientId: '',
  clientSecret: '',
  allowWrite: true,
};

function maskClientId(clientId: string): string {
  const last4 = clientId.slice(-4);
  return `****-****-${last4}`;
}

/** Defensively extract a string property from an unknown object */
function getString(obj: unknown, ...keys: string[]): string {
  if (obj && typeof obj === 'object') {
    const rec = obj as Record<string, unknown>;
    for (const key of keys) {
      if (typeof rec[key] === 'string') return rec[key] as string;
    }
  }
  return '';
}

type ModalStep = 'credentials' | 'select';

interface ProjectOption {
  id: string;
  name: string;
}

interface EnvironmentOption {
  id: string;
  name: string;
  host: string;
}

export function RiftEnvironments() {
  const [environments, setEnvironments] = useState<RiftEnvironment[]>([]);
  const [connectionStatuses, setConnectionStatuses] = useState<
    Record<string, ConnectionStatus>
  >({});
  const [editingEnv, setEditingEnv] = useState<RiftEnvironment | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testError, setTestError] = useState<Record<string, string>>({});

  // Form state for edit mode
  const [formData, setFormData] = useState<Omit<RiftEnvironment, 'id'>>(emptyEnv);

  // Add-modal state
  const [step, setStep] = useState<ModalStep>('credentials');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [deployAccessToken, setDeployAccessToken] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [envOptions, setEnvOptions] = useState<EnvironmentOption[]>([]);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(null);
  const [isLoadingEnvironments, setIsLoadingEnvironments] = useState(false);
  const [envName, setEnvName] = useState('');
  const [envCmUrl, setEnvCmUrl] = useState('');
  const [allowWrite, setAllowWrite] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    getEnvironments().then(setEnvironments);
  }, []);

  function refreshEnvironments() {
    getEnvironments().then(setEnvironments);
  }

  function resetAddModalState() {
    setStep('credentials');
    setClientId('');
    setClientSecret('');
    setIsConnecting(false);
    setConnectError(null);
    setDeployAccessToken(null);
    setProjects([]);
    setSelectedProjectId(null);
    setEnvOptions([]);
    setSelectedEnvironmentId(null);
    setIsLoadingEnvironments(false);
    setEnvName('');
    setEnvCmUrl('');
    setAllowWrite(true);
  }

  function openAddModal() {
    setEditingEnv(null);
    resetAddModalState();
    setShowModal(true);
  }

  function openEditModal(env: RiftEnvironment) {
    setEditingEnv(env);
    setFormData({
      name: env.name,
      cmUrl: env.cmUrl,
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      allowWrite: env.allowWrite,
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingEnv(null);
  }

  async function handleSaveEdit() {
    if (!editingEnv) return;
    const env: RiftEnvironment = {
      id: editingEnv.id,
      ...formData,
    };
    await saveEnvironment(env);
    refreshEnvironments();
    closeModal();
  }

  async function handleSaveNew() {
    const env: RiftEnvironment = {
      id: crypto.randomUUID(),
      name: envName,
      cmUrl: envCmUrl,
      clientId,
      clientSecret,
      allowWrite,
    };
    await saveEnvironment(env);
    refreshEnvironments();
    closeModal();
  }

  async function handleConnect() {
    setIsConnecting(true);
    setConnectError(null);
    try {
      const authResult = await authenticate(clientId, clientSecret);
      const token = authResult.accessToken;
      setDeployAccessToken(token);

      const rawProjects = await fetchProjects(token);
      console.log('[Rift] Projects response:', rawProjects);

      // Deploy API wraps results in { data: [...] }
      const projectList = Array.isArray(rawProjects)
        ? rawProjects
        : Array.isArray((rawProjects as Record<string, unknown>)?.data)
          ? (rawProjects as Record<string, unknown>).data as unknown[]
          : [];

      const parsed: ProjectOption[] = [];
      for (const p of projectList) {
        const id = getString(p, 'id');
        const name = getString(p, 'name');
        if (id) parsed.push({ id, name: name || id });
      }
      setProjects(parsed);
      setStep('select');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setConnectError(message);
    } finally {
      setIsConnecting(false);
    }
  }

  const handleProjectChange = useCallback(
    async (projectId: string) => {
      setSelectedProjectId(projectId);
      setSelectedEnvironmentId(null);
      setEnvOptions([]);
      setEnvName('');
      setEnvCmUrl('');

      if (!projectId || !deployAccessToken) return;

      setIsLoadingEnvironments(true);
      try {
        const rawEnvs = await fetchEnvironments(deployAccessToken, projectId);
        console.log('[Rift] Environments response:', rawEnvs);

        // Deploy API wraps results in { data: [...] }
        const envList = Array.isArray(rawEnvs)
          ? rawEnvs
          : Array.isArray((rawEnvs as Record<string, unknown>)?.data)
            ? (rawEnvs as Record<string, unknown>).data as unknown[]
            : [];

        const parsed: EnvironmentOption[] = [];
        for (const e of envList) {
          const id = getString(e, 'id');
          const name = getString(e, 'name');
          const host = getString(e, 'host');
          // host is just the hostname (e.g. "xmc-...sitecorecloud.io"), prepend https://
          const cmUrl = host ? `https://${host}` : '';
          if (id) parsed.push({ id, name: name || id, host: cmUrl });
        }
        setEnvOptions(parsed);
      } catch (err: unknown) {
        console.error('[Rift] Failed to fetch environments:', err);
      } finally {
        setIsLoadingEnvironments(false);
      }
    },
    [deployAccessToken]
  );

  function handleEnvironmentChange(envId: string) {
    setSelectedEnvironmentId(envId);
    const selected = envOptions.find((e) => e.id === envId);
    if (selected) {
      const projectName = projects.find((p) => p.id === selectedProjectId)?.name ?? '';
      setEnvName(projectName ? `${projectName} - ${selected.name}` : selected.name);
      setEnvCmUrl(selected.host);
      // Default allowWrite to false if name contains "prod"
      setAllowWrite(!selected.name.toLowerCase().includes('prod'));
    }
  }

  async function handleTest(env: RiftEnvironment) {
    setTestingId(env.id);
    setTestError((prev) => {
      const next = { ...prev };
      delete next[env.id];
      return next;
    });
    try {
      await authenticate(env.clientId, env.clientSecret);
      setConnectionStatuses((prev) => ({ ...prev, [env.id]: 'connected' }));
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Connection failed';
      setConnectionStatuses((prev) => ({ ...prev, [env.id]: 'failed' }));
      setTestError((prev) => ({ ...prev, [env.id]: message }));
    } finally {
      setTestingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteConfirmId) return;
    await deleteEnvironment(deleteConfirmId);
    setConnectionStatuses((prev) => {
      const next = { ...prev };
      delete next[deleteConfirmId];
      return next;
    });
    setDeleteConfirmId(null);
    refreshEnvironments();
  }

  function renderEditModal() {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <Label className="text-xs font-semibold text-foreground mb-1">Name</Label>
          <Input
            type="text"
            value={formData.name}
            onChange={(e) =>
              setFormData((f) => ({ ...f, name: e.target.value }))
            }
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-foreground mb-1">CM URL</Label>
          <Input
            type="text"
            value={formData.cmUrl}
            onChange={(e) =>
              setFormData((f) => ({ ...f, cmUrl: e.target.value }))
            }
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-foreground mb-1">Client ID</Label>
          <Input
            type="text"
            value={formData.clientId}
            onChange={(e) =>
              setFormData((f) => ({ ...f, clientId: e.target.value }))
            }
          />
        </div>

        <div>
          <Label className="text-xs font-semibold text-foreground mb-1">Client Secret</Label>
          <Input
            type="password"
            value={formData.clientSecret}
            onChange={(e) =>
              setFormData((f) => ({ ...f, clientSecret: e.target.value }))
            }
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            checked={formData.allowWrite}
            onCheckedChange={(checked) =>
              setFormData((f) => ({ ...f, allowWrite: checked === true }))
            }
            id="allowWriteEdit"
          />
          <Label htmlFor="allowWriteEdit" className="text-sm text-foreground">
            Allow Write
          </Label>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={closeModal}>
            Cancel
          </Button>
          <Button onClick={handleSaveEdit}>
            Save
          </Button>
        </DialogFooter>
      </div>
    );
  }

  function renderAddModal() {
    if (step === 'credentials') {
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Label className="text-xs font-semibold text-foreground mb-1">Client ID</Label>
            <Input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Enter your Sitecore Client ID"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold text-foreground mb-1">Client Secret</Label>
            <Input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Enter your Sitecore Client Secret"
            />
          </div>

          {connectError && (
            <div className="text-xs text-destructive px-3 py-2 bg-destructive/10 rounded border border-destructive/30">
              {connectError}
            </div>
          )}

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              onClick={handleConnect}
              disabled={isConnecting || !clientId || !clientSecret}
            >
              {isConnecting ? 'Connecting...' : 'Connect'}
            </Button>
          </DialogFooter>
        </div>
      );
    }

    // Step: select
    return (
      <div className="flex flex-col gap-3">
        <div>
          <Label className="text-xs font-semibold text-foreground mb-1">Project</Label>
          <Select value={selectedProjectId ?? undefined} onValueChange={handleProjectChange}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Select a project..." />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs font-semibold text-foreground mb-1">Environment</Label>
          <Select
            value={selectedEnvironmentId ?? undefined}
            onValueChange={handleEnvironmentChange}
            disabled={!selectedProjectId || isLoadingEnvironments}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue
                placeholder={
                  isLoadingEnvironments
                    ? 'Loading environments...'
                    : 'Select an environment...'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {envOptions.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedEnvironmentId && (
          <>
            <div>
              <Label className="text-xs font-semibold text-foreground mb-1">Name</Label>
              <Input
                type="text"
                value={envName}
                onChange={(e) => setEnvName(e.target.value)}
              />
            </div>

            <div>
              <Label className="text-xs font-semibold text-foreground mb-1">CM URL</Label>
              <Input
                type="text"
                value={envCmUrl}
                onChange={(e) => setEnvCmUrl(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={allowWrite}
                onCheckedChange={(checked) => setAllowWrite(checked === true)}
                id="allowWriteNew"
              />
              <Label htmlFor="allowWriteNew" className="text-sm text-foreground">
                Allow Write
              </Label>
            </div>
          </>
        )}

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => setStep('credentials')}>
            Back
          </Button>
          <Button variant="outline" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveNew}
            disabled={!envName || !envCmUrl}
          >
            Save
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="text-base font-bold text-foreground">
          Environments
        </div>
        <Button onClick={openAddModal} size="sm">
          + Add Environment
        </Button>
      </div>

      {/* Card grid */}
      <div className="p-5 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 content-start flex-1 overflow-y-auto">
        {environments.map((env) => {
          const status = connectionStatuses[env.id] || 'untested';
          const isTesting = testingId === env.id;
          return (
            <div
              key={env.id}
              className={cn(
                'rounded-lg p-4 flex flex-col gap-2 transition-colors border',
                status === 'connected' && 'bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-800',
                status === 'failed' && 'bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-800',
                status === 'untested' && 'bg-card border-border'
              )}
            >
              {/* Header row */}
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-foreground">
                  {env.name}
                </span>
                <span
                  title={
                    status === 'failed' && testError[env.id]
                      ? testError[env.id]
                      : status
                  }
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    status === 'connected' && 'bg-green-500',
                    status === 'failed' && 'bg-red-500',
                    status === 'untested' && 'bg-muted-foreground'
                  )}
                />
              </div>

              {/* CM URL */}
              <div className="text-xs text-muted-foreground break-all">
                {env.cmUrl}
              </div>

              {/* Masked Client ID */}
              <div className="text-xs text-muted-foreground">
                {maskClientId(env.clientId)}
              </div>

              {/* Source-only badge (always rendered for consistent card height) */}
              <div
                className={cn(
                  'flex items-center gap-1 text-xs',
                  env.allowWrite && 'invisible'
                )}
              >
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                <span>{'\uD83D\uDD12'} Source only</span>
              </div>

              {/* Button row */}
              <div className="flex gap-2 mt-1">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => handleTest(env)}
                  disabled={isTesting}
                  className="text-primary"
                >
                  {isTesting ? 'Testing...' : 'Test'}
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => openEditModal(env)}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  colorScheme="danger"
                  onClick={() => setDeleteConfirmId(env.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      <Dialog open={showModal} onOpenChange={(open) => { if (!open) closeModal(); }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {editingEnv ? 'Edit Environment' : 'Add Environment'}
            </DialogTitle>
          </DialogHeader>
          {editingEnv ? renderEditModal() : renderAddModal()}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Environment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this environment? This action cannot be undone and the stored credentials will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
