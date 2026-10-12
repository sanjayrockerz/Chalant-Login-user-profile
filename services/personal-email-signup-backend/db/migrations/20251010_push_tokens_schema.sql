-- Push Tokens Database Schema
-- Supports multi-device notifications for iOS (APNs) and Android (FCM)
-- with token lifecycle management and observability

-- Create enum types for platform and token type
CREATE TYPE push_platform AS ENUM ('ios', 'android');
CREATE TYPE push_token_type AS ENUM ('fcm', 'apns');

-- Push tokens table with comprehensive token lifecycle management
CREATE TABLE push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Token data (consider hashing/encryption based on security policy)
  token VARCHAR(4096) NOT NULL, -- FCM tokens can be up to 4KB
  token_hash VARCHAR(64), -- SHA-256 hash for duplicate detection if tokens are encrypted
  
  -- Platform and token type classification
  platform push_platform NOT NULL,
  token_type push_token_type NOT NULL,
  
  -- Device metadata for targeting and analytics
  device_metadata JSONB DEFAULT '{}', -- {model, os_version, app_version, device_id}
  
  -- Token lifecycle management
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_validated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Token status and health
  active BOOLEAN DEFAULT TRUE,
  failure_count INTEGER DEFAULT 0,
  last_failure_at TIMESTAMP WITH TIME ZONE,
  failure_reason TEXT,
  
  -- Audit and tenant isolation
  tenant_id VARCHAR(50) NOT NULL DEFAULT 'default',
  created_by VARCHAR(100), -- API client or admin user
  
  -- Soft deletion and archival
  deleted_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT valid_platform_token_type CHECK (
    (platform = 'ios' AND token_type = 'apns') OR
    (platform = 'android' AND token_type = 'fcm')
  )
);

-- Unique constraint to prevent duplicate registrations while allowing multi-device
-- Uses token_hash if available (for encrypted tokens), otherwise raw token
CREATE UNIQUE INDEX idx_push_tokens_unique_user_token 
ON push_tokens (user_id, COALESCE(token_hash, token), platform) 
WHERE active = TRUE AND deleted_at IS NULL;

-- Performance indexes for common query patterns
CREATE INDEX idx_push_tokens_user_active 
ON push_tokens (user_id, active, platform) 
WHERE active = TRUE AND deleted_at IS NULL;

CREATE INDEX idx_push_tokens_validation 
ON push_tokens (last_validated_at, platform) 
WHERE active = TRUE AND deleted_at IS NULL;

CREATE INDEX idx_push_tokens_failures 
ON push_tokens (failure_count, last_failure_at) 
WHERE active = TRUE AND failure_count > 0;

CREATE INDEX idx_push_tokens_tenant 
ON push_tokens (tenant_id, active) 
WHERE active = TRUE AND deleted_at IS NULL;

-- Composite index for notification targeting
CREATE INDEX idx_push_tokens_targeting 
ON push_tokens (tenant_id, platform, active, last_validated_at) 
WHERE active = TRUE AND deleted_at IS NULL;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_push_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER push_tokens_updated_at
  BEFORE UPDATE ON push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_push_tokens_updated_at();

-- Push token audit log for compliance and debugging
CREATE TABLE push_token_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID REFERENCES push_tokens(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Audit event details
  event_type VARCHAR(50) NOT NULL, -- 'registered', 'updated', 'validated', 'failed', 'deleted'
  event_data JSONB DEFAULT '{}', -- Additional context like failure reason, device changes
  
  -- Request context
  correlation_id VARCHAR(100),
  tenant_id VARCHAR(50) NOT NULL DEFAULT 'default',
  user_agent TEXT,
  ip_address INET,
  
  -- Audit metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by VARCHAR(100), -- API client, admin user, or system process
  
  -- Compliance retention (7 years for audit logs)
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 years')
);

-- Indexes for audit querying and compliance
CREATE INDEX idx_push_token_audit_user_event 
ON push_token_audit (user_id, event_type, created_at DESC);

CREATE INDEX idx_push_token_audit_correlation 
ON push_token_audit (correlation_id, created_at DESC);

CREATE INDEX idx_push_token_audit_expiration 
ON push_token_audit (expires_at);

-- Token validation tracking for FCM/APNs feedback processing
CREATE TABLE push_token_validation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL REFERENCES push_tokens(id) ON DELETE CASCADE,
  
  -- Validation details
  validation_type VARCHAR(50) NOT NULL, -- 'registration', 'periodic', 'feedback', 'delivery'
  validation_result VARCHAR(50) NOT NULL, -- 'valid', 'invalid', 'expired', 'unregistered'
  validation_source VARCHAR(50) NOT NULL, -- 'fcm_api', 'apns_api', 'delivery_feedback'
  
  -- Validation response data
  response_code INTEGER,
  response_message TEXT,
  response_data JSONB DEFAULT '{}',
  
  -- Timing and context
  validated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  correlation_id VARCHAR(100),
  tenant_id VARCHAR(50) NOT NULL DEFAULT 'default'
);

CREATE INDEX idx_push_token_validation_token 
ON push_token_validation (token_id, validated_at DESC);

CREATE INDEX idx_push_token_validation_result 
ON push_token_validation (validation_result, validated_at DESC);

-- Notification delivery tracking (for feedback loop)
CREATE TABLE push_notification_delivery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL REFERENCES push_tokens(id) ON DELETE CASCADE,
  
  -- Notification details
  notification_id VARCHAR(100) NOT NULL, -- External tracking ID
  message_type VARCHAR(50) NOT NULL, -- 'alert', 'badge', 'silent', 'data'
  
  -- Delivery status
  delivery_status VARCHAR(50) NOT NULL, -- 'sent', 'delivered', 'failed', 'expired'
  delivery_attempt INTEGER DEFAULT 1,
  
  -- Platform-specific response
  platform_message_id VARCHAR(200), -- FCM message ID or APNs identifier
  platform_response_code INTEGER,
  platform_error_code VARCHAR(50),
  platform_error_message TEXT,
  
  -- Timing
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  delivered_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE,
  
  -- Context
  correlation_id VARCHAR(100),
  tenant_id VARCHAR(50) NOT NULL DEFAULT 'default'
);

CREATE INDEX idx_push_notification_delivery_token 
ON push_notification_delivery (token_id, sent_at DESC);

CREATE INDEX idx_push_notification_delivery_status 
ON push_notification_delivery (delivery_status, sent_at DESC);

CREATE INDEX idx_push_notification_delivery_correlation 
ON push_notification_delivery (correlation_id, sent_at DESC);

-- Function to soft-delete expired or invalid tokens
CREATE OR REPLACE FUNCTION cleanup_invalid_push_tokens(
  max_failure_count INTEGER DEFAULT 5,
  failure_window_days INTEGER DEFAULT 7
)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Soft delete tokens with too many consecutive failures
  UPDATE push_tokens 
  SET 
    active = FALSE,
    deleted_at = NOW(),
    failure_reason = COALESCE(failure_reason, 'Exceeded failure threshold')
  WHERE 
    active = TRUE 
    AND failure_count >= max_failure_count
    AND last_failure_at > (NOW() - (failure_window_days || ' days')::INTERVAL)
    AND deleted_at IS NULL;
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log cleanup operation
  INSERT INTO push_token_audit (
    user_id, 
    event_type, 
    event_data, 
    created_by
  )
  SELECT 
    user_id,
    'cleanup_invalid',
    jsonb_build_object(
      'reason', 'exceeded_failure_threshold',
      'failure_count', failure_count,
      'max_failure_count', max_failure_count,
      'failure_window_days', failure_window_days
    ),
    'system_cleanup'
  FROM push_tokens 
  WHERE deleted_at = NOW() AND NOT active;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to mark tokens for validation based on age
CREATE OR REPLACE FUNCTION mark_tokens_for_validation(
  validation_interval_days INTEGER DEFAULT 7
)
RETURNS INTEGER AS $$
DECLARE
  marked_count INTEGER;
BEGIN
  -- Mark tokens that haven't been validated recently
  UPDATE push_tokens 
  SET last_validated_at = '1970-01-01'::TIMESTAMP WITH TIME ZONE
  WHERE 
    active = TRUE 
    AND deleted_at IS NULL
    AND last_validated_at < (NOW() - (validation_interval_days || ' days')::INTERVAL);
  
  GET DIAGNOSTICS marked_count = ROW_COUNT;
  
  RETURN marked_count;
END;
$$ LANGUAGE plpgsql;

-- View for active tokens by user (for application queries)
CREATE VIEW active_push_tokens AS
SELECT 
  id,
  user_id,
  token,
  platform,
  token_type,
  device_metadata,
  created_at,
  updated_at,
  last_validated_at,
  last_used_at,
  failure_count,
  tenant_id
FROM push_tokens 
WHERE 
  active = TRUE 
  AND deleted_at IS NULL 
  AND failure_count < 3; -- Only include healthy tokens

-- View for token health monitoring
CREATE VIEW push_token_health AS
SELECT 
  tenant_id,
  platform,
  COUNT(*) as total_tokens,
  COUNT(*) FILTER (WHERE active = TRUE AND deleted_at IS NULL) as active_tokens,
  COUNT(*) FILTER (WHERE failure_count > 0) as failing_tokens,
  COUNT(*) FILTER (WHERE last_validated_at < NOW() - INTERVAL '7 days') as stale_tokens,
  AVG(failure_count) as avg_failure_count,
  MAX(last_validated_at) as latest_validation,
  MIN(last_validated_at) as oldest_validation
FROM push_tokens 
GROUP BY tenant_id, platform;

-- Indexes for views
CREATE INDEX idx_active_push_tokens_user 
ON push_tokens (user_id) 
WHERE active = TRUE AND deleted_at IS NULL AND failure_count < 3;

-- Grant appropriate permissions (adjust based on your user roles)
-- GRANT SELECT, INSERT, UPDATE ON push_tokens TO app_user;
-- GRANT SELECT, INSERT ON push_token_audit TO app_user;
-- GRANT SELECT, INSERT ON push_token_validation TO app_user;
-- GRANT SELECT, INSERT ON push_notification_delivery TO app_user;
-- GRANT SELECT ON active_push_tokens TO app_user;
-- GRANT SELECT ON push_token_health TO readonly_user;

COMMENT ON TABLE push_tokens IS 'Stores push notification tokens with lifecycle management for iOS (APNs) and Android (FCM)';
COMMENT ON COLUMN push_tokens.token IS 'Raw push token from FCM/APNs - consider encryption for sensitive environments';
COMMENT ON COLUMN push_tokens.token_hash IS 'SHA-256 hash of token for duplicate detection when tokens are encrypted';
COMMENT ON COLUMN push_tokens.device_metadata IS 'JSONB containing device model, OS version, app version, and stable device identifier';
COMMENT ON COLUMN push_tokens.failure_count IS 'Number of consecutive delivery failures - tokens with high counts are candidates for cleanup';
COMMENT ON TABLE push_token_audit IS 'Audit trail for push token operations with 7-year retention for compliance';
COMMENT ON TABLE push_token_validation IS 'Tracks validation attempts against FCM/APNs APIs for token health monitoring';
COMMENT ON FUNCTION cleanup_invalid_push_tokens IS 'Soft-deletes tokens exceeding failure threshold within specified time window';
COMMENT ON VIEW active_push_tokens IS 'Application view showing only healthy, active tokens for notification targeting';