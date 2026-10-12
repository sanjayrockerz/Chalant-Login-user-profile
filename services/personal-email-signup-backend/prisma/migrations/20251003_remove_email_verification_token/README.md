Remove legacy EmailVerificationToken model and verificationToken column from User

Why:
- The project is migrating from link-based verification tokens to a Redis-backed OTP flow. The legacy database artifacts are no longer needed and should be removed to reduce surface area.

How this migration works:
- migration.sql drops the "EmailVerificationToken" table (if present) and removes the "verificationToken" column from the "User" table.
- rollback.sql recreates the column and table and the FK constraint for safe rollback.

Important safety steps BEFORE running this migration in production:
1. Take a full database backup (logical/physical) and verify restore steps.
2. Ensure a monitoring window and plan for rollback if errors occur.
3. Confirm that the legacy link-based verification endpoint is disabled and no users rely on it.
4. Run migration in a staging environment and validate application behavior.

Rollback steps:
1. If migration causes issues, run the rollback SQL in rollback.sql to recreate schema.
2. Restore data from backup if necessary (tokens are ephemeral; if you need to preserve them, export them before running the migration).

Notes:
- The rollback recreates the table/column structure but not the row data. If row-level preservation is required, export the content of EmailVerificationToken before applying the migration.
