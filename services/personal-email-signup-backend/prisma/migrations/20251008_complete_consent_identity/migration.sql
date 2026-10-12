-- Migration: Ensure all consent and identity fields exist with proper constraints
-- Date: 2025-10-08
-- Purpose: Complete terms acceptance and identity capture infrastructure

BEGIN;

-- Ensure terms fields exist (idempotent)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "termsVersion" varchar(64);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" timestamptz;

-- Ensure identity fields exist (idempotent) 
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "displayName" varchar(255);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "declaredAge" integer;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileImageUrl" text;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pronouns" varchar(64);

-- Add constraints for data integrity
DO $$
BEGIN
  -- Age constraint: must be non-negative if provided
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'check_declared_age_non_negative'
  ) THEN
    ALTER TABLE "User" ADD CONSTRAINT check_declared_age_non_negative 
    CHECK ("declaredAge" IS NULL OR "declaredAge" >= 0);
  END IF;

  -- Terms version format constraint (semantic versioning)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'check_terms_version_format'
  ) THEN
    ALTER TABLE "User" ADD CONSTRAINT check_terms_version_format 
    CHECK ("termsVersion" IS NULL OR "termsVersion" ~ '^v[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]+$');
  END IF;

  -- Profile image URL should be valid URL format if provided
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'check_profile_image_url_format'
  ) THEN
    ALTER TABLE "User" ADD CONSTRAINT check_profile_image_url_format 
    CHECK ("profileImageUrl" IS NULL OR "profileImageUrl" ~ '^https?://');
  END IF;
END$$;

-- Create indexes for performance
DO $$
BEGIN
  -- Index on terms version for gating queries
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'idx_user_terms_version' AND n.nspname = 'public'
  ) THEN
    CREATE INDEX idx_user_terms_version ON "User" ("termsVersion", "termsAcceptedAt");
  END IF;

  -- Index on declared age for age gating queries
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'idx_user_declared_age' AND n.nspname = 'public'
  ) THEN
    CREATE INDEX idx_user_declared_age ON "User" ("declaredAge");
  END IF;
END$$;

-- Add comment for audit trail
COMMENT ON COLUMN "User"."termsVersion" IS 'Terms and privacy policy version accepted by user';
COMMENT ON COLUMN "User"."termsAcceptedAt" IS 'Timestamp when user accepted the terms version';
COMMENT ON COLUMN "User"."declaredAge" IS 'Self-declared age for age gating (minimal age assurance)';
COMMENT ON COLUMN "User"."displayName" IS 'User display name for product (not auth identifier)';
COMMENT ON COLUMN "User"."profileImageUrl" IS 'Pointer to external media service, not stored content';
COMMENT ON COLUMN "User"."pronouns" IS 'Optional pronouns for user profile display';

COMMIT;