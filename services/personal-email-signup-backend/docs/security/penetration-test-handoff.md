# Penetration Test Handoff Packet

## Scope Overview
- Service: Personal Email Signup Backend (`services/personal-email-signup-backend`)
- Deployment Target: Staging (us-west), identical configuration to production minus third-party API keys
- Primary Modules In Scope: Auth flows, username APIs, profile management, contacts upload, rate limiting, Redis-backed anomaly detection

## Environment Checklist
- [ ] Deploy latest `main` build with security hardening patches (helmet+CSP, DOMPurify sanitization, Redis rate-limiter)
- [ ] Enable verbose request/response logging (masking secrets) for pen-test IP ranges
- [ ] Provision dedicated Redis and Postgres instances with constrained credentials
- [ ] Seed baseline tenants and user fixtures (fixtures script: `npm run db:seed`)
- [ ] Configure webhook sinks and alerting for `abuse_suspicious_events_total`

## Test Artifacts
- Automated security regression suite: `npm test -- security-hardening.spec.ts`
- Rate-limit stress harness: `test/security/security-hardening.spec.ts` (Redis stub + controller assertions)
- Static analysis: `npm run lint`, `npm run secrets:scan`
- Dependency audit snapshot: `npm audit` (include log in handoff bundle)

## Data Handling Notes
- No real customer data required; use generated fixtures only
- Contacts upload expects hashed phone storage only; raw phone numbers never persist
- All OTP/password flows rely on test SMTP sandbox (credentials in `.env.test`)

## Reporting & Communication
- Primary Contact: Security Engineering (security-eng@company.example)
- Slack Channel: `#auth-penetration-test`
- Expected Deliverables: Executive summary, vuln details with CVSS, reproduction steps, mitigation guidance
- SLA Targets: Critical findings triaged within 24h, high severity within 3 business days

## Supporting Materials
- API reference: `docs/openapi/personal-email-signup-openapi.yaml`
- Runbooks: `docs/runbooks/` (rate limiting, Redis operations)
- Observability Dashboards: `docs/observability/metrics.md`

## Sign-off Checklist
- [ ] Security tests passing in CI
- [ ] Helm chart/Manifest updated with CSP headers
- [ ] Monitoring alerts verified (Grafana dashboard `auth-security`)
- [ ] Incident response runbook shared with pen-test vendor
