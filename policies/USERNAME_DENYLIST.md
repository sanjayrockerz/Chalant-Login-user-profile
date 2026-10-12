Reserved Username Governance

Purpose
-------
This document describes the governance process for modifying the service-level reserved username denylist used to prevent impersonation, routing conflicts, and abuse.

Process
-------
- To add/remove names from the denylist, open a PR updating `src/user/username-denylist.ts` and `policies/USERNAME_DENYLIST.md` with justification.
- Include security & product rationale, any telemetry demonstrating need, and an approval ticket from Product + Security.
- Run risk analysis: ensure no existing usernames will be adversely affected; if so, plan migration or communication.
- For high-risk changes (e.g., removing many names), stage rollout using the `REQUIRE_USERNAME_DENYLIST` flag.

Audit and Monitoring
--------------------
- All changes must reference an audit ticket. Each deployment that flips enforcement ON must be accompanied by metrics verification: `username_conflicts_total` and audit events `username.set`.

Rollback
--------
- Revert the PR and redeploy. Consider a compensating action for users blocked during the window.
