'use client';

import { useState, useEffect } from 'react';
import { RiftView, RiftPreset } from '@/lib/rift/types';
import { getEnvironments } from '@/lib/rift/storage';
import { RiftEnvironments } from './RiftEnvironments';
import { RiftWelcome } from './RiftWelcome';
import { RiftMigrate } from './RiftMigrate';
import { RiftPresets } from './RiftPresets';
import { RiftHistory } from './RiftHistory';
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
  const [showSetup, setShowSetup] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
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
      return <RiftMigrate loadedPreset={loadedPreset} onBack={() => setMigrateMode('welcome')} />;
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

    if (activeView === 'history') {
      return <RiftHistory />;
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
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="sm"
                  isActive={activeView === 'environments'}
                  onClick={() => handleNavClick('environments')}
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
                >
                  <span className="w-5 text-center inline-block shrink-0">{'\u2605'}</span>
                  <span>Presets</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="sm"
                  isActive={activeView === 'history'}
                  onClick={() => handleNavClick('history')}
                >
                  <span className="w-5 text-center inline-block shrink-0">{'\uD83D\uDCCB'}</span>
                  <span>History</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>

            <div className="mt-auto">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    isActive={activeView === 'display'}
                    onClick={() => handleNavClick('display')}
                  >
                    <span className="w-5 text-center inline-block shrink-0">{'\uD83C\uDFA8'}</span>
                    <span>Theme</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    onClick={() => { setShowFeedback(true); setFeedbackText(''); setFeedbackCategory('general'); }}
                  >
                    <span className="w-5 text-center inline-block shrink-0">{'\uD83D\uDCE8'}</span>
                    <span>Feedback</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    onClick={() => setShowAbout(true)}
                  >
                    <span className="w-5 text-center inline-block shrink-0">{'\u2139\uFE0F'}</span>
                    <span>About Rift</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </div>
          </SidebarContent>
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

      {/* About dialog */}
      <Dialog open={showAbout} onOpenChange={setShowAbout}>
        <DialogContent size="sm">
          <div className="flex flex-col items-center text-center py-4">
            <img src="/rift-logo.svg" alt="Rift" className="w-16 h-16 mb-4" />
            <div className="text-lg font-bold text-foreground">Rift</div>
            <div className="text-sm text-muted-foreground mb-4">Content Migration for Sitecore XM Cloud</div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div><span className="font-medium text-foreground">Version:</span> 1.0.0</div>
              <div><span className="font-medium text-foreground">Author:</span> Wilkerson Consulting</div>
              <div><span className="font-medium text-foreground">Website:</span> <a href="https://longhorntaco.com/rift" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">longhorntaco.com/rift</a></div>
            </div>
            <div className="text-[10px] text-muted-foreground/60 mt-6">
              &copy; 2026 Wilkerson Consulting. All rights reserved.
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowAbout(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
