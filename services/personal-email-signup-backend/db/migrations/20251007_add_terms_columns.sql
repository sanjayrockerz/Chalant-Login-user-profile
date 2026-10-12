-- Add terms fields to users table for personal-email-signup-backend (Prisma/Postgres)
ALTER TABLE users
  ADD COLUMN terms_version varchar(64),
  ADD COLUMN terms_accepted_at timestamptz;

-- Optional index for queries
CREATE INDEX IF NOT EXISTS idx_users_terms_version ON users (terms_version);
