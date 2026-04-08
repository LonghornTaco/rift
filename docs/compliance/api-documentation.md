# API Documentation — Rift: Content Migration for SitecoreAI

**Version:** 2.0.0
**Last Updated:** April 8, 2026

---

## Overview

Rift no longer exposes custom API routes. All Sitecore API calls are made through the **Sitecore Marketplace SDK**, which manages authentication (Auth0), environment discovery, content browsing, and content transfer. There is no `/api/rift/` backend proxy.

The Application runs entirely client-side (browser) via the Marketplace SDK. The following sections document the SDK-based architecture and the Content Transfer API lifecycle that Rift orchestrates.

---

## Authentication

Authentication is handled by Sitecore's Marketplace SDK using the **Auth0 authorization code flow**. Users authenticate via a "Sign in with Sitecore" redirect to Sitecore's Auth0 tenant.

- Rift does not collect, receive, or store credentials of any kind.
- Auth tokens are managed exclusively by the Marketplace SDK.
- The same trust model applies as native Sitecore XM Cloud applications.

No custom auth endpoint exists in Rift. The SDK handles token acquisition, refresh, and expiry transparently.

---

## Environment Discovery

Environments are discovered at runtime using the Marketplace SDK's application context.

**SDK call:**
```ts
const context = await sdk.application.context();
const environments = context.resourceAccess; // Array of XM Cloud tenants/environments
```

Each entry in `resourceAccess` provides the environment identifier and associated metadata needed to construct API calls. No Deploy API polling or manual project/environment input is required.

---

## Content Browsing

### Site Listing

Sites (site collections) within an environment are listed via the Marketplace SDK.

**SDK call:**
```ts
const sites = await sdk.xmc.xmapp.listSites({ environmentId });
```

Returns an array of site collection objects, each with a name and root content path.

### Content Tree Browsing

The Authoring GraphQL API is accessed through the Marketplace SDK for content tree navigation.

**SDK call:**
```ts
const result = await sdk.xmc.authoring.graphql({
  environmentId,
  query: `{ item(path: $parentPath) { children { ... } } }`,
  variables: { parentPath }
});
```

Returns child content items with item ID, name, path, template name, and `hasChildren` flag.

---

## Content Migration — Content Transfer API Lifecycle

Content migration is performed via the **Sitecore Content Transfer API**. Rift orchestrates the following 8-step lifecycle for each migration operation:

### Step 1 — Create Transfer Operation

Initialize a new content transfer operation for the source environment.

```ts
const { operationId } = await sdk.xmc.contentTransfer.createOperation({
  environmentId: sourceEnvironmentId,
  paths,    // array of { itemPath, scope }
});
```

### Step 2 — Poll Export Status

Poll until the source environment has finished serializing the selected content into `.raif` chunks.

```ts
let status;
do {
  status = await sdk.xmc.contentTransfer.getExportStatus({ operationId });
  await delay(pollIntervalMs);
} while (status.state === 'InProgress');
```

Export states: `InProgress` | `Complete` | `Failed`

### Step 3 — Download Chunks

Download each exported `.raif` chunk (Protobuf-encoded binary) from the Content Transfer API.

```ts
for (const chunk of status.chunks) {
  const data = await sdk.xmc.contentTransfer.downloadChunk({
    operationId,
    chunkId: chunk.id,
  });
  // data is a binary Buffer / Uint8Array
}
```

### Step 4 — Upload Chunks

Upload each downloaded chunk to the target environment's Content Transfer API.

```ts
for (const chunk of chunks) {
  await sdk.xmc.contentTransfer.uploadChunk({
    environmentId: targetEnvironmentId,
    operationId: targetOperationId,
    chunkId: chunk.id,
    data: chunk.data,
  });
}
```

### Step 5 — Assemble

Signal to the target environment that all chunks have been uploaded and the package is ready for assembly.

```ts
await sdk.xmc.contentTransfer.assemble({
  environmentId: targetEnvironmentId,
  operationId: targetOperationId,
});
```

### Step 6 — Consume (Import)

Trigger import of the assembled package into the target environment's content tree.

```ts
await sdk.xmc.contentTransfer.consume({
  environmentId: targetEnvironmentId,
  operationId: targetOperationId,
});
```

### Step 7 — Poll Consume Status

Poll until the target environment has finished importing the content.

```ts
let importStatus;
do {
  importStatus = await sdk.xmc.contentTransfer.getConsumeStatus({
    environmentId: targetEnvironmentId,
    operationId: targetOperationId,
  });
  await delay(pollIntervalMs);
} while (importStatus.state === 'InProgress');
```

Consume states: `InProgress` | `Complete` | `PartialSuccess` | `Failed`

The `importStatus` response includes item-level counts: `created`, `updated`, `failed`.

### Step 8 — Cleanup

Release Content Transfer API resources for both the source and target operations.

```ts
await Promise.all([
  sdk.xmc.contentTransfer.deleteOperation({ operationId: sourceOperationId }),
  sdk.xmc.contentTransfer.deleteOperation({
    environmentId: targetEnvironmentId,
    operationId: targetOperationId,
  }),
]);
```

---

## Progress Reporting

During migration, Rift emits structured progress events to the UI via React state updates. The event shape is consistent across all steps:

```ts
type MigrationEvent =
  | { type: 'status';        message: string }
  | { type: 'pull-complete'; path: string; chunkCount: number }
  | { type: 'push-chunk';    chunkIndex: number; totalChunks: number }
  | { type: 'warning';       message: string }
  | { type: 'error';         message: string }
  | { type: 'complete';      created: number; updated: number; failed: number; total: number; message: string };
```

---

## Security

Because Rift uses no custom API routes:

- There is no server-side credential handling, CSRF surface, or SSRF risk from custom proxy routes.
- All API calls are authenticated by the Marketplace SDK using SDK-managed Auth0 tokens.
- The application enforces HTTPS for all external communications via standard browser security policies.
- Content Security Policy (CSP) headers restrict script execution and data exfiltration.

---

## Migration Scope Values

The `scope` parameter used when specifying migration paths maps to Sitecore content tree selection semantics:

| Scope Value | Description |
|-------------|-------------|
| `SingleItem` | The selected item only |
| `ItemAndChildren` | The item and its direct children |
| `ItemAndDescendants` | The item and all descendants (recursive) |
| `ChildrenOnly` | Direct children only, not the item itself |
| `DescendantsOnly` | All descendants only, not the item itself |
