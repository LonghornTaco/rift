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

type RawChildNode = {
  itemId: string;
  name: string;
  path: string;
  hasChildren: boolean;
  template: { name: string };
  updated?: { value?: string } | null;
};

function childrenQuery(parentPath: string) {
  return {
    query: `query GetChildren($path: String!) {
      item(where: { path: $path }) {
        children { nodes { itemId name path hasChildren template { name } updated: field(name: "__Updated") { value } } }
      }
    }`,
    variables: { path: parentPath },
  };
}

function mapChildNodes(nodes: RawChildNode[]): TreeNode[] {
  return nodes.map((n) => {
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
  });
}

/**
 * Throw when a GraphQL response body carries `errors`. Sitecore answers HTTP
 * 200 with an `errors` array on execution failures (timeouts included), so a
 * caller that only reads `data` would mistake a failed query for an empty one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function assertGraphQLOk(resData: any, label: string): void {
  const errors = resData?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(
      `GraphQL error ${label}: ${errors.map((e: { message?: string }) => e?.message ?? 'unknown').join('; ')}`
    );
  }
}

/**
 * Fetch children of a tree node via Authoring GraphQL API.
 *
 * Lenient: any failure (transport, GraphQL errors, missing item) yields [] so
 * the tree degrades gracefully. Use fetchTreeChildrenStrict wherever an empty
 * list must not be mistaken for "no children".
 */
export async function fetchTreeChildren(
  client: ClientSDK,
  contextId: string,
  parentPath: string
): Promise<TreeNode[]> {
  const response = await client.mutate('xmc.authoring.graphql', {
    params: { query: { sitecoreContextId: contextId }, body: childrenQuery(parentPath) },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resData = response.data as any;
  return mapChildNodes(resData?.data?.item?.children?.nodes ?? []);
}

/**
 * Run an Authoring GraphQL request and return its `data`, rejecting on an SDK
 * error envelope (an HTTP failure that resolves instead of throwing) and on a
 * GraphQL `errors` body. For callers where a silent empty result would be
 * mistaken for a real one.
 */
async function authoringStrict(
  client: ClientSDK,
  contextId: string,
  body: { query: string; variables?: Record<string, unknown> },
  label: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const response = await client.mutate('xmc.authoring.graphql', {
    params: { query: { sitecoreContextId: contextId }, body },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = response as any;
  if (res?.error) {
    throw new Error(`Authoring request failed while ${label}: ${JSON.stringify(res.error)}`);
  }
  const resData = res?.data;
  assertGraphQLOk(resData, label);
  return resData?.data;
}

/**
 * Strict variant for the post-transfer stale-list snapshot: rejects on an SDK
 * error envelope, on GraphQL `errors`, and on a missing parent. A failed read
 * must be EXCLUDED from that check; the lenient [] would instead be reported
 * as "every pre-existing child is missing", which is the false alarm the check
 * exists to avoid.
 */
export async function fetchTreeChildrenStrict(
  client: ClientSDK,
  contextId: string,
  parentPath: string
): Promise<TreeNode[]> {
  const data = await authoringStrict(
    client,
    contextId,
    childrenQuery(parentPath),
    `fetching children of ${parentPath}`
  );
  const item = data?.item;
  if (!item) throw new Error(`Item not found: ${parentPath}`);
  return mapChildNodes(item.children?.nodes ?? []);
}

/** The `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}` form of an item id the Authoring API returns as 32 hex chars. */
export function toBracedGuid(id: string): string {
  const hex = id.replace(/[{}-]/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`Not an item id: ${id}`);
  const h = hex.toUpperCase();
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}`;
}

export interface ItemIdentity {
  itemId: string;
  name: string;
}

/**
 * Reset a target item's stale cached child list by saving it with its CURRENT
 * name. Why this works (Sitecore kernel, verified against 1.12.2 and live on
 * 2026-11-03): the item name setter records the name property even when the
 * value is unchanged; a property change makes the data layer drop the item's
 * cached information, child list included; and an unchanged name raises no
 * rename event, so descendants, paths and the index are untouched. Side effects
 * stay on the item itself: an updated timestamp, one item:saved (index entry,
 * links, publish queue, history) and a statistics bump on the current version.
 * Strict: any failure rejects, nothing is retried.
 */
export async function repairChildList(
  client: ClientSDK,
  contextId: string,
  itemPath: string
): Promise<ItemIdentity> {
  const found = await authoringStrict(
    client,
    contextId,
    {
      query: `query GetItemIdentity($path: String!) { item(where: { path: $path }) { itemId name } }`,
      variables: { path: itemPath },
    },
    `looking up ${itemPath}`
  );
  const item = found?.item as ItemIdentity | null | undefined;
  if (!item) throw new Error(`Item not found: ${itemPath}`);
  // Values are inlined (JSON string syntax is valid GraphQL string syntax) so
  // the call does not depend on the schema's input scalar types.
  const renamed = await authoringStrict(
    client,
    contextId,
    {
      query: `mutation RenameToCurrentName { renameItem(input: { itemId: ${JSON.stringify(toBracedGuid(item.itemId))}, newName: ${JSON.stringify(item.name)} }) { item { itemId name } } }`,
    },
    `repairing the child list of ${itemPath}`
  );
  if (!renamed?.renameItem?.item) throw new Error(`Repair of ${itemPath} returned no item`);
  return { itemId: item.itemId, name: item.name };
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
 * Strict counterpart of fetchDualTreeChildren, for the drift walk. The walk
 * caches a descendant count per folder, so a side that failed to read must
 * reject: the lenient variant's [] (or source-only pairs) would be cached as a
 * wrong count. Rejects if either side rejects; with a null target only the
 * source is read.
 */
export async function fetchDualTreeChildrenStrict(
  client: ClientSDK,
  sourceContextId: string,
  targetContextId: string | null,
  parentPath: string,
): Promise<DualTreeNode[]> {
  const [sourceChildren, targetChildren] = await Promise.all([
    fetchTreeChildrenStrict(client, sourceContextId, parentPath),
    targetContextId
      ? fetchTreeChildrenStrict(client, targetContextId, parentPath)
      : Promise.resolve(null),
  ]);
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
 * - Default: returns item's own non-standard fields.
 * - `includeStandard: true`: returns own fields INCLUDING standard fields (`__Updated`,
 *   `__Revision`, security metadata, etc.). Used for on-demand compare view expansion.
 */
export async function fetchItemFields(
  client: ClientSDK,
  contextId: string,
  itemPath: string,
  options?: { includeStandard?: boolean },
): Promise<{ itemId: string; name: string; path: string; templateName: string; fields: Record<string, string> }> {
  const excludeStandard = !options?.includeStandard;
  // Standard fields are inherited from the Standard Template, so ownFields: true filters
  // them out regardless of excludeStandardFields. Flip both flags together.
  const ownFields = excludeStandard;
  const query = {
    query: `query GetItemFields($path: String!) {
      item(where: { path: $path }) {
        itemId name path
        template { name }
        fields(ownFields: ${ownFields}, excludeStandardFields: ${excludeStandard}) {
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
  const resData = response.data as any;
  assertGraphQLOk(resData, `fetching fields for ${itemPath}`);

  const item = resData?.data?.item;
  if (!item) throw new Error(`Item not found: ${itemPath}`);

  const fields: Record<string, string> = {};
  for (const f of item.fields?.nodes ?? []) {
    fields[f.name] = f.value;
  }

  return {
    itemId: item.itemId,
    name: item.name,
    path: item.path,
    templateName: item.template?.name ?? '',
    fields,
  };
}
