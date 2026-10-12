-- Rollback migration: Remove performance indexes
-- This migration removes the indexes added in 20241002000001_add_performance_indexes

-- Remove composite index for email verification lookups
DROP INDEX CONCURRENTLY IF EXISTS "idx_user_email_verification";

-- Remove index for token lookups on EmailVerificationToken
DROP INDEX CONCURRENTLY IF EXISTS "idx_email_verification_token_lookup";

-- Remove index for RefreshToken lookups
DROP INDEX CONCURRENTLY IF EXISTS "idx_refresh_token_lookup";

-- Remove indexes for token cleanup
DROP INDEX CONCURRENTLY IF EXISTS "idx_email_verification_created_at";
DROP INDEX CONCURRENTLY IF EXISTS "idx_refresh_token_created_at";

-- Remove index for user verification status
DROP INDEX CONCURRENTLY IF EXISTS "idx_user_verified_status";