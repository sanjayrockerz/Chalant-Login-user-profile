-- Forward-only legacy upgrade rehearsal for disposable integer-backed schemas.
-- The historical Prisma migration is retained as evidence and is not replayed:
-- it adds child UUID FKs before swapping User.id.
BEGIN;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
DECLARE fk RECORD;
BEGIN
  FOR fk IN
    SELECT conrelid::regclass AS table_name, conname
    FROM pg_constraint
    WHERE contype = 'f' AND confrelid = '"User"'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.table_name, fk.conname);
  END LOOP;
END $$;

ALTER TABLE "User" ADD COLUMN id_uuid uuid;
UPDATE "User" SET id_uuid = gen_random_uuid() WHERE id_uuid IS NULL;
ALTER TABLE "User" ALTER COLUMN id_uuid SET NOT NULL;

ALTER TABLE "RefreshToken" ADD COLUMN user_id_uuid uuid;
UPDATE "RefreshToken" c SET user_id_uuid = p.id_uuid FROM "User" p WHERE c."userId" = p.id;
ALTER TABLE "RefreshToken" ALTER COLUMN user_id_uuid SET NOT NULL;
ALTER TABLE "RefreshToken" DROP COLUMN "userId";
ALTER TABLE "RefreshToken" RENAME COLUMN user_id_uuid TO "userId";

ALTER TABLE hashed_contacts ADD COLUMN user_id_uuid uuid;
UPDATE hashed_contacts c SET user_id_uuid = p.id_uuid FROM "User" p WHERE c.user_id = p.id;
ALTER TABLE hashed_contacts ALTER COLUMN user_id_uuid SET NOT NULL;
ALTER TABLE hashed_contacts DROP COLUMN user_id;
ALTER TABLE hashed_contacts RENAME COLUMN user_id_uuid TO user_id;

ALTER TABLE contact_suggestions ADD COLUMN user_id_uuid uuid, ADD COLUMN suggested_user_id_uuid uuid;
UPDATE contact_suggestions c SET user_id_uuid = p.id_uuid FROM "User" p WHERE c.user_id = p.id;
UPDATE contact_suggestions c SET suggested_user_id_uuid = p.id_uuid FROM "User" p WHERE c.suggested_user_id = p.id;
ALTER TABLE contact_suggestions ALTER COLUMN user_id_uuid SET NOT NULL;
ALTER TABLE contact_suggestions ALTER COLUMN suggested_user_id_uuid SET NOT NULL;
ALTER TABLE contact_suggestions DROP COLUMN user_id, DROP COLUMN suggested_user_id;
ALTER TABLE contact_suggestions RENAME COLUMN user_id_uuid TO user_id;
ALTER TABLE contact_suggestions RENAME COLUMN suggested_user_id_uuid TO suggested_user_id;

ALTER TABLE blocks ADD COLUMN blocker_id_uuid uuid, ADD COLUMN blocked_id_uuid uuid;
UPDATE blocks c SET blocker_id_uuid = p.id_uuid FROM "User" p WHERE c.blocker_id = p.id;
UPDATE blocks c SET blocked_id_uuid = p.id_uuid FROM "User" p WHERE c.blocked_id = p.id;
ALTER TABLE blocks ALTER COLUMN blocker_id_uuid SET NOT NULL;
ALTER TABLE blocks ALTER COLUMN blocked_id_uuid SET NOT NULL;
ALTER TABLE blocks DROP CONSTRAINT blocks_pkey, DROP COLUMN blocker_id, DROP COLUMN blocked_id;
ALTER TABLE blocks RENAME COLUMN blocker_id_uuid TO blocker_id;
ALTER TABLE blocks RENAME COLUMN blocked_id_uuid TO blocked_id;
ALTER TABLE blocks ADD CONSTRAINT blocks_pkey PRIMARY KEY (blocker_id, blocked_id);

ALTER TABLE push_tokens ADD COLUMN user_id_uuid uuid;
UPDATE push_tokens c SET user_id_uuid = p.id_uuid FROM "User" p WHERE c.user_id = p.id;
ALTER TABLE push_tokens ALTER COLUMN user_id_uuid SET NOT NULL;
ALTER TABLE push_tokens DROP COLUMN user_id;
ALTER TABLE push_tokens RENAME COLUMN user_id_uuid TO user_id;

ALTER TABLE "User" DROP CONSTRAINT "User_pkey";
ALTER TABLE "User" DROP COLUMN id;
ALTER TABLE "User" RENAME COLUMN id_uuid TO id;
ALTER TABLE "User" ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);
DROP SEQUENCE IF EXISTS "User_id_seq";

ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User" (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE hashed_contacts ADD CONSTRAINT hashed_contacts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES "User" (id) ON DELETE CASCADE;
ALTER TABLE contact_suggestions ADD CONSTRAINT contact_suggestions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES "User" (id) ON DELETE CASCADE;
ALTER TABLE contact_suggestions ADD CONSTRAINT contact_suggestions_suggested_user_id_fkey
  FOREIGN KEY (suggested_user_id) REFERENCES "User" (id) ON DELETE CASCADE;
ALTER TABLE blocks ADD CONSTRAINT blocks_blocker_id_fkey
  FOREIGN KEY (blocker_id) REFERENCES "User" (id) ON DELETE CASCADE;
ALTER TABLE blocks ADD CONSTRAINT blocks_blocked_id_fkey
  FOREIGN KEY (blocked_id) REFERENCES "User" (id) ON DELETE CASCADE;
ALTER TABLE push_tokens ADD CONSTRAINT push_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES "User" (id) ON DELETE CASCADE;
COMMIT;
