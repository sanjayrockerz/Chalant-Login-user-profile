# Contacts Import & Push Notifications — Go-Live Checklist

**Launch Window:** November 2025  
**Release Manager:** __________________  
**Last Updated:** 2025-10-18

| # | Item | Owner | Status | Signoff |
| --- | --- | --- | --- | --- |
| 1 | Feature flags `enable_contacts_upload`, `enable_push_tokens` present in production config with percentage = 0 | Platform Eng | ☐ | |
| 2 | Toggling flags (0 → 5 → 25 → 100%) validated in staging | Platform Eng | ☐ | |
| 3 | Database migrations (contacts hashes, push_tokens fields) applied in production | DB Ops | ☐ | |
| 4 | Rollback procedure tested (flags to 0%) and documented | Release Eng | ☐ | |
| 5 | Rate limiting thresholds exercised in staging (100 uploads/sec, 1000 token regs/sec) | SRE | ☐ | |
| 6 | Observability dashboards verified (Prometheus, Grafana, Loki, Tempo) | Observability | ☐ | |
| 7 | Alert policies tested via PagerDuty/Opsgenie (critical, warning, info) | Oncall Lead | ☐ | |
| 8 | Privacy policy update approved & scheduled (see LEG-2310) | Legal | ☐ | |
| 9 | Security review & pen test signoff received | Security Lead | ☐ | |
|10 | Mobile clients (iOS/Android) tested end-to-end in staging | Mobile QA | ☐ | |
|11 | Runbooks finalized (token failures, contacts errors, rate limit tuning) | Support Ops | ☐ | |
|12 | Load test results meet targets (P99 < 2s, error < 1%) | Performance Eng | ☐ | |
|13 | Disaster recovery drills include contacts/push data | SRE | ☐ | |
|14 | Privacy notices & help center content published | Comms + Support | ☐ | |
|15 | Legal signoff document filed (`CD-PUSH-2025-signed.pdf`) | Compliance | ☐ | |
|16 | Go/No-Go meeting minutes captured with approvals | Release Manager | ☐ | |
|17 | Backout/rollback command snippets validated (`redis-cli` + admin panel) | Release Eng | ☐ | |
|18 | Production change tickets opened (feature flags, config) | Change Mgmt | ☐ | |
|19 | Oncall schedule updated for launch window | Incident Mgmt | ☐ | |
|20 | Post-launch monitoring plan distributed to stakeholders | Release Manager | ☐ | |

**All items must be marked complete before entering canary rollout.**
