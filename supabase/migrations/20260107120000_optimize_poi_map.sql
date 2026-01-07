-- Migration to optimize POI map fetching with server-side clustering
-- Created: 2026-01-07
-- Description: Updates cms_search_pois_map to support viewport filtering and clustering

-- Enable PostGIS if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- Drop existing function if exists to allow signature change
DROP FUNCTION IF EXISTS core.cms_search_pois_map;

-- Create the optimized function
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
  google_types_filter text default null
)
RETURNS TABLE (
  id uuid,
  name text,
  latitude float8,
  longitude float8,
  type text, -- 'cluster' or 'poi'
  count int,
  metadata jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  -- Clustering epsilon (distance) in degrees.
  eps float8;
  min_points int := 2;
BEGIN
  -- Determine epsilon based on zoom
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
      a.id AS poi_id, -- Alias to avoid conflict
      a.name,
      a.city,
      a.state,
      a.country,
      a.approved,
      a.google_types,
      c.latitude,
      c.longitude,
      -- Create geometry for clustering
      ST_SetSRID(ST_MakePoint(c.longitude, c.latitude), 4326) as geom
    FROM core.attractions a
    JOIN core.attraction_coordinate c ON c.attraction_id = a.id
    WHERE
      -- Viewport filter (add small buffer to avoid cutting off edge clusters)
      c.latitude BETWEEN (min_lat - 0.1) AND (max_lat + 0.1)
      AND c.longitude BETWEEN (min_lng - 0.1) AND (max_lng + 0.1)
      -- App filters
      AND (search_term IS NULL OR a.name ILIKE '%' || search_term || '%')
      AND (status_filter = 'all' OR (status_filter = 'approved' AND a.approved = true) OR (status_filter = 'pending' AND a.approved = false))
      AND (country_filter IS NULL OR a.country = country_filter)
      AND (state_filter IS NULL OR a.state = state_filter)
      AND (city_filter IS NULL OR a.city = city_filter)
      AND (google_types_filter IS NULL OR google_types_filter = ANY(a.google_types))
  ),
  clustered AS (
    SELECT
      *,
      CASE WHEN eps > 0 THEN
        ST_ClusterDBSCAN(geom, eps, min_points) OVER ()
      ELSE
        NULL
      END as cluster_id
    FROM filtered_pois
  ),
  -- Aggregate clusters
  clusters AS (
    SELECT
      (array_agg(clustered.poi_id))[1] as id, -- Values for representative point
      'Cluster (' || count(*) || ')' as name,
      avg(clustered.latitude)::float8 as latitude,
      avg(clustered.longitude)::float8 as longitude,
      'cluster' as type,
      count(*)::int as count,
      jsonb_build_object(
        'count', count(*)
      ) as metadata
    FROM clustered
    WHERE cluster_id IS NOT NULL
    GROUP BY cluster_id
  ),
  -- Get individual points (noise or non-clustered)
  points AS (
    SELECT
      clustered.poi_id as id,
      clustered.name,
      clustered.latitude,
      clustered.longitude,
      'poi' as type,
      1 as count,
      jsonb_build_object(
        'city', clustered.city,
        'state', clustered.state
      ) as metadata
    FROM clustered
    WHERE cluster_id IS NULL
  )
  SELECT * FROM clusters
  UNION ALL
  SELECT * FROM points;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.cms_search_pois_map TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_search_pois_map TO service_role;
