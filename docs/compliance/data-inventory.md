# Data Inventory — Rift: Content Migration for SitecoreAI

**Effective Date:** March 21, 2026
**Last Updated:** April 8, 2026
**Developer:** Wilkerson Consulting

---

## 1. Overview

This document provides a comprehensive inventory of all data processed by the Rift application, as required by the Sitecore Marketplace security checklist. It covers data collection, storage, processing, and deletion across all components of the Application.

Authentication is handled entirely by Sitecore's Marketplace SDK via Auth0. Rift does not collect, store, or process Sitecore credentials of any kind. Auth tokens are managed exclusively by the Marketplace SDK and are never accessed or retained by Rift code.

## 2. Data Inventory

### 2.1 Client-Side Persistent Data (Browser localStorage)

| # | Data Element | Storage Key | Data Type | Source | Purpose | Retention | Access Scope | Protection |
|---|-------------|-------------|-----------|--------|---------|-----------|-------------|------------|
| 1 | Migration preset names | `rift:presets` | String | User input | Label saved migration configurations | Until user deletes | User's browser only | Browser same-origin policy |
| 2 | Migration paths and scopes | `rift:presets` | Array of objects | User selection from content tree | Define content to migrate | Until user deletes | User's browser only | Browser same-origin policy |
| 3 | Preset last-used timestamp | `rift:presets` | ISO 8601 string | System-generated | Display recency in UI | Until user deletes | User's browser only | Browser same-origin policy |
| 4 | Batch size setting | `rift:settings` | Number | User input | Control migration batch size | Until user deletes | User's browser only | Browser same-origin policy |
| 5 | Dark mode preference | `rift:darkMode` | Boolean string | User input | UI theme | Until user deletes | User's browser only | Browser same-origin policy |
| 6 | Migration history | `rift:history` | Array of objects | System-generated | Display recent migrations | Until user deletes | User's browser only | Browser same-origin policy |

No credentials, environment secrets, or auth tokens are stored in `localStorage`. Environment identity (tenant/environment) is derived at runtime via the Marketplace SDK's `application.context` → `resourceAccess`.

### 2.2 Client-Side Transient Data (Browser Memory)

| # | Data Element | Data Type | Source | Purpose | Retention | Protection |
|---|-------------|-----------|--------|---------|-----------|------------|
| 7 | Auth0 access tokens | String | Marketplace SDK (Auth0) | Authorize Sitecore API calls | Managed by Marketplace SDK; not stored by Rift | Managed by SDK; never persisted by Rift |
| 8 | XM Cloud tenant/environment list | Array of objects | Marketplace SDK `application.context` → `resourceAccess` | Populate environment selectors | Browser session only (React state) | Not persisted |
| 9 | Content tree nodes | Array of objects | Sitecore Authoring GraphQL API (via SDK) | Display content tree for selection | Browser session only (React state) | Not persisted |
| 10 | Site discovery results | Array of objects | Marketplace SDK `xmc.xmapp.listSites` | Display available sites | Browser session only (React state) | Not persisted |
| 11 | Content Transfer operation IDs | String | Sitecore Content Transfer API | Track in-progress transfer operations | Duration of transfer operation only | Not persisted; ephemeral |
| 12 | Migration progress messages | Array of objects | Marketplace SDK / Content Transfer API | Real-time progress display | Browser session only (React state) | Not persisted |

### 2.3 Data Processed via Sitecore Infrastructure (Not Stored by Rift)

| # | Data Element | Data Type | Source | Purpose | Retention by Rift | Infrastructure |
|---|-------------|-----------|--------|---------|-------------------|---------------|
| 13 | Content export chunks (.raif) | Binary (Protobuf) | Sitecore Content Transfer API | Transfer serialized content between environments | Zero — streamed via Content Transfer API | Sitecore-managed |
| 14 | Content Transfer staging data | Binary | Sitecore Content Transfer API | Assemble and deliver export packages | Zero — managed by Sitecore API | Sitecore-managed |

### 2.4 Server Logs

| # | Data Element | Data Type | Source | Purpose | Retention | Access Scope | Protection |
|---|-------------|-----------|--------|---------|-----------|-------------|------------|
| 15 | Client IP address | String | Request headers (`x-forwarded-for`) | Rate limiting; security audit trail | Per hosting platform policy | Platform operators | Structured JSON logs; platform-managed storage |
| 16 | Access control decisions | JSON log entry | Middleware | Security audit — track denied requests | Per hosting platform policy | Platform operators | Structured JSON logs; platform-managed storage |
| 17 | Migration operation metadata | JSON log entry | Migration handler | Security audit — track migration start, completion, and errors | Per hosting platform policy | Platform operators | Structured JSON logs; platform-managed storage |

## 3. Data Flow Diagram

```
User's Browser                          Marketplace SDK / Sitecore Cloud
┌─────────────────────────────────┐    ┌─────────────────────────────────────┐
│                                 │    │                                     │
│  localStorage                   │    │  Auth0 (Sitecore-managed)           │
│  (presets, settings, history)   │    │  — authorization code flow          │
│                                 │    │  — token management (SDK only)      │
│  React State                    │    │                                     │
│  (tree nodes, site list,        │───>│  application.context.resourceAccess │
│   operation IDs, progress)      │<───│  — XM Cloud tenant/env discovery    │
│                                 │    │                                     │
│                                 │───>│  xmc.authoring.graphql              │
│                                 │<───│  — content tree browsing            │
│                                 │    │                                     │
│                                 │───>│  xmc.xmapp.listSites                │
│                                 │<───│  — site listing                     │
│                                 │    │                                     │
│                                 │───>│  Content Transfer API               │
│                                 │<───│  — chunked .raif export/import      │
└─────────────────────────────────┘    └─────────────────────────────────────┘
```

## 4. Data Classification

| Classification | Data Elements | Handling Requirements |
|---------------|--------------|----------------------|
| **Confidential** | Auth0 access tokens (#7) — managed by SDK, never accessed by Rift | SDK-managed; not logged; not stored |
| **Internal** | Content Transfer operation IDs (#11), content data (#13, #14) | Encrypt in transit; ephemeral only |
| **Public** | Preset names (#1), migration paths (#2), UI preferences (#4, #5) | Standard handling |

## 5. Regulatory Considerations

| Regulation | Applicability | Compliance Measures |
|-----------|--------------|-------------------|
| **GDPR** | Applies if users or content subjects are in the EU/EEA | DPA available; DSAR process documented; data minimization practiced; no credential data collected |
| **CCPA** | Applies if users are California residents | Privacy Policy includes CCPA disclosures; deletion rights supported |
| **HIPAA** | Not applicable | Application does not process health information by design |

## 6. Review Schedule

This data inventory shall be reviewed and updated:
- At least annually
- When new features are added that process additional data
- When data processing practices change
- When new sub-processors are engaged
