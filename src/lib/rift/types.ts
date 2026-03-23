export interface RiftEnvironment {
  id: string;
  name: string;
  cmUrl: string;
  clientId: string;
  clientSecret: string;
  allowWrite: boolean;
}

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
  sourceEnvId?: string;
  targetEnvId?: string;
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
  batchSize: number;
  logLevel: MigrationLogLevel;
  parallelPaths: boolean;
}

export const DEFAULT_SETTINGS: RiftSettings = {
  batchSize: 200,
  logLevel: 'INFORMATION',
  parallelPaths: false,
};

export interface MigrationHistoryEntry {
  id: string;
  date: string;
  sourceEnvName: string;
  targetEnvName: string;
  paths: { itemPath: string; scope: string }[];
  elapsedMs: number;
  totalItems: number;
  succeeded: number;
  failed: number;
  created: number;
  updated: number;
  status: 'success' | 'partial' | 'failed';
}

export type RiftView = 'environments' | 'migrate' | 'presets' | 'history' | 'display';

export type ConnectionStatus = 'untested' | 'connected' | 'failed';
