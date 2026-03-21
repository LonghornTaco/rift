import { NextRequest } from 'next/server';

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
}

const SCOPE_MAP: Record<string, string> = {
  SingleItem: 'SINGLE_ITEM',
  ItemAndChildren: 'ITEM_AND_CHILDREN',
  ItemAndDescendants: 'ITEM_AND_DESCENDANTS',
};

const MANAGEMENT_PATH = '/sitecore/api/management';
const DEFAULT_BATCH_SIZE = 200;

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
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

function managementUrl(cmUrl: string): string {
  return `${cmUrl.replace(/\/$/, '')}${MANAGEMENT_PATH}`;
}

// Pull full item data for a single path
async function pullItemData(
  cmUrl: string,
  token: string,
  itemPath: string,
  scope: string
): Promise<Record<string, unknown>[]> {
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

  if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
  const json = await res.json();
  if (json.errors && !json.data) throw new Error(`Pull errors: ${JSON.stringify(json.errors)}`);

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
  commands: Array<{ itemID: string; parentID: string; database: string; command: string; data: string }>
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
    body: JSON.stringify({ query: mutation, variables: { commands, logLevel: 'DEBUG' } }),
  });

  if (!res.ok) throw new Error(`Execute failed: ${res.status}`);
  const json = await res.json();
  if (json.errors && !json.data) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);

  return json?.data?.executeSerializationCommands ?? [];
}

// Process and push items in batches, releasing memory after each batch
async function processAndPushItems(
  items: Record<string, unknown>[],
  existingIds: Set<string>,
  targetCmUrl: string,
  targetToken: string,
  send: (data: Record<string, unknown>) => void,
  label: string,
  batchSize: number
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

    // Build commands for this batch only
    const commands = batch.map((item) => buildCommand(item, existingIds));
    const batchCreates = commands.filter((c) => c.isCreate).length;
    const batchUpdates = commands.length - batchCreates;

    try {
      const results = await executeCommands(
        targetCmUrl,
        targetToken,
        commands.map(({ isCreate, ...cmd }) => cmd)
      );

      for (const r of results) {
        if (r.success) {
          succeeded++;
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
      send({ type: 'error', message: `${label} batch ${batchNum} failed: ${err instanceof Error ? err.message : String(err)}` });
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
  let body: MigrateRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { source, target, paths, batchSize: requestBatchSize } = body;
  const batchSize = requestBatchSize ?? DEFAULT_BATCH_SIZE;
  if (!source?.cmUrl || !source?.clientId || !target?.cmUrl || !target?.clientId || !paths?.length) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

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

        // Process each path independently to limit memory usage
        for (let i = 0; i < sortedPaths.length; i++) {
          const p = sortedPaths[i];
          const scope = SCOPE_MAP[p.scope] || 'ITEM_AND_DESCENDANTS';
          const isMedia = p.itemPath.toLowerCase().startsWith('/sitecore/media library');
          const label = isMedia ? 'Media' : 'Content';

          send({ type: 'status', message: `[${i + 1}/${sortedPaths.length}] Pulling ${label}: ${p.itemPath}...` });

          // Pull items for this path
          let items: Record<string, unknown>[];
          try {
            items = await pullItemData(source.cmUrl, sourceToken, p.itemPath, scope);
            send({ type: 'pull-complete', path: p.itemPath, itemCount: items.length });
            totalPulled += items.length;
          } catch (err) {
            send({ type: 'error', message: `Failed to pull ${p.itemPath}: ${err instanceof Error ? err.message : String(err)}` });
            continue;
          }

          if (items.length === 0) continue;

          // Check what exists on target for this path
          send({ type: 'status', message: `Checking target for existing items in ${p.itemPath}...` });
          let existingIds: Set<string>;
          try {
            existingIds = await pullExistingIds(target.cmUrl, targetToken, p.itemPath, scope);
          } catch {
            existingIds = new Set();
          }

          // Process and push this path's items
          const result = await processAndPushItems(items, existingIds, target.cmUrl, targetToken, send, label, batchSize);

          totalSucceeded += result.succeeded;
          totalFailed += result.failed;
          totalCreated += result.created;
          totalUpdated += result.updated;

          // Items array goes out of scope here, allowing GC to reclaim memory
        }

        // Summary
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
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
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
