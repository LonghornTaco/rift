# Data Processing Addendum — Rift: Content Migration for SitecoreAI

**Effective Date:** March 21, 2026
**Last Updated:** March 21, 2026
**Developer ("Processor"):** Wilkerson Consulting

---

## 1. Purpose and Scope

This Data Processing Addendum ("DPA") supplements the terms under which the Rift application ("Application") is made available through the Sitecore Marketplace. It sets out the obligations of Wilkerson Consulting ("Processor") with respect to the processing of personal data on behalf of the customer ("Controller") in connection with the use of the Application.

This DPA applies to the extent that the Processor processes personal data on behalf of the Controller in the course of providing the Application's content migration services.

## 2. Definitions

Terms used in this DPA have the meanings given to them in the EU General Data Protection Regulation (Regulation (EU) 2016/679, "GDPR"), unless otherwise defined herein.

- **Personal Data:** Any information relating to an identified or identifiable natural person that is processed by the Application.
- **Processing:** Any operation performed on Personal Data, including collection, recording, organization, structuring, storage, adaptation, retrieval, consultation, use, disclosure, erasure, or destruction.
- **Sub-processor:** Any third party engaged by the Processor to process Personal Data on behalf of the Controller.

## 3. Nature and Purpose of Processing

### 3.1 Processing Activities

The Application performs the following processing activities:

| Activity | Data Involved | Duration | Purpose |
|----------|--------------|----------|---------|
| Content migration | Sitecore content items that may contain personal data embedded in content fields | Duration of migration operation only (streaming, not stored) | Transfer content between SitecoreAI environments |
| Authentication | OAuth client credentials | Duration of API request | Authenticate with Sitecore Cloud services |
| Logging | IP addresses, timestamps, operation metadata | Per hosting platform retention policy | Security monitoring and audit trail |

### 3.2 Categories of Data Subjects

Data subjects whose personal data may be processed include:
- Individuals whose personal data is contained within Sitecore content items being migrated (e.g., author names, contact information in content fields).
- Application users (IP addresses in server logs).

### 3.3 No Persistent Storage

The Application does not maintain a server-side database. Content data is streamed through the server during migration and is not stored, cached, or retained. Client-side data (environment configurations, presets) is stored exclusively in the user's browser.

## 4. Obligations of the Processor

### 4.1 Processing Instructions
The Processor shall process Personal Data only on documented instructions from the Controller, which are embodied in the Controller's use of the Application (selecting content to migrate, configuring environments).

### 4.2 Confidentiality
The Processor shall ensure that persons authorized to process Personal Data have committed themselves to confidentiality or are under an appropriate statutory obligation of confidentiality.

### 4.3 Security Measures
The Processor shall implement appropriate technical and organizational measures to ensure a level of security appropriate to the risk, including:

- Encryption of data in transit (TLS 1.2+)
- CSRF protection on all API endpoints
- Rate limiting on authentication endpoints
- Input validation and sanitization on all parameters
- Content Security Policy headers
- Structured security logging with UTC timestamps
- No persistent server-side storage of content data

### 4.4 Sub-processors

The following sub-processors are engaged:

| Sub-processor | Purpose | Location |
|--------------|---------|----------|
| Vercel Inc. | Application hosting and server-side execution | US (or region selected by deployment) |
| Sitecore (Sitecore Holding II A/S) | Content management platform (source/target of migration) | Per customer's Sitecore configuration |

The Processor shall inform the Controller of any intended changes concerning the addition or replacement of sub-processors, giving the Controller the opportunity to object.

### 4.5 Data Subject Rights
The Processor shall assist the Controller in responding to requests from data subjects exercising their rights under GDPR (access, rectification, erasure, restriction, portability, objection), taking into account the nature of the processing.

### 4.6 Breach Notification
The Processor shall notify the Controller without undue delay, and in any event within 72 hours, after becoming aware of a Personal Data breach.

### 4.7 Data Protection Impact Assessment
The Processor shall assist the Controller with data protection impact assessments and prior consultations with supervisory authorities, where required.

### 4.8 Deletion and Return of Data
Upon termination of the service, the Processor shall, at the Controller's choice, delete or return all Personal Data. Given that the Application does not persist content data server-side, this obligation is satisfied by the Application's stateless architecture. Client-side data can be deleted by clearing browser storage.

## 5. International Transfers

Where Personal Data is transferred to countries outside the European Economic Area (EEA), the Processor shall ensure that appropriate safeguards are in place, such as:
- Standard Contractual Clauses (SCCs) approved by the European Commission.
- The recipient's participation in an approved certification mechanism.

## 6. Audit Rights

The Controller has the right to audit the Processor's compliance with this DPA. The Processor shall make available to the Controller all information necessary to demonstrate compliance and allow for and contribute to audits conducted by the Controller or an auditor mandated by the Controller.

## 7. Liability

Each party's liability under this DPA is subject to the limitations and exclusions of liability set out in the applicable agreement between the parties.

## 8. Term and Termination

This DPA shall remain in effect for the duration of the Processor's processing of Personal Data on behalf of the Controller. The obligations of the Processor under this DPA shall survive termination to the extent required for the Processor to comply with applicable data protection law.

## 9. Contact

For DPA-related inquiries:

- **Data Protection Contact:** jasonmwilkerson@hotmail.com
- **Company:** Wilkerson Consulting
- **Address:** 5995 Loring Dr, Minnetrista, MN 55364
