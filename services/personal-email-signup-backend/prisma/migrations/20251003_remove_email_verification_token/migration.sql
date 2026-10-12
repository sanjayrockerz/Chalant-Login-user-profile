-- Migration: Remove EmailVerificationToken table and verificationToken column from User
-- Date: 2025-10-03
BEGIN;

-- Drop foreign key relation by dropping the table (if exists)
DROP TABLE IF EXISTS "EmailVerificationToken" CASCADE;

-- Remove the verificationToken column from users table if present
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = '"User"' AND column_name = 'verificationToken') THEN
        ALTER TABLE "User" DROP COLUMN IF EXISTS "verificationToken";
    END IF;
END$$;

COMMIT;
