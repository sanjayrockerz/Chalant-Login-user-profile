# Incident Response Guide — Contacts Import & Push Notifications

**Prepared By:** Incident Management Team  
**Date:** 2025-10-18

---

## 1. Severity Matrix

| Severity | Definition | Examples | Response Goal |
| --- | --- | --- | --- |
| Sev1 (Critical) | Full outage, data breach, privacy incident, notification spam, or regulatory exposure | Contacts upload leaking raw numbers, push tokens exposed, platform unreachable | Page oncall immediately; mitigate within 15 minutes; initiate incident bridge. |
| Sev2 (High) | Error rate >5%, P99 latency >5s, failed cohort rollout | FCM returns 500s, APNs throttling, contact hashing queue backlog causing 429s | Page oncall; mitigation or rollback within 30 minutes. |
| Sev3 (Medium) | Elevated errors (2–5%), partial functionality degradation, high support volume | Contact suggestions delayed, notifications retried repeatedly | Investigate within 1 hour; plan resolution within 24–48 hours. |
| Sev4 (Low) | Cosmetic bugs, documentation gaps | Tooltip copy inaccurate | Triage during business hours. |

---

## 2. Escalation Flow

1. **PagerDuty/Opsgenie Alert** → Primary Oncall.  
2. **Primary Oncall** evaluates severity, opens incident channel (`#inc-contacts-push`).  
3. **Incident Commander** assigned (rotation).  
4. **Engineering SME** (Push Tokens / Contacts) joins call.  
5. **Security/Privacy Liaison** looped in for potential data exposure.  
6. **Comms Lead** notified for user-facing updates when Sev1/Sev2.

Contact list stored in `runbooks/oncall-roster.md`.

---

## 3. Containment & Rollback

- Immediate action for Sev1/Sev2 may include setting feature flags to 0% (see launch plan rollback section).  
- If root cause is provider outage (FCM/APNs), disable affected platform while continuing for healthy platform when feasible.  
- Document timeline in incident notes.

---

## 4. Investigation Checklist

- Review Grafana dashboards (contacts health, push token health).  
- Check Loki for errors (search by correlation ID).  
- Validate Redis queues for backlog.  
- Inspect external provider status pages (status.firebase.google.com, developer.apple.com/system-status).  
- Confirm privacy safeguards (hashing jobs, token redaction) still functioning.

---

## 5. Communication Templates

- **Stakeholder Update (Sev1/Sev2):**
  > "We detected elevated errors in contacts/push notification pipeline. Feature flags rolled back to 0% at 12:05 UTC. Investigating root cause; next update in 30 minutes."

- **User Notification (if required):** prepared by Comms/Support referencing privacy policy sections.

---

## 6. Post-Incident Process

1. Complete incident timeline and impact assessment within 24 hours.  
2. Schedule blameless post-mortem within 48 hours; include cross-functional stakeholders.  
3. Use template `runbooks/post-mortem-template.md` (append contact/push specifics).  
4. Log action items in Jira project `OPS`.  
5. Update runbooks and monitoring based on lessons learned.

---

## 7. Documentation & Audit

- Store incident reports in `/docs/production-readiness/incidents/2025/`.  
- Note regulatory notifications if personal data impacted; involve Legal/Privacy immediately.  
- Review incident metrics during 30-day retrospective.
