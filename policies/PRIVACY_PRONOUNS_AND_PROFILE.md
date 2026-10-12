# Privacy: Pronouns and Profile Image Pointer Handling

Scope

This document describes how pronouns and profile image pointers are treated for privacy and compliance.

Pronouns
- Treated as low-sensitivity user-provided metadata.
- Max length: 64 characters. Trim and limit on ingestion.
- Stored in the user record as provided by the user.
- In audit events and logs, pronouns MUST be redacted by default. Audits may record `pronouns: "[REDACTED]"` and a boolean flag indicating whether pronouns were provided.

Profile image URLs
- The backend stores only a pointer string to the image resource (no image binary storage in the service DB).
- The server must not log full URLs that may contain signed tokens or secrets. Audit events should only include the hostname portion (e.g., `cdn.example.com`) or a boolean "has_image": true/false.
- When publishing audit or debug artifacts, redact query strings and fragments from URLs.

Data retention and deletion
- Pronouns: retained as part of the user profile. Follow general user data retention policy for deletion requests.
- Profile image pointers: retained until user replaces or deletes the pointer. When a deletion request is received, remove the pointer and record audit event.

Access controls
- Pronouns and profile image pointers are accessible to authenticated calls to profile endpoints only and must be protected by proper authorization checks.

Compliance notes
- Document these choices in privacy notices and Data Processing Agreements where necessary.
- Ensure privacy-team has approved the redaction approach for audit events.

