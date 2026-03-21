# API Documentation — Rift: Content Migration for Sitecore XM Cloud

**Version:** 1.0.0
**Last Updated:** March 21, 2026

---

## Overview

Rift exposes internal API routes under `/api/rift/` that serve as a backend proxy between the browser-based client and Sitecore Cloud services. All endpoints are POST requests that accept JSON bodies and return JSON responses.

**Base URL:** `https://[your-deployment-domain]/api/rift`

## Security

All endpoints are protected by:
- **CSRF middleware** — Validates that the `Origin` or `Referer` header matches the server's host.
- **Input validation** — All user-supplied parameters are validated before use.
- **SSRF prevention** — `cmUrl` parameters are validated against `https://*.sitecorecloud.io`.

## Endpoints

---

### POST /api/rift/auth

Exchanges Sitecore OAuth client credentials for an access token.

**Rate Limited:** 10 requests per minute per IP address.

**Request Body:**
```json
{
  "clientId": "string (required)",
  "clientSecret": "string (required)"
}
```

**Success Response (200):**
```json
{
  "accessToken": "string",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

**Error Responses:**
| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "clientId and clientSecret are required" }` | Missing parameters |
| 401 | `{ "error": "Invalid credentials" }` | Sitecore rejected the credentials |
| 429 | `{ "error": "Too many requests. Please try again later." }` | Rate limit exceeded |
| 502 | `{ "error": "Failed to connect to authentication server" }` | Network error |

---

### POST /api/rift/projects

Lists XM Cloud projects accessible to the authenticated user.

**Request Body:**
```json
{
  "accessToken": "string (required)"
}
```

**Success Response (200):**
Returns the raw project data from the Sitecore Deploy API.

**Error Responses:**
| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "accessToken is required" }` | Missing parameter |
| 401–403 | `{ "error": "Failed to fetch projects" }` | Authorization error |
| 502 | `{ "error": "Failed to connect to Deploy API" }` | Network error |

---

### POST /api/rift/environments

Lists environments within a specific XM Cloud project.

**Request Body:**
```json
{
  "accessToken": "string (required)",
  "projectId": "string (required)"
}
```

**Success Response (200):**
Returns the raw environment data from the Sitecore Deploy API.

**Error Responses:**
| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "accessToken and projectId are required" }` | Missing parameters |
| 401–403 | `{ "error": "environments failed" }` | Authorization error |
| 502 | `{ "error": "Failed to connect to Deploy API" }` | Network error |

---

### POST /api/rift/sites

Discovers Sitecore sites (site collections) in an environment.

**Request Body:**
```json
{
  "cmUrl": "string (required, must match https://*.sitecorecloud.io)",
  "accessToken": "string (required)"
}
```

**Success Response (200):**
```json
{
  "sites": [
    {
      "name": "string",
      "rootPath": "/sitecore/content/CollectionName/SiteName",
      "collection": "string"
    }
  ]
}
```

**Error Responses:**
| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "cmUrl and accessToken are required" }` | Missing parameters |
| 400 | `{ "error": "Invalid cmUrl: must be a valid Sitecore XM Cloud URL" }` | SSRF validation failure |
| 502 | `{ "error": "sites failed" }` | Upstream error |

---

### POST /api/rift/tree

Browses the content tree by fetching children of a given path.

**Request Body:**
```json
{
  "cmUrl": "string (required, must match https://*.sitecorecloud.io)",
  "accessToken": "string (required)",
  "parentPath": "string (required, must match /^\/[a-zA-Z0-9\\s\\-_\\/()]+$/)"
}
```

**Success Response (200):**
```json
{
  "children": [
    {
      "itemId": "GUID",
      "name": "string",
      "path": "/sitecore/content/...",
      "hasChildren": true,
      "templateName": "string"
    }
  ]
}
```

**Error Responses:**
| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "Invalid parentPath format" }` | Path validation failure |
| 400 | `{ "error": "Invalid cmUrl: ..." }` | SSRF validation failure |
| 502 | `{ "error": "tree failed" }` | Upstream error |

---

### POST /api/rift/item-fields

Fetches metadata and field values for a specific content item.

**Request Body:**
```json
{
  "cmUrl": "string (required, must match https://*.sitecorecloud.io)",
  "accessToken": "string (required)",
  "itemPath": "string (required, must match /^\/[a-zA-Z0-9\\s\\-_\\/()]+$/)",
  "fieldNames": ["string"] // optional — filter to specific fields
}
```

**Success Response (200):**
```json
{
  "itemId": "GUID",
  "name": "string",
  "path": "/sitecore/content/...",
  "templateId": "string",
  "templateName": "string",
  "fields": {
    "FieldName": "value"
  }
}
```

**Error Responses:**
| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "Invalid itemPath format" }` | Path validation failure |
| 400 | `{ "error": "GraphQL query error" }` | GraphQL returned errors |
| 404 | `{ "error": "Item not found" }` | Item does not exist at path |
| 502 | `{ "error": "item-fields failed" }` | Upstream error |

---

### POST /api/rift/migrate

Executes a content migration from source to target environment. Returns a streaming NDJSON response with real-time progress updates.

**Request Body:**
```json
{
  "source": {
    "cmUrl": "string (required, must match https://*.sitecorecloud.io)",
    "clientId": "string (required)",
    "clientSecret": "string (required)"
  },
  "target": {
    "cmUrl": "string (required, must match https://*.sitecorecloud.io)",
    "clientId": "string (required)",
    "clientSecret": "string (required)"
  },
  "paths": [
    {
      "itemPath": "string (required, validated)",
      "scope": "SingleItem | ItemAndChildren | ItemAndDescendants"
    }
  ],
  "batchSize": 200 // optional, clamped to 1–500
}
```

**Response:** Streaming `application/x-ndjson` with one JSON object per line.

**Message Types:**
```jsonl
{"type":"status","message":"Authenticating..."}
{"type":"status","message":"Authenticated to both environments."}
{"type":"status","message":"[1/3] Pulling Content: /sitecore/content/..."}
{"type":"pull-complete","path":"/sitecore/content/...","itemCount":42}
{"type":"status","message":"Content: pushing batch 1/2 (200 items)..."}
{"type":"push-batch","succeeded":200,"failed":0,"total":242}
{"type":"warning","message":"Failed: ItemName: error details"}
{"type":"error","message":"Failed to pull /sitecore/content/..."}
{"type":"complete","totalItems":242,"created":200,"updated":42,"succeeded":242,"failed":0,"pushed":242,"message":"Migration complete: 242 items migrated (200 created, 42 updated)."}
```

**Error Responses:**
| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "Missing required fields" }` | Incomplete request body |
| 400 | `{ "error": "Source: Invalid cmUrl: ..." }` | SSRF validation failure |
| 400 | `{ "error": "Invalid path: ..." }` | Path validation failure |
| 400 | `{ "error": "Invalid scope: ..." }` | Unknown scope value |
