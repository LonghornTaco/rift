# Privacy Policy — Rift: Content Migration for SitecoreAI

**Effective Date:** March 21, 2026
**Last Updated:** April 8, 2026
**Developer:** Wilkerson Consulting
**Contact:** jasonmwilkerson@hotmail.com

---

## 1. Introduction

Rift ("the Application") is a content migration tool for SitecoreAI that enables users to transfer content between SitecoreAI environments. This Privacy Policy describes how the Application collects, uses, stores, and protects information.

## 2. Information We Collect

### 2.1 Data Provided by Users

| Data Type | Description | Purpose |
|-----------|-------------|---------|
| Migration Paths | Sitecore content tree paths and migration scope selections | Define which content items to migrate |
| Migration Presets | Saved migration configurations (paths, scopes, environment references) | Allow users to save and reuse migration configurations |

Rift does **not** collect, receive, or store Sitecore credentials (client IDs, client secrets, or passwords) of any kind. Authentication is handled entirely by Sitecore's Marketplace SDK via Auth0. Users authenticate with their existing Sitecore identity through a standard "Sign in with Sitecore" redirect — Rift never sees or touches the credentials involved.

### 2.2 Data Processed Transiently

| Data Type | Description | Purpose |
|-----------|-------------|---------|
| Auth0 Access Tokens | Short-lived tokens managed entirely by the Marketplace SDK | Authorize Sitecore API calls during a session |
| Sitecore Content Data | Serialized content items (.raif chunks) transferred between environments via the Content Transfer API | Transfer content to target environments |
| Migration Logs | Status messages, error details, item counts | Provide real-time progress feedback to the user |

Auth0 tokens are managed exclusively by the Marketplace SDK. Rift code does not read, store, or transmit these tokens directly.

### 2.3 Data We Do NOT Collect

- Sitecore credentials (client IDs, client secrets, passwords)
- Personal information (names, email addresses, phone numbers)
- Usage analytics or telemetry
- Device metadata or browser fingerprints
- Cookies of any kind
- Any data from end-users of the Sitecore websites being migrated

## 3. How We Use Information

All data collected is used exclusively for the purpose of performing content migration between SitecoreAI environments. Specifically:

- **Authentication:** Users authenticate with Sitecore via Auth0 through the Marketplace SDK. Rift does not participate in the credential exchange.
- **Environment Discovery:** The Marketplace SDK's `application.context` provides access to the authenticated user's XM Cloud tenants via `resourceAccess`. No separate credential input is required.
- **Content Browsing:** Content trees and site listings are retrieved via the Marketplace SDK's Authoring GraphQL API (`xmc.authoring.graphql`) and `xmc.xmapp.listSites`.
- **Content Migration:** Content data is transferred between environments using the Sitecore Content Transfer API (chunked `.raif` files). Content data is not stored, cached, or retained by the Application beyond the duration of the migration operation.
- **Configuration Persistence:** Migration presets and settings are stored locally in the user's browser to enable reuse across sessions.

## 4. Data Storage and Retention

### 4.1 Client-Side Storage (Browser)

All persistent application data is stored in the user's browser via `localStorage`:

| Storage Key | Contents | Retention |
|-------------|----------|-----------|
| `rift:presets` | Saved migration presets | Until manually deleted by user |
| `rift:settings` | Application settings (batch size) | Until manually deleted by user |
| `rift:darkMode` | Theme preference | Until manually deleted by user |
| `rift:history` | Recent migration history | Until manually deleted by user |

No credentials, auth tokens, or sensitive identity data are stored in `localStorage` or anywhere else by Rift.

### 4.2 Server-Side Storage

The Application does **not** maintain any server-side database, file storage, or persistent data store. All data flows through the Sitecore Marketplace SDK infrastructure and the Sitecore Content Transfer API.

### 4.3 Transient Data

- Auth0 tokens are managed by the Marketplace SDK and are not accessible to or stored by Rift.
- Sitecore content data (.raif chunks) is transferred via the Content Transfer API and is not cached or logged by Rift.
- Structured server logs (access control decisions, migration operations) are written to the hosting platform's log infrastructure and retained according to the hosting provider's policies.

## 5. Data Sharing and Disclosure

The Application does **not** share, sell, rent, or disclose any user data to third parties.

Data is transmitted only to the following Sitecore-operated services as required for the Application's core functionality:

| Service | Endpoint | Purpose |
|---------|----------|---------|
| Sitecore Auth0 (via Marketplace SDK) | Sitecore-managed Auth0 tenant | User authentication (authorization code flow) |
| Sitecore Marketplace SDK | SDK-managed infrastructure | Environment discovery, content browsing, token management |
| SitecoreAI Authoring GraphQL API | `[environment].sitecorecloud.io/sitecore/api/authoring/graphql/v1` | Content tree browsing and site listing |
| Sitecore Content Transfer API | Sitecore-managed transfer infrastructure | Chunked content export and import (.raif files) |

## 6. Data Protection Measures

### 6.1 Data in Transit
- All communications use TLS 1.2 or higher.
- HTTP Strict Transport Security (HSTS) is enforced with a minimum age of two years.
- The Application enforces HTTPS-only connections to all Sitecore APIs.

### 6.2 Data at Rest
- Client-side data in `localStorage` is protected by the browser's same-origin policy.
- No credentials or auth tokens are stored client-side or server-side by Rift.
- The hosting environment (Vercel) provides full-disk encryption for all infrastructure.

### 6.3 Application Security
- Content Security Policy (CSP) headers restrict script execution and data exfiltration.
- Authentication trust is inherited from Sitecore's Auth0 identity provider — the same trust model used by native Sitecore applications.

## 7. User Rights and Data Control

### 7.1 Access
Users can view all stored data directly in their browser's developer tools under `localStorage`.

### 7.2 Deletion
Users can delete all stored data by:
- Using the Application's built-in preset management interface to remove individual items.
- Clearing browser `localStorage` for the Application's domain.
- Uninstalling the Application, which removes all associated browser storage.

For identity and session data managed by Auth0, users should refer to Sitecore's identity and privacy documentation.

### 7.3 Data Portability
Migration presets can be exported and imported through the Application's preset management interface.

### 7.4 Data Subject Access Requests (DSAR)
For any data subject access requests, please contact us at jasonmwilkerson@hotmail.com. See our Data Subject Access Request Process document for details.

## 8. Children's Privacy

The Application is intended for use by Sitecore administrators and developers. It is not directed at children under 16 years of age, and we do not knowingly collect information from children.

## 9. International Data Transfers

The Application processes data in the region where it is deployed. Content data is transferred between SitecoreAI environments, which may be located in different geographic regions as configured by the user's Sitecore organization. Authentication is handled by Sitecore's Auth0 tenant, subject to Sitecore's data processing terms.

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. Material changes will be communicated through the Sitecore Marketplace listing. The "Last Updated" date at the top of this policy indicates the most recent revision.

## 11. Contact Information

For privacy-related inquiries or concerns:

- **Email:** jasonmwilkerson@hotmail.com
- **Company:** Wilkerson Consulting
- **Address:** 5995 Loring Dr, Minnetrista, MN 55364
