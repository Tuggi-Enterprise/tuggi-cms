-- Migration to optimize POI map fetching with server-side clustering
-- Created: 2026-01-07
-- Description: Updates cms_search_pois_map to support viewport filtering and clustering

-- Enable PostGIS if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- Drop existing function if exists to allow signature change
DROP FUNCTION IF EXISTS core.cms_search_pois_map;

-- Add composite index on coordinate for faster bounding box search
CREATE INDEX IF NOT EXISTS idx_attraction_coordinate_lat_lng 
ON core.attraction_coordinate (latitude, longitude);

-- Enable RLS for security
ALTER TABLE core.attractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.attraction_coordinate ENABLE ROW LEVEL SECURITY;

-- Create policy to allow authenticated users (CMS users) to view and manage POIs
-- We use DO blocks to avoid errors if policy already exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'attractions' AND policyname = 'Authenticated users can manage attractions'
  ) THEN
    CREATE POLICY "Authenticated users can manage attractions" 
    ON core.attractions 
    FOR ALL 
    TO authenticated 
    USING (true) 
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'attraction_coordinate' AND policyname = 'Authenticated users can manage coordinates'
  ) THEN
    CREATE POLICY "Authenticated users can manage coordinates" 
    ON core.attraction_coordinate 
    FOR ALL 
    TO authenticated 
    USING (true) 
    WITH CHECK (true);
  END IF;
END $$;

-- Create the optimized function
-- SECURITY INVOKER is default, which means it will respect RLS policies of the caller
-- Since we are calling this as authenticated user from CMS, RLS policies above will apply
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
      (array_agg(clustered.poi_id))[1] as id,
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
  -- Get individual points
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
        'state', clustered.state,
        'country', clustered.country,
        'approved', clustered.approved,
        'has_description', clustered.has_description,
        'has_audio', clustered.has_audio
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
