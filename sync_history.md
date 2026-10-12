# Upstream Sync History

Track every subtree pull so we can audit what landed, how conflicts were resolved, and who signed off.

| Date | Service | Upstream Version | Commits Pulled | Conflicts | Test Status | Merged By | Notes |
|------|---------|------------------|----------------|-----------|-------------|-----------|-------|
| 2025-10-18 | signup-backend | v1.2.3 | 7 | config, tests | ✅ All passed | @john_doe | Resolved observability config clashes per policy. |

## Usage

1. Append a row for each completed sync (one row per service).
2. Note any manual overrides or follow-up actions in **Notes**.
3. Reference the corresponding git tag (`sync/<service>-vX.Y.Z`) and PR link when available.
4. Record freeze dates by adding a row with `Upstream Version` set to `frozen` and documenting the rationale in **Notes**.
