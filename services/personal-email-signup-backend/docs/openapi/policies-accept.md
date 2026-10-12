# Policies Acceptance OpenAPI Notes

This document supplements the generated OpenAPI spec and explains the acceptance endpoint's possible responses and enforcement semantics.

Endpoint: POST /api/policies/accept
- Auth: Bearer JWT (required)
- Request body: { "policy_version": "vYYYY-MM-DD-N" }

Possible responses:
- 200 OK: acceptance recorded, body `{ ok: true, policy_version, accepted_at }`.
- 400 Bad Request: `code: "unknown_policy_version"` when supplied version is not recognized.
- 401 Unauthorized: when authentication is missing or invalid.
- 403 Forbidden: `code: "policy_reaccept_required"` when the active policy is material and enforcement is active for the tenant; client must call POST /api/policies/accept with the active policy_version before proceeding.

Notes for generation:
- The NestJS controller includes `@ApiOperation` and `@ApiResponse` decorators; the `generate-swagger.ts` script will pick these up and include them in `dist/swagger.json` during CI.
- CI job will produce `dist/swagger.json` which should be archived as an artifact named `openapi-spec`.
