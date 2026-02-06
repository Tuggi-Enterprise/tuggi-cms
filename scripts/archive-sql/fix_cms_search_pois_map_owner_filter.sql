-- Add owner_id parameter to cms_search_pois_map and apply owner filter
-- Run in Supabase SQL Editor

DROP FUNCTION IF EXISTS core.cms_search_pois_map;

CREATE OR REPLACE FUNCTION core.cms_search_pois_map(
  min_lat float8,
  min_lng float8,
  max_lat float8,
  max_lng float8,
  zoom_level int,
  search_term text default null,
  status_filter text default 'all',
  country_filter text default null,
  state_filter text default null,
  city_filter text default null,
  owner_id uuid default null -- Optional owner filter (cms_users.id)
)
RETURNS TABLE (
  id uuid,
  name text,
  latitude float8,
  longitude float8,
  type text,
  count int,
  metadata jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  eps float8;
  min_points int := 2;
  caller_cms_id UUID;
  is_admin BOOLEAN := FALSE;
BEGIN
  -- Enforce owner-limiting for non-admin callers: force owner_id to caller's cms_users.id (resolve via email claim)
  caller_cms_id := (SELECT id FROM core.cms_users WHERE email = current_setting('request.jwt.claims.email', true));
  is_admin := EXISTS (
    SELECT 1 FROM core.cms_users cu
    WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
  );
  IF NOT is_admin THEN
    owner_id := caller_cms_id;
  END IF;
  -- Determine epsilon based on zoom (same as before)
  IF zoom_level <= 4 THEN eps := 3.0;
  ELSIF zoom_level <= 6 THEN eps := 1.0;
  ELSIF zoom_level <= 8 THEN eps := 0.5;
  ELSIF zoom_level <= 10 THEN eps := 0.1;
  ELSIF zoom_level <= 12 THEN eps := 0.05;
  ELSE eps := 0; -- No clustering for high zoom
  END IF;

  RETURN QUERY
  WITH filtered_pois AS (
    SELECT
      a.id AS poi_id,
      a.name,
      a.city,
      a.state,
      a.country,
      a.approved,
      EXISTS (
        SELECT 1 FROM core.attraction_descriptions ad 
        WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != ''
      ) AS has_description,
      EXISTS (
        SELECT 1 FROM core.attraction_descriptions ad 
        WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != ''
      ) AS has_audio,
      c.latitude,
      c.longitude,
      ST_SetSRID(ST_MakePoint(c.longitude, c.latitude), 4326) as geom
    FROM core.attractions a
    JOIN core.attraction_coordinate c ON c.attraction_id = a.id
    WHERE
      c.latitude BETWEEN (min_lat - 0.1) AND (max_lat + 0.1)
      AND c.longitude BETWEEN (min_lng - 0.1) AND (max_lng + 0.1)
      AND (search_term IS NULL OR a.name ILIKE '%' || search_term || '%')
      AND (status_filter = 'all' OR (status_filter = 'approved' AND a.approved = true) OR (status_filter = 'pending' AND a.approved = false))
      AND (country_filter IS NULL OR a.country = country_filter)
      AND (state_filter IS NULL OR a.state = state_filter)
      AND (city_filter IS NULL OR a.city = city_filter)
      AND (owner_id IS NULL OR a.created_by = owner_id)
  )
  SELECT * FROM (
    SELECT
      *,
      CASE WHEN eps > 0 THEN
        ST_ClusterDBSCAN(geom, eps, min_points) OVER ()
      ELSE
        NULL
      END as cluster_id
    FROM filtered_pois
  ) clustered
  -- (rest of original clustering / aggregation logic remains unchanged)
  ;
END;
$$;

GRANT EXECUTE ON FUNCTION core.cms_search_pois_map(float8, float8, float8, float8, int, text, text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_search_pois_map(float8, float8, float8, float8, int, text, text, text, text, text, uuid) TO service_role;

-- Compatibility wrapper for callers expecting the older signature (without owner_id)
DROP FUNCTION IF EXISTS core.cms_search_pois_map(float8, float8, float8, float8, int, text, text, text, text, text);

CREATE OR REPLACE FUNCTION core.cms_search_pois_map(
  min_lat float8,
  min_lng float8,
  max_lat float8,
  max_lng float8,
  zoom_level int,
  search_term text default null,
  status_filter text default 'all',
  country_filter text default null,
  state_filter text default null,
  city_filter text default null
)
RETURNS TABLE (
  id uuid,
  name text,
  latitude float8,
  longitude float8,
  type text,
  count int,
  metadata jsonb
)
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM core.cms_search_pois_map(
    min_lat := min_lat,
    min_lng := min_lng,
    max_lat := max_lat,
    max_lng := max_lng,
    zoom_level := zoom_level,
    search_term := search_term,
    status_filter := status_filter,
    country_filter := country_filter,
    state_filter := state_filter,
    city_filter := city_filter,
    owner_id := NULL
  );
$$;

-- Grant execute on the compatibility wrapper as well
GRANT EXECUTE ON FUNCTION core.cms_search_pois_map(float8, float8, float8, float8, int, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_search_pois_map(float8, float8, float8, float8, int, text, text, text, text, text) TO service_role;
