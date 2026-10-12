# ADR-003: Phone Hash Retention/TTL

- **Status**: Accepted (2024-10-05)
- **Context**: Must comply with data minimization for hashed contact data while supporting discovery.
- **Decision**: Retain `hashed_contacts` rows for 30 days, then purge via scheduled cleanup job.
- **Consequences**:
  - Requires `expires_at` column and supporting index for efficient pruning.
  - Suggestions older than 14 days marked stale to limit stale exposure.
  - Users can trigger immediate deletion through settings (GDPR support).
