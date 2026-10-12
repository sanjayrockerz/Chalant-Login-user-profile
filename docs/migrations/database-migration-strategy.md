# Database Migration & Backfill Strategy

## Executive Summary

This document outlines the strategy for implementing non-destructive database migrations, reconciling legacy usernames under new canonical rules, and maintaining profile image pointers without storing binaries in the auth database.

## Phase 1: Schema Migrations (Non-Destructive DDL)

### New Fields and Constraints

#### User Table Enhancements
```sql
-- Migration 001: Add new identity and preference fields
-- Non-destructive additions only

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS canonical_username VARCHAR(255),
ADD COLUMN IF NOT EXISTS username_normalized VARCHAR(255),
ADD COLUMN IF NOT EXISTS last_username_change TIMESTAMP,
ADD COLUMN IF NOT EXISTS pronouns VARCHAR(100),
ADD COLUMN IF NOT EXISTS profile_image_url VARCHAR(500),
ADD COLUMN IF NOT EXISTS profile_image_updated_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS terms_accepted_version VARCHAR(50),
ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS identity_verification_status VARCHAR(20) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMP;

-- Add case-insensitive username handling
-- Option 1: Using citext extension (PostgreSQL)
CREATE EXTENSION IF NOT EXISTS citext;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_ci citext;

-- Option 2: Functional unique index (database agnostic)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower 
ON users (LOWER(username)) 
WHERE username IS NOT NULL AND deleted_at IS NULL;

-- Username normalization index for performance
CREATE INDEX IF NOT EXISTS idx_users_canonical_username 
ON users (canonical_username) 
WHERE canonical_username IS NOT NULL AND deleted_at IS NULL;

-- Terms tracking index
CREATE INDEX IF NOT EXISTS idx_users_terms_version 
ON users (terms_accepted_version, terms_accepted_at);
```

#### Reserved Usernames Table
```sql
-- Migration 002: Create reserved usernames management table
CREATE TABLE IF NOT EXISTS reserved_usernames (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    canonical_username VARCHAR(255) NOT NULL,
    reserved_reason VARCHAR(100) NOT NULL, -- 'brand', 'system', 'content_policy', 'legal'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    expires_at TIMESTAMP NULL, -- NULL for permanent reservations
    metadata JSONB DEFAULT '{}' -- Additional context
);

CREATE UNIQUE INDEX idx_reserved_usernames_canonical 
ON reserved_usernames (canonical_username);

CREATE INDEX idx_reserved_usernames_expires 
ON reserved_usernames (expires_at) 
WHERE expires_at IS NOT NULL;
```

#### Username History Tracking
```sql
-- Migration 003: Username change audit trail
CREATE TABLE IF NOT EXISTS username_history (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    old_username VARCHAR(255),
    new_username VARCHAR(255) NOT NULL,
    canonical_username VARCHAR(255) NOT NULL,
    change_reason VARCHAR(100), -- 'user_request', 'policy_enforcement', 'migration'
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    changed_by VARCHAR(255), -- user_id or system identifier
    correlation_id VARCHAR(255),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_username_history_user ON username_history (user_id, changed_at DESC);
CREATE INDEX idx_username_history_canonical ON username_history (canonical_username);
CREATE INDEX idx_username_history_correlation ON username_history (correlation_id);
```

#### Profile Image Pointers
```sql
-- Migration 004: Profile image metadata table
CREATE TABLE IF NOT EXISTS profile_images (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    image_url VARCHAR(500) NOT NULL,
    image_type VARCHAR(20), -- 'avatar', 'banner', etc.
    storage_provider VARCHAR(50), -- 'aws_s3', 'cloudinary', 'cdn'
    file_size_bytes INTEGER,
    mime_type VARCHAR(100),
    width INTEGER,
    height INTEGER,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP NULL,
    moderation_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    moderation_notes TEXT,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP NULL,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_profile_images_user ON profile_images (user_id, is_active, uploaded_at DESC);
CREATE INDEX idx_profile_images_moderation ON profile_images (moderation_status, uploaded_at);
```

### Migration Safety Measures

#### Pre-Migration Checklist
- [ ] Database backup completed and verified
- [ ] Migration scripts tested in staging environment
- [ ] Rollback procedures documented and tested
- [ ] Performance impact assessment completed
- [ ] Downtime window scheduled (if required)

#### Migration Execution Strategy
```sql
-- Migration execution with safety measures
BEGIN;

-- Set statement timeout for safety
SET statement_timeout = '30s';

-- Enable safety checks
SET check_function_bodies = true;

-- Execute migration steps with validation
-- Step 1: Add columns with default values
ALTER TABLE users ADD COLUMN IF NOT EXISTS canonical_username VARCHAR(255);

-- Step 2: Validate column addition
SELECT COUNT(*) FROM users WHERE canonical_username IS NULL;

-- Step 3: Create indexes with CONCURRENTLY for large tables
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_canonical_username 
ON users (canonical_username) 
WHERE canonical_username IS NOT NULL AND deleted_at IS NULL;

-- Step 4: Validate index creation
SELECT schemaname, tablename, indexname, indexdef 
FROM pg_indexes 
WHERE indexname = 'idx_users_canonical_username';

COMMIT;
```

## Phase 2: Legacy Username Reconciliation

### Reconciliation Strategy

#### Step 1: Username Canonicalization Analysis
```sql
-- Analysis query to identify usernames requiring canonicalization
WITH username_analysis AS (
  SELECT 
    id,
    username,
    LOWER(TRIM(username)) as canonical,
    CASE 
      WHEN username != LOWER(TRIM(username)) THEN 'needs_normalization'
      WHEN LENGTH(username) > 30 THEN 'too_long'
      WHEN username ~ '[^a-zA-Z0-9._]' THEN 'invalid_characters'
      ELSE 'valid'
    END as status
  FROM users 
  WHERE username IS NOT NULL 
    AND deleted_at IS NULL
),
conflict_analysis AS (
  SELECT 
    canonical,
    COUNT(*) as user_count,
    array_agg(username ORDER BY created_at) as original_usernames,
    array_agg(id ORDER BY created_at) as user_ids
  FROM username_analysis 
  GROUP BY canonical 
  HAVING COUNT(*) > 1
)
SELECT 
  canonical,
  user_count,
  original_usernames,
  'conflict_resolution_required' as action_needed
FROM conflict_analysis
ORDER BY user_count DESC;
```

#### Step 2: Conflict Resolution Procedures

**Conflict Resolution Priority Rules:**
1. **Account Age**: Older accounts retain preferred username
2. **Account Activity**: More active accounts get priority
3. **Verification Status**: Verified accounts take precedence
4. **Premium Status**: Paid accounts receive priority

```sql
-- Conflict resolution with priority scoring
WITH conflict_resolution AS (
  SELECT 
    user_id,
    username,
    canonical_username,
    -- Priority scoring algorithm
    (
      CASE WHEN created_at < NOW() - INTERVAL '1 year' THEN 10 ELSE 0 END + -- Account age
      CASE WHEN last_login_at > NOW() - INTERVAL '30 days' THEN 5 ELSE 0 END + -- Recent activity
      CASE WHEN is_verified = true THEN 15 ELSE 0 END + -- Verification status
      CASE WHEN subscription_tier != 'free' THEN 8 ELSE 0 END -- Premium status
    ) as priority_score,
    ROW_NUMBER() OVER (
      PARTITION BY canonical_username 
      ORDER BY 
        is_verified DESC,
        subscription_tier != 'free' DESC,
        last_login_at DESC NULLS LAST,
        created_at ASC
    ) as priority_rank
  FROM users u
  WHERE canonical_username IN (
    SELECT canonical_username 
    FROM users 
    GROUP BY canonical_username 
    HAVING COUNT(*) > 1
  )
)
SELECT 
  user_id,
  username,
  canonical_username,
  priority_score,
  CASE 
    WHEN priority_rank = 1 THEN 'keep_username'
    ELSE 'require_new_username'
  END as resolution_action
FROM conflict_resolution
ORDER BY canonical_username, priority_rank;
```

#### Step 3: Automated Username Migration
```sql
-- Automated migration for non-conflicting usernames
UPDATE users 
SET 
  canonical_username = LOWER(TRIM(username)),
  username_normalized = LOWER(TRIM(username)),
  last_username_change = CURRENT_TIMESTAMP
WHERE canonical_username IS NULL 
  AND username IS NOT NULL
  AND deleted_at IS NULL
  -- Only migrate usernames that don't conflict
  AND LOWER(TRIM(username)) NOT IN (
    SELECT LOWER(TRIM(username)) 
    FROM users 
    WHERE deleted_at IS NULL 
    GROUP BY LOWER(TRIM(username)) 
    HAVING COUNT(*) > 1
  );
```

### Conflict Resolution Workflows

#### High-Priority Account Protection
```sql
-- Identify accounts requiring manual review
SELECT 
  u.id,
  u.username,
  u.email,
  u.created_at,
  u.last_login_at,
  u.is_verified,
  u.subscription_tier,
  'manual_review_required' as status
FROM users u
WHERE u.username IN (
  -- Usernames with conflicts requiring manual intervention
  SELECT username 
  FROM username_conflicts 
  WHERE resolution_method = 'manual_review'
);
```

#### Automated Conflict Resolution
```sql
-- Generate new usernames for lower-priority accounts
WITH username_suggestions AS (
  SELECT 
    user_id,
    original_username,
    ARRAY[
      original_username || '_' || EXTRACT(YEAR FROM created_at),
      original_username || '_user',
      original_username || LPAD(user_id::text, 4, '0')
    ] as suggested_usernames
  FROM users 
  WHERE resolution_action = 'require_new_username'
)
-- Insert suggestions into resolution table for review
INSERT INTO username_resolution_suggestions (
  user_id, 
  original_username, 
  suggested_usernames, 
  created_at
)
SELECT 
  user_id,
  original_username,
  suggested_usernames,
  CURRENT_TIMESTAMP
FROM username_suggestions;
```

## Phase 3: Profile Image Migration Strategy

### Image Pointer Management

#### Profile Image URL Strategy
```sql
-- Update existing profile image references
UPDATE users 
SET profile_image_url = CASE 
  -- Migrate existing image references to pointer system
  WHEN profile_image_data IS NOT NULL THEN 
    'https://cdn.example.com/profiles/' || id || '/avatar.jpg'
  ELSE NULL
END,
profile_image_updated_at = CASE 
  WHEN profile_image_data IS NOT NULL THEN CURRENT_TIMESTAMP
  ELSE NULL
END
WHERE profile_image_url IS NULL 
  AND (profile_image_data IS NOT NULL OR legacy_image_path IS NOT NULL);
```

#### Image Metadata Migration
```sql
-- Populate profile_images table with existing data
INSERT INTO profile_images (
  user_id,
  image_url,
  image_type,
  storage_provider,
  uploaded_at,
  moderation_status,
  is_active
)
SELECT 
  u.id,
  u.profile_image_url,
  'avatar',
  'legacy_migration',
  COALESCE(u.profile_image_updated_at, u.created_at),
  'approved', -- Assume existing images were approved
  true
FROM users u
WHERE u.profile_image_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM profile_images pi 
    WHERE pi.user_id = u.id AND pi.image_type = 'avatar'
  );
```

### Legacy Data Cleanup Strategy

#### Safe Binary Data Removal
```sql
-- Phase 1: Verify all images have been migrated to external storage
SELECT 
  COUNT(*) as total_users_with_images,
  COUNT(profile_image_url) as users_with_url_pointers,
  COUNT(profile_image_data) as users_with_binary_data
FROM users 
WHERE profile_image_data IS NOT NULL 
   OR profile_image_url IS NOT NULL;

-- Phase 2: Create backup before cleanup
CREATE TABLE IF NOT EXISTS users_image_backup AS 
SELECT id, profile_image_data, profile_image_updated_at
FROM users 
WHERE profile_image_data IS NOT NULL;

-- Phase 3: Remove binary data after validation
-- Only execute after confirming all images are properly migrated
UPDATE users 
SET profile_image_data = NULL 
WHERE profile_image_url IS NOT NULL 
  AND profile_image_data IS NOT NULL;
```

## Phase 4: Data Validation & Consistency Checks

### Validation Procedures

#### Username Consistency Validation
```sql
-- Validate username canonicalization consistency
WITH validation_results AS (
  SELECT 
    id,
    username,
    canonical_username,
    username_normalized,
    CASE 
      WHEN canonical_username != LOWER(TRIM(username)) THEN 'canonicalization_mismatch'
      WHEN username_normalized != LOWER(TRIM(username)) THEN 'normalization_mismatch'
      WHEN canonical_username IS NULL AND username IS NOT NULL THEN 'missing_canonical'
      ELSE 'valid'
    END as validation_status
  FROM users 
  WHERE deleted_at IS NULL
)
SELECT 
  validation_status,
  COUNT(*) as user_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM validation_results 
GROUP BY validation_status
ORDER BY user_count DESC;
```

#### Terms Acceptance Data Validation
```sql
-- Validate terms acceptance data integrity
SELECT 
  COUNT(*) as total_users,
  COUNT(terms_accepted_version) as users_with_terms_version,
  COUNT(terms_accepted_at) as users_with_acceptance_timestamp,
  COUNT(CASE WHEN terms_accepted_version IS NOT NULL 
             AND terms_accepted_at IS NULL THEN 1 END) as version_without_timestamp,
  COUNT(CASE WHEN terms_accepted_version IS NULL 
             AND terms_accepted_at IS NOT NULL THEN 1 END) as timestamp_without_version
FROM users 
WHERE deleted_at IS NULL;
```

#### Profile Image Pointer Validation
```sql
-- Validate profile image pointer consistency
WITH image_validation AS (
  SELECT 
    u.id,
    u.profile_image_url,
    pi.image_url as table_image_url,
    CASE 
      WHEN u.profile_image_url IS NOT NULL AND pi.id IS NULL THEN 'missing_metadata'
      WHEN u.profile_image_url IS NULL AND pi.id IS NOT NULL THEN 'orphaned_metadata'
      WHEN u.profile_image_url != pi.image_url THEN 'url_mismatch'
      ELSE 'valid'
    END as validation_status
  FROM users u
  LEFT JOIN profile_images pi ON u.id = pi.user_id 
    AND pi.image_type = 'avatar' 
    AND pi.is_active = true
  WHERE u.deleted_at IS NULL
)
SELECT 
  validation_status,
  COUNT(*) as user_count
FROM image_validation 
GROUP BY validation_status
ORDER BY user_count DESC;
```

## Rollback Procedures

### Emergency Rollback Plan

#### Schema Rollback (If Required)
```sql
-- Rollback script for emergency situations
-- WARNING: Only use if migration causes critical issues

BEGIN;

-- Step 1: Remove new indexes (safe)
DROP INDEX IF EXISTS idx_users_canonical_username;
DROP INDEX IF EXISTS idx_users_terms_version;

-- Step 2: Remove new columns (data loss risk - only if necessary)
-- ALTER TABLE users DROP COLUMN IF EXISTS canonical_username;
-- ALTER TABLE users DROP COLUMN IF EXISTS terms_accepted_version;

-- Step 3: Drop new tables (data loss - only if absolutely necessary)
-- DROP TABLE IF EXISTS username_history;
-- DROP TABLE IF EXISTS profile_images;

COMMIT;
```

#### Data Rollback Procedures
```sql
-- Restore username data from backup if needed
UPDATE users 
SET 
  username = ub.original_username,
  canonical_username = NULL,
  username_normalized = NULL
FROM username_backup ub 
WHERE users.id = ub.user_id 
  AND ub.backup_timestamp > NOW() - INTERVAL '24 hours';
```

### Monitoring Migration Health

#### Migration Progress Tracking
```sql
-- Track migration progress and health
CREATE OR REPLACE VIEW migration_status AS 
SELECT 
  'username_canonicalization' as migration_step,
  COUNT(*) as total_records,
  COUNT(canonical_username) as migrated_records,
  ROUND(COUNT(canonical_username) * 100.0 / COUNT(*), 2) as completion_percentage
FROM users 
WHERE deleted_at IS NULL

UNION ALL

SELECT 
  'profile_image_migration' as migration_step,
  COUNT(*) as total_records,
  COUNT(CASE WHEN profile_image_url IS NOT NULL THEN 1 END) as migrated_records,
  ROUND(COUNT(CASE WHEN profile_image_url IS NOT NULL THEN 1 END) * 100.0 / COUNT(*), 2) as completion_percentage
FROM users 
WHERE deleted_at IS NULL;
```

This migration strategy ensures safe, non-destructive database changes while maintaining data integrity and providing comprehensive rollback capabilities.