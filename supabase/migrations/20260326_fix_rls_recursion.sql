-- ============================================================================
-- Migration: Fix RLS Infinite Recursion
-- Purpose: Break the circular dependency between core.clients and core.client_cms_users
-- Date: 2026-03-26
-- ============================================================================

-- 1. Helper Function (SECURITY DEFINER bypasses RLS on internal queries)
CREATE OR REPLACE FUNCTION core.is_client_member(p_client_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM core.client_cms_users 
        WHERE client_id = p_client_id AND cms_user_id = p_user_id
    ) OR EXISTS (
        SELECT 1 FROM core.clients
        WHERE id = p_client_id AND cms_user_id = p_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Update core.clients policies
DROP POLICY IF EXISTS "clients_select_admin_only" ON core.clients;

CREATE POLICY "clients_select_policy_fixed" ON core.clients
  FOR SELECT
  USING (
    -- Admin role check (direct check on cms_users table is safe as long as it doesn't loop)
    EXISTS (
      SELECT 1 FROM core.cms_users
      WHERE id = auth.uid()::uuid AND role = 'admin' AND is_active = true
    )
    OR
    -- Direct owner check
    cms_user_id = auth.uid()::uuid
    OR
    -- Member check via security definer function (breaks recursion)
    core.is_client_member(id, auth.uid()::uuid)
  );

-- 3. Update core.client_cms_users policies
DROP POLICY IF EXISTS "client_cms_users_select_policy" ON core.client_cms_users;

CREATE POLICY "client_cms_users_select_policy_fixed" ON core.client_cms_users
  FOR SELECT
  USING (
    -- Admin check
    EXISTS (
      SELECT 1 FROM core.cms_users
      WHERE id = auth.uid()::uuid AND role = 'admin'
    )
    OR
    -- Use the helper function here too
    core.is_client_member(client_id, auth.uid()::uuid)
    OR
    -- Direct link check
    cms_user_id = auth.uid()::uuid
  );

-- 4. Update core.attractions policies (if any)
-- The attractions_client_manage_owned policy might still trigger recursion 
-- if it performs a join that triggers RLS. Using the helper function is safer.

DROP POLICY IF EXISTS "attractions_client_manage_owned" ON core.attractions;

CREATE POLICY "attractions_client_manage_owned_fixed" ON core.attractions
  FOR ALL
  TO authenticated
  USING (
    -- Admin check
    EXISTS (
        SELECT 1 FROM core.cms_users
        WHERE id = auth.uid()::uuid AND role IN ('admin', 'super_admin')
    )
    OR
    -- Check if user is creator
    created_by = auth.uid()::uuid
    OR
    -- Direct member check via function
    core.is_client_member(owner_id, auth.uid()::uuid)
  )
  WITH CHECK (
    EXISTS (
        SELECT 1 FROM core.cms_users
        WHERE id = auth.uid()::uuid AND role IN ('admin', 'super_admin')
    )
    OR
    created_by = auth.uid()::uuid
    OR
    core.is_client_member(owner_id, auth.uid()::uuid)
  );

-- 5. Update clients UPDATE policy to be safer
DROP POLICY IF EXISTS "clients_update_policy" ON core.clients;
CREATE POLICY "clients_update_policy_fixed" ON core.clients
  FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM core.cms_users WHERE id = auth.uid()::uuid AND role = 'admin')
    OR
    cms_user_id = auth.uid()::uuid
  );

-- 6. Permissions
GRANT EXECUTE ON FUNCTION core.is_client_member TO authenticated;
GRANT EXECUTE ON FUNCTION core.is_client_member TO service_role;
