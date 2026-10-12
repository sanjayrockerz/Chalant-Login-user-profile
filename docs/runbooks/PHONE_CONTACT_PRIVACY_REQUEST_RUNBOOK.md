# Runbook: Privacy Requests (Contact Discovery)

## Scope
- GDPR/CCPA data deletion requests referencing phone contacts or suggestions.

## Steps
1. Verify request authenticity via Trust & Safety ticket (includes user ID & request ID).
2. Run API call `DELETE /v1/contacts` impersonating user (admin token). Confirm 204.
3. Execute cleanup job in targeted mode:
   - `npm run job:prune-hashed-contacts -- --userId=<id>`.
4. Delete suggestions:
   - `DELETE FROM contact_suggestions WHERE user_id = $1 OR suggested_user_id = $1;`
5. Confirm `hashed_contacts` has zero rows for user:
   - `SELECT COUNT(*) FROM hashed_contacts WHERE user_id = $1;`
6. Log completion notes in Trust & Safety ticket.

## SLA
- Complete within 7 days (preferably <48 h).

## Escalation
- Privacy lead (priyaa.singh@colleging.com) if DSR backlog > 20.
