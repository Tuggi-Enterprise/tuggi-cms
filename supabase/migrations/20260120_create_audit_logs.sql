/**
 * Audit Logs Table Migration
 * 
 * Creates audit_logs table in core schema with:
 * - User tracking (user_id, request_ip, user_agent)
 * - Action tracking (action, resource_type, resource_id, status)
 * - Details storage (JSONB for flexible metadata)
 * - Timestamps and indexes for efficient querying
 * 
 * Deploy: Copy SQL and run in Supabase SQL Editor
 */

-- ============================================
-- CREATE AUDIT_LOGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS core.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User and Request Info
  user_id TEXT NOT NULL DEFAULT 'anonymous',
  request_ip TEXT NOT NULL DEFAULT 'unknown',
  user_agent TEXT,
  
  -- Action Info
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success', -- success, failure, partial
  
  -- Details and Error
  details JSONB DEFAULT '{}',
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT audit_logs_valid_action CHECK (action IN (
    'create_poi', 'update_poi', 'delete_poi',
    'generate_description', 'generate_audio', 'generate_trigger_points',
    'correct_city', 'store_image', 'store_audio',
    'verify_batch', 'extract_images', 'process_images',
    'api_call', 'api_error'
  )),
  
  CONSTRAINT audit_logs_valid_status CHECK (status IN (
    'success', 'failure', 'partial'
  ))
);

-- ============================================
-- INDEXES (for efficient querying)
-- ============================================

-- Query by user (who did it?)
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id 
  ON core.audit_logs(user_id, created_at DESC);

-- Query by action (what happened?)
CREATE INDEX IF NOT EXISTS idx_audit_logs_action 
  ON core.audit_logs(action, created_at DESC);

-- Query by resource (what was affected?)
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource 
  ON core.audit_logs(resource_type, resource_id, created_at DESC);

-- Query by timestamp (when did it happen?)
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp 
  ON core.audit_logs(created_at DESC);

-- Query failures quickly
CREATE INDEX IF NOT EXISTS idx_audit_logs_failures 
  ON core.audit_logs(status, created_at DESC) 
  WHERE status = 'failure';

-- Query by IP (security investigations)
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip 
  ON core.audit_logs(request_ip, created_at DESC);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE core.audit_logs ENABLE ROW LEVEL SECURITY;

-- Anonymous policy - all rows visible (can be restricted later if needed)
-- This allows Edge Functions to read logs for monitoring
CREATE POLICY audit_logs_view 
  ON core.audit_logs 
  FOR SELECT 
  USING (true);

-- Service role can insert logs
CREATE POLICY audit_logs_insert 
  ON core.audit_logs 
  FOR INSERT 
  WITH CHECK (true);

-- ============================================
-- COMMENTS (documentation)
-- ============================================

COMMENT ON TABLE core.audit_logs IS 
  'Audit trail for all sensitive operations. Logs user actions, timestamps, and operation details for compliance and security monitoring.';

COMMENT ON COLUMN core.audit_logs.user_id IS 
  'User ID from JWT token or "anonymous" for unauthenticated requests';

COMMENT ON COLUMN core.audit_logs.request_ip IS 
  'Client IP address (extracted from CF-Connecting-IP, X-Forwarded-For, or X-Real-IP)';

COMMENT ON COLUMN core.audit_logs.action IS 
  'Type of action performed (create_poi, update_poi, delete_poi, generate_description, etc.)';

COMMENT ON COLUMN core.audit_logs.resource_type IS 
  'Type of resource affected (poi, image, audio, batch, etc.)';

COMMENT ON COLUMN core.audit_logs.resource_id IS 
  'ID of the specific resource affected';

COMMENT ON COLUMN core.audit_logs.status IS 
  'Operation status: success, failure, or partial';

COMMENT ON COLUMN core.audit_logs.details IS 
  'JSONB object with additional operation details (duration, counts, specific fields modified, etc.)';

COMMENT ON COLUMN core.audit_logs.error_message IS 
  'Error message if operation failed';

COMMENT ON COLUMN core.audit_logs.created_at IS 
  'Timestamp when the operation was logged';
