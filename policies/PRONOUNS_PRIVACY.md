Pronouns and Profile Image Privacy Policy

Purpose
-------
This policy defines how the service treats optional profile metadata (pronouns and profile images) to minimize privacy and compliance risk.

Pronouns
--------
- Treated as optional user-supplied profile metadata. Users may skip adding pronouns at registration and can update later via /profile/pronouns.
- Visibility: pronouns are visible in user-facing profiles but considered low sensitivity. Access to logs and production exports containing pronouns must be restricted and audited.
- Retention: pronouns are retained with the user's account. To delete, users may remove the value via the profile API; retention rules should follow company data retention policies.
- Auditing: audit events "pronouns.set" are emitted on changes. Audit payloads MUST NOT include raw pronouns; instead store a redacted placeholder or metadata (e.g., presence flag). This implementation emits a redacted placeholder in audit metadata.

Profile images
--------------
- The service stores only a pointer `profile_image_url` to an external media service. It never stores or proxies image binaries.
- Visibility: URLs may contain tokens; therefore the service must never emit full URLs in logs or audit events. Audit events can include host or storage provider only.
- Moderation and validation: delegated to the media service. The auth service SHOULD validate URL format but not attempt to download or inspect content.
- Retention: pointer is retained with the account; actual content retention is governed by the media service.

Rate limiting
-------------
- Profile updates are rate-limited using the existing throttling mechanism to mitigate abuse and scraping.

Governance
----------
- Changes to pronouns handling or retention require Product + Privacy approval and an update to this policy document.

