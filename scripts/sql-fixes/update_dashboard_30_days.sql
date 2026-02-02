-- ============================================================================
-- ATUALIZAÇÃO: Dashboard para últimos 30 dias (rolling window)
-- Data: 2026-02-02
-- Objetivo: Mudar mau_history e user_growth de agregação mensal para diária
-- ============================================================================

-- Drop função e views dependentes
DROP FUNCTION IF EXISTS core.dashboard_user_analytics(uuid);
DROP VIEW IF EXISTS drive.trail_users_from_trips CASCADE;
DROP VIEW IF EXISTS drive.trail_trips_unified CASCADE;

-- Recriar view trail_trips_unified
CREATE OR REPLACE VIEW drive.trail_trips_unified AS
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

-- Recriar view trail_users_from_trips
CREATE OR REPLACE VIEW drive.trail_users_from_trips AS
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

-- Permissões das views
GRANT SELECT ON drive.trail_trips_unified TO authenticated, service_role;
GRANT SELECT ON drive.trail_users_from_trips TO authenticated, service_role;

-- Recriar a função com dados diários (últimos 30 dias)
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

-- Permissões (anon incluído porque usa SECURITY DEFINER e é apenas leitura de métricas)
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO anon, authenticated, service_role;
