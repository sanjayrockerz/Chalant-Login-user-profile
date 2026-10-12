# Username Denylist Governance

Purpose

Defines the process for proposing, reviewing, approving, and applying updates to the repository of reserved usernames (denylist). The denylist is used to protect routing, legal, and brand safety concerns.

Roles
- Submitter: any engineer or product manager who proposes a name
- Owners: platform-security, product-identity
- Approvers: platform-security lead and legal/privacy reviewer

Proposal process
1. Create a PR against `policies/USERNAME_DENYLIST.md` or `src/user/username-denylist.ts` that lists proposed additions and rationale.
2. Provide supporting evidence: domain confusion risk, impersonation, brand ownership, legal takedown, or security incident.
3. At least two approvers (platform-security lead and product owner) must approve.

Small vs Large changes
- Small change: ≤ 10 entries. Can be applied via a normal PR with 48h review window.
- Large change: > 10 entries or bulk updates. Requires a 7-day review period and an announcement to stakeholders.

Audit and communication
- Every denylist update must include an entry in `policies/POLICY_REGISTER.md` with the change brief and the approving signatures.
- For public-facing changes, coordinate with PR/Community teams.

Rollback
- If denylist update causes significant user-facing regressions (verified by canary metrics), revert the change and open investigation ticket.

Periodic review
- Denylist must be reviewed quarterly for relevance and false positives.

