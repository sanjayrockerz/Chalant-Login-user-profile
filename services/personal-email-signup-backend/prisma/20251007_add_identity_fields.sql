-- Migration: add identity pointer fields to users table
-- Adds: display_name (varchar), declared_age (int), profile_image_url (varchar), pronouns (varchar)
-- This file is intended as a safe, idempotent SQL migration to be applied in CI or dev.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='"User"' AND column_name='displayName'
  ) THEN
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "displayName" varchar(255);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='"User"' AND column_name='declaredAge'
  ) THEN
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "declaredAge" integer;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='"User"' AND column_name='profileImageUrl'
  ) THEN
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileImageUrl" varchar(1024);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='"User"' AND column_name='pronouns'
  ) THEN
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pronouns" varchar(255);
  END IF;
END$$;

-- Create an index on declaredAge for faster queries; use IF NOT EXISTS by checking pg_class
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'idx_user_declared_age'
  ) THEN
    CREATE INDEX idx_user_declared_age ON "User" ("declaredAge");
  END IF;
END$$;

-- End migration
-- Add optional identity fields: display_name, declared_age, profile_image_url, pronouns
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS display_name varchar(255);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS declared_age integer;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS profile_image_url text;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS pronouns varchar(64);

-- Add indexes for quick lookup if needed
CREATE INDEX IF NOT EXISTS idx_user_declared_age ON "User" (declared_age);
