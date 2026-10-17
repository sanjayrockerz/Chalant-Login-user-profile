-- Test-only synthetic legacy baseline; disposable databases only.
-- Integer User identifiers intentionally exercise the UUID upgrade path.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TYPE "UserAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');
CREATE TYPE "PushTokenPlatform" AS ENUM ('ios', 'android');
CREATE TYPE "PushTokenType" AS ENUM ('fcm', 'apns');

CREATE TABLE "User" (
  "id" SERIAL PRIMARY KEY,
  "username" text NOT NULL UNIQUE,
  "normalizedUsername" text UNIQUE,
  "displayUsername" text,
  "email" text NOT NULL UNIQUE,
  "password" text,
  "accountStatus" "UserAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "isVerified" boolean NOT NULL DEFAULT false,
  "termsVersion" varchar(64),
  "termsAcceptedAt" timestamptz,
  "displayName" varchar(255),
  "declaredAge" integer,
  "profileImageUrl" text,
  "pronouns" varchar(64),
  "usernameUpdatedAt" timestamptz,
  "phone" varchar(20) UNIQUE,
  "phone_verified_at" timestamptz,
  "hashed_phone" varchar(64),
  "allow_contact_discovery" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "RefreshToken" (
  "id" SERIAL PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "token" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hashed_contacts (
  id SERIAL PRIMARY KEY,
  user_id integer NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
  hashed_phone varchar(64) NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE TYPE "MatchType" AS ENUM ('mutual', 'one_sided');
CREATE TABLE contact_suggestions (
  id SERIAL PRIMARY KEY,
  user_id integer NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
  suggested_user_id integer NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
  match_type "MatchType" NOT NULL,
  match_strength numeric(4,3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), viewed_at timestamptz,
  accepted_at timestamptz, stale boolean NOT NULL DEFAULT false
);
CREATE TABLE blocks (
  blocker_id integer NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
  blocked_id integer NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE push_tokens (
  id SERIAL PRIMARY KEY,
  user_id integer NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
  token varchar(512) NOT NULL, platform "PushTokenPlatform" NOT NULL, token_type "PushTokenType" NOT NULL,
  device_metadata jsonb, last_validated_at timestamptz,
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "User" (username, email, password) VALUES
  ('legacy_owner', 'legacy-owner@example.test', 'synthetic-hash'),
  ('legacy_target', 'legacy-target@example.test', 'synthetic-hash');
INSERT INTO "RefreshToken" (userId, token)
SELECT id, 'legacy-refresh-token' FROM "User" WHERE email = 'legacy-owner@example.test';
INSERT INTO hashed_contacts (user_id, hashed_phone, expires_at)
SELECT id, 'legacy-contact-hash', now() + interval '1 day'
FROM "User" WHERE email = 'legacy-owner@example.test';
INSERT INTO contact_suggestions (user_id, suggested_user_id, match_type, match_strength)
SELECT owner.id, target.id, 'mutual', 0.900 FROM "User" owner CROSS JOIN "User" target
WHERE owner.email = 'legacy-owner@example.test' AND target.email = 'legacy-target@example.test';
INSERT INTO blocks (blocker_id, blocked_id)
SELECT owner.id, target.id FROM "User" owner CROSS JOIN "User" target
WHERE owner.email = 'legacy-owner@example.test' AND target.email = 'legacy-target@example.test';
INSERT INTO push_tokens (user_id, token, platform, token_type)
SELECT id, 'legacy-push-token', 'ios', 'apns' FROM "User" WHERE email = 'legacy-owner@example.test';
