import type { ClientSDK } from '@sitecore-marketplace-sdk/client';
import type { TreeNode, SiteInfo } from './types';

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
        children { nodes { itemId name path hasChildren template { name } } }
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
  return nodes.map((n: { itemId: string; name: string; path: string; hasChildren: boolean; template: { name: string } }) => ({
    itemId: n.itemId,
    name: n.name,
    path: n.path,
    hasChildren: n.hasChildren,
    templateName: n.template?.name ?? '',
  }));
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
