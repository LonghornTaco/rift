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

  const nodes = response.data?.data?.item?.children?.nodes ?? [];
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
 */
export async function fetchSites(
  client: ClientSDK,
  contextId: string
): Promise<(SiteInfo & { collection: string })[]> {
  const response = await client.query('xmc.xmapp.listSites', {
    params: { query: { sitecoreContextId: contextId } },
  });

  const sites = response.data?.data ?? [];
  return sites.map((s: { name: string; rootItem?: { path: string }; collection?: { name: string } }) => ({
    name: s.name,
    rootPath: s.rootItem?.path ?? '',
    collection: s.collection?.name ?? '',
  }));
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

  const item = response.data?.data?.item;
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
