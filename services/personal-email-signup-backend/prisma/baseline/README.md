# Canonical schema baseline

`20261009160000_canonical_schema.json` is the reviewed governance record for the current Prisma schema. The Prisma schema is the single schema authority; the baseline initializer generates SQL from that schema with `prisma migrate diff --from-empty`.

The checksum protects the reviewed baseline from silent schema drift. Historical migration checksums are recorded to make accidental edits visible. Historical migrations remain immutable legacy evidence and are not replayed for fresh installations because their dependency order is not a valid empty-database path.

Fresh initialization is only permitted through `migration:fresh:init` against an explicitly disposable, phase-scoped target. Existing databases require an authorized schema-only snapshot and a separate forward migration plan. No baseline or historical migration is automatically marked as applied by this policy.

When the next additive migration is approved, update the canonical schema and this manifest together, generate the migration from the reviewed schema delta, and verify it against both a fresh canonical database and an authorized upgrade rehearsal. Do not edit old migration directories or use `migrate resolve` to conceal missing history.
