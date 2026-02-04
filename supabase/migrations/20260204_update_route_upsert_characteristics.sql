-- Migration: Update upsert_custom_route RPC with characteristics
-- Purpose: Add new characteristic parameters to the route upsert function
-- Date: 2026-02-04

-- ============================================
-- UPDATE UPSERT FUNCTION WITH CHARACTERISTICS
-- ============================================
CREATE OR REPLACE FUNCTION core.upsert_custom_route(
  p_id UUID,
  p_name VARCHAR,
  p_description TEXT,
  p_client_id UUID,
  p_geometry_wkt TEXT,
  p_waypoints JSONB,
  p_metadata JSONB,
  p_is_active BOOLEAN DEFAULT true,
  -- New characteristic parameters
  p_accessibility TEXT DEFAULT 'unknown',
  p_drivability TEXT DEFAULT 'unknown',
  p_scenic_profile TEXT[] DEFAULT '{}',
  p_best_time TEXT[] DEFAULT '{}',
  p_road_conditions TEXT[] DEFAULT '{}',
  p_resources JSONB DEFAULT '{}',
  p_photogenic_rating TEXT DEFAULT 'unknown',
  p_stops_count INTEGER DEFAULT 0
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
      -- Characteristics
      accessibility = p_accessibility,
      drivability = p_drivability,
      scenic_profile = p_scenic_profile,
      best_time = p_best_time,
      road_conditions = p_road_conditions,
      resources = p_resources,
      photogenic_rating = p_photogenic_rating,
      stops_count = p_stops_count,
      -- Audit
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
      -- Characteristics
      accessibility,
      drivability,
      scenic_profile,
      best_time,
      road_conditions,
      resources,
      photogenic_rating,
      stops_count,
      -- Audit
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
      -- Characteristics
      p_accessibility,
      p_drivability,
      p_scenic_profile,
      p_best_time,
      p_road_conditions,
      p_resources,
      p_photogenic_rating,
      p_stops_count,
      -- Audit
      v_cms_user_id,
      v_cms_user_id
    )
    RETURNING * INTO v_route;
  END IF;

  RETURN v_route;
END;
$$;
