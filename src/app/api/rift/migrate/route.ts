import { NextRequest } from 'next/server';
import { validateCmUrl, validateItemPath, getClientIp } from '@/lib/rift/api-security';
import { logOperation, logError } from '@/lib/rift/logger';

// Allow up to 5 minutes for large migrations (Vercel Pro)
export const maxDuration = 300;

interface MigrateRequestBody {
  source: {
    cmUrl: string;
    clientId: string;
    clientSecret: string;
  };
  target: {
    cmUrl: string;
    clientId: string;
    clientSecret: string;
  };
  paths: Array<{
    itemPath: string;
    scope: 'SingleItem' | 'ItemAndChildren' | 'ItemAndDescendants';
  }>;
  batchSize?: number;
  logLevel?: string;
}

const VALID_LOG_LEVELS = new Set(['DEBUG', 'INFORMATION', 'WARNING', 'ERROR']);

const VALID_SCOPES: Record<string, string> = {
  SingleItem: 'SINGLE_ITEM',
  ItemAndChildren: 'ITEM_AND_CHILDREN',
  ItemAndDescendants: 'ITEM_AND_DESCENDANTS',
};

const MANAGEMENT_PATH = '/sitecore/api/management';
const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;
const MIN_BATCH_SIZE = 1;

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch('https://auth.sitecorecloud.io/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience: 'https://api.sitecorecloud.io',
    }),
  });
  if (!res.ok) throw new Error('Authentication failed');
  const data = await res.json();
  return data.access_token;
}

function managementUrl(cmUrl: string): string {
  return `${cmUrl.replace(/\/$/, '')}${MANAGEMENT_PATH}`;
}

function authoringUrl(cmUrl: string): string {
  return `${cmUrl.replace(/\/$/, '')}/sitecore/api/authoring/graphql/v1`;
}

// Fetch child paths from the authoring API for tree walking
async function fetchChildPaths(
  cmUrl: string,
  token: string,
  parentPath: string
): Promise<{ path: string; hasChildren: boolean }[]> {
  const query = `
    query($path: String!) {
      item(where: { path: $path, language: "en", database: "master" }) {
        children {
          nodes {
            path
            hasChildren
          }
        }
      }
    }
  `;

  const res = await fetch(authoringUrl(cmUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables: { path: parentPath } }),
  });

  if (!res.ok) return [];
  const json = await res.json();
  return json?.data?.item?.children?.nodes ?? [];
}

// Pull full item data for a single path
async function pullItemData(
  cmUrl: string,
  token: string,
  itemPath: string,
  scope: string
): Promise<Record<string, unknown>[]> {
  // Management API serialize uses enum values inline (not as variables)
  const safePath = itemPath.replace(/"/g, '\\"');
  const query = `{
    serialize(path: "${safePath}", database: "master", scope: ${scope}) {
      data
    }
  }`;

  const res = await fetch(managementUrl(cmUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pull failed (HTTP ${res.status}): ${text.substring(0, 200)}`);
  }
  const json = await res.json();
  if (json.errors && !json.data) {
    const errMsg = json.errors.map((e: { message?: string }) => e.message).join('; ');
    throw new Error(`GraphQL errors: ${errMsg.substring(0, 300)}`);
  }

  return (json?.data?.serialize ?? []).map((item: Record<string, unknown>) =>
    (item.data || item) as Record<string, unknown>
  );
}

// Pull just IDs from target to check what exists
async function pullExistingIds(
  cmUrl: string,
  token: string,
  itemPath: string,
  scope: string
): Promise<Set<string>> {
  // Management API serialize uses enum values inline (not as variables)
  const safePath = itemPath.replace(/"/g, '\\"');
  const query = `{
    serialize(path: "${safePath}", database: "master", scope: ${scope}) {
      id
    }
  }`;

  const res = await fetch(managementUrl(cmUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) return new Set();
  const json = await res.json();
  if (json.errors) return new Set();

  return new Set((json?.data?.serialize ?? []).map((item: { id: string }) => item.id));
}

// Build UPDATE sub-commands from serialized item data
function buildUpdateSubCommands(itemData: Record<string, unknown>): Array<{ command: number; data: Record<string, unknown> }> {
  const subCommands: Array<{ command: number; data: Record<string, unknown> }> = [];

  const sharedFields = itemData.sharedFields as Array<{ fieldId: string; value: string }> | undefined;
  if (sharedFields) {
    for (const f of sharedFields) {
      subCommands.push({ command: 1, data: { fieldId: f.fieldId, value: f.value } });
    }
  }

  const unversionedFields = itemData.unversionedFields as Array<{
    language: string; fields: Array<{ fieldId: string; value: string }>;
  }> | undefined;
  if (unversionedFields) {
    for (const uf of unversionedFields) {
      for (const f of uf.fields) {
        subCommands.push({ command: 1, data: { fieldId: f.fieldId, value: f.value, language: uf.language } });
      }
    }
  }

  const versions = itemData.versions as Array<{
    language: string; versionNumber: number; fields: Array<{ fieldId: string; value: string }>;
  }> | undefined;
  if (versions) {
    for (const ver of versions) {
      for (const f of ver.fields) {
        subCommands.push({ command: 1, data: { fieldId: f.fieldId, value: f.value, language: ver.language, version: ver.versionNumber } });
      }
    }
  }

  return subCommands;
}

// Build a single ItemCommand from an item
function buildCommand(
  itemData: Record<string, unknown>,
  existingIds: Set<string>
): { itemID: string; parentID: string; database: string; command: string; data: string; isCreate: boolean } {
  const itemId = itemData.id as string;
  const parentId = itemData.parentId as string;

  if (existingIds.has(itemId)) {
    const subCommands = buildUpdateSubCommands(itemData);
    return {
      itemID: itemId,
      parentID: parentId,
      database: 'master',
      command: 'UPDATE',
      data: JSON.stringify(subCommands),
      isCreate: false,
    };
  }

  return {
    itemID: itemId,
    parentID: parentId,
    database: 'master',
    command: 'CREATE',
    data: JSON.stringify(itemData),
    isCreate: true,
  };
}

// Execute a batch of commands
async function executeCommands(
  cmUrl: string,
  token: string,
  commands: Array<{ itemID: string; parentID: string; database: string; command: string; data: string }>,
  logLevel: string
): Promise<Array<{ name: string; success: boolean; messages: Array<{ logLevel: string; message: string }> }>> {
  const mutation = `
    mutation($commands: [ItemCommand!]!, $logLevel: SerializationResultLogLevel) {
      executeSerializationCommands(commands: $commands, minimumLogLevel: $logLevel) {
        name
        success
        messages {
          logLevel
          message
        }
      }
    }
  `;

  const res = await fetch(managementUrl(cmUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: mutation, variables: { commands, logLevel } }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Execute failed (HTTP ${res.status}): ${text.substring(0, 200)}`);
  }
  const json = await res.json();
  if (json.errors && !json.data) {
    const errMsg = json.errors.map((e: { message?: string }) => e.message).join('; ');
    throw new Error(`Execute errors: ${errMsg.substring(0, 300)}`);
  }

  return json?.data?.executeSerializationCommands ?? [];
}

// Process and push items in batches
async function processAndPushItems(
  items: Record<string, unknown>[],
  existingIds: Set<string>,
  targetCmUrl: string,
  targetToken: string,
  send: (data: Record<string, unknown>) => void,
  label: string,
  batchSize: number,
  logLevel: string
): Promise<{ succeeded: number; failed: number; created: number; updated: number }> {
  let succeeded = 0;
  let failed = 0;
  let created = 0;
  let updated = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(items.length / batchSize);

    send({ type: 'status', message: `${label}: pushing batch ${batchNum}/${totalBatches} (${batch.length} items)...` });

    const commands = batch.map((item) => buildCommand(item, existingIds));
    const batchCreates = commands.filter((c) => c.isCreate).length;
    const batchUpdates = commands.length - batchCreates;

    try {
      const results = await executeCommands(
        targetCmUrl,
        targetToken,
        commands.map(({ isCreate, ...cmd }) => cmd),
        logLevel
      );

      for (const r of results) {
        if (r.success) {
          succeeded++;
          // Only stream per-item messages when user selected DEBUG
          if (logLevel === 'DEBUG') {
            for (const m of r.messages ?? []) {
              send({ type: 'debug', message: `${r.name}: ${m.message}`, logLevel: m.logLevel });
            }
          }
        } else {
          failed++;
          const errorMsg = r.messages?.map((m) => m.message).join('; ') ?? 'Unknown error';
          send({ type: 'warning', message: `Failed: ${r.name}: ${errorMsg.substring(0, 200)}` });
        }
      }

      created += batchCreates;
      updated += batchUpdates;
    } catch (err) {
      failed += batch.length;
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[Rift migrate] Batch ${batchNum} failed:`, detail);
      send({ type: 'error', message: `${label} batch ${batchNum} failed: ${detail}` });
    }

    send({
      type: 'push-batch',
      succeeded,
      failed,
      total: items.length,
    });
  }

  return { succeeded, failed, created, updated };
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  let body: MigrateRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { source, target, paths, batchSize: requestBatchSize, logLevel: requestLogLevel } = body;

  // Validate required fields
  if (!source?.cmUrl || !source?.clientId || !target?.cmUrl || !target?.clientId || !paths?.length) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  // Validate cmUrls (SSRF prevention)
  const sourceCmError = validateCmUrl(source.cmUrl);
  if (sourceCmError) {
    return new Response(JSON.stringify({ error: `Source: ${sourceCmError}` }), { status: 400 });
  }
  const targetCmError = validateCmUrl(target.cmUrl);
  if (targetCmError) {
    return new Response(JSON.stringify({ error: `Target: ${targetCmError}` }), { status: 400 });
  }

  // Validate all paths and scopes
  for (const p of paths) {
    const pathError = validateItemPath(p.itemPath);
    if (pathError) {
      return new Response(JSON.stringify({ error: `Invalid path: ${p.itemPath}` }), { status: 400 });
    }
    if (!VALID_SCOPES[p.scope]) {
      return new Response(JSON.stringify({ error: `Invalid scope: ${p.scope}` }), { status: 400 });
    }
  }

  // Clamp batchSize to safe range
  const batchSize = Math.min(Math.max(Number(requestBatchSize) || DEFAULT_BATCH_SIZE, MIN_BATCH_SIZE), MAX_BATCH_SIZE);
  const logLevel = VALID_LOG_LEVELS.has(requestLogLevel ?? '') ? requestLogLevel! : 'INFORMATION';

  // Sort paths: media library first, then content
  const sortedPaths = [...paths].sort((a, b) => {
    const aIsMedia = a.itemPath.toLowerCase().startsWith('/sitecore/media library');
    const bIsMedia = b.itemPath.toLowerCase().startsWith('/sitecore/media library');
    if (aIsMedia && !bIsMedia) return -1;
    if (!aIsMedia && bIsMedia) return 1;
    return 0;
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
      };

      try {
        logOperation('/api/rift/migrate', 'migration_start', `${paths.length} paths`, { clientIp, pathCount: paths.length, batchSize });

        // Auth to both environments
        send({ type: 'status', message: 'Authenticating...' });
        const [sourceToken, targetToken] = await Promise.all([
          getAccessToken(source.clientId, source.clientSecret),
          getAccessToken(target.clientId, target.clientSecret),
        ]);
        send({ type: 'status', message: 'Authenticated to both environments.' });

        let totalSucceeded = 0;
        let totalFailed = 0;
        let totalCreated = 0;
        let totalUpdated = 0;
        let totalPulled = 0;

        // Pull, check, and push a single subtree (ITEM_AND_CHILDREN scope)
        // then recurse into children that have descendants
        async function migrateSubtree(
          itemPath: string,
          label: string,
          depth: number
        ): Promise<void> {
          const indent = depth > 0 ? `${'  '.repeat(depth)}↳ ` : '';
          send({ type: 'status', message: `${indent}Pulling ${label}: ${itemPath}...` });

          let items: Record<string, unknown>[];
          try {
            items = await pullItemData(source.cmUrl, sourceToken, itemPath, 'ITEM_AND_CHILDREN');
            send({ type: 'pull-complete', path: itemPath, itemCount: items.length });
            totalPulled += items.length;
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            console.error(`[Rift migrate] Pull failed for ${itemPath}:`, detail);
            send({ type: 'error', message: `Failed to pull ${itemPath}: ${detail}` });
            return;
          }

          if (items.length === 0) return;

          // Check target for existing items at this level
          let existingIds: Set<string>;
          try {
            existingIds = await pullExistingIds(target.cmUrl, targetToken, itemPath, 'ITEM_AND_CHILDREN');
          } catch {
            existingIds = new Set();
          }

          const result = await processAndPushItems(items, existingIds, target.cmUrl, targetToken, send, label, batchSize, logLevel);
          totalSucceeded += result.succeeded;
          totalFailed += result.failed;
          totalCreated += result.created;
          totalUpdated += result.updated;

          // Recurse into children that have their own children
          let children: { path: string; hasChildren: boolean }[];
          try {
            children = await fetchChildPaths(source.cmUrl, sourceToken, itemPath);
          } catch {
            children = [];
          }

          for (const child of children) {
            if (child.hasChildren) {
              await migrateSubtree(child.path, label, depth + 1);
            }
          }
        }

        for (let i = 0; i < sortedPaths.length; i++) {
          const p = sortedPaths[i];
          const scope = VALID_SCOPES[p.scope];
          const isMedia = p.itemPath.toLowerCase().startsWith('/sitecore/media library');
          const label = isMedia ? 'Media' : 'Content';

          send({ type: 'status', message: `[${i + 1}/${sortedPaths.length}] Starting ${label}: ${p.itemPath}...` });

          if (scope === 'ITEM_AND_DESCENDANTS' && isMedia) {
            // Walk media tree depth-first to avoid OOM from large binary blobs
            await migrateSubtree(p.itemPath, label, 0);
          } else {
            // Content descendants (small items, safe to pull at once),
            // SINGLE_ITEM, or ITEM_AND_CHILDREN — pull directly
            send({ type: 'status', message: `Pulling ${label}: ${p.itemPath}...` });

            let items: Record<string, unknown>[];
            try {
              items = await pullItemData(source.cmUrl, sourceToken, p.itemPath, scope);
              send({ type: 'pull-complete', path: p.itemPath, itemCount: items.length });
              totalPulled += items.length;
            } catch (err) {
              const detail = err instanceof Error ? err.message : String(err);
              console.error(`[Rift migrate] Pull failed for ${p.itemPath}:`, detail);
              send({ type: 'error', message: `Failed to pull ${p.itemPath}: ${detail}` });
              continue;
            }

            if (items.length === 0) continue;

            let existingIds: Set<string>;
            try {
              existingIds = await pullExistingIds(target.cmUrl, targetToken, p.itemPath, scope);
            } catch {
              existingIds = new Set();
            }

            const result = await processAndPushItems(items, existingIds, target.cmUrl, targetToken, send, label, batchSize, logLevel);
            totalSucceeded += result.succeeded;
            totalFailed += result.failed;
            totalCreated += result.created;
            totalUpdated += result.updated;
          }
        }

        logOperation('/api/rift/migrate', 'migration_complete', undefined, {
          clientIp, totalPulled, totalSucceeded, totalFailed, totalCreated, totalUpdated,
        });

        send({
          type: 'complete',
          totalItems: totalPulled,
          created: totalCreated,
          updated: totalUpdated,
          succeeded: totalSucceeded,
          failed: totalFailed,
          pushed: totalSucceeded,
          message: totalFailed === 0
            ? `Migration complete: ${totalSucceeded} items migrated (${totalCreated} created, ${totalUpdated} updated).`
            : `Migration complete: ${totalSucceeded} migrated (${totalCreated} created, ${totalUpdated} updated), ${totalFailed} failed.`,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logError('/api/rift/migrate', 'migration_fatal_error', detail, { clientIp });
        send({ type: 'error', message: 'Migration failed unexpectedly' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
    },
  });
}
