# Terms of Service — Rift: Content Migration for SitecoreAI

**Effective Date:** March 23, 2026
**Last Updated:** April 8, 2026
**Developer:** Wilkerson Consulting

---

## 1. Acceptance of Terms

By installing, accessing, or using Rift ("the Application"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Application.

## 2. Description of Service

Rift is a content migration tool for SitecoreAI that enables users to transfer content between SitecoreAI environments. The Application operates as a standalone web application within the Sitecore Marketplace ecosystem. Authentication is handled entirely by Sitecore's identity infrastructure via Auth0 — the same trust model used by native Sitecore applications.

## 3. License

Subject to these Terms, Wilkerson Consulting grants you a limited, non-exclusive, non-transferable, revocable license to use the Application for its intended purpose of migrating content between SitecoreAI environments.

## 4. User Responsibilities

### 4.1 Account and Access

You are responsible for:
- Maintaining the security of your Sitecore account, which is used to authenticate with the Application via Auth0.
- Ensuring you have proper authorization to access the source and target environments used in migrations.
- All migration activity performed under your authenticated Sitecore identity.

Rift does not collect or store your Sitecore credentials. You authenticate using your existing Sitecore identity through a "Sign in with Sitecore" flow managed by Sitecore's Auth0 provider. Rift never receives your password or client secrets.

### 4.2 Acceptable Use
You agree not to:
- Use the Application to access environments you are not authorized to access.
- Attempt to circumvent any security measures of the Application or SitecoreAI.
- Use the Application in any manner that could damage, disable, or impair Sitecore services.
- Reverse engineer, decompile, or disassemble any portion of the Application, except as permitted by applicable law.

### 4.3 Content Responsibility
You are solely responsible for:
- The content you choose to migrate between environments.
- Verifying that migrated content is accurate and complete.
- Ensuring content migrations comply with your organization's policies and applicable regulations.

## 5. Data Handling

### 5.1 No Credential Storage

Rift does not collect, store, or encrypt any Sitecore credentials. Authentication is performed entirely through Sitecore's Marketplace SDK, which delegates to Sitecore's Auth0 identity provider. Auth tokens are managed by the SDK and are never stored or accessed by Rift.

### 5.2 Client-Side Storage

The Application stores only user preferences (migration presets, settings, history) in browser `localStorage`. No credentials, tokens, or sensitive identity data are stored by the Application.

### 5.3 Content Transfer

Content migration is performed via Sitecore's Content Transfer API, which handles chunked transfer of `.raif` files between environments. Content data is not retained by Rift beyond the duration of the transfer operation.

### 5.4 Privacy

Your use of the Application is subject to our [Privacy Policy](privacy-policy.md), which describes how we handle information in connection with the Application.

## 6. Intellectual Property

The Application, including its code, design, and documentation, is the intellectual property of Wilkerson Consulting and is licensed under the Apache License, Version 2.0. The source code is available at [github.com/LonghornTaco/rift](https://github.com/LonghornTaco/rift).

## 7. Disclaimers

### 7.1 "As Is" Basis
THE APPLICATION IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

### 7.2 No Guarantee of Results
Wilkerson Consulting does not warrant that:
- The Application will meet your specific requirements.
- Migrations will be error-free, complete, or uninterrupted.
- The Application will be compatible with all SitecoreAI configurations or versions.

### 7.3 Content Integrity
Wilkerson Consulting is not responsible for:
- Data loss or corruption resulting from content migrations.
- Inconsistent content states resulting from cancelled or failed migrations.
- Any impact to target environments caused by migrated content.

## 8. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL WILKERSON CONSULTING BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, OR USE, ARISING OUT OF OR RELATED TO YOUR USE OF THE APPLICATION, WHETHER BASED ON WARRANTY, CONTRACT, TORT, OR ANY OTHER LEGAL THEORY, EVEN IF WILKERSON CONSULTING HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

IN NO EVENT SHALL WILKERSON CONSULTING'S TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING OUT OF OR RELATED TO THE APPLICATION EXCEED THE AMOUNT YOU PAID FOR THE APPLICATION IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR ONE HUNDRED US DOLLARS ($100), WHICHEVER IS GREATER.

## 9. Indemnification

You agree to indemnify, defend, and hold harmless Wilkerson Consulting from and against any claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising out of or in any way connected with:
- Your use of the Application.
- Your violation of these Terms.
- Your violation of any rights of any third party.
- Content you migrate using the Application.

## 10. Termination

### 10.1 By You
You may stop using the Application at any time. To remove all Application data, clear your browser's `localStorage` for the Application's domain. Session state managed by the Marketplace SDK (Auth0 tokens) is handled by Sitecore's infrastructure independently.

### 10.2 By Wilkerson Consulting
We may suspend or terminate your access to the Application at any time, with or without cause, and with or without notice.

### 10.3 Effect of Termination
Upon termination, your right to use the Application ceases immediately. Sections 7 (Disclaimers), 8 (Limitation of Liability), 9 (Indemnification), and 12 (Governing Law) shall survive termination.

## 11. Changes to Terms

We reserve the right to modify these Terms at any time. Material changes will be communicated through the Sitecore Marketplace listing. Your continued use of the Application after changes constitutes acceptance of the revised Terms.

## 12. Governing Law

These Terms shall be governed by and construed in accordance with the laws of the State of Minnesota, United States, without regard to its conflict of law provisions. Any disputes arising under these Terms shall be subject to the exclusive jurisdiction of the courts located in Hennepin County, Minnesota.

## 13. Severability

If any provision of these Terms is found to be unenforceable, the remaining provisions shall continue in full force and effect.

## 14. Entire Agreement

These Terms, together with the Privacy Policy and any other documents referenced herein, constitute the entire agreement between you and Wilkerson Consulting regarding the Application.

## 15. Contact

For questions about these Terms:

- **Email:** jasonmwilkerson@hotmail.com
- **Company:** Wilkerson Consulting
- **Address:** 5995 Loring Dr, Minnetrista, MN 55364
