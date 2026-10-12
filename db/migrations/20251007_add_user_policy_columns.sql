-- Add columns to store the policy version the user accepted and the timestamp
ALTER TABLE users
ADD COLUMN accepted_policy_version varchar(64) NULL,
ADD COLUMN accepted_policy_at timestamptz NULL;

-- Optional: index for quick lookup of users needing re-acceptance
CREATE INDEX IF NOT EXISTS idx_users_accepted_policy_version ON users (accepted_policy_version);
