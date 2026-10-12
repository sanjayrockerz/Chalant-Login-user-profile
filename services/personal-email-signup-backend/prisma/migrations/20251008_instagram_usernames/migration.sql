-- Migration: Instagram-style username rules with case-insensitive uniqueness
-- Date: 2025-10-08
-- Purpose: Implement robust username constraints and normalization for global uniqueness
-- References: Instagram username rules, PostgreSQL citext extension

BEGIN;

-- Enable citext extension for case-insensitive text operations
-- This provides better performance than functional indexes on LOWER()
CREATE EXTENSION IF NOT EXISTS citext;

-- Add username_canonical field for case-insensitive storage and lookups
-- Store the canonical lowercase form for stable comparisons
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username_canonical" citext;

-- Add username change tracking fields for audit and rate limiting
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username_last_changed_at" timestamptz;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username_change_count" integer DEFAULT 0;

-- Populate username_canonical from existing usernames (backfill)
-- This normalizes existing data to lowercase canonical form
UPDATE "User" 
SET "username_canonical" = LOWER("username")
WHERE "username_canonical" IS NULL;

-- Make username_canonical NOT NULL after backfill
ALTER TABLE "User" ALTER COLUMN "username_canonical" SET NOT NULL;

-- Add constraints for Instagram-style username rules
DO $$
BEGIN
  -- Username format constraint: 1-30 characters, alphanumeric + underscore/period only
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'check_username_format'
  ) THEN
    ALTER TABLE "User" ADD CONSTRAINT check_username_format 
    CHECK ("username" ~ '^[a-zA-Z0-9_.]{1,30}$');
  END IF;

  -- Username canonical format constraint: normalized version
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'check_username_canonical_format'
  ) THEN
    ALTER TABLE "User" ADD CONSTRAINT check_username_canonical_format 
    CHECK ("username_canonical" ~ '^[a-z0-9_.]{1,30}$');
  END IF;

  -- Username change rate limiting: prevent excessive changes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'check_username_change_count'
  ) THEN
    ALTER TABLE "User" ADD CONSTRAINT check_username_change_count 
    CHECK ("username_change_count" >= 0 AND "username_change_count" <= 100);
  END IF;
END$$;

-- Drop existing username unique constraint
DROP INDEX IF EXISTS "User_username_key";

-- Create case-insensitive unique constraint on username_canonical
-- This ensures global uniqueness regardless of case
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_canonical_unique" 
ON "User"("username_canonical");

-- Create functional unique index on LOWER(username) as fallback
-- This provides redundant protection in case citext has issues
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_lower_unique" 
ON "User"(LOWER("username"));

-- Create indexes for performance optimization
CREATE INDEX IF NOT EXISTS "User_username_last_changed_at_idx" 
ON "User"("username_last_changed_at") 
WHERE "username_last_changed_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "User_username_change_count_idx" 
ON "User"("username_change_count") 
WHERE "username_change_count" > 0;

-- Create partial index for recently changed usernames (optimization for rate limiting)
CREATE INDEX IF NOT EXISTS "User_recent_username_changes_idx" 
ON "User"("id", "username_last_changed_at") 
WHERE "username_last_changed_at" > NOW() - INTERVAL '30 days';

-- Add comments for documentation
COMMENT ON COLUMN "User"."username_canonical" IS 'Canonical lowercase form of username for case-insensitive uniqueness';
COMMENT ON COLUMN "User"."username_last_changed_at" IS 'Timestamp of last username change for rate limiting';
COMMENT ON COLUMN "User"."username_change_count" IS 'Total count of username changes for abuse prevention';

COMMENT ON INDEX "User_username_canonical_unique" IS 'Ensures global case-insensitive username uniqueness';
COMMENT ON INDEX "User_username_lower_unique" IS 'Fallback uniqueness constraint using functional index';

COMMIT;