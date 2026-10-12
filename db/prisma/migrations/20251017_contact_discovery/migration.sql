-- Migration: Add phone verification fields and contact discovery tables
-- Generated to align with Prisma schema in db/prisma/schema.prisma

-- 1. Extend users table with phone verification & hashed phone metadata
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone varchar(20),
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS hashed_phone varchar(64);

-- Enforce uniqueness on raw phone numbers for account recovery and duplicate prevention
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_phone_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_phone_key UNIQUE (phone);
  END IF;
END$$;

-- Index hashed phone for privacy-preserving match lookups
CREATE INDEX IF NOT EXISTS idx_users_hashed_phone ON users (hashed_phone);

-- 2. Support enum used by contact_suggestions table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'match_type'
  ) THEN
    CREATE TYPE match_type AS ENUM ('mutual', 'one_sided');
  END IF;
END$$;

-- 3. Create hashed_contacts table for temporary contact uploads
CREATE TABLE IF NOT EXISTS hashed_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hashed_phone varchar(64) NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

-- Ensure composite uniqueness and lookup performance
ALTER TABLE hashed_contacts
  ADD CONSTRAINT uniq_hashed_contacts_user_phone UNIQUE (user_id, hashed_phone);
CREATE INDEX IF NOT EXISTS idx_hashed_contacts_user_id ON hashed_contacts (user_id);
CREATE INDEX IF NOT EXISTS idx_hashed_contacts_hashed_phone ON hashed_contacts (hashed_phone);

-- 4. Create contact_suggestions table for persisted recommendations
CREATE TABLE IF NOT EXISTS contact_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  suggested_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_type match_type NOT NULL,
  match_strength numeric(3,2) NOT NULL CHECK (match_strength >= 0 AND match_strength <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  viewed_at timestamptz,
  accepted_at timestamptz
);

ALTER TABLE contact_suggestions
  ADD CONSTRAINT uniq_contact_suggestions_pair UNIQUE (user_id, suggested_user_id);
CREATE INDEX IF NOT EXISTS idx_contact_suggestions_user ON contact_suggestions (user_id);
CREATE INDEX IF NOT EXISTS idx_contact_suggestions_user_match_type ON contact_suggestions (user_id, match_type);

-- 5. Optional: align hashed_phone content with user hashed phone column
COMMENT ON COLUMN users.hashed_phone IS 'SHA-256 hash of normalized E.164 phone for privacy-preserving matching';
COMMENT ON TABLE hashed_contacts IS 'Ephemeral hashed phone uploads retained for 30 days to drive friend discovery';
COMMENT ON TABLE contact_suggestions IS 'Materialized friend suggestions generated from hashed phone matches';
