-- Migration: Add created_by to core.attractions and tighten RLS
-- Date: 2026-01-22

-- Add column to link attractions to CMS users
ALTER TABLE core.attractions
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES core.cms_users(id) ON DELETE SET NULL;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_attractions_created_by ON core.attractions(created_by);

-- Drop permissive policy (if present)
DROP POLICY IF EXISTS "Authenticated users can manage attractions" ON core.attractions;

-- Policy: Admins (cms_users.role IN ('admin','super_admin')) can do everything
DROP POLICY IF EXISTS "attractions_admin_manage" ON core.attractions;
CREATE POLICY "attractions_admin_manage" ON core.attractions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    )
  );

-- Policy: Owners (created_by matches caller) can manage their own attractions
DROP POLICY IF EXISTS "attractions_owner_manage" ON core.attractions;
CREATE POLICY "attractions_owner_manage" ON core.attractions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.id = created_by
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.id = created_by
    )
  );

-- Policy: Allow anon (public) read of approved attractions (for public map views)
DROP POLICY IF EXISTS "attractions_public_select_approved" ON core.attractions;
CREATE POLICY "attractions_public_select_approved" ON core.attractions
  FOR SELECT
  TO anon
  USING (approved = true);

-- Policies: related tables (descriptions, trigger points, coordinates)

-- attraction_descriptions: admins or owners (via attractions.created_by) can manage
DROP POLICY IF EXISTS "attraction_descriptions_admin_manage" ON core.attraction_descriptions;
CREATE POLICY "attraction_descriptions_admin_manage" ON core.attraction_descriptions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    )
  );

DROP POLICY IF EXISTS "attraction_descriptions_owner_manage" ON core.attraction_descriptions;
CREATE POLICY "attraction_descriptions_owner_manage" ON core.attraction_descriptions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM core.attractions a
      JOIN core.cms_users cu ON a.created_by = cu.id
      WHERE a.id = core.attraction_descriptions.attraction_id
        AND cu.email = current_setting('request.jwt.claims.email', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.attractions a
      JOIN core.cms_users cu ON a.created_by = cu.id
      WHERE a.id = core.attraction_descriptions.attraction_id
        AND cu.email = current_setting('request.jwt.claims.email', true)
    )
  );

-- attraction_trigger_points: admins or owners
DROP POLICY IF EXISTS "attraction_trigger_points_admin_manage" ON core.attraction_trigger_points;
CREATE POLICY "attraction_trigger_points_admin_manage" ON core.attraction_trigger_points
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    )
  );

DROP POLICY IF EXISTS "attraction_trigger_points_owner_manage" ON core.attraction_trigger_points;
CREATE POLICY "attraction_trigger_points_owner_manage" ON core.attraction_trigger_points
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM core.attractions a
      JOIN core.cms_users cu ON a.created_by = cu.id
      WHERE a.id = core.attraction_trigger_points.attraction_id
        AND cu.email = current_setting('request.jwt.claims.email', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.attractions a
      JOIN core.cms_users cu ON a.created_by = cu.id
      WHERE a.id = core.attraction_trigger_points.attraction_id
        AND cu.email = current_setting('request.jwt.claims.email', true)
    )
  );

-- attraction_coordinate: admins or owners (coordinate belongs to attraction)
DROP POLICY IF EXISTS "attraction_coordinate_admin_manage" ON core.attraction_coordinate;
CREATE POLICY "attraction_coordinate_admin_manage" ON core.attraction_coordinate
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    )
  );

DROP POLICY IF EXISTS "attraction_coordinate_owner_manage" ON core.attraction_coordinate;
CREATE POLICY "attraction_coordinate_owner_manage" ON core.attraction_coordinate
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM core.attractions a
      JOIN core.cms_users cu ON a.created_by = cu.id
      WHERE a.id = core.attraction_coordinate.attraction_id
        AND cu.email = current_setting('request.jwt.claims.email', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.attractions a
      JOIN core.cms_users cu ON a.created_by = cu.id
      WHERE a.id = core.attraction_coordinate.attraction_id
        AND cu.email = current_setting('request.jwt.claims.email', true)
    )
  );

-- Verification: show policies for attractions
SELECT policyname, permissive, roles FROM pg_policies WHERE tablename = 'attractions';
