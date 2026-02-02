-- ============================================================================
-- TUGGI DASHBOARD - CORREÇÃO COMPLETA V4
-- Data: 2026-01-27
-- Objetivo: RPCs corrigidas - deduplicação de cidades + mais dados de inventário
-- ============================================================================

-- 1. LIMPEZA TOTAL
DROP FUNCTION IF EXISTS core.dashboard_user_analytics(uuid);
DROP FUNCTION IF EXISTS core.dashboard_city_stats(uuid);
DROP FUNCTION IF EXISTS core.dashboard_inventory_funnel();
DROP FUNCTION IF EXISTS core.dashboard_content_quality();
DROP FUNCTION IF EXISTS core.dashboard_inventory_details();
DROP FUNCTION IF EXISTS core.dashboard_top_visited_pois(int);
DROP FUNCTION IF EXISTS core.dashboard_recent_visited_pois(int);
DROP FUNCTION IF EXISTS core.dashboard_most_visited_cities(int);
DROP FUNCTION IF EXISTS core.dashboard_user_sessions(int);
DROP FUNCTION IF EXISTS core.dashboard_heatmap_data(int);
DROP VIEW IF EXISTS drive.trail_users_from_trips CASCADE;
DROP VIEW IF EXISTS drive.trail_trips_unified CASCADE;

-- ============================================================================
-- 2. VIEW: trail_trips_unified (Agregação de viagens)
-- ============================================================================
CREATE VIEW drive.trail_trips_unified AS
SELECT 
  trip_session_id,
  user_id,
  COUNT(*) as point_count,
  MIN(timestamp) as trip_start,
  MAX(timestamp) as trip_end,
  MIN(sequence_order) as min_sequence,
  MAX(sequence_order) as max_sequence,
  EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 60 as duration_minutes,
  (ARRAY_AGG(latitude ORDER BY sequence_order ASC))[1] as start_latitude,
  (ARRAY_AGG(longitude ORDER BY sequence_order ASC))[1] as start_longitude,
  (ARRAY_AGG(latitude ORDER BY sequence_order DESC))[1] as end_latitude,
  (ARRAY_AGG(longitude ORDER BY sequence_order DESC))[1] as end_longitude,
  AVG(speed) as avg_speed,
  MAX(speed) as max_speed,
  SUM(CASE WHEN is_moving THEN 1 ELSE 0 END) as moving_points,
  SUM(CASE WHEN is_moving = false OR is_moving IS NULL THEN 1 ELSE 0 END) as stationary_points,
  (SUM(COALESCE(distance_from_previous, 0)) / 1000.0)::numeric as distance_km
FROM drive.route_trail
GROUP BY trip_session_id, user_id;

-- ============================================================================
-- 3. VIEW: trail_users_from_trips (Usuários com trip stats)
-- ============================================================================
CREATE VIEW drive.trail_users_from_trips AS
SELECT 
  user_id,
  COUNT(DISTINCT trip_session_id) as trip_count,
  MIN(trip_start) as first_trip,
  MAX(trip_end) as last_trip,
  SUM(point_count) as total_points,
  SUM(duration_minutes) as total_duration_minutes,
  SUM(distance_km) as total_distance_km
FROM drive.trail_trips_unified
GROUP BY user_id;

-- ============================================================================
-- 4. RPC: dashboard_user_analytics (Métricas gerais - MAU ordenado ASC)
-- ============================================================================
CREATE FUNCTION core.dashboard_user_analytics(owner_id uuid DEFAULT NULL)
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
  user_growth jsonb
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT
    (SELECT COUNT(*)::bigint FROM drive.profiles) AS total_users,
    
    (SELECT COUNT(DISTINCT u.id)::bigint FROM (
      SELECT user_id as id FROM drive.trail_trips_unified WHERE trip_start > NOW() - INTERVAL '30 days'
      UNION
      SELECT user_id as id FROM drive.poi_visits WHERE visit_timestamp > NOW() - INTERVAL '30 days'
    ) u) AS active_users_30d,
    
    (SELECT COUNT(*)::bigint FROM drive.trail_trips_unified) AS total_trips,
    (SELECT COALESCE(SUM(distance_km), 0)::numeric FROM drive.trail_trips_unified) AS total_km_driven,
    (SELECT COUNT(*)::bigint FROM drive.poi_visits) AS total_poi_visits,
    (SELECT COUNT(*)::bigint FROM drive.poi_visits WHERE audio_played = true) AS total_audio_plays,
    
    (SELECT COALESCE(ROUND(AVG(duration_minutes))::text, '0') || ' min' 
     FROM drive.trail_trips_unified WHERE duration_minutes > 0) AS avg_trip_duration,
    
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('platform', platform, 'count', cnt)), '[]'::jsonb) 
     FROM (
       SELECT COALESCE(p.last_platform, 'unknown') as platform, COUNT(t.trip_session_id) as cnt
       FROM drive.trail_trips_unified t
       LEFT JOIN drive.profiles p ON t.user_id = p.id
       GROUP BY p.last_platform
       ORDER BY cnt DESC
     ) sub) AS trips_by_platform,
    
    -- Daily Active Users (últimos 30 dias) - rolling window
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day, 'count', active_users)), '[]'::jsonb)
     FROM (
       SELECT to_char(date_trunc('day', visit_timestamp), 'DD/MM') as day,
              COUNT(DISTINCT user_id)::int as active_users
       FROM drive.poi_visits
       WHERE visit_timestamp > NOW() - INTERVAL '30 days'
       GROUP BY date_trunc('day', visit_timestamp)
       ORDER BY date_trunc('day', visit_timestamp) ASC
     ) dau) AS mau_history,

    -- Daily User Growth (últimos 30 dias) - rolling window
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day, 'new_users', new_users)), '[]'::jsonb)
     FROM (
       SELECT to_char(date_trunc('day', created_at), 'DD/MM') as day,
              COUNT(*)::int as new_users
       FROM drive.profiles
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY date_trunc('day', created_at)
       ORDER BY date_trunc('day', created_at) ASC
     ) growth) AS user_growth;
END; $$;

-- ============================================================================
-- 5. RPC: dashboard_recent_visited_pois (Últimos POIs visitados)
-- ============================================================================
CREATE FUNCTION core.dashboard_recent_visited_pois(limit_count int DEFAULT 10)
RETURNS TABLE (
  visit_id uuid,
  poi_id uuid,
  poi_name text,
  poi_city text,
  poi_country text,
  poi_category text,
  user_id uuid,
  user_nickname text,
  visit_timestamp timestamptz,
  audio_played boolean,
  visit_source text,
  platform text
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pv.id as visit_id,
    pv.poi_id,
    pv.poi_name,
    pv.poi_city,
    pv.poi_country,
    pv.poi_category,
    pv.user_id,
    p.nickname as user_nickname,
    pv.visit_timestamp,
    pv.audio_played,
    pv.visit_source,
    pv.platform
  FROM drive.poi_visits pv
  LEFT JOIN drive.profiles p ON pv.user_id = p.id
  ORDER BY pv.visit_timestamp DESC
  LIMIT limit_count;
END; $$;

-- ============================================================================
-- 6. RPC: dashboard_top_visited_pois (POIs mais visitados - agregado)
-- ============================================================================
CREATE FUNCTION core.dashboard_top_visited_pois(limit_count int DEFAULT 10)
RETURNS TABLE (
  poi_id uuid,
  poi_name text,
  city text,
  country text,
  category text,
  total_visits bigint,
  audio_plays bigint,
  unique_visitors bigint
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pv.poi_id,
    pv.poi_name,
    pv.poi_city as city,
    pv.poi_country as country,
    pv.poi_category as category,
    COUNT(*)::bigint as total_visits,
    COUNT(*) FILTER (WHERE pv.audio_played = true)::bigint as audio_plays,
    COUNT(DISTINCT pv.user_id)::bigint as unique_visitors
  FROM drive.poi_visits pv
  GROUP BY pv.poi_id, pv.poi_name, pv.poi_city, pv.poi_country, pv.poi_category
  ORDER BY total_visits DESC
  LIMIT limit_count;
END; $$;

-- ============================================================================
-- 7. RPC: dashboard_most_visited_cities (Cidades mais visitadas - NORMALIZADA)
-- ============================================================================
CREATE FUNCTION core.dashboard_most_visited_cities(limit_count int DEFAULT 20)
RETURNS TABLE (
  city text,
  country text,
  visit_count bigint,
  audio_plays bigint,
  unique_visitors bigint
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT 
    -- Normaliza nome da cidade: trim, lower para agrupar, depois capitaliza
    INITCAP(TRIM(LOWER(pv.poi_city))) as city,
    -- Pega o país mais comum para aquela cidade
    (ARRAY_AGG(pv.poi_country ORDER BY pv.poi_country NULLS LAST))[1] as country,
    COUNT(*)::bigint as visit_count,
    COUNT(*) FILTER (WHERE pv.audio_played = true)::bigint as audio_plays,
    COUNT(DISTINCT pv.user_id)::bigint as unique_visitors
  FROM drive.poi_visits pv
  WHERE pv.poi_city IS NOT NULL 
    AND TRIM(pv.poi_city) <> ''
  GROUP BY INITCAP(TRIM(LOWER(pv.poi_city)))
  ORDER BY visit_count DESC
  LIMIT limit_count;
END; $$;

-- ============================================================================
-- 8. RPC: dashboard_city_stats (POIs por cidade - NORMALIZADA)
-- ============================================================================
CREATE FUNCTION core.dashboard_city_stats(owner_id uuid DEFAULT NULL)
RETURNS TABLE (city text, country text, poi_count bigint, approved_count bigint, pending_count bigint)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  caller_cms_id uuid;
  is_admin boolean := false;
BEGIN
  BEGIN
    caller_cms_id := (SELECT id FROM core.cms_users WHERE email = current_setting('request.jwt.claims.email', true));
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu 
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := TRUE;
  END;

  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN 
    owner_id := caller_cms_id; 
  END IF;

  RETURN QUERY
  SELECT 
    -- Normaliza nome da cidade
    INITCAP(TRIM(LOWER(a.city))) as city,
    -- Pega o país mais comum
    (ARRAY_AGG(a.country ORDER BY a.country NULLS LAST))[1] as country,
    COUNT(*)::bigint AS poi_count,
    COUNT(*) FILTER (WHERE a.approved = true)::bigint AS approved_count,
    COUNT(*) FILTER (WHERE a.approved = false)::bigint AS pending_count
  FROM core.attractions a
  WHERE (owner_id IS NULL OR a.created_by = owner_id)
    AND a.city IS NOT NULL AND TRIM(a.city) <> ''
  GROUP BY INITCAP(TRIM(LOWER(a.city)))
  ORDER BY poi_count DESC
  LIMIT 50;
END; $$;

-- ============================================================================
-- 9. RPC: dashboard_inventory_funnel (Core + Homolog)
-- ============================================================================
CREATE FUNCTION core.dashboard_inventory_funnel()
RETURNS TABLE (
  core_approved bigint,
  core_pending bigint,
  homolog_raw bigint,
  total_inventory bigint
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT
    (SELECT COUNT(*) FROM core.attractions WHERE approved = true)::bigint AS core_approved,
    (SELECT COUNT(*) FROM core.attractions WHERE approved = false)::bigint AS core_pending,
    (SELECT COUNT(*) FROM homolog.pois)::bigint AS homolog_raw,
    (SELECT COUNT(*) FROM core.attractions)::bigint + (SELECT COUNT(*) FROM homolog.pois)::bigint AS total_inventory;
END; $$;

-- ============================================================================
-- 10. RPC: dashboard_content_quality (Qualidade de descrições por idioma)
-- ============================================================================
CREATE FUNCTION core.dashboard_content_quality()
RETURNS TABLE (
  total_pois bigint,
  with_description_pt bigint,
  with_description_en bigint,
  with_description_es bigint,
  with_audio bigint,
  coverage_percentage numeric
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT
    (SELECT COUNT(*) FROM core.attractions)::bigint AS total_pois,
    
    (SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions 
     WHERE language IN ('pt-br', 'pt') AND description IS NOT NULL AND description <> '')::bigint AS with_description_pt,
    
    (SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions 
     WHERE language = 'en' AND description IS NOT NULL AND description <> '')::bigint AS with_description_en,
    
    (SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions 
     WHERE language = 'es' AND description IS NOT NULL AND description <> '')::bigint AS with_description_es,
    
    (SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions 
     WHERE audio_url IS NOT NULL AND audio_url <> '')::bigint AS with_audio,
    
    (SELECT ROUND(
      (COUNT(DISTINCT ad.attraction_id)::numeric / NULLIF((SELECT COUNT(*) FROM core.attractions), 0)) * 100, 1
    ) FROM core.attraction_descriptions ad WHERE ad.description IS NOT NULL)::numeric AS coverage_percentage;
END; $$;

-- ============================================================================
-- 11. RPC: dashboard_inventory_details (Detalhes do inventário para Content tab)
-- ============================================================================
CREATE FUNCTION core.dashboard_inventory_details()
RETURNS TABLE (
  -- Core stats
  core_total bigint,
  core_approved bigint,
  core_pending bigint,
  core_with_coordinates bigint,
  core_with_trigger_points bigint,
  core_missing_trigger_points bigint,
  
  -- Homolog stats
  homolog_total bigint,
  homolog_processed bigint,
  homolog_pending bigint,
  
  -- Content stats
  pois_with_any_description bigint,
  pois_with_all_languages bigint,
  pois_with_audio bigint,
  pois_missing_content bigint,
  
  -- Top cities by POI count
  top_cities jsonb,
  
  -- Categories breakdown
  categories_breakdown jsonb,
  
  -- Recent additions (últimos 7 dias)
  recent_core_additions bigint,
  recent_homolog_additions bigint
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT
    -- Core stats
    (SELECT COUNT(*) FROM core.attractions)::bigint AS core_total,
    (SELECT COUNT(*) FROM core.attractions WHERE approved = true)::bigint AS core_approved,
    (SELECT COUNT(*) FROM core.attractions WHERE approved = false)::bigint AS core_pending,
    (SELECT COUNT(DISTINCT a.id) FROM core.attractions a 
     INNER JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id)::bigint AS core_with_coordinates,
    (SELECT COUNT(DISTINCT a.id) FROM core.attractions a 
     INNER JOIN core.attraction_trigger_points tp ON a.id = tp.attraction_id)::bigint AS core_with_trigger_points,
    (SELECT COUNT(*) FROM core.attractions a 
     WHERE NOT EXISTS (SELECT 1 FROM core.attraction_trigger_points tp WHERE tp.attraction_id = a.id))::bigint AS core_missing_trigger_points,
    
    -- Homolog stats (usando processing_status conforme schema)
    (SELECT COUNT(*) FROM homolog.pois)::bigint AS homolog_total,
    (SELECT COUNT(*) FROM homolog.pois WHERE processing_status = 'completed')::bigint AS homolog_processed,
    (SELECT COUNT(*) FROM homolog.pois WHERE processing_status IN ('pending', 'processing', 'failed') OR processing_status IS NULL)::bigint AS homolog_pending,
    
    -- Content stats
    (SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions 
     WHERE description IS NOT NULL AND description <> '')::bigint AS pois_with_any_description,
    (SELECT COUNT(*) FROM (
      SELECT attraction_id FROM core.attraction_descriptions 
      WHERE description IS NOT NULL AND description <> ''
      GROUP BY attraction_id
      HAVING COUNT(DISTINCT language) >= 3
    ) sub)::bigint AS pois_with_all_languages,
    (SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions 
     WHERE audio_url IS NOT NULL AND audio_url <> '')::bigint AS pois_with_audio,
    (SELECT COUNT(*) FROM core.attractions a 
     WHERE NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL))::bigint AS pois_missing_content,
    
    -- Top 10 cities by POI count
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('city', city, 'country', country, 'count', cnt)), '[]'::jsonb)
     FROM (
       SELECT INITCAP(TRIM(LOWER(a.city))) as city, 
              (ARRAY_AGG(a.country))[1] as country,
              COUNT(*)::int as cnt
       FROM core.attractions a
       WHERE a.city IS NOT NULL AND TRIM(a.city) <> ''
       GROUP BY INITCAP(TRIM(LOWER(a.city)))
       ORDER BY cnt DESC
       LIMIT 10
     ) sub) AS top_cities,
    
    -- Categories breakdown
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'count', cnt)), '[]'::jsonb)
     FROM (
       SELECT COALESCE(a.category, 'uncategorized') as category, COUNT(*)::int as cnt
       FROM core.attractions a
       GROUP BY a.category
       ORDER BY cnt DESC
       LIMIT 15
     ) sub) AS categories_breakdown,
    
    -- Recent additions (últimos 7 dias)
    (SELECT COUNT(*) FROM core.attractions WHERE created_at > NOW() - INTERVAL '7 days')::bigint AS recent_core_additions,
    (SELECT COUNT(*) FROM homolog.pois WHERE created_at > NOW() - INTERVAL '7 days')::bigint AS recent_homolog_additions;
END; $$;

-- ============================================================================
-- 12. RPC: dashboard_user_sessions (Sessions por usuário - cruza com trips)
-- ============================================================================
CREATE FUNCTION core.dashboard_user_sessions(limit_count int DEFAULT 50)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  nickname text,
  country text,
  last_platform text,
  last_sign_in_at timestamptz,
  login_count int,
  trip_count bigint,
  total_km numeric,
  poi_visits_count bigint,
  last_trip_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id as user_id,
    p.full_name,
    p.nickname,
    p.country,
    p.last_platform,
    p.last_sign_in_at,
    COALESCE(p.login_count, 0) as login_count,
    COALESCE(t.trip_count, 0)::bigint as trip_count,
    COALESCE(t.total_distance_km, 0)::numeric as total_km,
    COALESCE(v.visit_count, 0)::bigint as poi_visits_count,
    t.last_trip as last_trip_at
  FROM drive.profiles p
  LEFT JOIN drive.trail_users_from_trips t ON t.user_id = p.id
  LEFT JOIN (
    SELECT pv.user_id, COUNT(*) as visit_count 
    FROM drive.poi_visits pv 
    GROUP BY pv.user_id
  ) v ON v.user_id = p.id
  ORDER BY t.last_trip DESC NULLS LAST, p.last_sign_in_at DESC NULLS LAST
  LIMIT limit_count;
END; $$;

-- ============================================================================
-- 13. RPC: dashboard_heatmap_data (Dados para heatmap de route_trail)
-- ============================================================================
CREATE FUNCTION core.dashboard_heatmap_data(sample_size int DEFAULT 5000)
RETURNS TABLE (
  lat double precision,
  lng double precision,
  weight int
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH sampled_points AS (
    SELECT 
      rt.latitude,
      rt.longitude
    FROM drive.route_trail rt
    WHERE rt.latitude IS NOT NULL 
      AND rt.longitude IS NOT NULL
      AND rt.timestamp > NOW() - INTERVAL '90 days'
    ORDER BY rt.timestamp DESC
    LIMIT sample_size
  ),
  gridded AS (
    SELECT 
      ROUND(latitude::numeric, 3) as grid_lat,
      ROUND(longitude::numeric, 3) as grid_lng,
      COUNT(*)::int as density
    FROM sampled_points
    GROUP BY ROUND(latitude::numeric, 3), ROUND(longitude::numeric, 3)
  )
  SELECT 
    grid_lat::double precision as lat,
    grid_lng::double precision as lng,
    density as weight
  FROM gridded
  ORDER BY density DESC;
END; $$;

-- ============================================================================
-- 14. PERMISSÕES
-- ============================================================================
GRANT SELECT ON drive.trail_trips_unified TO authenticated, service_role;
GRANT SELECT ON drive.trail_users_from_trips TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_city_stats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_most_visited_cities(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_top_visited_pois(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_recent_visited_pois(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_inventory_funnel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_content_quality() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_inventory_details() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_user_sessions(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_heatmap_data(int) TO authenticated, service_role;

-- ============================================================================
-- FIM
-- ============================================================================
