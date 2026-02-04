-- Migration: Create Route Audit Logs and Usage Tables
-- Purpose: Track route modifications and app usage statistics
-- Date: 2026-02-04
-- Schema: drive (transactional/log data)

-- ============================================
-- 1. CREATE CUSTOM ROUTE AUDIT LOGS
-- ============================================
CREATE TABLE IF NOT EXISTS drive.custom_route_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Linked Route
  route_id UUID NOT NULL REFERENCES core.custom_routes(id) ON DELETE CASCADE,
  
  -- Action: CREATE, UPDATE, DELETE, ACTIVATE, DEACTIVATE
  action VARCHAR(50) NOT NULL,
  
  -- Who performed the action (CMS User)
  performer_id UUID REFERENCES core.cms_users(id) ON DELETE SET NULL,
  
  -- Raw changes as JSON (Old vs New)
  changes JSONB DEFAULT '{}',
  
  -- When it happened
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optimize audit log searches
CREATE INDEX IF NOT EXISTS idx_route_audit_route_id ON drive.custom_route_audit_logs(route_id);
CREATE INDEX IF NOT EXISTS idx_route_audit_performer_id ON drive.custom_route_audit_logs(performer_id);
CREATE INDEX IF NOT EXISTS idx_route_audit_created_at ON drive.custom_route_audit_logs(created_at DESC);

-- ============================================
-- 2. CREATE CUSTOM ROUTE USAGE (App side tracking)
-- ============================================
-- Tracks when a user starts/completes a route in the Tuggi App
CREATE TABLE IF NOT EXISTS drive.custom_route_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  route_id UUID NOT NULL REFERENCES core.custom_routes(id) ON DELETE CASCADE,
  
  -- App User who used the route
  user_id UUID NOT NULL, -- References app users (transactional)
  
  -- Action: START, COMPLETE, CANCEL
  action VARCHAR(50) NOT NULL,
  
  -- Metadata: duration_spent, distance_covered, etc.
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_usage_route_id ON drive.custom_route_usage(route_id);
CREATE INDEX IF NOT EXISTS idx_route_usage_user_id ON drive.custom_route_usage(user_id);

-- ============================================
-- 3. ENABLE RLS
-- ============================================
ALTER TABLE drive.custom_route_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive.custom_route_usage ENABLE ROW LEVEL SECURITY;

-- Policy: Admin only for audit logs
DROP POLICY IF EXISTS "route_audit_admin_all" ON drive.custom_route_audit_logs;
CREATE POLICY "route_audit_admin_all" ON drive.custom_route_audit_logs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM core.cms_users
      WHERE email = (auth.jwt() ->> 'email') AND role = 'admin' AND is_active = true
    )
  );

-- Policy: Admin can see all usage; Clients can see usage for their own routes
DROP POLICY IF EXISTS "route_usage_select_policy" ON drive.custom_route_usage;
CREATE POLICY "route_usage_select_policy" ON drive.custom_route_usage
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM core.cms_users
      WHERE email = (auth.jwt() ->> 'email') AND role = 'admin' AND is_active = true
    )
    OR
    EXISTS (
      SELECT 1 FROM core.custom_routes r
      JOIN core.client_cms_users ccu ON r.client_id = ccu.client_id
      JOIN core.cms_users cu ON cu.id = ccu.cms_user_id
      WHERE r.id = drive.custom_route_usage.route_id 
      AND cu.email = (auth.jwt() ->> 'email')
      AND cu.is_active = true
    )
  );

-- ============================================
-- 4. GRANT PERMISSIONS
-- ============================================
GRANT SELECT ON drive.custom_route_audit_logs TO authenticated;
GRANT SELECT ON drive.custom_route_usage TO authenticated;
GRANT ALL ON drive.custom_route_audit_logs TO service_role;
GRANT ALL ON drive.custom_route_usage TO service_role;
