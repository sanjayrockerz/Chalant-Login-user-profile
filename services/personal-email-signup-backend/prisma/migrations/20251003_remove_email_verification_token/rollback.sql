-- Rollback: Recreate EmailVerificationToken table and verificationToken column on User
-- Date: 2025-10-03
BEGIN;

-- Recreate verificationToken column on User (nullable)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = '"User"' AND column_name = 'verificationToken') THEN
        ALTER TABLE "User" ADD COLUMN "verificationToken" text;
    END IF;
END$$;

-- Recreate EmailVerificationToken table
CREATE TABLE IF NOT EXISTS "EmailVerificationToken" (
    id SERIAL PRIMARY KEY,
    "userId" integer UNIQUE NOT NULL,
    token text NOT NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now()
);

-- Reinstate foreign key to User
ALTER TABLE "EmailVerificationToken"
    ADD CONSTRAINT fk_email_verification_user FOREIGN KEY ("userId") REFERENCES "User" (id) ON DELETE CASCADE;

COMMIT;
