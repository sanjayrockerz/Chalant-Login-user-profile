# Privacy & Compliance Addendum

## Policy Updates
- Updated Privacy Policy section 3.5 to clarify hashed storage and 30-day retention (legal ticket LEG-1827).
- Terms of Service appendix references contact discovery opt-in for EU/UK regions.
- Added consent checkbox copy in mobile onboarding: "I agree to share hashed versions of my contacts for friend suggestions".

## DPIA Summary
- **Scope**: processing hashed phone numbers for discovery.
- **Lawful basis**: explicit consent; opt-in only.
- **Data minimization**: only SHA-256 hashes + metadata (upload time, user ID). No plain phone numbers.
- **Risk assessment**: primary risk is re-identification via brute-force; mitigated by rate limits, TLS, RBAC, monitoring.
- **Residual risk**: low; DPIA signed off by DPO on 2024-10-10.

## User Controls
- Opt-in toggle in settings `Settings > Privacy > Contact Discovery` (off by default).
- "Delete synced contacts" action triggers API `DELETE /v1/contacts` and erases suggestions.
- Users notified weekly via in-app banner until feature launched globally.

## Messaging & Localization
- English: "We use hashed phone numbers to suggest friends. You can delete them anytime."
- Spanish (es-ES): "Usamos números de teléfono con hash para sugerir amigos. Puedes borrarlos cuando quieras." (localization vetted).
- Additional locales tracked in L10N ticket L10N-441.

## Auditing
- Access logging stored in BigQuery dataset `contact_discovery_audit` with 90-day retention.
- Quarterly access review by Security Ops; report template in `docs/security/ACCESS_REVIEW_TEMPLATE.md`.

## Legal Contacts
- Privacy counsel: priya.singh@colleging.com
- DPO: dpo@colleging.com
- Security lead: sec-lead@colleging.com
