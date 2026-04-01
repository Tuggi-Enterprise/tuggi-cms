-- Migration: Fix ambiguous owner_id references in RPC functions
-- Date: 2026-02-04

-- ================================
-- 1) cms_search_pois_internal
-- ================================
DROP FUNCTION IF EXISTS core.cms_search_pois_internal(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, TEXT
);

CREATE OR REPLACE FUNCTION core.cms_search_pois_internal(
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
  p_owner_id TEXT DEFAULT NULL -- Optional: restrict results to POIs created_by this cms_user id
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
  -- Enforce owner-limiting: if caller is not an admin, force p_owner_id to the caller's cms_users.id
  caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true));
  is_admin := EXISTS (
    SELECT 1 FROM core.cms_users cu
    WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
  );
  IF NOT is_admin THEN
    p_owner_id := caller_cms_id;
  END IF;

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

  IF p_owner_id IS NOT NULL THEN
    where_conditions := array_append(where_conditions, format('a.created_by = %L', p_owner_id));
  END IF;

  IF array_length(where_conditions, 1) > 0 THEN
    where_conditions := array_append(where_conditions, '1=1');
  END IF;

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

  IF array_length(where_conditions, 1) > 0 THEN
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
              ''created_at'', ad.created_at
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
      WHERE %s
      %s
    ', 
      stats_result.total_count,
      stats_result.approved_count,
      stats_result.pending_count,
      stats_result.with_description_count,
      stats_result.with_audio_count,
      stats_result.with_trigger_points_count,
      stats_result.complete_count,
      array_to_string(where_conditions, ' AND '),
      order_clause
    );
  ELSE
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
              ''created_at'', ad.created_at
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
    ', 
      stats_result.total_count,
      stats_result.approved_count,
      stats_result.pending_count,
      stats_result.with_description_count,
      stats_result.with_audio_count,
      stats_result.with_trigger_points_count,
      stats_result.complete_count,
      order_clause
    );
  END IF;

  IF NOT fetch_all THEN
    limit_clause := format(' LIMIT %s', limit_count);
    offset_clause := format(' OFFSET %s', offset_count);
  END IF;

  RETURN QUERY EXECUTE base_query || limit_clause || offset_clause;
END;
$$;

GRANT EXECUTE ON FUNCTION core.cms_search_pois_internal(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_search_pois_internal(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, TEXT
) TO service_role;

-- ================================
-- 2) cms_search_pois_map
-- ================================
-- Drop all possible overloaded versions to avoid "function is not unique" errors
DROP FUNCTION IF EXISTS core.cms_search_pois_map(float8, float8, float8, float8, int, text, text, text, text, text, uuid, text);
DROP FUNCTION IF EXISTS core.cms_search_pois_map(float8, float8, float8, float8, int, text, text, text, text, text, uuid);
DROP FUNCTION IF EXISTS core.cms_search_pois_map(float8, float8, float8, float8, int, text, text, text, text, text);

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
    is_admin := TRUE; -- Fallback for non-JWT context
  END;
  
  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN
    effective_owner_id := caller_cms_id;
  END IF;

  -- ZOOM SENSITIVITY (Optimized for wide view)
  IF zoom_level <= 4 THEN eps := 0.8;
  ELSIF zoom_level = 5 THEN eps := 0.1;
  ELSIF zoom_level = 6 THEN eps := 0.02;
  ELSE eps := 0; -- Zoom 7+ shows everything individual
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
      a.is_active,
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
        'is_active', cl.is_active,
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

-- Compatibility wrapper (keeps name consistency and handles 10 params)
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
    p_owner_id := NULL::uuid,
    is_active_filter := 'all'
  );
$$;

GRANT EXECUTE ON FUNCTION core.cms_search_pois_map(float8, float8, float8, float8, int, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_search_pois_map(float8, float8, float8, float8, int, text, text, text, text, text) TO service_role;

-- ================================
-- 3) dashboard_city_stats
-- ================================
DROP FUNCTION IF EXISTS core.dashboard_city_stats();
DROP FUNCTION IF EXISTS core.dashboard_city_stats(uuid);

CREATE OR REPLACE FUNCTION core.dashboard_city_stats(
  p_owner_id uuid DEFAULT NULL
)
RETURNS TABLE (
  city text,
  country text,
  poi_count bigint,
  approved_count bigint,
  pending_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller_cms_id uuid;
  is_admin boolean := false;
  target_owner_id uuid;
BEGIN
  -- Resolve identity
  BEGIN
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true));
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu 
      WHERE cu.email = current_setting('request.jwt.claims.email', true) 
      AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := TRUE;
  END;

  -- Default target scoping
  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN
    target_owner_id := COALESCE(p_owner_id, caller_cms_id);
  ELSE
    target_owner_id := p_owner_id;
  END IF;

  RETURN QUERY
  SELECT 
    INITCAP(TRIM(LOWER(a.city))) as city,
    (ARRAY_AGG(a.country ORDER BY a.country NULLS LAST))[1] as country,
    COUNT(*)::bigint AS poi_count,
    COUNT(*) FILTER (WHERE a.approved = true)::bigint AS approved_count,
    COUNT(*) FILTER (WHERE a.approved = false)::bigint AS pending_count
  FROM core.attractions a
  WHERE (target_owner_id IS NULL OR a.owner_id = target_owner_id OR a.created_by = target_owner_id)
    AND a.city IS NOT NULL AND TRIM(a.city) <> ''
  GROUP BY INITCAP(TRIM(LOWER(a.city)))
  ORDER BY poi_count DESC
  LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_city_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_city_stats(uuid) TO service_role;

-- ================================
-- 4) dashboard_user_analytics
-- ================================
DROP FUNCTION IF EXISTS core.dashboard_user_analytics();
DROP FUNCTION IF EXISTS core.dashboard_user_analytics(uuid);

CREATE OR REPLACE FUNCTION core.dashboard_user_analytics(
  p_owner_id uuid DEFAULT NULL
)
RETURNS TABLE (
  total_users bigint,
  active_users_30d bigint,
  total_trips bigint,
  total_km_driven numeric,
  total_poi_visits bigint,
  total_audio_plays bigint,
  avg_trip_duration text,
  trips_by_platform jsonb,
  mau_history jsonb,
  user_growth jsonb,
  total_premium_users bigint,
  upcoming_expirations jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller_cms_id uuid;
  is_admin boolean := false;
  target_owner_id uuid;
BEGIN
  -- Security Resolution
  BEGIN
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true));
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true)
        AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := TRUE;
  END;

  -- Default target scoping
  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN
    target_owner_id := COALESCE(p_owner_id, caller_cms_id);
  ELSE
    target_owner_id := p_owner_id;
  END IF;

  RETURN QUERY SELECT
    -- total_users 
    (SELECT COUNT(DISTINCT u.id)::bigint FROM (
        SELECT id FROM drive.profiles WHERE target_owner_id IS NULL
        UNION ALL
        SELECT v.user_id FROM drive.poi_visits v 
        JOIN core.attractions a ON v.poi_id = a.id 
        WHERE target_owner_id IS NOT NULL 
          AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
    ) u) AS total_users,

    -- active_users_30d
    (SELECT COUNT(DISTINCT u.id)::bigint FROM (
      -- Trips (Global or via POI visit bridge)
      SELECT t.user_id as id FROM drive.trail_trips_unified t 
      WHERE t.trip_start > NOW() - INTERVAL '30 days'
        AND (target_owner_id IS NULL OR EXISTS (
          SELECT 1 FROM drive.poi_visits v 
          JOIN core.attractions a ON v.poi_id = a.id
          WHERE v.trip_session_id = t.trip_session_id 
            AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
        ))
      UNION
      -- POI Visits
      SELECT v.user_id as id FROM drive.poi_visits v 
      WHERE v.visit_timestamp > NOW() - INTERVAL '30 days'
        AND (target_owner_id IS NULL OR EXISTS (
          SELECT 1 FROM core.attractions a 
          WHERE a.id = v.poi_id AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
        ))
      UNION
      -- Profile-based activity (only for global dashboard)
      SELECT id FROM drive.profiles 
      WHERE target_owner_id IS NULL 
        AND (created_at > NOW() - INTERVAL '30 days' OR updated_at > NOW() - INTERVAL '30 days')
    ) u) AS active_users_30d,

    -- total_trips
    (SELECT COUNT(DISTINCT trip_id)::bigint FROM (
       SELECT t.trip_session_id as trip_id FROM drive.trail_trips_unified t WHERE target_owner_id IS NULL
       UNION ALL
       SELECT v.trip_session_id as trip_id FROM drive.poi_visits v 
       JOIN core.attractions a ON v.poi_id = a.id
       WHERE target_owner_id IS NOT NULL 
         AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
    ) trips) AS total_trips,

    -- total_km_driven
    (SELECT COALESCE(SUM(km), 0)::numeric FROM (
       SELECT t.distance_km as km FROM drive.trail_trips_unified t WHERE target_owner_id IS NULL
       UNION ALL
       SELECT t.distance_km as km FROM drive.trail_trips_unified t
       WHERE target_owner_id IS NOT NULL 
         AND EXISTS (
           SELECT 1 FROM drive.poi_visits v 
           JOIN core.attractions a ON v.poi_id = a.id
           WHERE v.trip_session_id = t.trip_session_id 
             AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
         )
    ) kms) AS total_km_driven,

    -- total_poi_visits
    (SELECT COUNT(*)::bigint FROM drive.poi_visits v
     WHERE (target_owner_id IS NULL OR EXISTS (
       SELECT 1 FROM core.attractions a 
       WHERE a.id = v.poi_id AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
     ))) AS total_poi_visits,

    -- total_audio_plays
    (SELECT COUNT(*)::bigint FROM drive.poi_visits v
     WHERE v.audio_played = true 
       AND (target_owner_id IS NULL OR EXISTS (
         SELECT 1 FROM core.attractions a 
         WHERE a.id = v.poi_id AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
       ))) AS total_audio_plays,

    -- avg_trip_duration
    (SELECT (COALESCE(ROUND(AVG(duration)), 0)::text || ' min')
     FROM (
       SELECT t.duration_minutes as duration FROM drive.trail_trips_unified t 
       WHERE target_owner_id IS NULL AND t.duration_minutes > 0.1 AND t.duration_minutes < 1440
       UNION ALL
       SELECT t.duration_minutes as duration FROM drive.trail_trips_unified t 
       WHERE target_owner_id IS NOT NULL 
         AND EXISTS (
           SELECT 1 FROM drive.poi_visits v 
           JOIN core.attractions a ON v.poi_id = a.id
           WHERE v.trip_session_id = t.trip_session_id 
             AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
         ) AND t.duration_minutes > 0.1 AND t.duration_minutes < 1440
     ) durations) AS avg_trip_duration,

    -- trips_by_platform
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('platform', platform, 'count', cnt)), '[]'::jsonb) 
     FROM (
       SELECT COALESCE(p.last_platform, 'unknown') as platform, COUNT(DISTINCT t.trip_session_id) as cnt
       FROM drive.trail_trips_unified t
       LEFT JOIN drive.profiles p ON t.user_id = p.id
       WHERE (target_owner_id IS NULL OR EXISTS (
         SELECT 1 FROM drive.poi_visits v 
         JOIN core.attractions a ON v.poi_id = a.id
         WHERE v.trip_session_id = t.trip_session_id 
           AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
       ))
       GROUP BY p.last_platform
       ORDER BY cnt DESC
     ) sub) AS trips_by_platform,

    -- mau_history
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day, 'count', active_users)), '[]'::jsonb)
     FROM (
       SELECT to_char(date_trunc('day', v.visit_timestamp), 'DD/MM') as day,
              COUNT(DISTINCT v.user_id)::int as active_users
       FROM drive.poi_visits v
       WHERE v.visit_timestamp > NOW() - INTERVAL '30 days'
         AND (target_owner_id IS NULL OR EXISTS (
           SELECT 1 FROM core.attractions a 
           WHERE a.id = v.poi_id AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
         ))
       GROUP BY date_trunc('day', v.visit_timestamp)
       ORDER BY date_trunc('day', v.visit_timestamp) ASC
     ) dau) AS mau_history,

    -- user_growth
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('month', m, 'count', c)), '[]'::jsonb)
     FROM (
       SELECT to_char(date_trunc('month', created_at), 'MM/YY') as m,
              SUM(COUNT(*)) OVER (ORDER BY date_trunc('month', created_at))::int as c
       FROM drive.profiles
       WHERE target_owner_id IS NULL
       GROUP BY date_trunc('month', created_at)
       ORDER BY date_trunc('month', created_at) ASC
     ) sub) AS user_growth,

    -- Premium Metrics
    (SELECT COUNT(*)::bigint FROM drive.profiles p 
     WHERE p.subscription_tier_id IS NOT NULL 
     AND p.subscription_tier_id != '984a7cd3-c937-4218-842a-9c5fdf824f25'
     AND (target_owner_id IS NULL OR EXISTS (
        SELECT 1 FROM drive.poi_visits v 
        JOIN core.attractions a ON v.poi_id = a.id 
        WHERE v.user_id = p.id AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
     ))) AS total_premium_users,

    -- Upcoming Expirations (Next 5)
    (SELECT COALESCE(jsonb_agg(exp), '[]'::jsonb)
     FROM (
       SELECT 
         p.id as user_id,
         p.full_name,
         u.email::text,
         st.display_name as tier_name,
         p.subscription_end_date as end_date
       FROM drive.profiles p
       LEFT JOIN auth.users u ON u.id = p.id
       LEFT JOIN drive.subscription_tiers st ON st.id = p.subscription_tier_id
       WHERE p.subscription_tier_id IS NOT NULL 
         AND p.subscription_tier_id != '984a7cd3-c937-4218-842a-9c5fdf824f25'
         AND p.subscription_end_date IS NOT NULL
         AND p.subscription_end_date >= NOW()
         AND (target_owner_id IS NULL OR EXISTS (
            SELECT 1 FROM drive.poi_visits v 
            JOIN core.attractions a ON v.poi_id = a.id 
            WHERE v.user_id = p.id AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
         ))
       ORDER BY p.subscription_end_date ASC
       LIMIT 5
     ) exp) AS upcoming_expirations;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO service_role;

-- ================================
-- 5) dashboard_heatmap_data
-- Uses materialized view drive.trail_heatmap_grid when available (pre-aggregated, all data)
-- Falls back to real-time query from drive.route_trail if view doesn't exist
-- ================================
DROP FUNCTION IF EXISTS core.dashboard_heatmap_data(int);

CREATE OR REPLACE FUNCTION core.dashboard_heatmap_data(sample_size int DEFAULT 5000)
RETURNS TABLE (
  lat double precision,
  lng double precision,
  weight int
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Try materialized view first (covers ALL data, pre-aggregated by 100m grid)
  IF EXISTS (
    SELECT 1 FROM pg_matviews WHERE schemaname = 'drive' AND matviewname = 'trail_heatmap_grid'
  ) THEN
    RETURN QUERY
    SELECT
      g.grid_lat::double precision AS lat,
      g.grid_lng::double precision AS lng,
      g.point_count::int AS weight
    FROM drive.trail_heatmap_grid g
    WHERE g.point_count > 1
    ORDER BY g.point_count DESC;
  ELSE
    -- Fallback: real-time aggregation from raw table
    RETURN QUERY
    WITH gridded AS (
      SELECT
        ROUND(rt.latitude::numeric, 3) AS grid_lat,
        ROUND(rt.longitude::numeric, 3) AS grid_lng,
        COUNT(*)::int AS density
      FROM drive.route_trail rt
      WHERE rt.latitude IS NOT NULL
        AND rt.longitude IS NOT NULL
      GROUP BY ROUND(rt.latitude::numeric, 3), ROUND(rt.longitude::numeric, 3)
    )
    SELECT
      grid_lat::double precision AS lat,
      grid_lng::double precision AS lng,
      density AS weight
    FROM gridded
    ORDER BY density DESC;
  END IF;
END; $$;

GRANT EXECUTE ON FUNCTION core.dashboard_heatmap_data(int) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_heatmap_data(int) TO service_role;
