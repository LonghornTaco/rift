'use client';

import { useState, useCallback } from 'react';
import type { RiftEnvironment } from '@/lib/rift/types';
import { saveEnvironment } from '@/lib/rift/storage';
import { authenticate } from '@/lib/rift/sitecore-auth';
import { fetchProjects, fetchEnvironments, parseProjectList, parseEnvironmentList } from '@/lib/rift/api-client';
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
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface RiftSetupWizardProps {
  onComplete: () => void;
}

type WizardStep = 1 | 2;
type CredentialPhase = 'credentials' | 'select';

export function RiftSetupWizard({ onComplete }: RiftSetupWizardProps) {
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  // Credential state (shared across steps)
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  // Step 1 state
  const [step1Phase, setStep1Phase] = useState<CredentialPhase>('credentials');
  const [step1Connecting, setStep1Connecting] = useState(false);
  const [step1ConnectError, setStep1ConnectError] = useState<string | null>(null);
  const [step1Projects, setStep1Projects] = useState<ProjectOption[]>([]);
  const [step1SelectedProjectId, setStep1SelectedProjectId] = useState<string | null>(null);
  const [step1EnvOptions, setStep1EnvOptions] = useState<EnvironmentOption[]>([]);
  const [step1SelectedEnvId, setStep1SelectedEnvId] = useState<string | null>(null);
  const [step1LoadingEnvs, setStep1LoadingEnvs] = useState(false);
  const [step1EnvName, setStep1EnvName] = useState('');
  const [step1CmUrl, setStep1CmUrl] = useState('');
  const [step1AllowWrite, setStep1AllowWrite] = useState(true);

  // Step 2 state
  const [step2Phase, setStep2Phase] = useState<CredentialPhase>('credentials');
  const [step2Connecting, setStep2Connecting] = useState(false);
  const [step2ConnectError, setStep2ConnectError] = useState<string | null>(null);
  const [step2Projects, setStep2Projects] = useState<ProjectOption[]>([]);
  const [step2SelectedProjectId, setStep2SelectedProjectId] = useState<string | null>(null);
  const [step2EnvOptions, setStep2EnvOptions] = useState<EnvironmentOption[]>([]);
  const [step2SelectedEnvId, setStep2SelectedEnvId] = useState<string | null>(null);
  const [step2LoadingEnvs, setStep2LoadingEnvs] = useState(false);
  const [step2EnvName, setStep2EnvName] = useState('');
  const [step2CmUrl, setStep2CmUrl] = useState('');
  const [step2AllowWrite, setStep2AllowWrite] = useState(true);

  // Saved data from step 1 for pre-filling step 2
  const [savedClientId, setSavedClientId] = useState('');
  const [savedClientSecret, setSavedClientSecret] = useState('');
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);

  // --- Step 1 handlers ---

  async function handleStep1Connect() {
    setStep1Connecting(true);
    setStep1ConnectError(null);
    try {
      await authenticate(clientId, clientSecret, 'discovery', '', '');

      const rawProjects = await fetchProjects();
      setStep1Projects(parseProjectList(rawProjects));
      setStep1Phase('select');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setStep1ConnectError(message);
    } finally {
      setStep1Connecting(false);
    }
  }

  const handleStep1ProjectChange = useCallback(
    async (projectId: string) => {
      setStep1SelectedProjectId(projectId);
      setStep1SelectedEnvId(null);
      setStep1EnvOptions([]);
      setStep1EnvName('');
      setStep1CmUrl('');

      if (!projectId) return;

      setStep1LoadingEnvs(true);
      try {
        const rawEnvs = await fetchEnvironments(projectId);
        setStep1EnvOptions(parseEnvironmentList(rawEnvs, projectId));
      } catch (err: unknown) {
        console.error('[Rift] Failed to fetch environments:', err);
      } finally {
        setStep1LoadingEnvs(false);
      }
    },
    []
  );

  function handleStep1EnvChange(envId: string) {
    setStep1SelectedEnvId(envId);
    const selected = step1EnvOptions.find((e) => e.id === envId);
    if (selected) {
      const projectName = step1Projects.find((p) => p.id === step1SelectedProjectId)?.name ?? '';
      setStep1EnvName(projectName ? `${projectName} - ${selected.name}` : selected.name);
      setStep1CmUrl(selected.host);
      setStep1AllowWrite(!selected.name.toLowerCase().includes('prod'));
    }
  }

  async function handleStep1Next() {
    const env: RiftEnvironment = {
      id: crypto.randomUUID(),
      name: step1EnvName,
      cmUrl: step1CmUrl,
      clientId,
      clientSecret,
      allowWrite: step1AllowWrite,
    };
    await saveEnvironment(env);

    // Save credentials for step 2 pre-fill
    setSavedClientId(clientId);
    setSavedClientSecret(clientSecret);
    setSavedProjectId(step1SelectedProjectId);

    // Pre-fill step 2 credentials with same values (user can uncheck to change)
    setStep2Phase('credentials');
    setClientId(clientId);
    setClientSecret(clientSecret);

    setWizardStep(2);
  }

  // --- Step 2 handlers ---

  async function handleStep2Connect() {
    setStep2Connecting(true);
    setStep2ConnectError(null);
    try {
      await authenticate(clientId, clientSecret, 'discovery', '', '');

      const rawProjects = await fetchProjects();
      const parsed = parseProjectList(rawProjects);
      setStep2Projects(parsed);
      setStep2Phase('select');

      // Pre-select saved project if available
      if (savedProjectId && parsed.some((p) => p.id === savedProjectId)) {
        setStep2SelectedProjectId(savedProjectId);
        setStep2LoadingEnvs(true);
        try {
          const rawEnvs = await fetchEnvironments(savedProjectId);
          setStep2EnvOptions(parseEnvironmentList(rawEnvs, savedProjectId));
        } catch (err: unknown) {
          console.error('[Rift] Failed to fetch environments:', err);
        } finally {
          setStep2LoadingEnvs(false);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setStep2ConnectError(message);
    } finally {
      setStep2Connecting(false);
    }
  }

  const handleStep2ProjectChange = useCallback(
    async (projectId: string) => {
      setStep2SelectedProjectId(projectId);
      setStep2SelectedEnvId(null);
      setStep2EnvOptions([]);
      setStep2EnvName('');
      setStep2CmUrl('');

      if (!projectId) return;

      setStep2LoadingEnvs(true);
      try {
        const rawEnvs = await fetchEnvironments(projectId);
        setStep2EnvOptions(parseEnvironmentList(rawEnvs, projectId));
      } catch (err: unknown) {
        console.error('[Rift] Failed to fetch environments:', err);
      } finally {
        setStep2LoadingEnvs(false);
      }
    },
    []
  );

  function handleStep2EnvChange(envId: string) {
    setStep2SelectedEnvId(envId);
    const selected = step2EnvOptions.find((e) => e.id === envId);
    if (selected) {
      const projectName = step2Projects.find((p) => p.id === step2SelectedProjectId)?.name ?? '';
      setStep2EnvName(projectName ? `${projectName} - ${selected.name}` : selected.name);
      setStep2CmUrl(selected.host);
      setStep2AllowWrite(!selected.name.toLowerCase().includes('prod'));
    }
  }

  async function handleStep2Finish() {
    const env: RiftEnvironment = {
      id: crypto.randomUUID(),
      name: step2EnvName,
      cmUrl: step2CmUrl,
      clientId,
      clientSecret,
      allowWrite: step2AllowWrite,
    };
    await saveEnvironment(env);
    onComplete();
  }

  function handleBack() {
    setWizardStep(1);
  }

  // --- Render helpers ---

  function renderStepIndicator(currentStep: WizardStep) {
    return (
      <div className="flex items-center gap-2 mb-5">
        <span className="text-xs text-muted-foreground">
          Step {currentStep} of 2
        </span>
        <div className="flex gap-1">
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              currentStep === 1 ? 'bg-blue-500' : 'bg-muted-foreground/40'
            )}
          />
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              currentStep === 2 ? 'bg-blue-500' : 'bg-muted-foreground/40'
            )}
          />
        </div>
      </div>
    );
  }

  function renderCredentialsForm(
    connecting: boolean,
    connectError: string | null,
    onConnect: () => void
  ) {
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

        <div className="flex justify-end mt-2">
          <Button
            onClick={onConnect}
            disabled={connecting || !clientId || !clientSecret}
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </Button>
        </div>
      </div>
    );
  }

  function renderSelectForm(
    projects: ProjectOption[],
    selectedProjectId: string | null,
    onProjectChange: (id: string) => void,
    envOptions: EnvironmentOption[],
    selectedEnvId: string | null,
    onEnvChange: (id: string) => void,
    loadingEnvs: boolean,
    envName: string,
    onEnvNameChange: (v: string) => void,
    cmUrl: string,
    onCmUrlChange: (v: string) => void,
    allowWrite: boolean,
    onAllowWriteChange: (v: boolean) => void,
    checkboxId: string
  ) {
    return (
      <div className="flex flex-col gap-3">
        <div>
          <Label className="text-xs font-semibold text-foreground mb-1">Project</Label>
          <Select value={selectedProjectId ?? undefined} onValueChange={onProjectChange}>
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
            value={selectedEnvId ?? undefined}
            onValueChange={onEnvChange}
            disabled={!selectedProjectId || loadingEnvs}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue
                placeholder={
                  loadingEnvs ? 'Loading environments...' : 'Select an environment...'
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

        {selectedEnvId && (
          <>
            <div>
              <Label className="text-xs font-semibold text-foreground mb-1">Name</Label>
              <Input
                type="text"
                value={envName}
                onChange={(e) => onEnvNameChange(e.target.value)}
              />
            </div>

            <div>
              <Label className="text-xs font-semibold text-foreground mb-1">CM URL</Label>
              <Input
                type="text"
                value={cmUrl}
                onChange={(e) => onCmUrlChange(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                checked={!allowWrite}
                onCheckedChange={(checked) => onAllowWriteChange(checked !== true)}
                id={checkboxId}
              />
              <Label htmlFor={checkboxId} className="text-sm text-foreground">
                Read Only
              </Label>
            </div>
          </>
        )}
      </div>
    );
  }

  // --- Main render ---

  const isStep1 = wizardStep === 1;
  const subtitle = isStep1
    ? "Let's set up your environments. Start with your source environment \u2014 typically Production."
    : "Now add a target environment \u2014 where you'll push content to (e.g. UAT or DEV).";

  const canSaveStep1 = step1Phase === 'select' && step1EnvName && step1CmUrl;
  const canSaveStep2 = step2Phase === 'select' && step2EnvName && step2CmUrl;

  return (
    <div className="flex items-center justify-center flex-1 p-6">
      <Card style="outline" padding="lg" className="max-w-[520px] w-full">
        {renderStepIndicator(wizardStep)}

        <h2 className="text-[22px] font-bold text-foreground mb-1.5">
          {isStep1 ? 'Welcome to Rift' : 'Add your target environment'}
        </h2>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          {subtitle}
        </p>

        {/* Step 1 content */}
        {isStep1 && (
          <>
            {step1Phase === 'credentials' &&
              renderCredentialsForm(step1Connecting, step1ConnectError, handleStep1Connect)}

            {step1Phase === 'select' && (
              <>
                {renderSelectForm(
                  step1Projects,
                  step1SelectedProjectId,
                  handleStep1ProjectChange,
                  step1EnvOptions,
                  step1SelectedEnvId,
                  handleStep1EnvChange,
                  step1LoadingEnvs,
                  step1EnvName,
                  setStep1EnvName,
                  step1CmUrl,
                  setStep1CmUrl,
                  step1AllowWrite,
                  setStep1AllowWrite,
                  'allowWriteStep1'
                )}

                <div className="flex justify-end mt-4">
                  <Button
                    onClick={handleStep1Next}
                    disabled={!canSaveStep1}
                  >
                    Next
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {/* Step 2 content */}
        {!isStep1 && (
          <>
            {step2Phase === 'credentials' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={clientId === savedClientId && clientSecret === savedClientSecret && !!savedClientId}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setClientId(savedClientId);
                        setClientSecret(savedClientSecret);
                      } else {
                        setClientId('');
                        setClientSecret('');
                      }
                    }}
                    id="sameCredentials"
                  />
                  <Label htmlFor="sameCredentials" className="text-sm text-foreground">
                    Same credentials as source environment
                  </Label>
                </div>

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

                {step2ConnectError && (
                  <div className="text-xs text-destructive px-3 py-2 bg-destructive/10 rounded border border-destructive/30">
                    {step2ConnectError}
                  </div>
                )}

                <div className="flex justify-end mt-2">
                  <Button
                    onClick={handleStep2Connect}
                    disabled={step2Connecting || !clientId || !clientSecret}
                  >
                    {step2Connecting ? 'Connecting...' : 'Connect'}
                  </Button>
                </div>
              </div>
            )}

            {step2Phase === 'select' && (
              <>
                {renderSelectForm(
                  step2Projects,
                  step2SelectedProjectId,
                  handleStep2ProjectChange,
                  step2EnvOptions,
                  step2SelectedEnvId,
                  handleStep2EnvChange,
                  step2LoadingEnvs,
                  step2EnvName,
                  setStep2EnvName,
                  step2CmUrl,
                  setStep2CmUrl,
                  step2AllowWrite,
                  setStep2AllowWrite,
                  'allowWriteStep2'
                )}

                <div className="flex gap-2 justify-end mt-4">
                  <Button variant="outline" onClick={handleBack}>
                    Back
                  </Button>
                  <Button
                    onClick={handleStep2Finish}
                    disabled={!canSaveStep2}
                  >
                    Finish
                  </Button>
                </div>
              </>
            )}

            {step2Phase === 'credentials' && (
              <div className="flex gap-2 justify-end mt-4">
                <Button variant="outline" onClick={handleBack}>
                  Back
                </Button>
              </div>
            )}
          </>
        )}

        {/* Skip link */}
        <div className="text-center mt-5">
          <span
            onClick={() => setShowSkipConfirm(true)}
            className="text-xs text-muted-foreground cursor-pointer hover:underline"
          >
            {isStep1 ? 'Skip Setup' : 'Skip'}
          </span>
        </div>
      </Card>

      {/* Skip confirmation */}
      <AlertDialog open={showSkipConfirm} onOpenChange={setShowSkipConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip Setup?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to skip the setup wizard? You can always add environments manually from the Environments tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction onClick={onComplete}>
              Skip
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
