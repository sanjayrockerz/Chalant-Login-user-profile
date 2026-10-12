# Legal Review Package — Contacts Import & Push Notifications

**Ticket:** LEG-2310  
**Prepared by:** Privacy Engineering  
**Date Submitted:** 2025-10-18

---

## 1. Materials Provided

| Artifact | Description | Location |
| --- | --- | --- |
| Privacy Policy Addendum | Draft language for Sections 2, 3, 6 | `docs/privacy/privacy-policy-addendum-contacts-push.md` |
| GDPR & CCPA Compliance Packet | Lawful basis, DPIA summary, rights mapping | `docs/privacy/compliance-contacts-push.md` |
| User-Facing Copy | Consent modal, tooltips, help center drafts | `docs/privacy/user-facing-copy-contacts-push.md` |
| Data Flow Diagram | Visio diagram showing data entry, hashing, retention | `design/diagrams/contacts-push-data-flow.vsdx` *(attached to ticket)* |
| Security Safeguards Summary | Rate limits, anomaly detection, encryption | `SECURITY_COMPLIANCE.md` §4.5 update *(pending)* |

---

## 2. Key Questions for Legal Counsel

1. Does the consent language sufficiently describe hashing, retention, and opt-out?  
2. Are additional disclosures required for APNs/FCM transfers under GDPR/UK GDPR?  
3. Is the 30-day retention justified and documented adequately?  
4. Do we need separate consent for marketing notifications (future scope)?

---

## 3. Requested Actions

- Provide redlines or approval on privacy policy language.  
- Confirm lawful basis rationale and DPIA conclusions.  
- Validate CCPA notice and non-discrimination statements.  
- Approve user-facing copy or request modifications.

---

## 4. Signoff Tracking

| Role | Name | Status | Date |
| --- | --- | --- | --- |
| Privacy Counsel | __________________ | ☐ Approved ☐ Changes Required | ______ |
| Data Protection Officer | __________________ | ☐ Approved ☐ Changes Required | ______ |
| Security Lead | __________________ | ☐ Approved ☐ Changes Required | ______ |

---

## 5. Post-Approval Tasks

- Merge approved policy text into public website CMS.  
- Coordinate announcement (email/in-app) with Comms.  
- Update Privacy Center and help center with final copy.  
- Archive signed PDF in `/compliance/signoffs/2025/LEG-2310.pdf`.
