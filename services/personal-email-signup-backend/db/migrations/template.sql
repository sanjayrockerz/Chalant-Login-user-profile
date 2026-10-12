-- Migration: <DESCRIPTIVE_NAME>
-- Created: <YYYY-MM-DD>
-- Author: <YOUR_NAME>
-- Jira/Issue: <TICKET_NUMBER>

-- Description:
-- <Detailed description of what this migration does and why>

-- Dependencies:
-- <List any dependencies or prerequisite migrations>

-- Rollback Strategy:
-- <Describe how to rollback this migration if needed>

-- ==================================
-- MIGRATION UP
-- ==================================

BEGIN;

-- Your migration SQL here
-- Example:
-- CREATE TABLE "example" (
--   "id" TEXT NOT NULL PRIMARY KEY,
--   "name" TEXT NOT NULL,
--   "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
-- );

-- CREATE INDEX "idx_example_name" ON "example"("name");

COMMIT;

-- ==================================
-- VALIDATION QUERIES (run after migration)
-- ==================================

-- Check row counts
-- SELECT COUNT(*) FROM "example";

-- Verify constraints
-- SELECT * FROM pg_constraint WHERE conname = 'example_pkey';

-- ==================================
-- ROLLBACK (for reference only - create separate DOWN migration)
-- ==================================

-- BEGIN;
-- DROP TABLE IF EXISTS "example";
-- COMMIT;
