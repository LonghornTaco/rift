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
  recycleOrphans?: boolean;
}

interface AuthContext {
  token: string;
  clientId: string;
  clientSecret: string;
}

interface FieldData {
  fieldId: string;
  value: string;
  blobId?: string;
}

interface LanguageFields {
  language: string;
  fields: FieldData[];
}

interface VersionFields {
  language: string;
  versionNumber: number;
  fields: FieldData[];
}

interface SimpleCommand {
  itemID: string;
  parentID: string;
  database: string;
  command: string;
  data: string;
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

// Statistics/system fields excluded from serialization (matches Sitecore CLI behavior)
const EXCLUDED_FIELD_IDS = [
  '{B1E16562-F3F9-4DDD-84CA-6E099950ECC0}', // __Last run
  '{8CDC337E-A112-42FB-BBB4-4143751E123F}', // __Revision
  '{52807595-0F8F-4B20-8D2A-CB71D28C6103}', // __Owner
  '{D9CF14B1-FA16-4BA6-9288-E8A174D4D522}', // __Updated
  '{BADD9CF9-53E0-4D0C-BCC0-2D784C282F6A}', // __Updated by
  '{001DD393-96C5-490B-924A-B0F25CD9EFD8}', // __Lock
];

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

function authHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// POST with automatic token refresh on 401/403
async function authPost(url: string, body: string, auth: AuthContext): Promise<Response> {
  let res = await fetch(url, { method: 'POST', headers: authHeaders(auth.token), body });
  if (res.status === 401 || res.status === 403) {
    auth.token = await getAccessToken(auth.clientId, auth.clientSecret);
    res = await fetch(url, { method: 'POST', headers: authHeaders(auth.token), body });
  }
  return res;
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
  auth: AuthContext,
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

  const res = await authPost(authoringUrl(cmUrl), JSON.stringify({ query, variables: { path: parentPath } }), auth);
  if (!res.ok) return [];
  const json = await res.json();
  return json?.data?.item?.children?.nodes ?? [];
}

// Pull full item data for a single path
async function pullItemData(
  cmUrl: string,
  auth: AuthContext,
  itemPath: string,
  scope: string
): Promise<Record<string, unknown>[]> {
  // Management API serialize uses enum values inline (not as variables).
  // Note: excludedFieldIds is not used — it triggers server-side CLI version
  // checking (SMS 5.2.125+) which requires sitecore-graphql-cli-version headers.
  // Statistics fields (__Updated, __Lock, etc.) are included in the migration,
  // which is acceptable for a migration tool.
  const safePath = itemPath.replace(/"/g, '\\"');
  const query = `{
    serialize(path: "${safePath}", database: "master", scope: ${scope}) {
      data
    }
  }`;

  const res = await authPost(managementUrl(cmUrl), JSON.stringify({ query }), auth);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pull failed (HTTP ${res.status}): ${text.substring(0, 200)}`);
  }
  const json = await res.json();
  if (json.errors) {
    const errMsg = json.errors.map((e: { message?: string }) => e.message).join('; ');
    if (!json.data?.serialize) {
      throw new Error(`GraphQL errors: ${errMsg.substring(0, 300)}`);
    }
    console.warn(`[Rift migrate] Partial GraphQL errors for ${itemPath}: ${errMsg.substring(0, 300)}`);
  }

  return (json?.data?.serialize ?? []).map((item: Record<string, unknown>) =>
    (item.data || item) as Record<string, unknown>
  );
}

// Pull full target item data keyed by ID (for comparison-based UPDATE building)
async function pullTargetData(
  cmUrl: string,
  auth: AuthContext,
  itemPath: string,
  scope: string
): Promise<Map<string, Record<string, unknown>>> {
  const safePath = itemPath.replace(/"/g, '\\"');
  const query = `{
    serialize(path: "${safePath}", database: "master", scope: ${scope}) {
      data
    }
  }`;

  const res = await authPost(managementUrl(cmUrl), JSON.stringify({ query }), auth);
  if (!res.ok) return new Map();
  const json = await res.json();
  if (json.errors && !json.data?.serialize) return new Map();

  const items = (json?.data?.serialize ?? []).map((item: Record<string, unknown>) =>
    (item.data || item) as Record<string, unknown>
  );

  const map = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    if (item.id) map.set(item.id as string, item);
  }
  return map;
}

// Get item name from data (explicit name field or last path segment)
function getItemName(item: Record<string, unknown>): string {
  if (item.name) return item.name as string;
  const path = item.path as string | undefined;
  return path?.split('/').pop() ?? '';
}

// Normalize field value for comparison (strip \r\n like CLI does)
function normalizeValue(val: string | undefined): string {
  return (val ?? '').replace(/[\r\n]/g, '');
}

function fieldsMatch(source: FieldData, target: FieldData): boolean {
  if (normalizeValue(source.value) !== normalizeValue(target.value)) return false;
  if ((source.blobId ?? '') !== (target.blobId ?? '')) return false;
  return true;
}

// Build UPDATE sub-commands by comparing source vs target item data (matches CLI behavior)
function buildUpdateSubCommands(
  sourceItem: Record<string, unknown>,
  targetItem: Record<string, unknown>
): Array<{ command: string; data: unknown }> {
  const subCommands: Array<{ command: string; data: unknown }> = [];

  // 1. CHANGE_TEMPLATE if template differs
  if (sourceItem.templateId && targetItem.templateId && sourceItem.templateId !== targetItem.templateId) {
    subCommands.push({ command: 'CHANGE_TEMPLATE', data: sourceItem.templateId });
  }

  // 2. Shared fields
  const sourceShared = (sourceItem.sharedFields as FieldData[]) ?? [];
  const targetShared = (targetItem.sharedFields as FieldData[]) ?? [];
  const targetSharedMap = new Map<string, FieldData>();
  for (const tf of targetShared) targetSharedMap.set(tf.fieldId, tf);
  const sourceSharedIds = new Set<string>();

  for (const f of sourceShared) {
    sourceSharedIds.add(f.fieldId);
    const tf = targetSharedMap.get(f.fieldId);
    if (!tf || !fieldsMatch(f, tf)) {
      const data: Record<string, unknown> = { fieldId: f.fieldId, value: f.value };
      if (f.blobId) data.blobId = f.blobId;
      subCommands.push({ command: 'UPDATE', data });
    }
  }
  for (const tf of targetShared) {
    if (!sourceSharedIds.has(tf.fieldId)) {
      subCommands.push({ command: 'RESET_FIELD', data: { fieldId: tf.fieldId } });
    }
  }

  // 3. Unversioned fields
  const sourceUnversioned = (sourceItem.unversionedFields as LanguageFields[]) ?? [];
  const targetUnversioned = (targetItem.unversionedFields as LanguageFields[]) ?? [];
  const targetUnversionedMap = new Map<string, FieldData[]>();
  for (const tu of targetUnversioned) targetUnversionedMap.set(tu.language, tu.fields ?? []);

  const sourceLangs = new Set<string>();
  for (const su of sourceUnversioned) {
    sourceLangs.add(su.language);
    const targetFields = targetUnversionedMap.get(su.language) ?? [];
    const targetFieldMap = new Map<string, FieldData>();
    for (const tf of targetFields) targetFieldMap.set(tf.fieldId, tf);
    const sourceFieldIds = new Set<string>();

    for (const f of su.fields) {
      sourceFieldIds.add(f.fieldId);
      const tf = targetFieldMap.get(f.fieldId);
      if (!tf || !fieldsMatch(f, tf)) {
        const data: Record<string, unknown> = { fieldId: f.fieldId, value: f.value, language: su.language };
        if (f.blobId) data.blobId = f.blobId;
        subCommands.push({ command: 'UPDATE', data });
      }
    }
    for (const tf of targetFields) {
      if (!sourceFieldIds.has(tf.fieldId)) {
        subCommands.push({ command: 'RESET_FIELD', data: { fieldId: tf.fieldId, language: su.language } });
      }
    }
  }
  for (const tu of targetUnversioned) {
    if (!sourceLangs.has(tu.language)) {
      for (const tf of (tu.fields ?? [])) {
        subCommands.push({ command: 'RESET_FIELD', data: { fieldId: tf.fieldId, language: tu.language } });
      }
    }
  }

  // 4. Versioned fields
  const sourceVersions = (sourceItem.versions as VersionFields[]) ?? [];
  const targetVersions = (targetItem.versions as VersionFields[]) ?? [];
  const targetVersionMap = new Map<string, VersionFields>();
  for (const tv of targetVersions) targetVersionMap.set(`${tv.language}:${tv.versionNumber}`, tv);
  const sourceVersionKeys = new Set<string>();

  for (const sv of sourceVersions) {
    const key = `${sv.language}:${sv.versionNumber}`;
    sourceVersionKeys.add(key);
    const tv = targetVersionMap.get(key);

    if (!tv) {
      // Version missing on target
      if (!sv.fields || sv.fields.length === 0) {
        // Empty version — explicitly add it (CLI only sends ADD_VERSION when version has no fields)
        subCommands.push({ command: 'ADD_VERSION', data: { language: sv.language, version: String(sv.versionNumber) } });
      } else {
        // Version has fields — field UPDATEs create the version implicitly
        for (const f of sv.fields) {
          const data: Record<string, unknown> = { fieldId: f.fieldId, value: f.value, language: sv.language, version: String(sv.versionNumber) };
          if (f.blobId) data.blobId = f.blobId;
          subCommands.push({ command: 'UPDATE', data });
        }
      }
    } else {
      // Version exists on both sides — compare fields
      const targetFieldMap = new Map<string, FieldData>();
      for (const tf of (tv.fields ?? [])) targetFieldMap.set(tf.fieldId, tf);
      const sourceFieldIds = new Set<string>();

      for (const f of sv.fields) {
        sourceFieldIds.add(f.fieldId);
        const tf = targetFieldMap.get(f.fieldId);
        if (!tf || !fieldsMatch(f, tf)) {
          const data: Record<string, unknown> = { fieldId: f.fieldId, value: f.value, language: sv.language, version: String(sv.versionNumber) };
          if (f.blobId) data.blobId = f.blobId;
          subCommands.push({ command: 'UPDATE', data });
        }
      }
      for (const tf of (tv.fields ?? [])) {
        if (!sourceFieldIds.has(tf.fieldId)) {
          subCommands.push({ command: 'RESET_FIELD', data: { fieldId: tf.fieldId, language: tv.language, version: String(tv.versionNumber) } });
        }
      }
    }
  }

  // REMOVE_VERSION for versions on target but not source
  for (const tv of targetVersions) {
    if (!sourceVersionKeys.has(`${tv.language}:${tv.versionNumber}`)) {
      subCommands.push({ command: 'REMOVE_VERSION', data: { language: tv.language, version: String(tv.versionNumber) } });
    }
  }

  return subCommands;
}

// Build a single ItemCommand from an item
function buildCommand(
  itemData: Record<string, unknown>,
  targetDataMap: Map<string, Record<string, unknown>>
): { itemID: string; parentID: string; database: string; command: string; data: string; isCreate: boolean } {
  const itemId = itemData.id as string;
  const parentId = itemData.parentId as string;
  const targetItem = targetDataMap.get(itemId);

  if (targetItem) {
    const subCommands = buildUpdateSubCommands(itemData, targetItem);
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
  auth: AuthContext,
  commands: SimpleCommand[],
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
          eventID {
            id
            name
          }
        }
      }
    }
  `;

  const res = await authPost(
    managementUrl(cmUrl),
    JSON.stringify({ query: mutation, variables: { commands, logLevel } }),
    auth
  );

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

// Execute a list of simple commands in batches, counting successes/failures
async function executeBatchedCommands(
  cmUrl: string,
  auth: AuthContext,
  commands: SimpleCommand[],
  logLevel: string,
  send: (data: Record<string, unknown>) => void,
  label: string,
  batchSize: number
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < commands.length; i += batchSize) {
    const batch = commands.slice(i, i + batchSize);
    try {
      const results = await executeCommands(cmUrl, auth, batch, logLevel);
      for (const r of results) {
        if (r.success) {
          succeeded++;
          if (logLevel === 'DEBUG') {
            for (const m of r.messages ?? []) {
              send({ type: 'debug', message: `${r.name}: ${m.message}`, logLevel: m.logLevel });
            }
          }
        } else {
          failed++;
          const errorMsg = r.messages?.map((m) => m.message).join('; ') ?? '';
          send({ type: 'warning', message: `Failed: ${r.name}: ${errorMsg.substring(0, 200)}` });
        }
      }
    } catch (err) {
      failed += batch.length;
      const detail = err instanceof Error ? err.message : String(err);
      send({ type: 'error', message: `${label} batch failed: ${detail}` });
    }
  }

  return { succeeded, failed };
}

interface MigrationResult {
  succeeded: number;
  failed: number;
  created: number;
  updated: number;
  skipped: number;
  moved: number;
  renamed: number;
  recycled: number;
}

// Process and push items in batches
async function processAndPushItems(
  items: Record<string, unknown>[],
  targetDataMap: Map<string, Record<string, unknown>>,
  targetCmUrl: string,
  targetAuth: AuthContext,
  send: (data: Record<string, unknown>) => void,
  label: string,
  batchSize: number,
  logLevel: string,
  recycleOrphans: boolean
): Promise<MigrationResult> {
  let succeeded = 0;
  let failed = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let moved = 0;
  let renamed = 0;
  let recycled = 0;

  // Phase 1: MOVE commands (items whose parent changed)
  const moveCommands: SimpleCommand[] = [];
  for (const item of items) {
    const itemId = item.id as string;
    const targetItem = targetDataMap.get(itemId);
    if (!targetItem) continue;
    const sourceParent = item.parentId as string;
    const targetParent = targetItem.parentId as string;
    if (sourceParent && targetParent && sourceParent !== targetParent) {
      moveCommands.push({
        itemID: itemId,
        parentID: targetParent,
        database: 'master',
        command: 'MOVE',
        data: JSON.stringify(sourceParent),
      });
    }
  }
  if (moveCommands.length > 0) {
    send({ type: 'status', message: `${label}: moving ${moveCommands.length} items...` });
    const result = await executeBatchedCommands(targetCmUrl, targetAuth, moveCommands, logLevel, send, `${label} move`, batchSize);
    moved += result.succeeded;
    succeeded += result.succeeded;
    failed += result.failed;
  }

  // Phase 2: RENAME commands (items whose name changed)
  const renameCommands: SimpleCommand[] = [];
  for (const item of items) {
    const itemId = item.id as string;
    const targetItem = targetDataMap.get(itemId);
    if (!targetItem) continue;
    const sourceName = getItemName(item);
    const targetName = getItemName(targetItem);
    if (sourceName && targetName && sourceName !== targetName) {
      renameCommands.push({
        itemID: itemId,
        parentID: item.parentId as string,
        database: 'master',
        command: 'RENAME',
        data: JSON.stringify(sourceName),
      });
    }
  }
  if (renameCommands.length > 0) {
    send({ type: 'status', message: `${label}: renaming ${renameCommands.length} items...` });
    const result = await executeBatchedCommands(targetCmUrl, targetAuth, renameCommands, logLevel, send, `${label} rename`, batchSize);
    renamed += result.succeeded;
    succeeded += result.succeeded;
    failed += result.failed;
  }

  // Phase 3: CREATE and UPDATE commands (existing logic)
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(items.length / batchSize);

    send({ type: 'status', message: `${label}: pushing batch ${batchNum}/${totalBatches} (${batch.length} items)...` });

    const allCommands = batch.map((item) => buildCommand(item, targetDataMap));

    // Filter out empty UPDATE commands (no changes needed)
    const activeIndices: number[] = [];
    const activeCommands: typeof allCommands = [];
    for (let ci = 0; ci < allCommands.length; ci++) {
      if (allCommands[ci].isCreate || allCommands[ci].data !== '[]') {
        activeIndices.push(ci);
        activeCommands.push(allCommands[ci]);
      } else {
        skipped++;
      }
    }

    if (activeCommands.length === 0) {
      send({ type: 'push-batch', succeeded, failed, total: items.length });
      continue;
    }

    const batchCreates = activeCommands.filter((c) => c.isCreate).length;
    const batchUpdates = activeCommands.length - batchCreates;

    try {
      const results = await executeCommands(
        targetCmUrl,
        targetAuth,
        activeCommands.map(({ isCreate, ...cmd }) => cmd),
        logLevel
      );

      // Collect failed CREATEs that need retry as UPDATE
      const retryItems: Record<string, unknown>[] = [];

      for (let ri = 0; ri < results.length; ri++) {
        const r = results[ri];
        if (r.success) {
          succeeded++;
          if (logLevel === 'DEBUG') {
            for (const m of r.messages ?? []) {
              send({ type: 'debug', message: `${r.name}: ${m.message}`, logLevel: m.logLevel });
            }
          }
        } else {
          const errorMsg = r.messages?.map((m) => m.message).join('; ') ?? '';
          // If CREATE failed because item already exists, retry as UPDATE
          if (activeCommands[ri]?.isCreate && errorMsg.includes('already existed')) {
            retryItems.push(batch[activeIndices[ri]]);
          } else {
            failed++;
            send({ type: 'warning', message: `Failed: ${r.name}: ${errorMsg.substring(0, 200)}` });
          }
        }
      }

      // Retry failed CREATEs as UPDATEs (push all source fields since we lack target comparison data)
      if (retryItems.length > 0) {
        send({ type: 'status', message: `${label}: retrying ${retryItems.length} items as updates...` });
        const retryTargetMap = new Map<string, Record<string, unknown>>();
        for (const item of retryItems) {
          retryTargetMap.set(item.id as string, {
            id: item.id,
            templateId: item.templateId,
            sharedFields: [],
            unversionedFields: [],
            versions: [],
          });
        }
        const retryCommands = retryItems.map((item) => buildCommand(item, retryTargetMap));
        try {
          const retryResults = await executeCommands(
            targetCmUrl,
            targetAuth,
            retryCommands.map(({ isCreate, ...cmd }) => cmd),
            logLevel
          );
          for (const r of retryResults) {
            if (r.success) {
              succeeded++;
            } else {
              failed++;
              const errorMsg = r.messages?.map((m) => m.message).join('; ') ?? 'Unknown error';
              send({ type: 'warning', message: `Failed (retry): ${r.name}: ${errorMsg.substring(0, 200)}` });
            }
          }
        } catch (retryErr) {
          failed += retryItems.length;
          const detail = retryErr instanceof Error ? retryErr.message : String(retryErr);
          send({ type: 'error', message: `${label} retry failed: ${detail}` });
        }
      }

      created += batchCreates - retryItems.length;
      updated += batchUpdates + retryItems.length;
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

  // Phase 4: RECYCLE orphaned items (target items not present in source)
  if (recycleOrphans) {
    const sourceIds = new Set(items.map((item) => item.id as string));
    const orphans = [...targetDataMap.entries()]
      .filter(([id]) => !sourceIds.has(id))
      .map(([, item]) => item);

    if (orphans.length > 0) {
      // Sort deepest first so children are recycled before parents
      orphans.sort((a, b) => {
        const aDepth = ((a.path as string) ?? '').split('/').length;
        const bDepth = ((b.path as string) ?? '').split('/').length;
        return bDepth - aDepth;
      });

      send({ type: 'status', message: `${label}: recycling ${orphans.length} orphaned items...` });
      const recycleCommands: SimpleCommand[] = orphans.map((item) => ({
        itemID: item.id as string,
        parentID: item.parentId as string,
        database: 'master',
        command: 'RECYCLE',
        data: '{}',
      }));
      const result = await executeBatchedCommands(targetCmUrl, targetAuth, recycleCommands, logLevel, send, `${label} recycle`, batchSize);
      recycled += result.succeeded;
      succeeded += result.succeeded;
      failed += result.failed;
    }
  }

  return { succeeded, failed, created, updated, skipped, moved, renamed, recycled };
}

// Build the summary portion of a completion message from non-zero counts
function buildStatsSummary(stats: Record<string, number>): string {
  const parts: string[] = [];
  for (const [label, count] of Object.entries(stats)) {
    if (count > 0) parts.push(`${count} ${label}`);
  }
  return parts.join(', ');
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);

  let body: MigrateRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { source, target, paths, batchSize: requestBatchSize, logLevel: requestLogLevel, recycleOrphans: requestRecycleOrphans } = body;

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
  const recycleOrphans = requestRecycleOrphans !== false; // default true

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
        logOperation('/api/rift/migrate', 'migration_start', `${paths.length} paths`, { clientIp, pathCount: paths.length, batchSize, recycleOrphans });

        // Auth to both environments (mutable token holders for auto-refresh)
        send({ type: 'status', message: 'Authenticating...' });
        const sourceAuth: AuthContext = { token: '', clientId: source.clientId, clientSecret: source.clientSecret };
        const targetAuth: AuthContext = { token: '', clientId: target.clientId, clientSecret: target.clientSecret };
        [sourceAuth.token, targetAuth.token] = await Promise.all([
          getAccessToken(source.clientId, source.clientSecret),
          getAccessToken(target.clientId, target.clientSecret),
        ]);
        send({ type: 'status', message: 'Authenticated to both environments.' });

        let totalSucceeded = 0;
        let totalFailed = 0;
        let totalCreated = 0;
        let totalUpdated = 0;
        let totalPulled = 0;
        let totalSkipped = 0;
        let totalMoved = 0;
        let totalRenamed = 0;
        let totalRecycled = 0;

        function accumulateResult(result: MigrationResult) {
          totalSucceeded += result.succeeded;
          totalFailed += result.failed;
          totalCreated += result.created;
          totalUpdated += result.updated;
          totalSkipped += result.skipped;
          totalMoved += result.moved;
          totalRenamed += result.renamed;
          totalRecycled += result.recycled;
        }

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
            items = await pullItemData(source.cmUrl, sourceAuth, itemPath, 'ITEM_AND_CHILDREN');
            send({ type: 'pull-complete', path: itemPath, itemCount: items.length });
            totalPulled += items.length;
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            console.error(`[Rift migrate] Pull failed for ${itemPath}:`, detail);
            send({ type: 'error', message: `Failed to pull ${itemPath}: ${detail}` });
            return;
          }

          if (items.length === 0) return;

          // Pull full target data for comparison-based updates
          let targetDataMap: Map<string, Record<string, unknown>>;
          try {
            targetDataMap = await pullTargetData(target.cmUrl, targetAuth, itemPath, 'ITEM_AND_CHILDREN');
          } catch {
            targetDataMap = new Map();
          }

          accumulateResult(await processAndPushItems(items, targetDataMap, target.cmUrl, targetAuth, send, label, batchSize, logLevel, recycleOrphans));

          // Recurse into children that have their own children (parallel, limited concurrency)
          let children: { path: string; hasChildren: boolean }[];
          try {
            children = await fetchChildPaths(source.cmUrl, sourceAuth, itemPath);
          } catch {
            children = [];
          }

          const childrenWithSubs = children.filter((c) => c.hasChildren);
          const CONCURRENCY = 3;
          for (let ci = 0; ci < childrenWithSubs.length; ci += CONCURRENCY) {
            const batch = childrenWithSubs.slice(ci, ci + CONCURRENCY);
            await Promise.all(batch.map((child) => migrateSubtree(child.path, label, depth + 1)));
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
            // Content descendants (small items, fast single pull),
            // SINGLE_ITEM, or ITEM_AND_CHILDREN — pull directly
            send({ type: 'status', message: `Pulling ${label}: ${p.itemPath}...` });

            let items: Record<string, unknown>[];
            try {
              items = await pullItemData(source.cmUrl, sourceAuth, p.itemPath, scope);
              send({ type: 'pull-complete', path: p.itemPath, itemCount: items.length });
              totalPulled += items.length;
            } catch (err) {
              const detail = err instanceof Error ? err.message : String(err);
              console.error(`[Rift migrate] Pull failed for ${p.itemPath}:`, detail);
              send({ type: 'error', message: `Failed to pull ${p.itemPath}: ${detail}` });
              continue;
            }

            if (items.length === 0) continue;

            // Pull full target data for comparison-based updates
            let targetDataMap: Map<string, Record<string, unknown>>;
            try {
              targetDataMap = await pullTargetData(target.cmUrl, targetAuth, p.itemPath, scope);
            } catch {
              targetDataMap = new Map();
            }

            accumulateResult(await processAndPushItems(items, targetDataMap, target.cmUrl, targetAuth, send, label, batchSize, logLevel, recycleOrphans));
          }
        }

        logOperation('/api/rift/migrate', 'migration_complete', undefined, {
          clientIp, totalPulled, totalSucceeded, totalFailed, totalCreated, totalUpdated, totalSkipped, totalMoved, totalRenamed, totalRecycled,
        });

        const summary = buildStatsSummary({
          created: totalCreated,
          updated: totalUpdated,
          moved: totalMoved,
          renamed: totalRenamed,
          recycled: totalRecycled,
          unchanged: totalSkipped,
        });

        send({
          type: 'complete',
          totalItems: totalPulled,
          created: totalCreated,
          updated: totalUpdated,
          moved: totalMoved,
          renamed: totalRenamed,
          recycled: totalRecycled,
          skipped: totalSkipped,
          succeeded: totalSucceeded,
          failed: totalFailed,
          pushed: totalSucceeded,
          message: totalFailed === 0
            ? `Migration complete: ${totalSucceeded} operations (${summary}).`
            : `Migration complete: ${totalSucceeded} operations (${summary}), ${totalFailed} failed.`,
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
