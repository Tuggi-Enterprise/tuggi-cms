-- Migration: Optimized Dashboard Metrics (Consolidated V5)
-- Date: 2026-04-07
-- Purpose: Unifies all dashboard-related SQL fixes for the 2026-04-07 release, including real-time activity, recent interactions, and timezone-aware analytics.

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

-- 3. dashboard_realtime_activity: Melhoria para o radar em tempo real com idioma
CREATE OR REPLACE FUNCTION core.dashboard_realtime_activity(
  interval_minutes int DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '30s'
AS $$
DECLARE
  active_users jsonb;
  active_pois jsonb;
  time_threshold timestamptz;
BEGIN
  time_threshold := NOW() - (interval_minutes || ' minutes')::interval;

  -- 1) Usuarios Ativos
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'user_id', sub.user_id,
      'lat', sub.latitude,
      'lng', sub.longitude,
      'timestamp', sub.ping_time
    )
  ), '[]'::jsonb) 
  INTO active_users
  FROM (
    SELECT DISTINCT ON (user_id) 
           user_id, latitude, longitude, timestamp as ping_time
    FROM drive.route_trail
    WHERE timestamp >= time_threshold
      AND latitude IS NOT NULL AND longitude IS NOT NULL
    ORDER BY user_id, timestamp DESC
  ) sub;

  -- 2) POIs Tocados com Audio Language
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'visit_id', sub2.visit_id,
      'poi_id', sub2.poi_id,
      'poi_name', sub2.poi_name,
      'poi_city', sub2.poi_city,
      'poi_country', sub2.poi_country,
      'poi_category', sub2.poi_category,
      'user_nickname', sub2.user_nickname,
      'visit_timestamp', sub2.visit_timestamp,
      'audio_played', sub2.audio_played,
      'platform', sub2.platform,
      'audio_language', sub2.audio_language
    )
  ), '[]'::jsonb)
  INTO active_pois
  FROM (
    SELECT 
      pv.id as visit_id,
      a.id as poi_id,
      a.name as poi_name,
      a.city as poi_city,
      a.country as poi_country,
      a.category as poi_category,
      COALESCE(p.nickname, p.full_name, 'Anonymous') as user_nickname,
      pv.visit_timestamp,
      pv.audio_played,
      COALESCE(pv.platform, 'unknown') as platform,
      COALESCE(pv.audio_language, 'unknown') as audio_language
    FROM drive.poi_visits pv
    JOIN core.attractions a ON a.id = pv.poi_id
    LEFT JOIN drive.profiles p ON p.id = pv.user_id
    WHERE pv.visit_timestamp >= time_threshold
    ORDER BY pv.visit_timestamp DESC
    LIMIT 50
  ) sub2;

  RETURN jsonb_build_object(
    'active_users', active_users,
    'active_pois', active_pois,
    'interval_minutes', interval_minutes,
    'generated_at', NOW()
  );
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION core.dashboard_recent_app_users(int) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_recent_app_users(int) TO service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_recent_visited_pois(int) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_recent_visited_pois(int) TO service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_realtime_activity(int) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_realtime_activity(int) TO service_role;
