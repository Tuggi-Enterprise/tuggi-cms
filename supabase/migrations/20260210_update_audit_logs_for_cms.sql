-- =============================================================================
-- Update audit_logs schema for CMS audit requirements
-- Adds required fields and retention-friendly indexes while preserving
-- backwards compatibility with existing audit logging.
-- =============================================================================

-- Ensure table exists (created in 20260120_create_audit_logs.sql)

-- Add required columns (nullable per LGPD and functional requirements)
ALTER TABLE core.audit_logs
  ADD COLUMN IF NOT EXISTS user_email TEXT,
  ADD COLUMN IF NOT EXISTS entity TEXT,
  ADD COLUMN IF NOT EXISTS entity_id TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS ip_address TEXT;

-- Allow nullable user_id (previously NOT NULL)
ALTER TABLE core.audit_logs
  ALTER COLUMN user_id DROP NOT NULL;

-- Remove overly restrictive action constraint (kept for backwards compatibility)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'audit_logs_valid_action'
      AND conrelid = 'core.audit_logs'::regclass
  ) THEN
    ALTER TABLE core.audit_logs DROP CONSTRAINT audit_logs_valid_action;
  END IF;
END $$;

-- Backfill new columns from legacy fields when possible
UPDATE core.audit_logs
SET
  entity = COALESCE(entity, resource_type),
  entity_id = COALESCE(entity_id, resource_id),
  ip_address = COALESCE(ip_address, request_ip)
WHERE entity IS NULL OR entity_id IS NULL OR ip_address IS NULL;

-- Helpful indexes for admin queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_email
  ON core.audit_logs(user_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON core.audit_logs(entity, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created_at
  ON core.audit_logs(action, created_at DESC);

-- =============================================================================
-- Retention: keep up to 90 days of logs (cleanup via pg_cron)
-- =============================================================================

CREATE OR REPLACE FUNCTION core.cleanup_audit_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM core.audit_logs
  WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$;

-- Schedule daily cleanup at 02:30 server time
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'audit-logs-cleanup',
      '30 2 * * *',
      'SELECT core.cleanup_audit_logs();'
    );
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION core.cleanup_audit_logs() TO postgres;
