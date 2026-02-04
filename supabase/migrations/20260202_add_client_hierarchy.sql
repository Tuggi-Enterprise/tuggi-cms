-- Migration: Add Client Hierarchy Support
-- Purpose: Enable client-based ownership of POIs and multi-user client accounts
-- Date: 2025-02-02

-- ============================================
-- 1. ADD client_id TO cms_users TABLE
-- ============================================

-- Add column
ALTER TABLE core.cms_users
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES core.clients(id) ON DELETE SET NULL;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_cms_users_client_id ON core.cms_users(client_id);

-- Constraint: Only 'client' role users can have client_id assigned
-- Note: Enforce at application level and via triggers
CREATE OR REPLACE FUNCTION core.validate_cms_user_client_id()
RETURNS TRIGGER AS $$
BEGIN
  -- If role is 'client', client_id must be provided
  IF NEW.role = 'client' AND NEW.client_id IS NULL THEN
    RAISE EXCEPTION 'CMS user with role "client" must have client_id assigned';
  END IF;
  
  -- If role is not 'client', client_id must be NULL
  IF NEW.role != 'client' AND NEW.client_id IS NOT NULL THEN
    NEW.client_id := NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if present
DROP TRIGGER IF EXISTS trigger_validate_cms_user_client_id ON core.cms_users;

-- Create trigger
CREATE TRIGGER trigger_validate_cms_user_client_id
  BEFORE INSERT OR UPDATE ON core.cms_users
  FOR EACH ROW
  EXECUTE FUNCTION core.validate_cms_user_client_id();

-- ============================================
-- 2. ADD OWNERSHIP FIELDS TO attractions TABLE
-- ============================================

-- Add owner_id (reference to client who owns the POI)
ALTER TABLE core.attractions
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES core.clients(id) ON DELETE SET NULL;

-- Add user_id to track who created the record (alternative name for created_by when dealing with client context)
-- Note: user_id and created_by will both exist and refer to the same cms_user

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_attractions_owner_id ON core.attractions(owner_id);

-- ============================================
-- 3. POPULATE owner_id FROM cms_users.client_id
-- ============================================

-- For all existing attractions, populate owner_id from the creator's client_id
-- This assumes created_by refers to a cms_user record
UPDATE core.attractions a
SET owner_id = cu.client_id
FROM core.cms_users cu
WHERE a.created_by = cu.id AND cu.client_id IS NOT NULL;

-- ============================================
-- 4. UPDATE RLS POLICIES FOR NEW OWNERSHIP MODEL
-- ============================================

-- Drop old policies
DROP POLICY IF EXISTS "attractions_admin_manage" ON core.attractions;
DROP POLICY IF EXISTS "attractions_owner_manage" ON core.attractions;
DROP POLICY IF EXISTS "attractions_public_read_approved" ON core.attractions;

-- New policy: Admin can do everything
CREATE POLICY "attractions_admin_full_access" ON core.attractions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true)
      AND cu.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true)
      AND cu.role IN ('admin', 'super_admin')
    )
  );

-- New policy: Owner (created_by matches) can manage
CREATE POLICY "attractions_creator_manage" ON core.attractions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true)
      AND cu.id = created_by
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true)
      AND cu.id = created_by
    )
  );

-- New policy: Client users can manage POIs owned by their client
CREATE POLICY "attractions_client_manage_owned" ON core.attractions
  FOR ALL
  TO authenticated
  USING (
    -- User must be part of the owner_client
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true)
      AND cu.client_id = attractions.owner_id
      AND cu.role = 'client'
    )
    OR
    -- Or linked via client_cms_users with proper role
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      JOIN core.client_cms_users ccu ON cu.id = ccu.cms_user_id
      WHERE cu.email = current_setting('request.jwt.claims.email', true)
      AND ccu.client_id = attractions.owner_id
      AND ccu.client_role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true)
      AND cu.client_id = attractions.owner_id
      AND cu.role = 'client'
    )
    OR
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      JOIN core.client_cms_users ccu ON cu.id = ccu.cms_user_id
      WHERE cu.email = current_setting('request.jwt.claims.email', true)
      AND ccu.client_id = attractions.owner_id
      AND ccu.client_role IN ('owner', 'manager')
    )
  );

-- Policy: Public read of approved attractions (for public app views)
CREATE POLICY "attractions_public_read_approved" ON core.attractions
  FOR SELECT
  TO anon
  USING (approved = true);

-- ============================================
-- 5. CREATE FUNCTION TO SET owner_id ON INSERT
-- ============================================

-- When inserting an attraction, if created_by is provided, auto-set owner_id from cms_user's client_id
CREATE OR REPLACE FUNCTION core.set_attraction_owner_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- If created_by is set and owner_id is NULL, populate owner_id from cms_user's client_id
  IF NEW.created_by IS NOT NULL AND NEW.owner_id IS NULL THEN
    SELECT client_id INTO NEW.owner_id
    FROM core.cms_users
    WHERE id = NEW.created_by;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if present
DROP TRIGGER IF EXISTS trigger_set_attraction_owner_on_insert ON core.attractions;

-- Create trigger
CREATE TRIGGER trigger_set_attraction_owner_on_insert
  BEFORE INSERT ON core.attractions
  FOR EACH ROW
  EXECUTE FUNCTION core.set_attraction_owner_on_insert();

-- ============================================
-- 6. ADD COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON COLUMN core.cms_users.client_id IS 'References the client this CMS user belongs to. Only populated for users with role="client"';
COMMENT ON COLUMN core.attractions.owner_id IS 'References the client who owns this attraction/POI. Set automatically from creator''s client_id';
COMMENT ON COLUMN core.attractions.created_by IS 'References the CMS user who created this attraction (for audit trail)';

-- ============================================
-- 7. GRANT PERMISSIONS
-- ============================================

-- Ensure authenticated users can read/modify attractions per RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON core.attractions TO authenticated;
GRANT SELECT ON core.attractions TO anon;

-- Service role gets full access
GRANT ALL ON core.attractions TO service_role;

-- Grant permissions on new functions
GRANT EXECUTE ON FUNCTION core.validate_cms_user_client_id TO authenticated;
GRANT EXECUTE ON FUNCTION core.validate_cms_user_client_id TO service_role;
GRANT EXECUTE ON FUNCTION core.set_attraction_owner_on_insert TO authenticated;
GRANT EXECUTE ON FUNCTION core.set_attraction_owner_on_insert TO service_role;
