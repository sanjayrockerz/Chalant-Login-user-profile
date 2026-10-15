-- Migration: convert int-backed identifiers to UUIDs for auth schema
-- Date: 2025-05-21
-- This migration upgrades the existing integer identifiers for users and
-- their dependent relations to UUID columns so Prisma and TypeORM share the
-- same identifier strategy.

BEGIN;

-- Ensure we can generate UUID values
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Bootstrap UUID identifiers for users
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "id_uuid" uuid;
UPDATE "User" SET "id_uuid" = gen_random_uuid() WHERE "id_uuid" IS NULL;
ALTER TABLE "User" ALTER COLUMN "id_uuid" SET DEFAULT gen_random_uuid();
ALTER TABLE "User" ALTER COLUMN "id_uuid" SET NOT NULL;

-- 2. Refresh tokens pivot to UUID foreign keys
ALTER TABLE "RefreshToken" DROP CONSTRAINT IF EXISTS "RefreshToken_userId_fkey";
ALTER TABLE "RefreshToken" ADD COLUMN IF NOT EXISTS "userId_uuid" uuid;
UPDATE "RefreshToken" rt
SET "userId_uuid" = u."id_uuid"
FROM "User" u
WHERE rt."userId" = u."id";
ALTER TABLE "RefreshToken" ALTER COLUMN "userId_uuid" SET NOT NULL;
ALTER TABLE "RefreshToken" DROP COLUMN IF EXISTS "userId";
ALTER TABLE "RefreshToken" RENAME COLUMN "userId_uuid" TO "userId";
ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Hashed contacts reference UUID user ids
DROP INDEX IF EXISTS idx_hashed_contacts_user_id;
DROP INDEX IF EXISTS uniq_hashed_contacts_user_phone;
ALTER TABLE hashed_contacts DROP CONSTRAINT IF EXISTS hashed_contacts_user_id_fkey;
ALTER TABLE hashed_contacts ADD COLUMN IF NOT EXISTS user_id_uuid uuid;
UPDATE hashed_contacts hc
SET user_id_uuid = u."id_uuid"
FROM "User" u
WHERE hc.user_id = u."id";
ALTER TABLE hashed_contacts ALTER COLUMN user_id_uuid SET NOT NULL;
ALTER TABLE hashed_contacts DROP COLUMN IF EXISTS user_id;
ALTER TABLE hashed_contacts RENAME COLUMN user_id_uuid TO user_id;
ALTER TABLE hashed_contacts
  ADD CONSTRAINT hashed_contacts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES "User"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hashed_contacts_user_phone ON hashed_contacts (user_id, hashed_phone);
CREATE INDEX IF NOT EXISTS idx_hashed_contacts_user_id ON hashed_contacts (user_id);

-- 4. Contact suggestions now store UUID foreign keys
DROP INDEX IF EXISTS uniq_contact_suggestions_pair;
DROP INDEX IF EXISTS idx_contact_suggestions_user;
DROP INDEX IF EXISTS idx_contact_suggestions_user_match_type;
DROP INDEX IF EXISTS idx_contact_suggestions_suggested_user;
ALTER TABLE contact_suggestions DROP CONSTRAINT IF EXISTS contact_suggestions_user_id_fkey;
ALTER TABLE contact_suggestions DROP CONSTRAINT IF EXISTS contact_suggestions_suggested_user_id_fkey;
ALTER TABLE contact_suggestions ADD COLUMN IF NOT EXISTS user_id_uuid uuid;
ALTER TABLE contact_suggestions ADD COLUMN IF NOT EXISTS suggested_user_id_uuid uuid;
UPDATE contact_suggestions cs
SET user_id_uuid = u."id_uuid"
FROM "User" u
WHERE cs.user_id = u."id";
UPDATE contact_suggestions cs
SET suggested_user_id_uuid = u."id_uuid"
FROM "User" u
WHERE cs.suggested_user_id = u."id";
ALTER TABLE contact_suggestions ALTER COLUMN user_id_uuid SET NOT NULL;
ALTER TABLE contact_suggestions ALTER COLUMN suggested_user_id_uuid SET NOT NULL;
ALTER TABLE contact_suggestions DROP COLUMN IF EXISTS user_id;
ALTER TABLE contact_suggestions DROP COLUMN IF EXISTS suggested_user_id;
ALTER TABLE contact_suggestions RENAME COLUMN user_id_uuid TO user_id;
ALTER TABLE contact_suggestions RENAME COLUMN suggested_user_id_uuid TO suggested_user_id;
ALTER TABLE contact_suggestions
  ADD CONSTRAINT contact_suggestions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES "User"("id") ON DELETE CASCADE;
ALTER TABLE contact_suggestions
  ADD CONSTRAINT contact_suggestions_suggested_user_id_fkey
  FOREIGN KEY (suggested_user_id) REFERENCES "User"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contact_suggestions_pair ON contact_suggestions (user_id, suggested_user_id);
CREATE INDEX IF NOT EXISTS idx_contact_suggestions_user ON contact_suggestions (user_id);
CREATE INDEX IF NOT EXISTS idx_contact_suggestions_user_match_type ON contact_suggestions (user_id, match_type);
CREATE INDEX IF NOT EXISTS idx_contact_suggestions_suggested_user ON contact_suggestions (suggested_user_id);

-- 5. Blocks table (composite primary key) switches to UUIDs
DROP INDEX IF EXISTS idx_blocks_blocker;
DROP INDEX IF EXISTS idx_blocks_blocked;
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_pkey;
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_blocker_id_fkey;
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_blocked_id_fkey;
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS blocker_id_uuid uuid;
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS blocked_id_uuid uuid;
UPDATE blocks b
SET blocker_id_uuid = u."id_uuid"
FROM "User" u
WHERE b.blocker_id = u."id";
UPDATE blocks b
SET blocked_id_uuid = u."id_uuid"
FROM "User" u
WHERE b.blocked_id = u."id";
ALTER TABLE blocks ALTER COLUMN blocker_id_uuid SET NOT NULL;
ALTER TABLE blocks ALTER COLUMN blocked_id_uuid SET NOT NULL;
ALTER TABLE blocks DROP COLUMN IF EXISTS blocker_id;
ALTER TABLE blocks DROP COLUMN IF EXISTS blocked_id;
ALTER TABLE blocks RENAME COLUMN blocker_id_uuid TO blocker_id;
ALTER TABLE blocks RENAME COLUMN blocked_id_uuid TO blocked_id;
ALTER TABLE blocks
  ADD CONSTRAINT blocks_pkey PRIMARY KEY (blocker_id, blocked_id);
ALTER TABLE blocks
  ADD CONSTRAINT blocks_blocker_id_fkey
  FOREIGN KEY (blocker_id) REFERENCES "User"("id") ON DELETE CASCADE;
ALTER TABLE blocks
  ADD CONSTRAINT blocks_blocked_id_fkey
  FOREIGN KEY (blocked_id) REFERENCES "User"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks (blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked_id);

-- 6. Push tokens use UUID identifiers and FKs
DROP INDEX IF EXISTS idx_push_tokens_user;
DROP INDEX IF EXISTS uniq_push_token_user_token_platform;
ALTER TABLE push_tokens DROP CONSTRAINT IF EXISTS push_tokens_pkey;
ALTER TABLE push_tokens DROP CONSTRAINT IF EXISTS push_tokens_user_id_fkey;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS id_uuid uuid;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS user_id_uuid uuid;
UPDATE push_tokens SET id_uuid = COALESCE(id_uuid, gen_random_uuid());
UPDATE push_tokens pt
SET user_id_uuid = u."id_uuid"
FROM "User" u
WHERE pt.user_id = u."id";
ALTER TABLE push_tokens ALTER COLUMN id_uuid SET NOT NULL;
ALTER TABLE push_tokens ALTER COLUMN id_uuid SET DEFAULT gen_random_uuid();
ALTER TABLE push_tokens ALTER COLUMN user_id_uuid SET NOT NULL;
ALTER TABLE push_tokens DROP COLUMN IF EXISTS id;
ALTER TABLE push_tokens DROP COLUMN IF EXISTS user_id;
ALTER TABLE push_tokens RENAME COLUMN id_uuid TO id;
ALTER TABLE push_tokens RENAME COLUMN user_id_uuid TO user_id;
ALTER TABLE push_tokens
  ADD CONSTRAINT push_tokens_pkey PRIMARY KEY (id);
ALTER TABLE push_tokens
  ADD CONSTRAINT push_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES "User"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_push_token_user_token_platform ON push_tokens (user_id, token, platform);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens (user_id);

-- 7. Finalize user table changes
-- EmailVerificationToken is removed by the next migration, but its legacy
-- integer FK must be detached before replacing User.id.
ALTER TABLE "EmailVerificationToken"
  DROP CONSTRAINT IF EXISTS "EmailVerificationToken_userId_fkey";
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE confrelid = '"User"'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.table_name, fk.conname);
  END LOOP;
END $$;
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_pkey";
ALTER TABLE "User" DROP COLUMN IF EXISTS "id";
ALTER TABLE "User" RENAME COLUMN "id_uuid" TO "id";
ALTER TABLE "User" ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");

-- Clean up orphaned sequences from SERIAL columns
DROP SEQUENCE IF EXISTS "User_id_seq";
DROP SEQUENCE IF EXISTS push_tokens_id_seq;

COMMIT;
