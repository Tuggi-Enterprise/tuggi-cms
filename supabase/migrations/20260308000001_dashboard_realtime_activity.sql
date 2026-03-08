-- Migration: Add dashboard_realtime_activity RPC
-- Date: 2026-03-08

-- ================================
-- dashboard_realtime_activity
-- ================================
DROP FUNCTION IF EXISTS core.dashboard_realtime_activity(int);

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
  -- Calculamos o threshold apenas uma vez
  time_threshold := NOW() - (interval_minutes || ' minutes')::interval;

  -- 1) Usuarios Ativos: pegando a ULTIMA coordenada registrada no periodo
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
           user_id, 
           latitude, 
           longitude, 
           timestamp as ping_time
    FROM drive.route_trail
    WHERE timestamp >= time_threshold
      AND latitude IS NOT NULL 
      AND longitude IS NOT NULL
    ORDER BY user_id, timestamp DESC
  ) sub;

  -- 2) POIs Tocados: ultimas interacoes no perido
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
      'platform', sub2.platform
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
      pv.platform
    FROM drive.poi_visits pv
    JOIN core.attractions a ON a.id = pv.poi_id
    LEFT JOIN drive.profiles p ON p.id = pv.user_id
    WHERE pv.visit_timestamp >= time_threshold
    ORDER BY pv.visit_timestamp DESC
    LIMIT 50
  ) sub2;

  -- 3) Retornamos tudo como um unico objeto JSON
  RETURN jsonb_build_object(
    'active_users', active_users,
    'active_pois', active_pois,
    'interval_minutes', interval_minutes,
    'generated_at', NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_realtime_activity(int) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_realtime_activity(int) TO service_role;
