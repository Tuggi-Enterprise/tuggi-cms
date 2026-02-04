-- Migration: Create Custom Routes Tables
-- Purpose: Store user-created tourist routes and track their usage
-- Date: 2026-02-04
-- Follows project conventions: core schema for reference data, drive schema for transactional/log data

-- ============================================
-- 1. CREATE CUSTOM ROUTES TABLE (Reference Data - core schema)
-- ============================================
CREATE TABLE IF NOT EXISTS core.custom_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic Info
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Ownership (SSOT: linked to clients table)
  client_id UUID NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  
  -- Audit: who created/updated
  created_by UUID REFERENCES core.cms_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES core.cms_users(id) ON DELETE SET NULL,
  
  -- Spatial Data: Full route geometry as LineString
  -- Using GEOGRAPHY for accurate distance calculations
  geometry GEOGRAPHY(LINESTRING, 4326),
  
  -- Original control points used to generate the route (for editing)
  -- Format: [{ lat: number, lng: number, type?: 'start' | 'via' | 'end' }]
  waypoints JSONB DEFAULT '[]',
  
  -- Metadata: distance (meters), duration (seconds), bounds, source (osrm/manual)
  metadata JSONB DEFAULT '{}',
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 2. CREATE INDEXES (Performance)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_custom_routes_client_id ON core.custom_routes(client_id);
CREATE INDEX IF NOT EXISTS idx_custom_routes_created_by ON core.custom_routes(created_by);
CREATE INDEX IF NOT EXISTS idx_custom_routes_is_active ON core.custom_routes(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_custom_routes_geometry ON core.custom_routes USING GIST(geometry);

-- ============================================
-- 3. ENABLE RLS
-- ============================================
ALTER TABLE core.custom_routes ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 4. RLS POLICIES
-- ============================================
-- Note: cms_users.id is NOT the same as auth.uid(), so we must lookup by email

-- Policy: Admin can do everything
DROP POLICY IF EXISTS "custom_routes_admin_all" ON core.custom_routes;
CREATE POLICY "custom_routes_admin_all" ON core.custom_routes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM core.cms_users
      WHERE email = (auth.jwt() ->> 'email') AND role = 'admin' AND is_active = true
    )
  );

-- Policy: Client users can view routes for their company
DROP POLICY IF EXISTS "custom_routes_client_select" ON core.custom_routes;
CREATE POLICY "custom_routes_client_select" ON core.custom_routes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM core.client_cms_users ccu
      JOIN core.cms_users cu ON cu.id = ccu.cms_user_id
      WHERE cu.email = (auth.jwt() ->> 'email') 
      AND cu.is_active = true
      AND ccu.client_id = core.custom_routes.client_id
    )
  );

-- Policy: Client users (owners/managers) can insert routes
DROP POLICY IF EXISTS "custom_routes_client_insert" ON core.custom_routes;
CREATE POLICY "custom_routes_client_insert" ON core.custom_routes
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.client_cms_users ccu
      JOIN core.cms_users cu ON cu.id = ccu.cms_user_id
      WHERE cu.email = (auth.jwt() ->> 'email') 
      AND cu.is_active = true
      AND ccu.client_id = core.custom_routes.client_id 
      AND ccu.client_role IN ('owner', 'manager')
    )
  );

-- Policy: Client users (owners/managers) can update routes
DROP POLICY IF EXISTS "custom_routes_client_update" ON core.custom_routes;
CREATE POLICY "custom_routes_client_update" ON core.custom_routes
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM core.client_cms_users ccu
      JOIN core.cms_users cu ON cu.id = ccu.cms_user_id
      WHERE cu.email = (auth.jwt() ->> 'email') 
      AND cu.is_active = true
      AND ccu.client_id = core.custom_routes.client_id 
      AND ccu.client_role IN ('owner', 'manager')
    )
  );

-- ============================================
-- 5. GRANT PERMISSIONS
-- ============================================
GRANT SELECT, INSERT, UPDATE, DELETE ON core.custom_routes TO authenticated;
GRANT ALL ON core.custom_routes TO service_role;

-- ============================================
-- 6. TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION core.update_custom_routes_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_custom_routes_timestamp ON core.custom_routes;
CREATE TRIGGER trigger_update_custom_routes_timestamp
  BEFORE UPDATE ON core.custom_routes
  FOR EACH ROW
  EXECUTE FUNCTION core.update_custom_routes_timestamp();
