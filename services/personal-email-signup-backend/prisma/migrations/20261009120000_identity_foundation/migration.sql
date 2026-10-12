-- Phase 1 identity foundation. Additive only; no legacy users or sessions are migrated.
BEGIN;

DO $$ BEGIN
  CREATE TYPE "UserAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "IdentityProvider" AS ENUM ('PASSWORD', 'GOOGLE', 'APPLE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LegacyIdentitySource" AS ENUM ('R1', 'R2', 'R3');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "accountStatus" "UserAccountStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE IF NOT EXISTS "user_identities" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "provider" "IdentityProvider" NOT NULL,
  "issuer" varchar(255) NOT NULL,
  "subject" varchar(255) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" timestamptz,
  CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_user_identities_issuer_subject" ON "user_identities" ("issuer", "subject");
CREATE INDEX IF NOT EXISTS "idx_user_identities_user" ON "user_identities" ("user_id");

CREATE TABLE IF NOT EXISTS "password_credentials" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "password_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_credentials_user_id_key" UNIQUE ("user_id"),
  CONSTRAINT "password_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "identity_sessions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "session_hash" varchar(128) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  CONSTRAINT "identity_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "identity_sessions_session_hash_key" UNIQUE ("session_hash"),
  CONSTRAINT "identity_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_identity_sessions_user" ON "identity_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_identity_sessions_expires" ON "identity_sessions" ("expires_at");

CREATE TABLE IF NOT EXISTS "legacy_identity_mappings" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "source" "LegacyIdentitySource" NOT NULL,
  "original_id" varchar(255) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legacy_identity_mappings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "legacy_identity_mappings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_legacy_identity_source_original" ON "legacy_identity_mappings" ("source", "original_id");
CREATE INDEX IF NOT EXISTS "idx_legacy_identity_user" ON "legacy_identity_mappings" ("user_id");

COMMIT;
