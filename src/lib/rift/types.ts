// --- Environment types (from Marketplace SDK application.context) ---

export interface RiftEnvironment {
  tenantId: string;
  tenantDisplayName: string;
  contextId: string; // preview Context ID — used for all API calls
}

// --- Migration types ---

export interface MigrationPath {
  itemPath: string;
  itemId: string;
  scope: 'SingleItem' | 'ItemAndChildren' | 'ItemAndDescendants';
}

export interface RiftPreset {
  id: string;
  name: string;
  paths: MigrationPath[];
  lastUsed: string;
  sourceTenantId?: string;
  targetTenantId?: string;
  siteRootPath?: string;
}

export interface TreeNode {
  itemId: string;
  name: string;
  path: string;
  hasChildren: boolean;
  templateName: string;
  children?: TreeNode[];
  isExpanded?: boolean;
}

export interface SiteInfo {
  name: string;
  rootPath: string;
}

export type MigrationLogLevel = 'DEBUG' | 'INFORMATION' | 'WARNING' | 'ERROR';

export interface RiftSettings {
  parallelPaths: boolean;
}

export const DEFAULT_SETTINGS: RiftSettings = {
  parallelPaths: true,
};

export interface MigrationHistoryEntry {
  id: string;
  date: string;
  sourceEnvName: string;
  targetEnvName: string;
  paths: { itemPath: string; scope: string }[];
  elapsedMs: number;
  status: 'success' | 'partial' | 'failed';
}

export type RiftView = 'migrate' | 'presets' | 'history';

// --- Content Transfer types ---

export type TransferPhase =
  | 'creating'
  | 'exporting'
  | 'downloading'
  | 'uploading'
  | 'assembling'
  | 'consuming'
  | 'cleanup'
  | 'complete'
  | 'error';

export interface TransferProgress {
  itemPath: string;
  phase: TransferPhase;
  chunksTotal?: number;
  chunksComplete?: number;
  error?: string;
}
