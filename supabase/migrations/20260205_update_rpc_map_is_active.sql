-- Migration: Add is_active to cms_search_pois_map RPC metadata
-- Date: 2026-02-05

DROP FUNCTION IF EXISTS core.cms_search_pois_map(
  float8, float8, float8, float8, int, text, text, text, text, text, uuid
);

CREATE OR REPLACE FUNCTION core.cms_search_pois_map(
  min_lat double precision, 
  min_lng double precision, 
  max_lat double precision, 
  max_lng double precision, 
  zoom_level integer, 
  search_term text DEFAULT NULL, 
  status_filter text DEFAULT 'all', 
  country_filter text DEFAULT NULL, 
  state_filter text DEFAULT NULL, 
  city_filter text DEFAULT NULL, 
  p_owner_id uuid DEFAULT NULL,
  is_active_filter text DEFAULT 'all'
)
RETURNS TABLE(
  id uuid, 
  name text, 
  latitude double precision, 
  longitude double precision, 
  type text, 
  count integer, 
  metadata jsonb
)
LANGUAGE plpgsql
STABLE 
SECURITY DEFINER
SET statement_timeout = '60s'
AS $$
DECLARE
  eps float8;
  min_points int := 2;
  caller_cms_id UUID;
  is_admin BOOLEAN := FALSE;
  effective_owner_id UUID;
BEGIN
  effective_owner_id := p_owner_id;
  
  -- Resolve identity
  BEGIN
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true));
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := TRUE;
  END;
  
  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN
    effective_owner_id := caller_cms_id;
  END IF;

  -- ZOOM SENSITIVITY
  IF zoom_level <= 4 THEN eps := 0.8;
  ELSIF zoom_level = 5 THEN eps := 0.1;
  ELSIF zoom_level = 6 THEN eps := 0.02;
  ELSE eps := 0; 
  END IF;

  RETURN QUERY
  WITH filtered_pois AS (
    SELECT
      a.id AS poi_id,
      a.name AS poi_name,
      a.city,
      a.state,
      a.country,
      a.approved,
      a.is_active, -- Added
      EXISTS (
        SELECT 1 FROM core.attraction_descriptions ad 
        WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description <> ''
      ) AS has_description,
      EXISTS (
        SELECT 1 FROM core.attraction_descriptions ad 
        WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url <> ''
      ) AS has_audio,
      c.latitude AS poi_lat,
      c.longitude AS poi_lng,
      ST_SetSRID(ST_MakePoint(c.longitude, c.latitude), 4326) as geom
    FROM core.attractions a
    JOIN core.attraction_coordinate c ON c.attraction_id = a.id
    WHERE
      c.latitude BETWEEN (min_lat - 0.02) AND (max_lat + 0.02)
      AND c.longitude BETWEEN (min_lng - 0.02) AND (max_lng + 0.02)
      AND (search_term IS NULL OR a.name ILIKE '%' || search_term || '%')
      AND (status_filter = 'all' OR (status_filter = 'approved' AND a.approved = true) OR (status_filter = 'pending' AND a.approved = false))
      AND (country_filter IS NULL OR a.country = country_filter)
      AND (state_filter IS NULL OR a.state = state_filter)
      AND (city_filter IS NULL OR a.city = city_filter)
      AND (effective_owner_id IS NULL OR a.created_by = effective_owner_id)
      AND (
        is_active_filter = 'all' 
        OR (is_active_filter = 'active' AND COALESCE(a.is_active, true) = true)
        OR (is_active_filter = 'inactive' AND COALESCE(a.is_active, true) = false)
      )
  ),
  clustered AS (
    SELECT
      fp.poi_id, fp.poi_name, fp.city, fp.state, fp.country, fp.approved, fp.is_active,
      fp.has_description, fp.has_audio, fp.poi_lat, fp.poi_lng,
      CASE WHEN eps > 0 THEN
        ST_ClusterDBSCAN(fp.geom, eps, min_points) OVER ()
      ELSE
        NULL
      END as cluster_id
    FROM filtered_pois fp
  ),
  aggregated_clusters AS (
    SELECT
      (array_agg(cl.poi_id))[1] as id,
      'Cluster (' || count(*) || ')' as name,
      avg(cl.poi_lat)::double precision as latitude,
      avg(cl.poi_lng)::double precision as longitude,
      'cluster'::text as type,
      count(*)::int as count,
      jsonb_build_object('count', count(*)) as metadata
    FROM clustered cl
    WHERE cl.cluster_id IS NOT NULL
    GROUP BY cl.cluster_id
  ),
  individual_points AS (
    SELECT
      cl.poi_id as id,
      cl.poi_name as name,
      cl.poi_lat as latitude,
      cl.poi_lng as longitude,
      'poi'::text as type,
      1 as count,
      jsonb_build_object(
        'city', cl.city,
        'state', cl.state,
        'country', cl.country,
        'approved', cl.approved,
        'is_active', cl.is_active, -- Added
        'has_description', cl.has_description,
        'has_audio', cl.has_audio
      ) as metadata
    FROM clustered cl
    WHERE cl.cluster_id IS NULL
  )
  SELECT * FROM aggregated_clusters
  UNION ALL
  SELECT * FROM individual_points;
END;
$$;

GRANT EXECUTE ON FUNCTION core.cms_search_pois_map(float8, float8, float8, float8, int, text, text, text, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_search_pois_map(float8, float8, float8, float8, int, text, text, text, text, text, uuid, text) TO service_role;
