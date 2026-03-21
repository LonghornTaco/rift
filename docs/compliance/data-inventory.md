# Data Inventory — Rift: Content Migration for Sitecore XM Cloud

**Effective Date:** March 21, 2026
**Last Updated:** March 21, 2026
**Developer:** Wilkerson Consulting

---

## 1. Overview

This document provides a comprehensive inventory of all data processed by the Rift application, as required by the Sitecore Marketplace security checklist. It covers data collection, storage, processing, and deletion across all components of the Application.

## 2. Data Inventory

### 2.1 Client-Side Persistent Data (Browser localStorage)

| # | Data Element | Storage Key | Data Type | Source | Purpose | Retention | Access Scope | Protection |
|---|-------------|-------------|-----------|--------|---------|-----------|-------------|------------|
| 1 | Environment name | `rift:environments` | String | User input | Identify environments in the UI | Until user deletes | User's browser only | Browser same-origin policy |
| 2 | CM URL | `rift:environments` | URL string | User input / Sitecore Deploy API | Connect to XM Cloud authoring and management APIs | Until user deletes | User's browser only | Browser same-origin policy; validated against `*.sitecorecloud.io` |
| 3 | OAuth Client ID | `rift:environments` | String | User input | Authenticate with Sitecore Cloud | Until user deletes | User's browser only | Browser same-origin policy; masked in UI (last 4 chars only) |
| 4 | OAuth Client Secret | `rift:environments` | String | User input | Authenticate with Sitecore Cloud | Until user deletes | User's browser only | Browser same-origin policy |
| 5 | Migration preset names | `rift:presets` | String | User input | Label saved migration configurations | Until user deletes | User's browser only | Browser same-origin policy |
| 6 | Migration paths and scopes | `rift:presets` | Array of objects | User selection from content tree | Define content to migrate | Until user deletes | User's browser only | Browser same-origin policy |
| 7 | Preset last-used timestamp | `rift:presets` | ISO 8601 string | System-generated | Display recency in UI | Until user deletes | User's browser only | Browser same-origin policy |
| 8 | Batch size setting | `rift:settings` | Number | User input | Control migration batch size | Until user deletes | User's browser only | Browser same-origin policy |
| 9 | Dark mode preference | `rift:darkMode` | Boolean string | User input | UI theme | Until user deletes | User's browser only | Browser same-origin policy |

### 2.2 Client-Side Transient Data (Browser Memory)

| # | Data Element | Data Type | Source | Purpose | Retention | Protection |
|---|-------------|-----------|--------|---------|-----------|------------|
| 10 | OAuth access tokens | String | Sitecore Cloud auth API | Authorize API requests | Browser session only (React state) | Not persisted; cleared on page unload |
| 11 | Content tree nodes | Array of objects | Sitecore Authoring GraphQL API | Display content tree for selection | Browser session only (React state) | Not persisted |
| 12 | Site discovery results | Array of objects | Sitecore Authoring GraphQL API | Display available sites | Browser session only (React state) | Not persisted |
| 13 | XM Cloud projects list | Array of objects | Sitecore Deploy API | Environment setup wizard | Browser session only (React state) | Not persisted |
| 14 | Migration progress messages | Array of objects | Server streaming response | Real-time progress display | Browser session only (React state) | Not persisted |

### 2.3 Server-Side Transient Data (Streaming)

| # | Data Element | Data Type | Source | Purpose | Retention | Protection |
|---|-------------|-----------|--------|---------|-----------|------------|
| 15 | Serialized content items | JSON objects | Sitecore Management GraphQL API (source) | Stream to target environment | Zero — streamed, never stored | TLS in transit; not cached or logged |
| 16 | Content item IDs (target) | Set of strings | Sitecore Management GraphQL API (target) | Determine create vs. update | Duration of request only | TLS in transit; garbage collected after request |

### 2.4 Server Logs

| # | Data Element | Data Type | Source | Purpose | Retention | Access Scope | Protection |
|---|-------------|-----------|--------|---------|-----------|-------------|------------|
| 17 | Client IP address | String | Request headers (`x-forwarded-for`) | Rate limiting; security audit trail | Per hosting platform policy | Platform operators | Structured JSON logs; platform-managed storage |
| 18 | Authentication events | JSON log entry | Application logger | Security audit — track successful and failed auth attempts | Per hosting platform policy | Platform operators | Structured JSON logs; platform-managed storage |
| 19 | Access control decisions | JSON log entry | CSRF middleware | Security audit — track denied cross-origin requests | Per hosting platform policy | Platform operators | Structured JSON logs; platform-managed storage |
| 20 | Migration operation metadata | JSON log entry | Migration route handler | Security audit — track migration start, completion, and errors | Per hosting platform policy | Platform operators | Structured JSON logs; platform-managed storage |

## 3. Data Flow Diagram

```
User's Browser                          Rift Server (Vercel)                    Sitecore Cloud
┌─────────────────┐                    ┌─────────────────┐                    ┌─────────────────┐
│                 │                    │                 │                    │                 │
│  localStorage   │───credentials────>│  API Routes     │───OAuth────────────>│  auth.sitecore  │
│  (environments, │                    │  (stateless)    │<──access token─────│  cloud.io       │
│   presets,      │                    │                 │                    │                 │
│   settings)     │                    │                 │───GraphQL──────────>│  [env].sitecore │
│                 │<──content tree─────│                 │<──content data─────│  cloud.io       │
│  React State    │                    │                 │                    │                 │
│  (tokens,       │                    │  Logs ────────> │  Hosting Platform  │                 │
│   tree nodes,   │                    │  (structured    │  Log Storage       │                 │
│   progress)     │                    │   JSON, UTC)    │                    │                 │
└─────────────────┘                    └─────────────────┘                    └─────────────────┘
```

## 4. Data Classification

| Classification | Data Elements | Handling Requirements |
|---------------|--------------|----------------------|
| **Confidential** | OAuth client secrets (#4), access tokens (#10) | Encrypt in transit; minimize retention; do not log |
| **Internal** | Client IDs (#3), CM URLs (#2), content data (#15) | Encrypt in transit; mask in UI where appropriate |
| **Public** | Environment names (#1), preset names (#5), UI preferences (#8, #9) | Standard handling |

## 5. Regulatory Considerations

| Regulation | Applicability | Compliance Measures |
|-----------|--------------|-------------------|
| **GDPR** | Applies if users or content subjects are in the EU/EEA | DPA available; DSAR process documented; data minimization practiced |
| **CCPA** | Applies if users are California residents | Privacy Policy includes CCPA disclosures; deletion rights supported |
| **HIPAA** | Not applicable | Application does not process health information by design |

## 6. Review Schedule

This data inventory shall be reviewed and updated:
- At least annually
- When new features are added that process additional data
- When data processing practices change
- When new sub-processors are engaged
