-- Add terms_version and terms_accepted_at to users and create history table
ALTER TABLE users
  ADD COLUMN terms_version varchar(64) NULL,
  ADD COLUMN terms_accepted_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS policy_acceptance_history (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  policy_version varchar(64) NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  source varchar(64) NULL,
  notes text NULL
);

-- Indexes to support queries
CREATE INDEX IF NOT EXISTS idx_policy_acceptance_history_user_id ON policy_acceptance_history (user_id);
CREATE INDEX IF NOT EXISTS idx_policy_acceptance_history_policy_version ON policy_acceptance_history (policy_version);
