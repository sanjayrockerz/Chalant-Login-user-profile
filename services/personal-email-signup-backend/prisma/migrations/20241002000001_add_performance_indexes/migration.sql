-- Migration: Add indexes and TTL for performance optimization
-- This migration adds composite indexes for hot queries and TTL behavior for token cleanup

-- Add composite index for email verification lookups (email + token)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_user_email_verification" ON "User"("email", "verificationToken") WHERE "verificationToken" IS NOT NULL;

-- Add index for token lookups on EmailVerificationToken
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_email_verification_token_lookup" ON "EmailVerificationToken"("token");

-- Add index for RefreshToken lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_refresh_token_lookup" ON "RefreshToken"("token");

-- Add index for token cleanup based on creation time (for TTL simulation)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_email_verification_created_at" ON "EmailVerificationToken"("createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_refresh_token_created_at" ON "RefreshToken"("createdAt");

-- Add index for user lookups by verification status
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_user_verified_status" ON "User"("isVerified");

-- Performance note: In production, consider adding a cleanup job to remove expired tokens
-- Example: DELETE FROM "EmailVerificationToken" WHERE "createdAt" < NOW() - INTERVAL '24 hours';
-- Example: DELETE FROM "RefreshToken" WHERE "createdAt" < NOW() - INTERVAL '7 days';