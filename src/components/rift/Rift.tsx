'use client';

import { useState, useEffect } from 'react';
import { RiftView, RiftPreset, RiftSettings, DEFAULT_SETTINGS } from '@/lib/rift/types';
import { getEnvironments, getSettings, saveSettings } from '@/lib/rift/storage';
import { RiftEnvironments } from './RiftEnvironments';
import { RiftWelcome } from './RiftWelcome';
import { RiftMigrate } from './RiftMigrate';
import { RiftPresets } from './RiftPresets';
import { RiftSetupWizard } from './RiftSetupWizard';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
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
import { cn } from '@/lib/utils';

export function Rift() {
  const [activeView, setActiveView] = useState<RiftView>('migrate');
  const [migrateMode, setMigrateMode] = useState<'welcome' | 'workspace'>('welcome');
  const [loadedPreset, setLoadedPreset] = useState<RiftPreset | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [settings, setSettings] = useState<RiftSettings>(DEFAULT_SETTINGS);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState('general');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);

  useEffect(() => {
    getEnvironments().then((envs) => {
      if (envs.length === 0) {
        setShowSetup(true);
      }
    });
    // Restore dark mode preference (default: dark)
    const saved = localStorage.getItem('rift:darkMode');
    if (saved === 'false') {
      setDarkMode(false);
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
    setSettings(getSettings());
  }, []);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    if (next) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('rift:darkMode', String(next));
  };

  const handleSetupComplete = () => {
    setShowSetup(false);
    setActiveView('migrate');
  };

  const handleNavClick = (view: RiftView) => {
    if (activeView === 'migrate' && view !== 'migrate') {
      setMigrateMode('welcome');
    }
    if (view === 'migrate' && activeView !== 'migrate') {
      setMigrateMode('welcome');
    }
    setActiveView(view);
  };

  const renderContent = () => {
    if (showSetup) {
      return <RiftSetupWizard onComplete={handleSetupComplete} />;
    }

    if (activeView === 'environments') {
      return <RiftEnvironments />;
    }

    if (activeView === 'migrate') {
      if (migrateMode === 'welcome') {
        return (
          <RiftWelcome
            onNewMigration={() => {
              setMigrateMode('workspace');
              setLoadedPreset(null);
            }}
            onLoadPreset={(p) => {
              setMigrateMode('workspace');
              setLoadedPreset(p);
            }}
          />
        );
      }
      return <RiftMigrate loadedPreset={loadedPreset} onBack={() => setMigrateMode('welcome')} batchSize={settings.batchSize} />;
    }

    if (activeView === 'presets') {
      return (
        <RiftPresets
          onLoadPreset={(preset) => {
            setLoadedPreset(preset);
            setMigrateMode('workspace');
            setActiveView('migrate');
          }}
        />
      );
    }

    // Settings page
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="px-5 py-3 bg-card border-b border-border">
          <div className="text-base font-semibold text-foreground">Settings</div>
        </div>
        <div className="p-5 space-y-8 max-w-md">
          {/* Display section */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Display</h3>
            <label className="text-sm font-medium text-muted-foreground block mb-2">
              Theme
            </label>
            <Select
              value={darkMode ? 'dark' : 'light'}
              onValueChange={(val) => {
                const isDark = val === 'dark';
                setDarkMode(isDark);
                if (isDark) {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
                localStorage.setItem('rift:darkMode', String(isDark));
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Configuration section */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Configuration</h3>
            <label className="text-sm font-medium text-muted-foreground block mb-1">
              Batch Size
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Number of items pushed per request. Larger batches are faster but may timeout on slow connections. Default: {DEFAULT_SETTINGS.batchSize}.
            </p>
            <Select
              value={String(settings.batchSize)}
              onValueChange={(val) => {
                const updated = { ...settings, batchSize: parseInt(val, 10) };
                setSettings(updated);
                saveSettings(updated);
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
        </div>
      </div>
    );
  };

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex h-screen w-full font-sans">
        {/* Sidebar */}
        <Sidebar className="w-[220px] shrink-0 border-r border-sidebar-border bg-sidebar">
          <SidebarHeader>
            <div
              className="px-2 pt-3 pb-1 cursor-pointer"
              onClick={() => {
                setActiveView('migrate');
                setMigrateMode('welcome');
              }}
            >
              <div className="text-2xl font-bold tracking-wide text-sidebar-primary-foreground">
                RIFT
              </div>
              <div className="text-xs text-sidebar-foreground/60 mt-0.5">
                Content Migration
              </div>
            </div>
          </SidebarHeader>

          <SidebarSeparator />

          <SidebarContent>
            {/* Main nav */}
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  isActive={activeView === 'migrate'}
                  onClick={() => handleNavClick('migrate')}
                >
                  <span className="w-5 text-center inline-block shrink-0">{'\u21C4'}</span>
                  <span>Migrate</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

            {/* Settings section */}
            <div className="mt-6">
              <div
                className="pl-5 pr-3 py-1.5 text-[10px] uppercase tracking-widest text-sidebar-foreground/40 cursor-pointer select-none flex items-center gap-1.5"
                onClick={() => setSettingsExpanded(!settingsExpanded)}
              >
                <span className="text-[8px]">{settingsExpanded ? '\u25BC' : '\u25B6'}</span>
                Settings
              </div>

              {settingsExpanded && (
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      size="sm"
                      isActive={activeView === 'environments'}
                      onClick={() => handleNavClick('environments')}
                      className="pl-6"
                    >
                      <span className="w-5 text-center inline-block shrink-0">{'\uD83D\uDD17'}</span>
                      <span>Environments</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      size="sm"
                      isActive={activeView === 'presets'}
                      onClick={() => handleNavClick('presets')}
                      className="pl-6"
                    >
                      <span className="w-5 text-center inline-block shrink-0">{'\u2605'}</span>
                      <span>Presets</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      size="sm"
                      isActive={activeView === 'display'}
                      onClick={() => handleNavClick('display')}
                      className="pl-6"
                    >
                      <span className="w-5 text-center inline-block shrink-0">{'\u2699'}</span>
                      <span>Configuration</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      size="sm"
                      onClick={() => { setShowFeedback(true); setFeedbackText(''); setFeedbackCategory('general'); }}
                      className="pl-6"
                    >
                      <span className="w-5 text-center inline-block shrink-0">{'\uD83D\uDCE8'}</span>
                      <span>Feedback</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              )}
            </div>
          </SidebarContent>

          <SidebarFooter>
            <div className="text-[10px] text-sidebar-foreground/40 px-2">
              v1.0 &middot; No server storage
            </div>
          </SidebarFooter>
        </Sidebar>

        {/* Content Area */}
        <div
          className={cn(
            'flex-1 bg-background overflow-y-auto flex flex-col',
            !showSetup &&
              activeView !== 'environments' &&
              !(activeView === 'migrate' && migrateMode === 'workspace') &&
              activeView !== 'migrate' &&
              'items-center justify-center'
          )}
        >
          {renderContent()}
        </div>
      </div>

      {/* Feedback dialog */}
      <Dialog open={showFeedback} onOpenChange={(open) => { if (!open) { setShowFeedback(false); setFeedbackSent(false); setFeedbackText(''); setFeedbackCategory('general'); } }}>
        <DialogContent size="sm">
          {feedbackSent ? (
            <>
              <DialogHeader>
                <DialogTitle>Thank You</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">Your feedback has been sent. We appreciate you taking the time to help us improve Rift.</p>
              <DialogFooter>
                <Button onClick={() => { setShowFeedback(false); setFeedbackSent(false); setFeedbackText(''); setFeedbackCategory('general'); }}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Send Feedback</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs font-semibold text-foreground mb-1">Category</Label>
                  <Select value={feedbackCategory} onValueChange={setFeedbackCategory}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General Feedback</SelectItem>
                      <SelectItem value="bug">Bug Report</SelectItem>
                      <SelectItem value="feature">Feature Request</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-semibold text-foreground mb-1">Your Feedback</Label>
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Tell us what you think..."
                    rows={5}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowFeedback(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={!feedbackText.trim()}
                  onClick={() => {
                    const categoryLabels: Record<string, string> = {
                      general: 'General Feedback',
                      bug: 'Bug Report',
                      feature: 'Feature Request',
                    };
                    const subject = encodeURIComponent(`[Rift] ${categoryLabels[feedbackCategory] || 'Feedback'}`);
                    const body = encodeURIComponent(feedbackText.trim());
                    window.open(`mailto:rift-feedback@mayo.edu?subject=${subject}&body=${body}`, '_blank');
                    setFeedbackSent(true);
                  }}
                >
                  Send
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
