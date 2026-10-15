-- Repair the two historical migrations that were ordered before the schema.
-- The following UUID migration upgrades these foreign keys as needed.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "phone" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "phone_verified_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "hashed_phone" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "idx_user_email_verification"
  ON "User"("email", "verificationToken")
  WHERE "verificationToken" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_email_verification_token_lookup"
  ON "EmailVerificationToken"("token");
CREATE INDEX IF NOT EXISTS "idx_refresh_token_lookup"
  ON "RefreshToken"("token");
CREATE INDEX IF NOT EXISTS "idx_email_verification_created_at"
  ON "EmailVerificationToken"("createdAt");
CREATE INDEX IF NOT EXISTS "idx_refresh_token_created_at"
  ON "RefreshToken"("createdAt");
CREATE INDEX IF NOT EXISTS "idx_user_verified_status"
  ON "User"("isVerified");
CREATE INDEX IF NOT EXISTS "idx_users_hashed_phone"
  ON "User"("hashed_phone");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_key') THEN
    ALTER TABLE "User" ADD CONSTRAINT "users_phone_key" UNIQUE ("phone");
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hashed_contacts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  hashed_phone VARCHAR(64) NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hashed_contacts_user_phone
  ON hashed_contacts (user_id, hashed_phone);
CREATE INDEX IF NOT EXISTS idx_hashed_contacts_hashed_phone ON hashed_contacts (hashed_phone);
CREATE INDEX IF NOT EXISTS idx_hashed_contacts_user_id ON hashed_contacts (user_id);
CREATE INDEX IF NOT EXISTS idx_hashed_contacts_expires_at ON hashed_contacts (expires_at);

CREATE TABLE IF NOT EXISTS contact_suggestions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  suggested_user_id INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  match_type VARCHAR(16) NOT NULL,
  match_strength NUMERIC(4,3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  viewed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  stale BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contact_suggestions_pair
  ON contact_suggestions (user_id, suggested_user_id);
CREATE INDEX IF NOT EXISTS idx_contact_suggestions_user ON contact_suggestions (user_id);
CREATE INDEX IF NOT EXISTS idx_contact_suggestions_user_match_type
  ON contact_suggestions (user_id, match_type);
CREATE INDEX IF NOT EXISTS idx_contact_suggestions_suggested_user
  ON contact_suggestions (suggested_user_id);

-- These tables were referenced by the UUID conversion migration but were
-- missing from the historical bootstrap migrations.
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES "User"(id) ON DELETE CASCADE,
  CONSTRAINT blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks (blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PushTokenPlatform') THEN
    CREATE TYPE "PushTokenPlatform" AS ENUM ('ios', 'android');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PushTokenType') THEN
    CREATE TYPE "PushTokenType" AS ENUM ('fcm', 'apns');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS push_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  token VARCHAR(512) NOT NULL,
  platform "PushTokenPlatform" NOT NULL,
  token_type "PushTokenType" NOT NULL,
  device_metadata JSONB,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_push_token_user_token_platform
  ON push_tokens (user_id, token, platform);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens (user_id);
