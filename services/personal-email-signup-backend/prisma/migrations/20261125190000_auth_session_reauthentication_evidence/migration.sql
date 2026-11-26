-- Older sessions have no trustworthy reauthentication evidence. Keep them NULL
-- so sensitive actions require a fresh credential or provider authentication.
ALTER TABLE identity_sessions
  ADD COLUMN reauthenticated_at TIMESTAMPTZ(6);

COMMENT ON COLUMN identity_sessions.reauthenticated_at IS
  'Timestamp of a verified primary password or external provider authentication; refresh does not update it.';
