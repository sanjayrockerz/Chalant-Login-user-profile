-- =============================================================================
-- Contact Import Data Model Schema
-- =============================================================================
-- Comprehensive database schema for secure contact discovery system
-- Supports hashed storage, deduplication, matching, and automated cleanup
-- 
-- Design Principles:
-- 1. Privacy-first: Only hashed identifiers stored
-- 2. Performance: Optimized indexes for fast queries
-- 3. Retention: Automated cleanup with TTL policies
-- 4. Scalability: Partitioning and sharding support
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- =============================================================================
-- CORE CONTACT STORAGE TABLES
-- =============================================================================

-- Hashed contacts storage with automatic expiration
CREATE TABLE hashed_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    hashed_identifier VARCHAR(512) NOT NULL, -- Argon2id hash (hex encoded)
    identifier_type VARCHAR(10) NOT NULL CHECK (identifier_type IN ('phone', 'email')),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    match_count INTEGER DEFAULT 0, -- Track how many times this hash matched
    last_matched_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata for debugging and analytics (no PII)
    upload_batch_id UUID, -- Group contacts from same upload
    normalization_version VARCHAR(10) DEFAULT 'v1.0', -- Track normalization changes
    client_version VARCHAR(50), -- Track client app version
    
    CONSTRAINT unique_user_hash_type UNIQUE (user_id, hashed_identifier, identifier_type)
);

-- Optimized indexes for hashed_contacts
CREATE INDEX CONCURRENTLY idx_hashed_contacts_user_id ON hashed_contacts(user_id);
CREATE INDEX CONCURRENTLY idx_hashed_contacts_hash_type ON hashed_contacts(hashed_identifier, identifier_type);
CREATE INDEX CONCURRENTLY idx_hashed_contacts_expires_at ON hashed_contacts(expires_at);
CREATE INDEX CONCURRENTLY idx_hashed_contacts_uploaded_at ON hashed_contacts(uploaded_at DESC);
CREATE INDEX CONCURRENTLY idx_hashed_contacts_batch_id ON hashed_contacts(upload_batch_id);

-- Composite index for fast matching queries
CREATE INDEX CONCURRENTLY idx_hashed_contacts_match_lookup 
ON hashed_contacts(hashed_identifier, identifier_type, expires_at) 
WHERE expires_at > NOW();

-- =============================================================================
-- FRIEND SUGGESTIONS AND MATCHING
-- =============================================================================

-- User-to-user contact mappings for friend suggestions
CREATE TABLE contact_matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_user_id VARCHAR(255) NOT NULL,
    matched_user_id VARCHAR(255) NOT NULL,
    match_type VARCHAR(20) NOT NULL CHECK (match_type IN ('exact', 'mutual', 'one_sided')),
    match_strength DECIMAL(3,2) DEFAULT 1.00 CHECK (match_strength BETWEEN 0.00 AND 1.00),
    identifier_type VARCHAR(10) NOT NULL CHECK (identifier_type IN ('phone', 'email')),
    
    -- Matching metadata
    matched_via_hash VARCHAR(16), -- First 16 chars of hash for debugging
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    suggestion_shown_at TIMESTAMP WITH TIME ZONE,
    suggestion_accepted_at TIMESTAMP WITH TIME ZONE,
    suggestion_dismissed_at TIMESTAMP WITH TIME ZONE,
    
    -- Prevent duplicate suggestions
    CONSTRAINT unique_requester_matched_type UNIQUE (requester_user_id, matched_user_id, identifier_type)
);

-- Indexes for contact_matches
CREATE INDEX CONCURRENTLY idx_contact_matches_requester ON contact_matches(requester_user_id, expires_at);
CREATE INDEX CONCURRENTLY idx_contact_matches_matched ON contact_matches(matched_user_id);
CREATE INDEX CONCURRENTLY idx_contact_matches_expires_at ON contact_matches(expires_at);
CREATE INDEX CONCURRENTLY idx_contact_matches_created_at ON contact_matches(created_at DESC);
CREATE INDEX CONCURRENTLY idx_contact_matches_strength ON contact_matches(match_strength DESC);

-- Composite index for suggestion queries
CREATE INDEX CONCURRENTLY idx_contact_matches_suggestions 
ON contact_matches(requester_user_id, match_strength DESC, created_at DESC) 
WHERE expires_at > NOW() AND suggestion_dismissed_at IS NULL;

-- =============================================================================
-- DEDUPLICATION TRACKING
-- =============================================================================

-- Track uploaded contact hashes per user to prevent re-processing
CREATE TABLE upload_deduplication (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    contact_hash_signature VARCHAR(64) NOT NULL, -- Hash of the contact hash for dedup
    identifier_type VARCHAR(10) NOT NULL CHECK (identifier_type IN ('phone', 'email')),
    first_uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    upload_count INTEGER DEFAULT 1,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    
    CONSTRAINT unique_user_hash_sig_type UNIQUE (user_id, contact_hash_signature, identifier_type)
);

-- Indexes for upload_deduplication
CREATE INDEX CONCURRENTLY idx_upload_dedup_user_expires ON upload_deduplication(user_id, expires_at);
CREATE INDEX CONCURRENTLY idx_upload_dedup_expires_at ON upload_deduplication(expires_at);
CREATE INDEX CONCURRENTLY idx_upload_dedup_hash_sig ON upload_deduplication(contact_hash_signature);

-- =============================================================================
-- BATCH PROCESSING AND UPLOAD TRACKING
-- =============================================================================

-- Track upload batches for processing management
CREATE TABLE upload_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    total_contacts INTEGER NOT NULL,
    processed_contacts INTEGER DEFAULT 0,
    successful_contacts INTEGER DEFAULT 0,
    failed_contacts INTEGER DEFAULT 0,
    duplicate_contacts INTEGER DEFAULT 0,
    
    -- Processing status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Performance metrics
    processing_time_ms INTEGER,
    matches_found INTEGER DEFAULT 0,
    suggestions_created INTEGER DEFAULT 0,
    
    -- Error tracking
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Indexes for upload_batches
CREATE INDEX CONCURRENTLY idx_upload_batches_user_id ON upload_batches(user_id, started_at DESC);
CREATE INDEX CONCURRENTLY idx_upload_batches_status ON upload_batches(status, started_at);
CREATE INDEX CONCURRENTLY idx_upload_batches_expires_at ON upload_batches(expires_at);

-- =============================================================================
-- USER PREFERENCES AND PRIVACY SETTINGS
-- =============================================================================

-- Enhanced privacy preferences with granular controls
CREATE TABLE contact_privacy_preferences (
    user_id VARCHAR(255) PRIMARY KEY,
    
    -- Discovery settings
    allow_discovery BOOLEAN DEFAULT false,
    discovery_mode VARCHAR(20) DEFAULT 'mutual_only' CHECK (discovery_mode IN ('mutual_only', 'one_sided', 'disabled')),
    allow_suggestions BOOLEAN DEFAULT false,
    
    -- Platform-specific settings
    phone_discovery_enabled BOOLEAN DEFAULT false,
    email_discovery_enabled BOOLEAN DEFAULT false,
    
    -- Suggestion preferences
    max_suggestions_per_day INTEGER DEFAULT 10 CHECK (max_suggestions_per_day BETWEEN 0 AND 100),
    suggestion_quality_threshold DECIMAL(3,2) DEFAULT 0.80 CHECK (suggestion_quality_threshold BETWEEN 0.00 AND 1.00),
    
    -- Privacy controls
    allow_reverse_lookup BOOLEAN DEFAULT false, -- Can others find this user via their contacts
    allow_mutual_friends_visibility BOOLEAN DEFAULT true,
    
    -- Retention preferences
    contact_retention_days INTEGER DEFAULT 90 CHECK (contact_retention_days BETWEEN 1 AND 365),
    suggestion_retention_days INTEGER DEFAULT 30 CHECK (suggestion_retention_days BETWEEN 1 AND 90),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for privacy preferences
CREATE INDEX CONCURRENTLY idx_contact_privacy_discovery ON contact_privacy_preferences(allow_discovery, discovery_mode);

-- =============================================================================
-- ANALYTICS AND MONITORING
-- =============================================================================

-- System performance metrics (anonymized)
CREATE TABLE contact_system_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    metric_date DATE NOT NULL,
    metric_hour INTEGER NOT NULL CHECK (metric_hour BETWEEN 0 AND 23),
    
    -- Upload metrics
    total_uploads INTEGER DEFAULT 0,
    total_contacts_processed INTEGER DEFAULT 0,
    avg_contacts_per_upload DECIMAL(8,2) DEFAULT 0,
    avg_processing_time_ms INTEGER DEFAULT 0,
    
    -- Matching metrics
    total_matches_found INTEGER DEFAULT 0,
    exact_matches INTEGER DEFAULT 0,
    mutual_matches INTEGER DEFAULT 0,
    avg_match_strength DECIMAL(3,2) DEFAULT 0,
    
    -- Deduplication metrics
    total_duplicates_found INTEGER DEFAULT 0,
    within_upload_duplicates INTEGER DEFAULT 0,
    cross_upload_duplicates INTEGER DEFAULT 0,
    
    -- Performance metrics
    avg_response_time_ms INTEGER DEFAULT 0,
    p95_response_time_ms INTEGER DEFAULT 0,
    error_rate DECIMAL(5,4) DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_metric_date_hour UNIQUE (metric_date, metric_hour)
);

-- Indexes for metrics
CREATE INDEX CONCURRENTLY idx_contact_metrics_date ON contact_system_metrics(metric_date DESC, metric_hour DESC);

-- =============================================================================
-- CLEANUP AND RETENTION AUDIT
-- =============================================================================

-- Track cleanup operations for compliance
CREATE TABLE cleanup_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cleanup_type VARCHAR(50) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    records_deleted INTEGER NOT NULL,
    cleanup_duration_ms INTEGER,
    cleanup_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Optional filters applied
    cleanup_criteria JSONB,
    
    -- Results
    success BOOLEAN DEFAULT true,
    error_message TEXT
);

-- Index for cleanup audit
CREATE INDEX CONCURRENTLY idx_cleanup_audit_date ON cleanup_audit_log(cleanup_date DESC);
CREATE INDEX CONCURRENTLY idx_cleanup_audit_type ON cleanup_audit_log(cleanup_type, cleanup_date DESC);

-- =============================================================================
-- DATA RETENTION FUNCTIONS
-- =============================================================================

-- Function to cleanup expired hashed contacts
CREATE OR REPLACE FUNCTION cleanup_expired_hashed_contacts()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM hashed_contacts 
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    INSERT INTO cleanup_audit_log (cleanup_type, table_name, records_deleted, success)
    VALUES ('expired_contacts', 'hashed_contacts', deleted_count, true);
    
    RETURN deleted_count;
EXCEPTION WHEN OTHERS THEN
    INSERT INTO cleanup_audit_log (cleanup_type, table_name, records_deleted, success, error_message)
    VALUES ('expired_contacts', 'hashed_contacts', 0, false, SQLERRM);
    RAISE;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup expired contact matches
CREATE OR REPLACE FUNCTION cleanup_expired_contact_matches()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM contact_matches 
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    INSERT INTO cleanup_audit_log (cleanup_type, table_name, records_deleted, success)
    VALUES ('expired_matches', 'contact_matches', deleted_count, true);
    
    RETURN deleted_count;
EXCEPTION WHEN OTHERS THEN
    INSERT INTO cleanup_audit_log (cleanup_type, table_name, records_deleted, success, error_message)
    VALUES ('expired_matches', 'contact_matches', 0, false, SQLERRM);
    RAISE;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup expired upload deduplication records
CREATE OR REPLACE FUNCTION cleanup_expired_upload_deduplication()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM upload_deduplication 
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    INSERT INTO cleanup_audit_log (cleanup_type, table_name, records_deleted, success)
    VALUES ('expired_deduplication', 'upload_deduplication', deleted_count, true);
    
    RETURN deleted_count;
EXCEPTION WHEN OTHERS THEN
    INSERT INTO cleanup_audit_log (cleanup_type, table_name, records_deleted, success, error_message)
    VALUES ('expired_deduplication', 'upload_deduplication', 0, false, SQLERRM);
    RAISE;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup old upload batches
CREATE OR REPLACE FUNCTION cleanup_old_upload_batches()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM upload_batches 
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    INSERT INTO cleanup_audit_log (cleanup_type, table_name, records_deleted, success)
    VALUES ('expired_batches', 'upload_batches', deleted_count, true);
    
    RETURN deleted_count;
EXCEPTION WHEN OTHERS THEN
    INSERT INTO cleanup_audit_log (cleanup_type, table_name, records_deleted, success, error_message)
    VALUES ('expired_batches', 'upload_batches', 0, false, SQLERRM);
    RAISE;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- AUTOMATED CLEANUP SCHEDULING
-- =============================================================================

-- Schedule cleanup jobs using pg_cron (requires pg_cron extension)
-- Run cleanup every day at 2 AM
SELECT cron.schedule('cleanup-expired-contacts', '0 2 * * *', 'SELECT cleanup_expired_hashed_contacts();');
SELECT cron.schedule('cleanup-expired-matches', '0 2 * * *', 'SELECT cleanup_expired_contact_matches();');
SELECT cron.schedule('cleanup-expired-deduplication', '0 2 * * *', 'SELECT cleanup_expired_upload_deduplication();');
SELECT cron.schedule('cleanup-old-batches', '0 2 * * *', 'SELECT cleanup_old_upload_batches();');

-- =============================================================================
-- PARTITIONING FOR SCALABILITY
-- =============================================================================

-- Partition hashed_contacts by date for better performance with large datasets
-- This is optional but recommended for high-volume deployments

-- Create partitioned table (uncomment for large scale deployments)
/*
CREATE TABLE hashed_contacts_partitioned (
    LIKE hashed_contacts INCLUDING ALL
) PARTITION BY RANGE (uploaded_at);

-- Create monthly partitions
CREATE TABLE hashed_contacts_2024_01 PARTITION OF hashed_contacts_partitioned
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE hashed_contacts_2024_02 PARTITION OF hashed_contacts_partitioned
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

-- Add more partitions as needed
*/

-- =============================================================================
-- PERFORMANCE OPTIMIZATION VIEWS
-- =============================================================================

-- View for active contact matches (frequently used query)
CREATE VIEW active_contact_matches AS
SELECT 
    cm.*,
    cpp.max_suggestions_per_day,
    cpp.suggestion_quality_threshold
FROM contact_matches cm
JOIN contact_privacy_preferences cpp ON cm.requester_user_id = cpp.user_id
WHERE cm.expires_at > NOW()
  AND cm.suggestion_dismissed_at IS NULL
  AND cpp.allow_suggestions = true
  AND cm.match_strength >= cpp.suggestion_quality_threshold;

-- View for user contact statistics
CREATE VIEW user_contact_stats AS
SELECT 
    user_id,
    COUNT(*) as total_contacts,
    COUNT(*) FILTER (WHERE identifier_type = 'phone') as phone_contacts,
    COUNT(*) FILTER (WHERE identifier_type = 'email') as email_contacts,
    MAX(uploaded_at) as last_upload,
    MIN(expires_at) as next_expiry
FROM hashed_contacts
WHERE expires_at > NOW()
GROUP BY user_id;

-- =============================================================================
-- TRIGGERS FOR AUTOMATED UPDATES
-- =============================================================================

-- Trigger to update updated_at timestamp on privacy preferences
CREATE OR REPLACE FUNCTION update_contact_privacy_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_contact_privacy_updated_at
    BEFORE UPDATE ON contact_privacy_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_contact_privacy_updated_at();

-- Trigger to increment match_count on hashed_contacts when matched
CREATE OR REPLACE FUNCTION increment_contact_match_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE hashed_contacts 
    SET match_count = match_count + 1,
        last_matched_at = NOW()
    WHERE hashed_identifier = NEW.matched_via_hash;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_increment_match_count
    AFTER INSERT ON contact_matches
    FOR EACH ROW
    EXECUTE FUNCTION increment_contact_match_count();

-- =============================================================================
-- COMMENTS AND DOCUMENTATION
-- =============================================================================

-- Table comments for documentation
COMMENT ON TABLE hashed_contacts IS 'Stores hashed contact identifiers with automatic expiration for privacy compliance';
COMMENT ON TABLE contact_matches IS 'Tracks user-to-user contact matches for friend suggestions with configurable retention';
COMMENT ON TABLE upload_deduplication IS 'Prevents re-processing of duplicate contacts across multiple uploads';
COMMENT ON TABLE upload_batches IS 'Manages batch processing of contact uploads with status tracking and metrics';
COMMENT ON TABLE contact_privacy_preferences IS 'User privacy settings for contact discovery and friend suggestions';
COMMENT ON TABLE contact_system_metrics IS 'System performance and usage metrics for monitoring and optimization';
COMMENT ON TABLE cleanup_audit_log IS 'Audit trail for automated cleanup operations for compliance reporting';

-- Column comments for key fields
COMMENT ON COLUMN hashed_contacts.hashed_identifier IS 'Argon2id hash of normalized contact identifier (phone/email)';
COMMENT ON COLUMN hashed_contacts.expires_at IS 'Automatic expiration timestamp for privacy compliance (max 90 days)';
COMMENT ON COLUMN contact_matches.match_strength IS 'Confidence score from 0.00 to 1.00 indicating match quality';
COMMENT ON COLUMN upload_deduplication.contact_hash_signature IS 'Hash of the contact hash for deduplication tracking';

-- =============================================================================
-- SECURITY CONSTRAINTS
-- =============================================================================

-- Ensure expires_at is never more than 90 days from upload
ALTER TABLE hashed_contacts 
ADD CONSTRAINT check_expires_at_max_90_days 
CHECK (expires_at <= uploaded_at + INTERVAL '90 days');

-- Ensure contact matches expire within reasonable timeframe
ALTER TABLE contact_matches 
ADD CONSTRAINT check_match_expires_reasonable 
CHECK (expires_at <= created_at + INTERVAL '180 days');

-- Ensure upload deduplication doesn't exceed max retention
ALTER TABLE upload_deduplication 
ADD CONSTRAINT check_dedup_expires_max_retention 
CHECK (expires_at <= first_uploaded_at + INTERVAL '365 days');

-- =============================================================================
-- PERFORMANCE MONITORING QUERIES
-- =============================================================================

-- Query to check index usage
CREATE VIEW index_usage_stats AS
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes 
WHERE schemaname = 'public' 
  AND tablename IN ('hashed_contacts', 'contact_matches', 'upload_deduplication')
ORDER BY idx_scan DESC;

-- Query to monitor table sizes
CREATE VIEW table_size_stats AS
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('hashed_contacts', 'contact_matches', 'upload_deduplication', 'upload_batches')
ORDER BY size_bytes DESC;

-- =============================================================================
-- SCHEMA VALIDATION
-- =============================================================================

-- Function to validate schema integrity
CREATE OR REPLACE FUNCTION validate_contact_schema()
RETURNS TABLE(check_name TEXT, status TEXT, details TEXT) AS $$
BEGIN
    -- Check for required tables
    RETURN QUERY
    SELECT 'required_tables' as check_name,
           CASE WHEN COUNT(*) = 7 THEN 'PASS' ELSE 'FAIL' END as status,
           'Found ' || COUNT(*) || ' of 7 required tables' as details
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name IN ('hashed_contacts', 'contact_matches', 'upload_deduplication', 
                         'upload_batches', 'contact_privacy_preferences', 
                         'contact_system_metrics', 'cleanup_audit_log');
    
    -- Check for required indexes
    RETURN QUERY
    SELECT 'required_indexes' as check_name,
           CASE WHEN COUNT(*) >= 15 THEN 'PASS' ELSE 'FAIL' END as status,
           'Found ' || COUNT(*) || ' indexes on contact tables' as details
    FROM pg_indexes 
    WHERE schemaname = 'public' 
      AND tablename LIKE '%contact%' OR tablename LIKE '%upload%';
    
    -- Check cleanup functions exist
    RETURN QUERY
    SELECT 'cleanup_functions' as check_name,
           CASE WHEN COUNT(*) = 4 THEN 'PASS' ELSE 'FAIL' END as status,
           'Found ' || COUNT(*) || ' of 4 cleanup functions' as details
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
      AND p.proname LIKE 'cleanup_%';
END;
$$ LANGUAGE plpgsql;

-- Run schema validation
-- SELECT * FROM validate_contact_schema();