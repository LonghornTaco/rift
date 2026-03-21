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

export interface RiftSettings {
  batchSize: number;
}

export const DEFAULT_SETTINGS: RiftSettings = {
  batchSize: 200,
};

export type RiftView = 'environments' | 'migrate' | 'presets' | 'display';

export type ConnectionStatus = 'untested' | 'connected' | 'failed';
