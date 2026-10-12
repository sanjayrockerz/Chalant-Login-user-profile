# GDPR & CCPA Compliance Packet — Contacts Import and Push Tokens

**Version:** 1.0 (Draft)  
**Prepared by:** Privacy Engineering & Legal Compliance  
**Date:** 2025-10-18

---

## 1. GDPR Compliance Overview

### 1.1 Lawful Basis Assessment

| Processing Activity | Data Elements | Lawful Basis | Notes |
| --- | --- | --- | --- |
| Contacts import & friend suggestion | Hashed phone numbers, upload timestamp, user ID | **Consent** — GDPR Art. 6(1)(a) | User explicitly initiates upload; consent captured via in-product modal with affirmative action; audit trail stored in `contacts_upload_consent` table. |
| Push notification delivery | Push token, device metadata, tenant ID, failure counts | **Legitimate Interest** — GDPR Art. 6(1)(f) | Necessary to deliver requested notifications; interest balancing documented in DPIA (Section 2). Users can opt out via OS settings/log out. |

### 1.2 Data Subject Rights Mapping

| Right | Endpoint / UX Control | SLA | Implementation Notes |
| --- | --- | --- | --- |
| Access & Portability | `GET /users/me/data` | 30 days (standard) | Returns JSON containing hashed contacts (if any) and active push tokens. |
| Rectification | Re-upload contacts, re-register token | Immediate | Hashes recomputed on new upload; push tokens replaced on re-registration. |
| Erasure | `DELETE /contacts`, `DELETE /push-tokens/unregister` | 30 days (regulatory maximum) — operational target 24 hours | Triggers immediate deletion from primary DB; propagates to cache and backup deletion queue. |
| Restrict Processing | Toggle **Allow Contact Discovery** | Immediate | Prevents inclusion in future suggestion matches. |
| Objection | Support ticket → DPO review | 30 days | Documented workflow for legitimate interest challenges. |
| Automated Decision-Making Transparency | Contacts suggestions only | Immediate | No legal/financial effects; provide explanation in FAQ. |

### 1.3 Data Protection Impact Assessment (Summary)

- **Risks Identified:**
  - Rainbow table re-identification of hashed contacts.  
  - Unauthorized access to push tokens leading to spam notifications.  
  - Logging of raw identifiers.
- **Safeguards Implemented:**
  - Pepper + SHA-256 hashing with rotating pepper (stored in HSM).  
  - Role-based access controls, anomaly detection on high-volume uploads, rate limiting.  
  - Secrets scanning ensures tokens never logged; observability pipelines redact values.  
  - 30-day retention cap with automated deletion job; annual review of retention necessity.  
- **Residual Risk:** Low and acceptable per Risk Committee (meeting 2025-10-12). Follow-up action: annual DPIA refresh or sooner if processing changes.

### 1.4 International Data Transfers

| Provider | Region | Transfer Mechanism | Notes |
| --- | --- | --- | --- |
| AWS (Primary DB, Redis) | EU-West-1, US-East-1 | SCCs & AWS DPA | EU user hashes stored in EU-West; cross-region replication uses SCCs. |
| Google FCM | Global | Google Data Processing Terms + SCCs | Tokens for EU users processed through Google’s EU endpoints when available. |
| Apple APNs | Global | Apple Push Services Agreement | APNs processes tokens globally; tokens are pseudonymous. |

Data Processing Agreements are stored in `legal/vendor-contracts`. Records of processing activity (RoPA) updated in OneTrust entry `#CD-PUSH-2025`.

---

## 2. CCPA Compliance Overview

### 2.1 Notice at Collection

**Language for policy footer & onboarding flows:**
> “We collect phone contacts (hashed) and push notification tokens to provide friend suggestions and notifications. See our updated Privacy Policy for details.”

### 2.2 Data Subject Rights Fulfillment

| Right | Fulfillment Mechanism | Notes |
| --- | --- | --- |
| Right to Know | Support ticket intake + `GET /users/me/data` | Provide categories, purposes, retention timelines. |
| Right to Delete | `DELETE /contacts` + `DELETE /push-tokens/unregister` | Automatic; confirm completion via email within 10 days. |
| Right to Opt-Out of Sale | Not applicable | Data not sold; language added to policy. |
| Right to Non-Discrimination | Feature parity maintained regardless of participation; QA sign-off recorded in launch checklist. |
| Right to Correct | Same as rectification under GDPR. |

### 2.3 Retention & Backups

- Primary systems purge hashed contacts after 30 days; push tokens expire after 30 days of inactivity or logout.  
- Disaster recovery backups retain data for 30 additional days; access restricted to incident response, with deletion logs retained for auditing.

### 2.4 Recordkeeping

- Maintain logs of CCPA requests and fulfillment in Zendesk tag `CCPA`.  
- Annual training updated to include new data flows.  
- Update data inventory spreadsheet with new categories (`Identifiers`, `Internet Activity`).

---

## 3. User-Facing Controls & Transparency

- Consent modal copy and checklist referenced in user-facing copy doc (`user-facing-copy-contacts-push.md`).  
- Privacy Center updated with toggles and deletion buttons; QA ensures functionally accessible (WCAG AA).

---

## 4. Legal Review & Signoff Workflow

1. Deliver this packet with data flow diagram to Legal (Ticket LEG-2310).  
2. Capture edits and redlines in change log (Appendix A).  
3. Obtain DPO approval and upload signed PDF to compliance vault (`/compliance/signoffs/2025/LEG-2310.pdf`).  
4. Record signoff date in launch checklist prior to enabling feature flags.

---

## Appendix A — Change Log

| Date | Author | Description |
| --- | --- | --- |
| 2025-10-18 | Privacy Engineering | Initial draft for legal review |
