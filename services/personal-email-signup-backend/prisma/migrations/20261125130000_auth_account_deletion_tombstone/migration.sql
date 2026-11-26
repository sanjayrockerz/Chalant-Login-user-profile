-- Permanent, PII-minimal fence for irreversibly deleted canonical Auth subjects.
-- This table intentionally has no foreign key to users so account cleanup and
-- same-email re-registration cannot remove or reuse the old subject marker.
CREATE TABLE account_deletion_tombstones (
  auth_subject UUID PRIMARY KEY,
  lifecycle_revision BIGINT NOT NULL CHECK (lifecycle_revision > 0),
  deleted_at TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp()
);

COMMENT ON TABLE account_deletion_tombstones IS
  'Permanent minimal Auth-subject fence; never expires or stores user PII.';
COMMENT ON COLUMN account_deletion_tombstones.auth_subject IS
  'Immutable deleted canonical Auth UUID; not reassigned.';
COMMENT ON COLUMN account_deletion_tombstones.lifecycle_revision IS
  'Terminal revision used to reject stale lifecycle and provisioning events.';
