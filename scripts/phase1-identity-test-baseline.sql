-- Test-only synthetic pre-identity baseline.
-- This is not a production schema and must only run against a disposable database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "User" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "username" text NOT NULL UNIQUE,
  "normalizedUsername" text UNIQUE,
  "displayUsername" text,
  "email" text NOT NULL UNIQUE,
  "password" text NOT NULL,
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

INSERT INTO "User" ("username", "email", "password")
VALUES ('pre_identity_user', 'pre-identity@example.test', 'synthetic-hash');

CREATE TYPE "MatchType" AS ENUM ('mutual', 'one_sided');

CREATE TABLE hashed_contacts (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
  hashed_phone varchar(64) NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE contact_suggestions (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
  suggested_user_id uuid NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
  match_type "MatchType" NOT NULL,
  match_strength numeric(4,3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  viewed_at timestamptz,
  accepted_at timestamptz,
  stale boolean NOT NULL DEFAULT false
);

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES "User" (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

INSERT INTO "User" ("username", "email", "password")
VALUES ('pre_identity_target', 'pre-target@example.test', 'synthetic-hash');

INSERT INTO hashed_contacts (user_id, hashed_phone, expires_at)
SELECT id, 'synthetic-contact-hash', now() + interval '1 day'
FROM "User" WHERE email = 'pre-identity@example.test';

INSERT INTO contact_suggestions (user_id, suggested_user_id, match_type, match_strength)
SELECT owner.id, target.id, 'mutual', 0.900
FROM "User" owner CROSS JOIN "User" target
WHERE owner.email = 'pre-identity@example.test' AND target.email = 'pre-target@example.test';

INSERT INTO blocks (blocker_id, blocked_id)
SELECT owner.id, target.id
FROM "User" owner CROSS JOIN "User" target
WHERE owner.email = 'pre-identity@example.test' AND target.email = 'pre-target@example.test';
