# Privacy Policy — Rift: Content Migration for Sitecore XM Cloud

**Effective Date:** March 21, 2026
**Last Updated:** March 21, 2026
**Developer:** Wilkerson Consulting
**Contact:** jasonmwilkerson@hotmail.com

---

## 1. Introduction

Rift ("the Application") is a content migration tool for Sitecore XM Cloud that enables users to transfer content between Sitecore XM Cloud environments. This Privacy Policy describes how the Application collects, uses, stores, and protects information.

## 2. Information We Collect

### 2.1 Data Provided by Users

| Data Type | Description | Purpose |
|-----------|-------------|---------|
| Sitecore Client Credentials | OAuth client ID and client secret for XM Cloud environments | Authenticate with Sitecore APIs to perform content migration |
| Environment Configuration | Environment names, CM URLs | Identify and connect to Sitecore XM Cloud instances |
| Migration Paths | Sitecore content tree paths and migration scope selections | Define which content items to migrate |
| Migration Presets | Saved migration configurations (paths, scopes, environment references) | Allow users to save and reuse migration configurations |

### 2.2 Data Processed Transiently

| Data Type | Description | Purpose |
|-----------|-------------|---------|
| OAuth Access Tokens | Short-lived tokens obtained from Sitecore Cloud authentication | Authorize API requests during a session |
| Sitecore Content Data | Serialized content items pulled from source environments | Transfer content to target environments |
| Migration Logs | Status messages, error details, item counts | Provide real-time progress feedback to the user |

### 2.3 Data We Do NOT Collect

- Personal information (names, email addresses, phone numbers)
- Usage analytics or telemetry
- Device metadata or browser fingerprints
- Cookies for tracking purposes
- Any data from end-users of the Sitecore websites being migrated

## 3. How We Use Information

All data collected is used exclusively for the purpose of performing content migration between Sitecore XM Cloud environments. Specifically:

- **Authentication:** Client credentials are used solely to obtain access tokens from Sitecore Cloud authentication services.
- **Content Migration:** Content data is read from a source environment and written to a target environment. Content data is not stored, cached, or retained by the Application beyond the duration of the migration operation.
- **Configuration Persistence:** Environment configurations and migration presets are stored locally in the user's browser to enable reuse across sessions.

## 4. Data Storage and Retention

### 4.1 Client-Side Storage (Browser)

All persistent application data is stored in the user's browser via `localStorage`:

| Storage Key | Contents | Retention |
|-------------|----------|-----------|
| `rift:environments` | Environment configurations including credentials | Until manually deleted by user |
| `rift:presets` | Saved migration presets | Until manually deleted by user |
| `rift:settings` | Application settings (batch size) | Until manually deleted by user |
| `rift:darkMode` | Theme preference | Until manually deleted by user |

### 4.2 Server-Side Storage

The Application does **not** maintain any server-side database, file storage, or persistent data store. All server-side processing is stateless and transient.

### 4.3 Transient Data

- OAuth access tokens are held in browser memory only during an active session and are not persisted.
- Sitecore content data is streamed through the server during migration and is not stored, cached, or logged.
- Structured server logs (authentication events, access control decisions, migration operations) are written to the hosting platform's log infrastructure and retained according to the hosting provider's policies.

## 5. Data Sharing and Disclosure

The Application does **not** share, sell, rent, or disclose any user data to third parties.

Data is transmitted only to the following Sitecore-operated services as required for the Application's core functionality:

| Service | Endpoint | Purpose |
|---------|----------|---------|
| Sitecore Cloud Authentication | `auth.sitecorecloud.io` | OAuth token exchange |
| Sitecore XM Cloud Deploy API | `xmclouddeploy-api.sitecorecloud.io` | Project and environment discovery |
| Sitecore XM Cloud Authoring API | `[environment].sitecorecloud.io/sitecore/api/authoring/graphql/v1` | Content tree browsing and metadata |
| Sitecore XM Cloud Management API | `[environment].sitecorecloud.io/sitecore/api/management` | Content serialization and migration |

## 6. Data Protection Measures

### 6.1 Data in Transit
- All communications use TLS 1.2 or higher.
- HTTP Strict Transport Security (HSTS) is enforced with a minimum age of two years.
- The Application enforces HTTPS-only connections to all Sitecore APIs.

### 6.2 Data at Rest
- Client-side data in `localStorage` is protected by the browser's same-origin policy.
- The Application does not store data on the server side.
- The hosting environment (Vercel) provides full-disk encryption for all infrastructure.

### 6.3 Application Security
- Content Security Policy (CSP) headers restrict script execution and data exfiltration.
- CSRF protection validates request origins on all API endpoints.
- Rate limiting protects against brute-force authentication attempts.
- Input validation prevents injection attacks on all API parameters.

## 7. User Rights and Data Control

### 7.1 Access
Users can view all stored data directly in their browser's developer tools under `localStorage`.

### 7.2 Deletion
Users can delete all stored data by:
- Using the Application's built-in environment and preset management interfaces to remove individual items.
- Clearing browser `localStorage` for the Application's domain.
- Uninstalling the Application, which removes all associated browser storage.

### 7.3 Data Portability
Migration presets can be exported and imported through the Application's preset management interface.

### 7.4 Data Subject Access Requests (DSAR)
For any data subject access requests, please contact us at jasonmwilkerson@hotmail.com. See our Data Subject Access Request Process document for details.

## 8. Children's Privacy

The Application is intended for use by Sitecore administrators and developers. It is not directed at children under 16 years of age, and we do not knowingly collect information from children.

## 9. International Data Transfers

The Application processes data in the region where it is deployed. Content data is transferred between Sitecore XM Cloud environments, which may be located in different geographic regions as configured by the user's Sitecore organization.

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. Material changes will be communicated through the Sitecore Marketplace listing. The "Last Updated" date at the top of this policy indicates the most recent revision.

## 11. Contact Information

For privacy-related inquiries or concerns:

- **Email:** jasonmwilkerson@hotmail.com
- **Company:** Wilkerson Consulting
- **Address:** 5995 Loring Dr, Minnetrista, MN 55364
