import type { TreeNode, SiteInfo } from './types';

interface FetchTreeResult {
  children: TreeNode[];
}

export async function fetchTreeChildren(parentPath: string): Promise<TreeNode[]> {
  const res = await fetch('/api/rift/tree', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentPath }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Tree fetch failed (${res.status})`);
  }

  const result: FetchTreeResult = await res.json();
  return result.children;
}

interface FetchSitesResult {
  sites: (SiteInfo & { collection: string })[];
}

export async function fetchSites(): Promise<(SiteInfo & { collection: string })[]> {
  const res = await fetch('/api/rift/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Sites fetch failed (${res.status})`);
  }

  const result: FetchSitesResult = await res.json();
  return result.sites;
}

export async function fetchProjects(): Promise<unknown[]> {
  const res = await fetch('/api/rift/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Projects fetch failed (${res.status})`);
  }

  return res.json();
}

interface ItemFieldsResult {
  itemId: string;
  name: string;
  path: string;
  templateId: string;
  templateName: string;
  fields: Record<string, string>;
}

export async function fetchItemFields(
  itemPath: string,
  fieldNames: string[] = []
): Promise<ItemFieldsResult> {
  const res = await fetch('/api/rift/item-fields', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemPath, fieldNames }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Item fields fetch failed (${res.status})`);
  }

  return res.json();
}

export async function fetchEnvironments(projectId: string): Promise<unknown[]> {
  const res = await fetch('/api/rift/environments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Environments fetch failed (${res.status})`);
  }

  return res.json();
}

// --- Shared parsing helpers for Deploy API responses ---

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

export interface ProjectOption {
  id: string;
  name: string;
}

export interface EnvironmentOption {
  id: string;
  name: string;
  host: string;
}

/** Parse raw Deploy API project response into ProjectOption[] */
export function parseProjectList(rawProjects: unknown): ProjectOption[] {
  const projectList = Array.isArray(rawProjects)
    ? rawProjects
    : Array.isArray((rawProjects as Record<string, unknown>)?.data)
      ? ((rawProjects as Record<string, unknown>).data as unknown[])
      : [];

  const parsed: ProjectOption[] = [];
  for (const p of projectList) {
    const id = getString(p, 'id');
    const name = getString(p, 'name');
    if (id) parsed.push({ id, name: name || id });
  }
  return parsed;
}

/**
 * Parse raw Deploy API environment response into EnvironmentOption[].
 * Filters to only CM environments belonging to the specified project,
 * since the Deploy API ignores the projectId query parameter.
 */
/** Store credentials server-side for an environment */
export async function storeCredentialsApi(
  envId: string,
  clientId: string,
  clientSecret: string
): Promise<void> {
  const res = await fetch('/api/rift/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envId, clientId, clientSecret, action: 'store' }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to store credentials');
  }
}

/** Check if credentials are stored server-side for an environment */
export async function checkCredentialsApi(envId: string): Promise<boolean> {
  const res = await fetch('/api/rift/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envId, action: 'check' }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.hasCredentials === true;
}

/** Delete stored credentials for an environment */
export async function deleteCredentialsApi(envId: string): Promise<void> {
  const res = await fetch('/api/rift/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envId, action: 'delete' }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete credentials');
  }
}

export function parseEnvironmentList(rawEnvs: unknown, forProjectId: string): EnvironmentOption[] {
  const envList = Array.isArray(rawEnvs)
    ? rawEnvs
    : Array.isArray((rawEnvs as Record<string, unknown>)?.data)
      ? ((rawEnvs as Record<string, unknown>).data as unknown[])
      : [];

  const parsed: EnvironmentOption[] = [];
  for (const e of envList) {
    const id = getString(e, 'id');
    const name = getString(e, 'name');
    const host = getString(e, 'host');
    const envProjectId = getString(e, 'projectId');
    const envType = getString(e, 'type');
    if (envProjectId && envProjectId !== forProjectId) continue;
    if (envType && envType !== 'cm') continue;
    const cmUrl = host ? `https://${host}` : '';
    if (id) parsed.push({ id, name: name || id, host: cmUrl });
  }
  return parsed;
}
