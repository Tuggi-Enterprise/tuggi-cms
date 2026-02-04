-- Migration: Create Custom Route RPC Functions
-- Purpose: Encapsulate route logic and provide secure access via Supabase RPC
-- Date: 2026-02-04
-- Schema: core

-- ============================================
-- 1. GET CUSTOM ROUTES
-- ============================================
-- Returns routes for a specific client with access check
CREATE OR REPLACE FUNCTION core.get_custom_routes(p_client_id UUID)
RETURNS SETOF core.custom_routes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_user_email TEXT := auth.jwt() ->> 'email';
  v_cms_user_id UUID;
  v_is_admin BOOLEAN := false;
BEGIN
  -- Get CMS user by email
  SELECT id, (role = 'admin') INTO v_cms_user_id, v_is_admin 
  FROM core.cms_users 
  WHERE email = v_user_email AND is_active = true;

  -- Security check: User must be admin or belong to the client
  IF NOT COALESCE(v_is_admin, false) AND NOT EXISTS (
    SELECT 1 FROM core.client_cms_users WHERE cms_user_id = v_cms_user_id AND client_id = p_client_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: User does not have access to this client';
  END IF;

  RETURN QUERY
  SELECT * FROM core.custom_routes
  WHERE client_id = p_client_id
  AND is_active = true
  ORDER BY created_at DESC;
END;
$$;

-- ============================================
-- 2. GET CUSTOM ROUTE BY ID
-- ============================================
CREATE OR REPLACE FUNCTION core.get_custom_route(p_id UUID)
RETURNS core.custom_routes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_route core.custom_routes;
  v_user_email TEXT := auth.jwt() ->> 'email';
  v_cms_user_id UUID;
  v_is_admin BOOLEAN := false;
BEGIN
  -- Get CMS user by email
  SELECT id, (role = 'admin') INTO v_cms_user_id, v_is_admin 
  FROM core.cms_users 
  WHERE email = v_user_email AND is_active = true;

  SELECT * INTO v_route FROM core.custom_routes WHERE id = p_id;
  
  IF v_route IS NULL THEN
    RETURN NULL;
  END IF;

  -- Security check: User must be admin or belong to the route's client
  IF NOT COALESCE(v_is_admin, false) AND NOT EXISTS (
    SELECT 1 FROM core.client_cms_users WHERE cms_user_id = v_cms_user_id AND client_id = v_route.client_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: User does not have access to this route';
  END IF;

  RETURN v_route;
END;
$$;

-- ============================================
-- 3. UPSERT CUSTOM ROUTE
-- ============================================
-- Handles both create and update
CREATE OR REPLACE FUNCTION core.upsert_custom_route(
  p_id UUID,
  p_name VARCHAR,
  p_description TEXT,
  p_client_id UUID,
  p_geometry_wkt TEXT,
  p_waypoints JSONB,
  p_metadata JSONB,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS core.custom_routes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_route core.custom_routes;
  v_user_email TEXT := auth.jwt() ->> 'email';
  v_cms_user_id UUID;
  v_final_client_id UUID := p_client_id;
  v_is_admin BOOLEAN := false;
BEGIN
  -- Get CMS user by email (not auth.uid, since cms_users.id is separate from auth user id)
  SELECT id, (role = 'admin') INTO v_cms_user_id, v_is_admin 
  FROM core.cms_users 
  WHERE email = v_user_email AND is_active = true;

  -- If no CMS user found, deny access
  IF v_cms_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: CMS user not found for email %', v_user_email;
  END IF;

  -- If client_id is not provided, try to find the user's client
  IF v_final_client_id IS NULL THEN
    SELECT client_id INTO v_final_client_id 
    FROM core.client_cms_users 
    WHERE cms_user_id = v_cms_user_id 
    LIMIT 1;
  END IF;

  -- Security check: User must be admin OR (belong to the client as owner/manager)
  IF NOT COALESCE(v_is_admin, false) THEN
    IF v_final_client_id IS NULL THEN
      RAISE EXCEPTION 'Unauthorized: No client associated with this user';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM core.client_cms_users 
      WHERE cms_user_id = v_cms_user_id 
      AND client_id = v_final_client_id 
      AND client_role IN ('owner', 'manager')
    ) THEN
      RAISE EXCEPTION 'Unauthorized: User does not have permission to modify routes for this client';
    END IF;
  END IF;

  IF p_id IS NOT NULL AND EXISTS (SELECT 1 FROM core.custom_routes WHERE id = p_id) THEN
    -- UPDATE
    UPDATE core.custom_routes
    SET
      name = p_name,
      description = p_description,
      client_id = v_final_client_id,
      geometry = ST_GeomFromText(p_geometry_wkt, 4326)::geography,
      waypoints = p_waypoints,
      metadata = p_metadata,
      is_active = p_is_active,
      updated_by = v_cms_user_id,
      updated_at = NOW()
    WHERE id = p_id
    RETURNING * INTO v_route;
  ELSE
    -- INSERT
    INSERT INTO core.custom_routes (
      name,
      description,
      client_id,
      geometry,
      waypoints,
      metadata,
      is_active,
      created_by,
      updated_by
    )
    VALUES (
      p_name,
      p_description,
      v_final_client_id,
      ST_GeomFromText(p_geometry_wkt, 4326)::geography,
      p_waypoints,
      p_metadata,
      p_is_active,
      v_cms_user_id,
      v_cms_user_id
    )
    RETURNING * INTO v_route;
  END IF;

  RETURN v_route;
END;
$$;

-- ============================================
-- 4. DELETE CUSTOM ROUTE
-- ============================================
CREATE OR REPLACE FUNCTION core.delete_custom_route(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_client_id UUID;
  v_user_email TEXT := auth.jwt() ->> 'email';
  v_cms_user_id UUID;
  v_is_admin BOOLEAN := false;
BEGIN
  -- Get CMS user by email
  SELECT id, (role = 'admin') INTO v_cms_user_id, v_is_admin 
  FROM core.cms_users 
  WHERE email = v_user_email AND is_active = true;

  IF v_cms_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: CMS user not found';
  END IF;

  SELECT client_id INTO v_client_id FROM core.custom_routes WHERE id = p_id;
  
  IF v_client_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Security check
  IF NOT COALESCE(v_is_admin, false) AND NOT EXISTS (
    SELECT 1 FROM core.client_cms_users 
    WHERE cms_user_id = v_cms_user_id 
    AND client_id = v_client_id 
    AND client_role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE core.custom_routes
  SET is_active = false, updated_by = v_cms_user_id, updated_at = NOW()
  WHERE id = p_id;
  
  RETURN TRUE;
END;
$$;

-- ============================================
-- 5. GRANT PERMISSIONS
-- ============================================
GRANT EXECUTE ON FUNCTION core.get_custom_routes(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_custom_route(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION core.upsert_custom_route(UUID, VARCHAR, TEXT, UUID, TEXT, JSONB, JSONB, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION core.delete_custom_route(UUID) TO authenticated;
