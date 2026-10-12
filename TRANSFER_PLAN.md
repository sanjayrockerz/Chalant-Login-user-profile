# Transfer plan for login-page-back (and related services)

Purpose: document ownership, who will initiate repository transfers (if needed), and fallback options when transfers aren't possible. This covers `login-page-back` and `personal-email-signup-backend` migration into the monorepo.

## Primary transfer path
1. Target Organization: `acme-auth-org` (replace with your org name).
2. Initiator: Current repository owner (`@login-owner`) will initiate a repository transfer via GitHub UI -> Settings -> Transfer repository. The initiator must be an owner of the source repo.
3. Required confirmations:
   - Confirm the target org `acme-auth-org` allows repository transfers into it (org owner or admin confirmation).
   - Ensure the transfer does not violate any org naming or repository policy.
4. Post-transfer actions:
   - Add service owner teams to the repo with appropriate permissions (write/admin) in the org.
   - Update repository settings: branch protection, required reviewers, and CI hooks to point to monorepo if needed.

## Fallback path (if transfer not available)
1. Create a fork or keep the source repo in-place and continue using `git subtree` to import into the monorepo.
2. If the source repo is private and cannot be transferred, create a read-only mirror or a new empty repo in the target org and push the filtered clone as an initial import; mark the original as deprecated.
3. Document the fallback in the upstream `README` pointing to the monorepo.

## Roles & responsibilities
- Initiator: `@login-owner` (current repo admin)
- Target org admin: `@org-admin` (to accept transfer and set policies)
- Release engineering: `ops@example.com` (coordinate subtree pulls and CI mappings)
- Service owners: `@login-team`, `@signup-team` (code reviewers and approvers)

## Timing
- Coordinate transfers with the freeze date in `RUNBOOK_SUBTREE_SYNC.md` (freeze: 2025-10-21 23:59 UTC).

## Notes
- Transfers can only be accepted by organization owners or repo admins with transfer rights. Confirm with org admin prior to starting.
- After a transfer, update any deployment credentials or webhooks with the new repo location.
