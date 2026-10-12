-- Rollback: Instagram-style username rules migration
-- Date: 2025-10-08
-- Purpose: Safely rollback username constraints and normalization

BEGIN;

-- Drop new indexes
DROP INDEX IF EXISTS "User_recent_username_changes_idx";
DROP INDEX IF EXISTS "User_username_change_count_idx";
DROP INDEX IF EXISTS "User_username_last_changed_at_idx";
DROP INDEX IF EXISTS "User_username_lower_unique";
DROP INDEX IF EXISTS "User_username_canonical_unique";

-- Drop new constraints
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS check_username_change_count;
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS check_username_canonical_format;
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS check_username_format;

-- Remove new columns
ALTER TABLE "User" DROP COLUMN IF EXISTS "username_change_count";
ALTER TABLE "User" DROP COLUMN IF EXISTS "username_last_changed_at";
ALTER TABLE "User" DROP COLUMN IF EXISTS "username_canonical";

-- Restore original unique constraint on username
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

-- Note: We do not drop the citext extension as it might be used elsewhere
-- DROP EXTENSION IF EXISTS citext;

COMMIT;