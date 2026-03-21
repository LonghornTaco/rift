# Data Subject Access Request (DSAR) Process — Rift

**Effective Date:** March 21, 2026
**Last Updated:** March 21, 2026
**Developer:** Wilkerson Consulting

---

## 1. Overview

This document describes the process by which data subjects can exercise their rights under applicable data protection regulations (including GDPR and CCPA) in relation to personal data processed by the Rift application.

## 2. Data Subject Rights

Under applicable law, data subjects may have the following rights:

| Right | Description |
|-------|-------------|
| **Access** | Request confirmation of whether personal data is being processed and obtain a copy |
| **Rectification** | Request correction of inaccurate personal data |
| **Erasure** | Request deletion of personal data ("right to be forgotten") |
| **Restriction** | Request limitation of processing of personal data |
| **Portability** | Request transfer of personal data in a structured, machine-readable format |
| **Objection** | Object to processing of personal data |

## 3. How Rift Processes Personal Data

Rift is a stateless content migration tool. Understanding what data Rift processes is important for evaluating DSAR applicability:

### 3.1 Data the User Controls Directly

| Data | Storage Location | User Action to Exercise Rights |
|------|-----------------|-------------------------------|
| Environment configurations (names, URLs, credentials) | User's browser `localStorage` | View, edit, or delete via the Application's Environments interface, or clear browser storage |
| Migration presets | User's browser `localStorage` | View, edit, or delete via the Application's Presets interface, or clear browser storage |
| Application settings | User's browser `localStorage` | Modify via the Application's Configuration interface, or clear browser storage |

**Because this data is stored entirely in the user's browser, the user has full and direct control.** No request to the developer is necessary.

### 3.2 Data Processed Transiently

| Data | Retention | Notes |
|------|-----------|-------|
| Sitecore content (during migration) | None — streamed, not stored | Content passes through the server but is not persisted |
| OAuth access tokens | Session memory only | Discarded when the browser session ends |

### 3.3 Server Logs

| Data | Retention | Notes |
|------|-----------|-------|
| IP addresses | Per hosting platform policy | Included in structured security logs for audit purposes |
| Timestamps and operation metadata | Per hosting platform policy | Authentication events, access control decisions, migration operations |

## 4. Submitting a DSAR

### 4.1 How to Submit

Data subjects may submit a DSAR by emailing:

**jasonmwilkerson@hotmail.com**

The request should include:
- Full name of the data subject
- Description of the right being exercised
- Sufficient detail to identify the personal data concerned
- Preferred method of response (email, postal mail)

### 4.2 Verification

To protect against unauthorized disclosure, we will verify the identity of the requestor before processing any DSAR. Verification may include:
- Confirming the email address associated with the request
- Requesting additional identifying information

### 4.3 Response Timeline

| Milestone | Timeline |
|-----------|----------|
| Acknowledge receipt | Within 3 business days |
| Complete request | Within 30 calendar days of receipt |
| Extension (complex requests) | Up to 60 additional calendar days, with notification |

### 4.4 Fees

DSARs are processed free of charge. In the case of manifestly unfounded or excessive requests (particularly if repetitive), we may charge a reasonable fee or refuse to act on the request, in accordance with applicable law.

## 5. Self-Service Data Deletion

Because Rift stores user data exclusively in the browser, users can delete all their data without submitting a formal request:

1. **Individual items:** Use the Application's Environments or Presets interface to delete specific entries.
2. **All Application data:** Open browser Developer Tools (F12) > Application > Local Storage > select the Application's domain > delete all `rift:*` keys.
3. **Complete removal:** Clear all site data for the Application's domain in browser settings.

## 6. Escalation

If a data subject is not satisfied with our response to a DSAR, they may:

1. Contact us again at jasonmwilkerson@hotmail.com to discuss the matter further.
2. Lodge a complaint with the relevant supervisory authority:
   - **EU/EEA:** The data protection authority in the data subject's country of residence.
   - **US (CCPA):** The California Attorney General's office (for California residents).

## 7. Record Keeping

We maintain a log of all DSARs received, including:
- Date of receipt
- Nature of the request
- Actions taken
- Date of response
- Outcome

This log is retained for a minimum of 3 years for compliance and audit purposes.

## 8. Contact

- **DSAR Email:** jasonmwilkerson@hotmail.com
- **Company:** Wilkerson Consulting
- **Address:** 5995 Loring Dr, Minnetrista, MN 55364
