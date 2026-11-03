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
  scope: 'SingleItem' | 'ItemAndDescendants';
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
  updated?: string;
  children?: TreeNode[];
  isExpanded?: boolean;
}

/**
 * A paired tree node representing the same logical item across source and target envs.
 * Identity key is `path`. Either side may be undefined when the item exists on only one side.
 */
export interface DualTreeNode {
  path: string;
  name: string;
  hasChildren: boolean;
  source?: TreeNode;
  target?: TreeNode;
  diff?: 'match' | 'different';
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

/**
 * Prefix of the error thrown when the target has accepted a file but its
 * background job has not reached BlobState Transferred within the finalizing
 * budget. Shared so the progress copy can recognise it and so the run-level
 * summary can tell a slow target apart from a real failure.
 */
export const FINALIZING_TIMEOUT_PREFIX = 'Target is still finalizing';

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
  | 'finalizing'
  | 'cleanup'
  | 'complete'
  | 'error';

export interface TransferProgressEvent {
  timestamp: number;
  phase: TransferPhase;
  detail?: string;
}

export interface TransferProgress {
  itemPath: string;
  phase: TransferPhase;
  chunksTotal?: number;
  chunksComplete?: number;
  error?: string;
  /** Set when the target finished writing but reported errors (BlobState TransferredWithErrors). */
  warning?: string;
  events?: TransferProgressEvent[];
}
