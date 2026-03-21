import type { TreeNode, SiteInfo } from './types';

interface FetchTreeResult {
  children: TreeNode[];
}

export async function fetchTreeChildren(
  cmUrl: string,
  accessToken: string,
  parentPath: string
): Promise<TreeNode[]> {
  const res = await fetch('/api/rift/tree', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmUrl, accessToken, parentPath }),
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

export async function fetchSites(
  cmUrl: string,
  accessToken: string
): Promise<(SiteInfo & { collection: string })[]> {
  const res = await fetch('/api/rift/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmUrl, accessToken }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Sites fetch failed (${res.status})`);
  }

  const result: FetchSitesResult = await res.json();
  return result.sites;
}

export async function fetchProjects(accessToken: string): Promise<unknown[]> {
  const res = await fetch('/api/rift/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken }),
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
  cmUrl: string,
  accessToken: string,
  itemPath: string,
  fieldNames: string[] = []
): Promise<ItemFieldsResult> {
  const res = await fetch('/api/rift/item-fields', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmUrl, accessToken, itemPath, fieldNames }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Item fields fetch failed (${res.status})`);
  }

  return res.json();
}

export async function fetchEnvironments(
  accessToken: string,
  projectId: string
): Promise<unknown[]> {
  const res = await fetch('/api/rift/environments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, projectId }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Environments fetch failed (${res.status})`);
  }

  return res.json();
}
