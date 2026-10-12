# Policy Change Log

This changelog records every activation or update to the canonical policy version. Each entry must include legal and engineering metadata.

## Changelog entry template
- policy_version: vYYYY-MM-DD-N
- activated_at: 2025-10-07T00:00:00Z
- activated_by: @legal-team (name + email)
- engineering_contact: @eng-oncall (name + email)
- change_summary: Brief description of what changed in the Terms/Privacy
- rationale: Why the update is needed
- public_urls:
  - terms: https://example.com/terms/vYYYY-MM-DD-N
  - privacy: https://example.com/privacy/vYYYY-MM-DD-N
- migration_notes: Any notes about re-consent or user notifications
- audit_proof: Link to signed approval (internal doc or ticket)

## Example entry
- policy_version: v2025-10-07-1
- activated_at: 2025-10-07T00:00:00Z
- activated_by: Jane Legal <jane.legal@example.com>
- engineering_contact: Ops Team <ops@example.com>
- change_summary: Minor clarifications to data retention periods.
- rationale: Align with updated retention guidance.
- public_urls:
  - terms: https://example.com/terms/v2025-10-07-1
  - privacy: https://example.com/privacy/v2025-10-07-1
- migration_notes: Users must re-accept on next login; a notification will be shown for 30 days.
- audit_proof: https://internal.example.com/tickets/42

## Recorded activations

- policy_version: v2025-10-07-1
- activated_at: 2025-10-07T00:00:00Z
- activated_by: Jane Legal <jane.legal@example.com>
- engineering_contact: Ops Team <ops@example.com>
- change_summary: Minor clarifications to data retention periods and updated retention tables.
- rationale: Align with updated legal retention guidance and ensure explicit user consent for retention durations.
- public_urls:
  - terms: https://example.com/terms/v2025-10-07-1
  - privacy: https://example.com/privacy/v2025-10-07-1
- migration_notes: Users must re-accept on next token refresh if active policy is material; ledger created for auditability.
- audit_proof: https://internal.example.com/tickets/42

Add new entries to this file whenever you flip `active_policy_version`.
