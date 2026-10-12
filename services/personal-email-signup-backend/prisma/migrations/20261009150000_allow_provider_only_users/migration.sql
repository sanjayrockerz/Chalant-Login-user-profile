-- Phase 2B: provider-only accounts do not receive fabricated legacy passwords.
-- Additive/relaxing change: existing password values and PasswordCredential rows remain intact.
BEGIN;
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;
COMMIT;
