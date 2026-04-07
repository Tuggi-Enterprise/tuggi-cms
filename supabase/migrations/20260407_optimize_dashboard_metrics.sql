-- Migration: Optimized Dashboard Metrics (Consolidated V4)
-- Date: 2026-04-07
-- Purpose: Unifies recent activity groupings (app users) and live feed enrichment (visited POIs with language).

-- 1. dashboard_recent_app_users: Agrupamento por usuário/dia com Timezone
CREATE OR REPLACE FUNCTION core.dashboard_recent_app_users(limit_count int DEFAULT 5)
RETURNS TABLE (
  user_id uuid,
  name text,
  last_activity timestamptz,
  duration_minutes numeric,
  platform text
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH user_daily_activity AS (
    SELECT 
      ts.user_id,
      COALESCE(p.nickname, p.full_name, 'Anonymous') as name,
      (ts.start_time AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date as activity_date,
      MAX(ts.start_time) as last_activity_time,
      SUM(EXTRACT(EPOCH FROM COALESCE(ts.duration, '00:00:00'::interval)) / 60)::numeric as total_duration,
      COALESCE(p.last_platform, 'unknown') as platform
    FROM drive.trip_sessions ts
    LEFT JOIN drive.profiles p ON p.id = ts.user_id
    GROUP BY ts.user_id, name, activity_date, p.last_platform
  )
  SELECT 
    uda.user_id,
    uda.name,
    uda.last_activity_time as last_activity,
    uda.total_duration as duration_minutes,
    uda.platform
  FROM user_daily_activity uda
  ORDER BY uda.last_activity_time DESC
  LIMIT limit_count;
END;
$$;

-- 2. dashboard_recent_visited_pois: Live Feed com Idioma e Nome do POI
CREATE OR REPLACE FUNCTION core.dashboard_recent_visited_pois(
  limit_count int DEFAULT 10
)
RETURNS TABLE (
  visit_id uuid,
  poi_id uuid,
  poi_name text,
  poi_city text,
  poi_country text,
  poi_category text,
  user_nickname text,
  visit_timestamp timestamptz,
  audio_played boolean,
  visit_source text,
  platform text,
  audio_language text
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id as visit_id,
    v.poi_id::uuid,
    a.name as poi_name,
    a.city as poi_city,
    a.country as poi_country,
    a.category as poi_category,
    COALESCE(p.nickname, 'Anonymous') as user_nickname,
    v.visit_timestamp,
    v.audio_played,
    COALESCE(v.visit_source, 'unknown') as visit_source,
    COALESCE(v.platform, 'unknown') as platform,
    COALESCE(v.audio_language, 'unknown') as audio_language
  FROM drive.poi_visits v
  JOIN core.attractions a ON a.id = v.poi_id
  LEFT JOIN drive.profiles p ON p.id = v.user_id
  ORDER BY v.visit_timestamp DESC
  LIMIT limit_count;
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION core.dashboard_recent_app_users(int) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_recent_app_users(int) TO service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_recent_visited_pois(int) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_recent_visited_pois(int) TO service_role;
