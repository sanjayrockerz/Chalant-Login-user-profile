-- Migration: Contact discovery tables and supporting indexes
-- This migration creates the hashed_contacts and contact_suggestions tables
-- along with the indexes required for latency and dedupe guarantees.

BEGIN;

-- Ensure users table has phone metadata columns required by contact sync pipeline
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
    ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS hashed_phone VARCHAR(64);

-- Maintain uniqueness and lookup support for hashed_phone queries
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_users_hashed_phone'
    ) THEN
        CREATE INDEX idx_users_hashed_phone ON users (hashed_phone);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_key'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_phone_key UNIQUE (phone);
    END IF;
END $$;

-- hashed_contacts stores normalized, hashed uploads for dedupe
CREATE TABLE IF NOT EXISTS hashed_contacts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hashed_phone VARCHAR(64) NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Indexes for hashed_contacts
CREATE UNIQUE INDEX IF NOT EXISTS uniq_hashed_contacts_user_phone
    ON hashed_contacts (user_id, hashed_phone);
CREATE INDEX IF NOT EXISTS idx_hashed_contacts_hashed_phone
    ON hashed_contacts (hashed_phone);
CREATE INDEX IF NOT EXISTS idx_hashed_contacts_user_id
    ON hashed_contacts (user_id);
CREATE INDEX IF NOT EXISTS idx_hashed_contacts_expires_at
    ON hashed_contacts (expires_at);

-- contact_suggestions links probable matches discovered from hashed contacts
CREATE TABLE IF NOT EXISTS contact_suggestions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    suggested_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    match_type VARCHAR(16) NOT NULL,
    match_strength NUMERIC(4,3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    viewed_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    stale BOOLEAN NOT NULL DEFAULT FALSE
);

-- Indexes for contact_suggestions
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contact_suggestions_pair
    ON contact_suggestions (user_id, suggested_user_id);
CREATE INDEX IF NOT EXISTS idx_contact_suggestions_user
    ON contact_suggestions (user_id);
CREATE INDEX IF NOT EXISTS idx_contact_suggestions_user_match_type
    ON contact_suggestions (user_id, match_type);
CREATE INDEX IF NOT EXISTS idx_contact_suggestions_suggested_user
    ON contact_suggestions (suggested_user_id);

COMMIT;
