# Policy Register — Canonical Terms & Privacy

This register records the canonical, single active policy_version identifiers for the repository and maps them to publicly hosted Terms and Privacy content.

Active policy_version
- active_policy_version: v2025-10-07-1
- canonical_terms_url: https://example.com/terms/v2025-10-07-1
- canonical_privacy_url: https://example.com/privacy/v2025-10-07-1
- activated_at: 2025-10-07T00:00:00Z
- activated_by: @legal-team
 - active_policy_is_material: true   # Set to true if this is a material update that must block until re-acceptance

Notes
- The `active_policy_version` is a single string that represents the authoritative combined policy content users must accept.
- Use the activation procedure to flip `active_policy_version` only after the hosted content is live and accessible.
