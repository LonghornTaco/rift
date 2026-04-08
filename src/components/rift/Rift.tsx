'use client';

import { useState, useEffect } from 'react';
import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import { RiftAuthProvider } from '@/lib/rift/auth-provider';
import { useMarketplaceClient } from '@/lib/rift/marketplace-client';
import { RiftView, RiftPreset } from '@/lib/rift/types';
import { RiftWelcome } from './RiftWelcome';
import { RiftMigrate } from './RiftMigrate';
import { RiftPresets } from './RiftPresets';
import { RiftHistory } from './RiftHistory';
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// --- Root export: wraps app in auth provider ---

export function Rift() {
  return (
    <RiftAuthProvider>
      <RiftApp />
    </RiftAuthProvider>
  );
}

// --- Inner app: consumes SDK state ---

function RiftApp() {
  const { client, environments, isInitialized, error } = useMarketplaceClient();

  const [activeView, setActiveView] = useState<RiftView>('migrate');
  const [migrateMode, setMigrateMode] = useState<'welcome' | 'workspace'>('welcome');
  const [loadedPreset, setLoadedPreset] = useState<RiftPreset | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
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

  const handleNavClick = (view: RiftView) => {
    if (view === 'migrate' || activeView === 'migrate') {
      setMigrateMode('welcome');
    }
    setActiveView(view);
  };

  const handleLoadPreset = (preset: RiftPreset) => {
    setLoadedPreset(preset);
    setMigrateMode('workspace');
    setActiveView('migrate');
  };

  // --- Loading state ---
  if (!isInitialized) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background font-sans">
        <div className="text-sm text-muted-foreground">Connecting to Sitecore...</div>
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background font-sans">
        <div className="text-sm text-destructive">SDK Error: {error}</div>
      </div>
    );
  }

  // --- Minimum environments guard ---
  if (environments.length < 2) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background font-sans">
        <div className="text-sm text-muted-foreground text-center max-w-sm">
          <div className="font-semibold text-foreground mb-2">Not enough environments</div>
          <div>Rift requires access to at least two XM Cloud environments. Please ensure your organization has the necessary resource access configured in the Sitecore Marketplace.</div>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    if (activeView === 'migrate') {
      if (migrateMode === 'welcome') {
        return (
          <RiftWelcome
            environments={environments}
            onNewMigration={() => {
              setMigrateMode('workspace');
              setLoadedPreset(null);
            }}
            onLoadPreset={(p: RiftPreset) => {
              setMigrateMode('workspace');
              setLoadedPreset(p);
            }}
          />
        );
      }
      return (
        <RiftMigrate
          client={client!}
          environments={environments}
          loadedPreset={loadedPreset}
          onBack={() => setMigrateMode('welcome')}
        />
      );
    }

    if (activeView === 'presets') {
      return (
        <RiftPresets
          environments={environments}
          onLoadPreset={handleLoadPreset}
        />
      );
    }

    if (activeView === 'history') {
      return <RiftHistory />;
    }

    return null;
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
          </SidebarContent>

          <SidebarFooter>
            <SidebarMenu>
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
          </SidebarFooter>
        </Sidebar>

        {/* Content Area */}
        <div
          className={cn(
            'flex-1 bg-background overflow-y-auto flex flex-col',
            !(activeView === 'migrate' && migrateMode === 'workspace') && 'items-center justify-center'
          )}
        >
          {renderContent()}
        </div>
      </div>

      {/* About dialog */}
      <Dialog open={showAbout} onOpenChange={setShowAbout}>
        <DialogContent size="sm">
          <div className="flex flex-col items-center text-center py-4">
            <img src="/rift-logo.svg" alt="Rift" className="w-16 h-16 mb-4" />
            <div className="text-lg font-bold text-foreground">Rift</div>
            <div className="text-sm text-muted-foreground mb-4">Content Migration for SitecoreAI</div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div><span className="font-medium text-foreground">Version:</span> 1.0.0</div>
              <div><span className="font-medium text-foreground">Author:</span> Wilkerson Consulting</div>
              <div><span className="font-medium text-foreground">Website:</span> <a href="https://riftapp.dev" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">riftapp.dev</a></div>
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
