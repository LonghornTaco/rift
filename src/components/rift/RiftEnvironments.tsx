'use client';

import { useState, useEffect, useCallback } from 'react';
import type { RiftEnvironment, ConnectionStatus } from '@/lib/rift/types';
import {
  getEnvironments,
  saveEnvironment,
  deleteEnvironment,
} from '@/lib/rift/storage';
import { authenticate, authenticateFromStored } from '@/lib/rift/sitecore-auth';
import { fetchProjects, fetchEnvironments, fetchSites, parseProjectList, parseEnvironmentList, storeCredentialsApi, deleteCredentialsApi, checkCredentialsApi } from '@/lib/rift/api-client';
import type { ProjectOption, EnvironmentOption } from '@/lib/rift/api-client';
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
  allowWrite: true,
};

type ModalStep = 'credentials' | 'select';

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
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [envOptions, setEnvOptions] = useState<EnvironmentOption[]>([]);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(null);
  const [isLoadingEnvironments, setIsLoadingEnvironments] = useState(false);
  const [envName, setEnvName] = useState('');
  const [envCmUrl, setEnvCmUrl] = useState('');
  const [allowWrite, setAllowWrite] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [forgettingCredId, setForgettingCredId] = useState<string | null>(null);
  const [rememberCredentials, setRememberCredentials] = useState(false);
  const [showRememberModal, setShowRememberModal] = useState(false);
  const [reconnectEnvId, setReconnectEnvId] = useState<string | null>(null);
  const [reconnectClientId, setReconnectClientId] = useState('');
  const [reconnectClientSecret, setReconnectClientSecret] = useState('');
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [credentialStatuses, setCredentialStatuses] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setEnvironments(getEnvironments());
  }, []);

  function refreshEnvironments() {
    setEnvironments(getEnvironments());
  }

  useEffect(() => {
    async function checkAllCredentials() {
      const envs = getEnvironments();
      const statuses: Record<string, boolean> = {};
      for (const env of envs) {
        statuses[env.id] = env.hasStoredCredentials ?? false;
      }
      setCredentialStatuses(statuses);
    }
    checkAllCredentials();
  }, [environments]);

  function resetAddModalState() {
    setStep('credentials');
    setClientId('');
    setClientSecret('');
    setIsConnecting(false);
    setConnectError(null);
    setProjects([]);
    setSelectedProjectId(null);
    setEnvOptions([]);
    setSelectedEnvironmentId(null);
    setIsLoadingEnvironments(false);
    setEnvName('');
    setEnvCmUrl('');
    setAllowWrite(true);
    setRememberCredentials(false);
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
    if (rememberCredentials) {
      const env: RiftEnvironment = {
        id: crypto.randomUUID(),
        name: envName,
        cmUrl: envCmUrl,
        allowWrite,
        hasStoredCredentials: true,
      };
      await storeCredentialsApi(env.id, clientId, clientSecret);
      saveEnvironment(env);
      refreshEnvironments();
    }
    closeModal();
  }

  async function handleConnect() {
    setIsConnecting(true);
    setConnectError(null);
    try {
      // Create a temporary session for project/env discovery (envId/cmUrl/envName set later)
      await authenticate(clientId, clientSecret, 'discovery', '', '');

      const rawProjects = await fetchProjects();
      setProjects(parseProjectList(rawProjects));
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

      if (!projectId) return;

      setIsLoadingEnvironments(true);
      try {
        const rawEnvs = await fetchEnvironments(projectId);
        setEnvOptions(parseEnvironmentList(rawEnvs, projectId));
      } catch (err: unknown) {
        console.error('[Rift] Failed to fetch environments:', err);
      } finally {
        setIsLoadingEnvironments(false);
      }
    },
    []
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
      if (env.hasStoredCredentials) {
        await authenticateFromStored(env.id, env.cmUrl, env.name);
      } else {
        // No stored credentials — can't test. Show reconnect prompt.
        setConnectionStatuses((prev) => ({ ...prev, [env.id]: 'failed' }));
        setTestError((prev) => ({ ...prev, [env.id]: 'No credentials stored. Use Reconnect.' }));
        setTestingId(null);
        return;
      }
      setConnectionStatuses((prev) => ({ ...prev, [env.id]: 'connected' }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setConnectionStatuses((prev) => ({ ...prev, [env.id]: 'failed' }));
      setTestError((prev) => ({ ...prev, [env.id]: message }));
    } finally {
      setTestingId(null);
    }
  }

  async function handleForgetCredentials(envId: string) {
    setForgettingCredId(envId);
    try {
      await deleteCredentialsApi(envId);
      const env = environments.find((e) => e.id === envId);
      if (env) {
        saveEnvironment({ ...env, hasStoredCredentials: false });
      }
      setCredentialStatuses((prev) => ({ ...prev, [envId]: false }));
      setConnectionStatuses((prev) => ({ ...prev, [envId]: 'untested' }));
      refreshEnvironments();
    } catch (err) {
      console.error('[Rift] Failed to forget credentials:', err);
    } finally {
      setForgettingCredId(null);
    }
  }

  function openReconnect(envId: string) {
    setReconnectEnvId(envId);
    setReconnectClientId('');
    setReconnectClientSecret('');
    setReconnectError(null);
    setRememberCredentials(false);
  }

  async function handleReconnect() {
    if (!reconnectEnvId) return;
    setIsReconnecting(true);
    setReconnectError(null);
    try {
      const env = environments.find((e) => e.id === reconnectEnvId);
      if (!env) return;

      await authenticate(reconnectClientId, reconnectClientSecret, env.id, env.cmUrl, env.name);

      // Validate credentials have access to this specific CM environment
      try {
        await fetchSites();
      } catch {
        throw new Error('These credentials do not have access to this environment. Please verify you are using the correct credentials.');
      }

      if (rememberCredentials) {
        await storeCredentialsApi(env.id, reconnectClientId, reconnectClientSecret);
        saveEnvironment({ ...env, hasStoredCredentials: true });
        setCredentialStatuses((prev) => ({ ...prev, [env.id]: true }));
      }

      setConnectionStatuses((prev) => ({ ...prev, [env.id]: 'connected' }));
      setReconnectEnvId(null);
      refreshEnvironments();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Reconnect failed';
      setReconnectError(message);
    } finally {
      setIsReconnecting(false);
    }
  }

  async function confirmDelete() {
    if (!deleteConfirmId) return;
    setIsDeleting(true);
    try {
      await deleteCredentialsApi(deleteConfirmId).catch(() => {});
      deleteEnvironment(deleteConfirmId);
      setConnectionStatuses((prev) => {
        const next = { ...prev };
        delete next[deleteConfirmId];
        return next;
      });
      setCredentialStatuses((prev) => {
        const next = { ...prev };
        delete next[deleteConfirmId];
        return next;
      });
      setDeleteConfirmId(null);
      refreshEnvironments();
    } finally {
      setIsDeleting(false);
    }
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

        <div className="flex items-center gap-2">
          <Checkbox
            checked={!formData.allowWrite}
            onCheckedChange={(checked) =>
              setFormData((f) => ({ ...f, allowWrite: checked !== true }))
            }
            id="readOnlyEdit"
          />
          <Label htmlFor="readOnlyEdit" className="text-sm text-foreground">
            Read Only
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
                checked={!allowWrite}
                onCheckedChange={(checked) => setAllowWrite(checked !== true)}
                id="readOnlyNew"
              />
              <Label htmlFor="readOnlyNew" className="text-sm text-foreground">
                Read Only
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={rememberCredentials}
                onCheckedChange={(checked) => {
                  if (checked === true) {
                    setShowRememberModal(true);
                  } else {
                    setRememberCredentials(false);
                  }
                }}
                id="rememberCredsNew"
              />
              <Label htmlFor="rememberCredsNew" className="text-sm text-foreground">
                Remember Credentials
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
                status === 'connected' && 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700',
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

              {/* Credential status */}
              <div className="text-xs text-muted-foreground">
                {env.hasStoredCredentials ? (
                  <span className="text-green-600 dark:text-green-400">Credentials stored</span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">No credentials</span>
                )}
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

              {/* Button rows */}
              <div className="flex flex-col gap-1.5 mt-1">
                <div className="flex gap-2">
                  {env.hasStoredCredentials ? (
                    <>
                      <Button variant="outline" size="xs" onClick={() => handleTest(env)} disabled={isTesting} className="text-primary">
                        {isTesting ? 'Testing...' : 'Test'}
                      </Button>
                      <Button variant="outline" size="xs" onClick={() => openEditModal(env)}>
                        Edit
                      </Button>
                      <Button variant="outline" size="xs" colorScheme="danger" onClick={() => setDeleteConfirmId(env.id)}>
                        Delete
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" size="xs" className="text-primary" onClick={() => openReconnect(env.id)}>
                        Reconnect
                      </Button>
                      <Button variant="outline" size="xs" onClick={() => openEditModal(env)}>
                        Edit
                      </Button>
                      <Button variant="outline" size="xs" colorScheme="danger" onClick={() => setDeleteConfirmId(env.id)}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
                {env.hasStoredCredentials && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="xs" onClick={() => handleForgetCredentials(env.id)} disabled={forgettingCredId === env.id}>
                      {forgettingCredId === env.id ? 'Forgetting...' : 'Forget Credentials'}
                    </Button>
                  </div>
                )}
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
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open && !isDeleting) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Environment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this environment? This action cannot be undone and the stored credentials will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <Button onClick={confirmDelete} disabled={isDeleting} className="bg-destructive text-white hover:bg-destructive/90">
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remember Credentials info modal */}
      <AlertDialog open={showRememberModal} onOpenChange={(open) => { if (!open) setShowRememberModal(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Credential Storage</AlertDialogTitle>
            <AlertDialogDescription>
              Your credentials will be encrypted and stored securely on our servers. Only the application can access them — no person can view or retrieve your credentials. You can delete them at any time from the Environments page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowRememberModal(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setRememberCredentials(true); setShowRememberModal(false); }}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reconnect dialog */}
      <Dialog open={!!reconnectEnvId} onOpenChange={(open) => { if (!open) setReconnectEnvId(null); }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Reconnect Environment</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div>
              <Label className="text-xs font-semibold text-foreground mb-1">Client ID</Label>
              <Input
                type="text"
                value={reconnectClientId}
                onChange={(e) => setReconnectClientId(e.target.value)}
                placeholder="Enter your Sitecore Client ID"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-foreground mb-1">Client Secret</Label>
              <Input
                type="password"
                value={reconnectClientSecret}
                onChange={(e) => setReconnectClientSecret(e.target.value)}
                placeholder="Enter your Sitecore Client Secret"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={rememberCredentials}
                onCheckedChange={(checked) => {
                  if (checked === true) {
                    setShowRememberModal(true);
                  } else {
                    setRememberCredentials(false);
                  }
                }}
                id="rememberCredsReconnect"
              />
              <Label htmlFor="rememberCredsReconnect" className="text-sm text-foreground">
                Remember Credentials
              </Label>
            </div>
            {reconnectError && (
              <div className="text-xs text-destructive px-3 py-2 bg-destructive/10 rounded border border-destructive/30">
                {reconnectError}
              </div>
            )}
            <DialogFooter className="mt-2">
              <Button variant="outline" onClick={() => setReconnectEnvId(null)}>Cancel</Button>
              <Button
                onClick={handleReconnect}
                disabled={isReconnecting || !reconnectClientId || !reconnectClientSecret}
              >
                {isReconnecting ? 'Connecting...' : 'Connect'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
