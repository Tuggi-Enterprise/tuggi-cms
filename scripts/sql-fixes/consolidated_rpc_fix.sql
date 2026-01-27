-- Consolidated fix for POI RPC overloading
-- Resolves PGRST203: Could not choose the best candidate function

-- 1. Fix cms_search_pois_map ambiguity
-- Drop all existing overloads
DROP FUNCTION IF EXISTS core.cms_search_pois_map(float8, float8, float8, float8, integer, text, text, text, text, text);
DROP FUNCTION IF EXISTS core.cms_search_pois_map(float8, float8, float8, float8, integer, text, text, text, text, text, uuid);

-- Recreate single version with optional owner_id
CREATE OR REPLACE FUNCTION core.cms_search_pois_map(
  min_lat float8,
  min_lng float8,
  max_lat float8,
  max_lng float8,
  zoom_level integer,
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
  type text, -- 'cluster' or 'poi'
  count int,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER -- Ensures it has enough permissions to read all tables
AS $$
DECLARE
  eps float8;
  min_points int := 2;
  caller_cms_id UUID;
  is_admin BOOLEAN := FALSE;
BEGIN
  -- Resolve caller identity for owner-scoping
  BEGIN
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true));
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    -- Fallback for direct calls without JWT claims
    is_admin := TRUE; 
  END;

  -- If not admin, restrict to caller's POIs
  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN
    owner_id := caller_cms_id;
  END IF;

  -- Determine clustering distance (epsilon) based on zoom
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
  aggregated_clusters AS (
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
  individual_points AS (
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
  SELECT * FROM aggregated_clusters
  UNION ALL
  SELECT * FROM individual_points;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.cms_search_pois_map TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_search_pois_map TO service_role;

-- 2. Clean up cms_search_pois (standard search) to avoid similar ambiguity for clients
-- Drop old versions
DROP FUNCTION IF EXISTS core.cms_search_pois(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS core.cms_search_pois(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, UUID);
DROP FUNCTION IF EXISTS core.cms_search_pois_internal(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, TEXT);

-- Create unified version
CREATE OR REPLACE FUNCTION core.cms_search_pois(
  search_term TEXT DEFAULT NULL,
  status_filter TEXT DEFAULT 'all',
  country_filter TEXT DEFAULT NULL,
  state_filter TEXT DEFAULT NULL,
  city_filter TEXT DEFAULT NULL,
  google_types_filter TEXT DEFAULT NULL,
  category_filter TEXT DEFAULT NULL,
  content_status_filter TEXT DEFAULT NULL,
  group_status_filter TEXT DEFAULT NULL,
  score_filter TEXT DEFAULT NULL,
  trigger_points_filter TEXT DEFAULT NULL,
  limit_count INTEGER DEFAULT 1000,
  offset_count INTEGER DEFAULT 0,
  fetch_all BOOLEAN DEFAULT FALSE,
  owner_id UUID DEFAULT NULL -- Use UUID consistently
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  google_place_id TEXT,
  google_types TEXT[],
  category TEXT,
  rating NUMERIC,
  image_url TEXT,
  approved BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  user_id TEXT,
  business_status TEXT,
  formatted_phone_number TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  descriptions JSONB,
  trigger_points JSONB,
  group_membership JSONB,
  verification_data JSONB,
  total_count BIGINT,
  approved_count BIGINT,
  pending_count BIGINT,
  with_description_count BIGINT,
  with_audio_count BIGINT,
  with_trigger_points_count BIGINT,
  complete_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_query TEXT;
  where_conditions TEXT[] := '{}';
  order_clause TEXT := 'ORDER BY a.created_at DESC';
  limit_clause TEXT := '';
  offset_clause TEXT := '';
  stats_query TEXT;
  stats_result RECORD;
  caller_cms_id UUID;
  is_admin BOOLEAN := FALSE;
BEGIN
  -- Resolve caller identity
  BEGIN
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true));
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := TRUE;
  END;

  -- If not admin, restrict to caller's POIs
  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN
    owner_id := caller_cms_id;
  END IF;

  -- Build WHERE conditions
  IF search_term IS NOT NULL AND search_term != '' THEN
    where_conditions := array_append(where_conditions, 
      format('(a.name ILIKE %L OR a.city ILIKE %L OR a.country ILIKE %L)', 
        '%' || search_term || '%', '%' || search_term || '%', '%' || search_term || '%'));
  END IF;

  IF status_filter IS NOT NULL AND status_filter != 'all' THEN
    IF status_filter = 'approved' THEN
      where_conditions := array_append(where_conditions, 'a.approved = TRUE');
    ELSIF status_filter = 'pending' THEN
      where_conditions := array_append(where_conditions, 'a.approved = FALSE');
    END IF;
  END IF;

  IF country_filter IS NOT NULL AND country_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.country = %L', country_filter));
  END IF;

  IF state_filter IS NOT NULL AND state_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.state = %L', state_filter));
  END IF;

  IF city_filter IS NOT NULL AND city_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.city = %L', city_filter));
  END IF;

  IF owner_id IS NOT NULL THEN
    where_conditions := array_append(where_conditions, format('a.created_by = %L', owner_id));
  END IF;

  -- Build WHERE clause
  IF array_length(where_conditions, 1) > 0 THEN
    where_conditions := array_append(where_conditions, '1=1'); -- Placeholder
  END IF;

  -- Calculate statistics
  IF array_length(where_conditions, 1) > 0 THEN
    stats_query := format('
      SELECT 
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE a.approved = true) as approved_count,
        COUNT(*) FILTER (WHERE a.approved = false) as pending_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)) as with_description_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL)) as with_audio_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)) as with_trigger_points_count,
        COUNT(*) FILTER (WHERE a.approved = true AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)) as complete_count
      FROM core.attractions a
      WHERE %s
    ', array_to_string(where_conditions, ' AND '));
  ELSE
    stats_query := '
      SELECT 
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE a.approved = true) as approved_count,
        COUNT(*) FILTER (WHERE a.approved = false) as pending_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)) as with_description_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL)) as with_audio_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)) as with_trigger_points_count,
        COUNT(*) FILTER (WHERE a.approved = true AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)) as complete_count
      FROM core.attractions a
    ';
  END IF;

  EXECUTE stats_query INTO stats_result;

  -- Build main query with relations
  base_query := format('
    SELECT 
      a.id::TEXT,
      a.name,
      a.city,
      a.state,
      a.country,
      a.google_place_id,
      a.google_types,
      a.category,
      a.rating,
      a.image_url,
      a.approved,
      a.created_at,
      a.updated_at,
      a.user_id::TEXT,
      a.business_status,
      a.formatted_phone_number,
      ac.latitude::NUMERIC,
      ac.longitude::NUMERIC,
      COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            ''id'', ad.id,
            ''language'', ad.language,
            ''description'', ad.description,
            ''audio_url'', ad.audio_url,
            ''created_at'', ad.created_at,
            ''verification_status'', ad.verification_status
          )
        ) FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id), 
        ''[]''::jsonb
      ) as descriptions,
      COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            ''id'', atp.id,
            ''is_active'', atp.is_active,
            ''type'', atp.type
          )
        ) FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id), 
        ''[]''::jsonb
      ) as trigger_points,
      COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            ''group_id'', ag.id,
            ''group_name'', ag.name,
            ''role'', agm.group_role
          )
        ) FROM core.attraction_groups ag 
         JOIN core.attraction_group_members agm ON ag.id = agm.group_id 
         WHERE agm.attraction_id = a.id), 
        ''[]''::jsonb
      ) as group_membership,
      ''{}''::jsonb as verification_data,
      %L::BIGINT as total_count,
      %L::BIGINT as approved_count,
      %L::BIGINT as pending_count,
      %L::BIGINT as with_description_count,
      %L::BIGINT as with_audio_count,
      %L::BIGINT as with_trigger_points_count,
      %L::BIGINT as complete_count
    FROM core.attractions a
    LEFT JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
    %s
    %s
  ', 
    stats_result.total_count,
    stats_result.approved_count,
    stats_result.pending_count,
    stats_result.with_description_count,
    stats_result.with_audio_count,
    stats_result.with_trigger_points_count,
    stats_result.complete_count,
    CASE WHEN array_length(where_conditions, 1) > 0 THEN 'WHERE ' || array_to_string(where_conditions, ' AND ') ELSE '' END,
    order_clause
  );

  IF NOT fetch_all THEN
    limit_clause := format(' LIMIT %s', limit_count);
    offset_clause := format(' OFFSET %s', offset_count);
  END IF;

  RETURN QUERY EXECUTE base_query || limit_clause || offset_clause;
END;
$$;

GRANT EXECUTE ON FUNCTION core.cms_search_pois TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_search_pois TO service_role;
