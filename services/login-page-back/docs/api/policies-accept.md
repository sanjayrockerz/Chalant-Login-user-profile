# /api/policies/accept

Authenticated endpoint to record user acceptance of the active policy.

- Method: POST
- Path: /api/policies/accept
- Auth: Bearer JWT (requires req.user.id populated)

Request body:
```json
{ "policy_version": "vYYYY-MM-DD-N" }
```

Responses:
- 200 OK: `{ "ok": true, "policy_version": "vYYYY-MM-DD-N", "accepted_at": "2025-10-07T12:34:56Z" }` (idempotent)
- 400 Bad Request: `code: "unknown_policy_version"` when the supplied policy_version is not recognized
- 401 Unauthorized: when authentication is missing/invalid
- 403 Forbidden: `code: "policy_reaccept_required"` when `active_policy_is_material` is true and the tenant is within enforcement scope; client must call POST /api/policies/accept to re-accept before continuing

Notes:
- The server persists `terms_version` and `terms_accepted_at` on the user record and appends to `policy_acceptance_history` when appropriate.
- Acceptance events emit `legal.accept` audit events and increment `terms_accepted_total` metric when Prometheus is enabled.
