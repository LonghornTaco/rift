import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import type { TreeNode, SiteInfo, DualTreeNode } from './types';

/**
 * Merge two same-level TreeNode lists into DualTreeNode pairs, keyed by path.
 *
 * - Preserves source order for paths present in source.
 * - Appends target-only paths at the end in target order.
 * - `name` comes from source when present, otherwise target.
 * - `hasChildren` is true if either side reports hasChildren.
 * - When `target` is null or undefined, every pair has `target: undefined`.
 * - `diff` is set only when both sides are present AND both have non-empty `updated` strings.
 *   'match' when updated values are equal, 'different' otherwise. Undefined in all other cases.
 */
export function zipDualTreeChildren(
  source: TreeNode[],
  target: TreeNode[] | null | undefined,
): DualTreeNode[] {
  const targetByPath = new Map<string, TreeNode>();
  if (target) {
    for (const t of target) targetByPath.set(t.path, t);
  }

  const paired: DualTreeNode[] = [];
  const seen = new Set<string>();

  for (const s of source) {
    const t = targetByPath.get(s.path);
    const pair: DualTreeNode = {
      path: s.path,
      name: s.name,
      hasChildren: s.hasChildren || (t?.hasChildren ?? false),
      source: s,
      target: t,
    };
    if (t && s.updated && t.updated) {
      pair.diff = s.updated === t.updated ? 'match' : 'different';
    }
    paired.push(pair);
    seen.add(s.path);
  }

  if (target) {
    for (const t of target) {
      if (seen.has(t.path)) continue;
      paired.push({
        path: t.path,
        name: t.name,
        hasChildren: t.hasChildren,
        source: undefined,
        target: t,
      });
    }
  }

  return paired;
}

/**
 * Fetch children of a tree node via Authoring GraphQL API.
 */
export async function fetchTreeChildren(
  client: ClientSDK,
  contextId: string,
  parentPath: string
): Promise<TreeNode[]> {
  const query = {
    query: `query GetChildren($path: String!) {
      item(where: { path: $path }) {
        children { nodes { itemId name path hasChildren template { name } updated: field(name: "__Updated") { value } } }
      }
    }`,
    variables: { path: parentPath },
  };

  const response = await client.mutate('xmc.authoring.graphql', {
    params: { query: { sitecoreContextId: contextId }, body: query },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resData = response.data as any;
  const nodes = resData?.data?.item?.children?.nodes ?? [];
  return nodes.map(
    (n: {
      itemId: string;
      name: string;
      path: string;
      hasChildren: boolean;
      template: { name: string };
      updated?: { value?: string } | null;
    }) => {
      const mapped: TreeNode = {
        itemId: n.itemId,
        name: n.name,
        path: n.path,
        hasChildren: n.hasChildren,
        templateName: n.template?.name ?? '',
      };
      const updatedValue = n.updated?.value;
      if (updatedValue) mapped.updated = updatedValue;
      return mapped;
    },
  );
}

/**
 * Fetch children from source and target envs in parallel and zip into DualTreeNode pairs.
 *
 * - When `targetContextId` is null, only the source is fetched.
 * - When the target fetch rejects, degrades gracefully to source-only pairs (logged silently).
 * - When the source fetch rejects, the error is re-thrown (expansion fails like today).
 */
export async function fetchDualTreeChildren(
  client: ClientSDK,
  sourceContextId: string,
  targetContextId: string | null,
  parentPath: string,
): Promise<DualTreeNode[]> {
  const sourcePromise = fetchTreeChildren(client, sourceContextId, parentPath);
  const targetPromise = targetContextId
    ? fetchTreeChildren(client, targetContextId, parentPath)
    : Promise.resolve(null);

  const [sourceResult, targetResult] = await Promise.allSettled([sourcePromise, targetPromise]);

  if (sourceResult.status === 'rejected') {
    throw sourceResult.reason;
  }

  const sourceChildren = sourceResult.value;
  const targetChildren =
    targetResult.status === 'fulfilled' ? targetResult.value : null;

  if (targetResult.status === 'rejected' && targetContextId) {
    console.warn(
      `[Rift] Target tree fetch failed for ${parentPath}:`,
      targetResult.reason,
    );
  }

  return zipDualTreeChildren(sourceChildren, targetChildren);
}

/**
 * Fetch sites via XM Apps Sites REST API.
 * Fetches both sites and collections to construct the full content root path.
 */
export async function fetchSites(
  client: ClientSDK,
  contextId: string
): Promise<(SiteInfo & { collection: string })[]> {
  const [sitesResponse, collectionsResponse] = await Promise.all([
    client.query('xmc.xmapp.listSites', {
      params: { query: { sitecoreContextId: contextId } },
    }),
    client.query('xmc.xmapp.listCollections', {
      params: { query: { sitecoreContextId: contextId } },
    }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sites = (sitesResponse.data as any)?.data ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collections = (collectionsResponse.data as any)?.data ?? [];

  // Build collection ID → name lookup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collectionMap = new Map<string, string>(
    collections.map((c: any) => [c.id, c.name])
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sites
    .filter((s: any) => s.name)
    .map((s: any) => {
      const collectionName = collectionMap.get(s.collectionId) ?? '';
      // XM Cloud convention: /sitecore/content/<CollectionName>/<SiteName>
      const rootPath = collectionName
        ? `/sitecore/content/${collectionName}/${s.name}`
        : `/sitecore/content/${s.name}`;
      return {
        name: s.name,
        rootPath,
        collection: collectionName,
      };
    });
}

/**
 * Fetch item fields via Authoring GraphQL API.
 */
export async function fetchItemFields(
  client: ClientSDK,
  contextId: string,
  itemPath: string
): Promise<{ itemId: string; name: string; path: string; templateId: string; templateName: string; fields: Record<string, string> }> {
  const query = {
    query: `query GetItemFields($path: String!) {
      item(where: { path: $path }) {
        itemId name path
        template { templateId: itemId name }
        fields(ownFields: true, excludeStandardFields: true) {
          nodes { name value }
        }
      }
    }`,
    variables: { path: itemPath },
  };

  const response = await client.mutate('xmc.authoring.graphql', {
    params: { query: { sitecoreContextId: contextId }, body: query },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const item = (response.data as any)?.data?.item;
  if (!item) throw new Error(`Item not found: ${itemPath}`);

  const fields: Record<string, string> = {};
  for (const f of item.fields?.nodes ?? []) {
    fields[f.name] = f.value;
  }

  return {
    itemId: item.itemId,
    name: item.name,
    path: item.path,
    templateId: item.template?.templateId ?? '',
    templateName: item.template?.name ?? '',
    fields,
  };
}
