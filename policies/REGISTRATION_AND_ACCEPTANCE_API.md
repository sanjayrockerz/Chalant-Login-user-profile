# Registration & Acceptance API — enforcement of policy_version

This document provides a canonical API pattern for enforcing that user registration includes a `terms_version` that matches the server's `active_policy_version`. It also defines an idempotent acceptance endpoint for authenticated users.

Design goals
- The server maintains a single `active_policy_version` (see `policies/POLICY_REGISTER.md`).
- Registration failing to include the correct `terms_version` is rejected with a clear validation error pointing the client to the acceptance flow.
- Acceptance endpoint records consent for the authenticated user, is idempotent for the same version, and rejects unknown versions.
- API payloads reference only `policy_version` identifiers; the client links to canonical policy content (URLs) outside of the API payload.

API endpoints

1) Registration endpoint (public)

POST /api/register

Request body (JSON):
```json
{
  "email": "user@example.com",
  "password": "s3cure",
  "terms_version": "v2025-10-07-1"
}
```

Behavior:
- Server reads the current `active_policy_version` from config/env (or a service): `ACTIVE_POLICY_VERSION`.
- If `terms_version` is missing or does not equal `ACTIVE_POLICY_VERSION`, the server returns HTTP 400 with a structured error instructing the client to run the acceptance flow first. This error is considered a validation error and uses code `policy_version_mismatch`.
- If versions match, proceed with registration and persist `accepted_policy_version` and `accepted_policy_at` on the user record.

Response (success): 201 Created
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "accepted_policy_version": "v2025-10-07-1",
  "accepted_policy_at": "2025-10-07T12:34:56Z"
}
```

Response (validation error): 400 Bad Request
```json
{
  "code": "policy_version_mismatch",
  "message": "You must accept the active Terms & Privacy (v2025-10-07-1) before registering. Please call POST /api/policies/accept while unauthenticated or use the client acceptance flow.",
  "active_policy_version": "v2025-10-07-1"
}
```

2) Acceptance endpoint (authenticated)

POST /api/policies/accept

Request body (JSON):
```json
{
  "policy_version": "v2025-10-07-1"
}
```

Behavior:
- Requires authentication (user must be logged in).
- Server validates that `policy_version` equals the `ACTIVE_POLICY_VERSION` (reject unknown/stale versions). If the provided `policy_version` is not recognized, return HTTP 400 and `code: "unknown_policy_version"`.
- If the user's `accepted_policy_version` equals the incoming `policy_version`, return 200 OK (idempotent).
- Otherwise, persist `accepted_policy_version` and `accepted_policy_at = now()` and emit an audit event.

Policy-version mismatch on authenticated requests (enforcement semantics):
- When the server is configured with `REQUIRE_TERMS_ENFORCE_MODE=global` or `canary` (and the request's tenant is in the canary list), and the active policy is marked `active_policy_is_material: true` in `policies/POLICY_REGISTER.md`, authentication-protected endpoints MUST enforce re-acceptance.
- Enforcement should be performed at clear authentication lifecycle points (token refresh, protected API entry) and MUST follow these response semantics:
  - If unauthenticated: return 401 Unauthorized as usual.
  - If authenticated but the user's `accepted_policy_version` is missing or older than `ACTIVE_POLICY_VERSION` and enforcement applies for the tenant: return 403 Forbidden with a structured body:

```json
{
  "code": "policy_reaccept_required",
  "message": "You must accept the updated Terms & Privacy (v2025-10-07-1) before continuing. Please call POST /api/policies/accept",
  "active_policy_version": "v2025-10-07-1"
}
```

  - If enforcement does not apply for the tenant (ENFORCE_MODE=off or canary but tenant not in list), do not block the request; log the mismatch and emit an audit event `policy_enforcement_skipped` with tenant and user metadata.

Responses:
- 200 OK (idempotent acceptance)
```json
{ "ok": true, "policy_version": "v2025-10-07-1", "accepted_at": "2025-10-07T12:34:56Z" }
```

- 400 Bad Request (unknown/stale version)
```json
{ "code": "unknown_policy_version", "message": "The policy_version provided is not recognized. Please fetch the latest policy_version from the application or contact support." }
```

- 401 Unauthorized if the user is not authenticated.

Implementation sketch (Node/Express + PostgreSQL)

```ts
// Constants / config
const ACTIVE_POLICY_VERSION = process.env.ACTIVE_POLICY_VERSION || 'v2025-10-07-1';

// Registration handler (simplified)
app.post('/api/register', async (req, res) => {
  const { email, password, terms_version } = req.body;
  if (!terms_version || terms_version !== ACTIVE_POLICY_VERSION) {
    return res.status(400).json({
      code: 'policy_version_mismatch',
      message: `You must accept the active Terms & Privacy (${ACTIVE_POLICY_VERSION}) before registering.`,
      active_policy_version: ACTIVE_POLICY_VERSION
    });
  }

  // proceed with user creation
  const user = await createUser({ email, password, accepted_policy_version: terms_version });
  res.status(201).json(user);
});

// Acceptance endpoint
app.post('/api/policies/accept', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { policy_version } = req.body;
  if (!policy_version || policy_version !== ACTIVE_POLICY_VERSION) {
    return res.status(400).json({ code: 'unknown_policy_version', message: 'The policy_version provided is not recognized.' });
  }

  const user = await db('users').where({ id: userId }).first();
  if (user.accepted_policy_version === policy_version) {
    return res.status(200).json({ ok: true, policy_version, accepted_at: user.accepted_policy_at });
  }

  const accepted_at = new Date().toISOString();
  await db('users').where({ id: userId }).update({ accepted_policy_version: policy_version, accepted_policy_at: accepted_at });
  // write audit event (recommended)
  await db('policy_acceptance_audit').insert({ user_id: userId, policy_version, accepted_at });

  return res.status(200).json({ ok: true, policy_version, accepted_at });
});
```

Notes and best practices
- Keep policy payloads minimal: only send `policy_version` IDs in the API. The client should fetch or link to canonical policy pages independently.
- If you need to show the policy content inline, fetch canonical URLs from a config endpoint, not embed the full text in the API responses.
- Emit audit events for every acceptance for compliance.
- Consider rate-limiting acceptance to prevent replay/flooding; acceptance should be cheap but auditable.

