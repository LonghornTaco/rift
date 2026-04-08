# Incident Response Plan — Rift: Content Migration for SitecoreAI

**Effective Date:** March 21, 2026
**Last Updated:** March 21, 2026
**Developer:** Wilkerson Consulting
**Security Contact:** jasonmwilkerson@hotmail.com

---

## 1. Purpose

This Incident Response Plan ("IRP") establishes procedures for identifying, responding to, and recovering from cybersecurity incidents related to the Rift application. It fulfills the Sitecore Marketplace security checklist requirement that developers maintain an incident response plan practiced at least annually.

## 2. Scope

This plan covers all security incidents related to:
- The Rift application code and its dependencies
- The hosting infrastructure used to serve the Application
- User data processed by the Application
- Third-party services integrated with the Application

## 3. Definitions

| Term | Definition |
|------|-----------|
| **Security Incident** | Any event that compromises the confidentiality, integrity, or availability of the Application or its data |
| **Data Breach** | A security incident involving unauthorized access to or disclosure of personal data |
| **0-Day Vulnerability** | A previously unknown vulnerability that is being actively exploited |
| **Severity Levels** | See Section 5 for classification criteria |

## 4. Roles and Responsibilities

| Role | Responsibility | Contact |
|------|---------------|---------|
| **Incident Commander** | Leads incident response; makes escalation decisions | Jason Wilkerson, Wilkerson Consulting |
| **Security Lead** | Technical investigation and remediation | Jason Wilkerson, Wilkerson Consulting |
| **Communications Lead** | Handles notifications to Sitecore, customers, and authorities | Jason Wilkerson, Wilkerson Consulting |

For teams of one or two, a single person may fulfill multiple roles. Ensure at least one backup contact is designated.

## 5. Severity Classification

| Level | Criteria | Response Time | Examples |
|-------|----------|--------------|---------|
| **Critical (P1)** | Active exploitation; data breach confirmed; 0-day in Application code | Immediate (within 1 hour) | Credential exfiltration, active SSRF exploitation, supply chain compromise |
| **High (P2)** | Vulnerability with known exploit but no confirmed exploitation; potential data exposure | Within 4 hours | Critical dependency vulnerability, authentication bypass |
| **Medium (P3)** | Vulnerability without known exploit; limited impact | Within 24 hours | Medium-severity dependency CVE, information disclosure |
| **Low (P4)** | Minor security issue; no immediate risk | Within 1 week | Low-severity CVE, configuration improvement |

## 6. Incident Response Phases

### Phase 1: Detection and Identification

**Sources of detection:**
- Automated dependency vulnerability scanning (`npm audit`, Dependabot/Renovate)
- Hosting platform alerts (Vercel)
- Security researcher reports
- Sitecore notification
- Customer reports
- Log monitoring anomalies

**Upon detection:**
1. Record the date and time of detection (UTC).
2. Classify the severity level (Section 5).
3. Assign an Incident Commander.
4. Create an incident record with: description, affected components, severity, and timeline.

### Phase 2: Containment

**Immediate actions by severity:**

| Severity | Containment Actions |
|----------|-------------------|
| Critical | Disable affected endpoints or take Application offline if necessary. Rotate any potentially compromised credentials. Notify Sitecore immediately. |
| High | Assess blast radius. Implement temporary mitigations (e.g., WAF rules, feature flags). |
| Medium | Document the vulnerability. Plan remediation for next release. |
| Low | Add to backlog. Remediate in normal development cycle. |

### Phase 3: Investigation

1. Review structured server logs for indicators of compromise:
   - Authentication failures (`auth_failure` events)
   - Access control denials (`access_control` events with `deny`)
   - Unusual migration patterns (`migration_start` / `migration_complete` events)
   - Rate limit triggers (`rate_limited` events)
2. Identify the root cause and attack vector.
3. Determine the scope of impact (affected users, data, timeframe).
4. Preserve evidence (export logs before retention expiry).

### Phase 4: Remediation

1. Develop and test a fix.
2. For dependency vulnerabilities: update the affected package, regenerate SBOM.
3. For application vulnerabilities: patch, test, and deploy.
4. Verify the fix resolves the issue without introducing regressions.
5. Deploy the fix to production.

### Phase 5: Notification

#### Sitecore Notification
Per the Sitecore Marketplace security checklist:

| Scenario | Notification Deadline | Contact |
|----------|---------------------|---------|
| Confirmed security incident | Within 72 hours of confirmation | security@sitecore.com |
| Confirmed 0-day vulnerability | Within 24 hours of confirmation | security@sitecore.com |

#### Customer Notification
- Notify all customers of a data breach within 72 hours of confirmation.
- Notification shall include: description of the incident, data affected, actions taken, and recommended user actions.

#### Regulatory Notification
- If the incident constitutes a data breach under GDPR, notify the relevant supervisory authority within 72 hours.
- If the incident affects California residents under CCPA, follow applicable breach notification requirements.

### Phase 6: Recovery

1. Confirm the fix is deployed and effective.
2. Monitor logs for any continued exploitation attempts.
3. Restore any services taken offline during containment.
4. Communicate resolution to all notified parties.

### Phase 7: Post-Incident Review

Within 5 business days of incident closure:

1. Conduct a post-incident review meeting.
2. Document:
   - Timeline of events
   - Root cause analysis
   - What worked well in the response
   - What could be improved
   - Action items to prevent recurrence
3. Update this IRP if the review identifies gaps.
4. Update security controls, monitoring, or testing as needed.

## 7. Communication Templates

### 7.1 Sitecore Notification Template

```
Subject: Security Incident Notification — Rift [Incident ID]

To: security@sitecore.com

We are writing to notify you of a security incident affecting the Rift
application published on the Sitecore Marketplace.

Incident ID: [ID]
Date Detected: [DATE, UTC]
Date Confirmed: [DATE, UTC]
Severity: [Critical/High/Medium]
Status: [Investigating/Contained/Remediated]

Description:
[Brief description of the incident]

Impact:
[Scope of impact — affected components, data, users]

Actions Taken:
[Steps taken to contain and remediate]

Next Steps:
[Planned actions and timeline]

Contact: jasonmwilkerson@hotmail.com
```

### 7.2 Customer Notification Template

```
Subject: Security Notice — Rift Content Migration Tool

We are writing to inform you of a security incident affecting the Rift
application.

What happened:
[Plain-language description]

What data was affected:
[Specific data types and scope]

What we have done:
[Remediation actions taken]

What you should do:
[Recommended user actions, e.g., rotate credentials]

Contact: jasonmwilkerson@hotmail.com
```

## 8. Annual Testing

This IRP shall be tested at least annually through one of the following methods:
- **Tabletop exercise:** Walk through a simulated incident scenario with all role holders.
- **Functional test:** Simulate a security event and execute the response process.
- **Full exercise:** Conduct an end-to-end test including notification procedures (using test channels).

Record the date, type, participants, findings, and improvements from each test.

| Date | Type | Participants | Key Findings | Improvements Made |
|------|------|-------------|-------------|------------------|
| [DATE] | [Tabletop/Functional/Full] | [Names] | [Findings] | [Actions] |

## 9. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | March 21, 2026 | Jason Wilkerson | Initial version |

## 10. Contact Information

- **Security Contact (monitored alias):** jasonmwilkerson@hotmail.com
- **Incident Commander:** Jason Wilkerson, jasonmwilkerson@hotmail.com
- **Sitecore Security:** security@sitecore.com
