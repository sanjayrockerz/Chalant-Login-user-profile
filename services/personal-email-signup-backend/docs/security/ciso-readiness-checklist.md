# CISO Security Readiness Checklist

## Application Hardening
- [ ] Helmet middleware with strict CSP deployed (`src/main.ts`)
- [ ] DOMPurify sanitization enforced for user-supplied text (pronouns, contact batch IDs)
- [ ] Raw SQL eliminated or replaced with Prisma query builder
- [ ] Rate limiting + anomaly detection validated (Redis-backed, multi-dimensional guard)

## Testing & Verification
- [ ] Security regression suite (`src/security/security-hardening.spec.ts`) executed
- [ ] Linting, unit, and integration suites clean (`npm run lint`, `npm test`)
- [ ] Dependency audit reviewed (`npm audit`), remediation plan documented
- [ ] Manual exploratory testing on critical flows (auth, contact upload, rate limited endpoints)

## Monitoring & Telemetry
- [ ] Suspicious event metrics wired (`MetricsService.incrementSuspiciousEvent`)
- [ ] Retry-After headers and correlation IDs surfaced on 429 responses
- [ ] Dashboards updated for rate-limit saturation + anomaly signals

## Documentation & Operations
- [ ] Pen-test handoff packet delivered (`docs/security/penetration-test-handoff.md`)
- [ ] Runbooks updated with security controls and escalation paths
- [ ] Change log recorded in `SECURITY_IMPLEMENTATION_SUMMARY.md`
- [ ] Compliance evidence archived (configs, test logs, audit trails)

## Approvals
- [ ] Security Engineering Lead sign-off
- [ ] DevOps Lead sign-off
- [ ] CISO final approval for staging → production promotion
