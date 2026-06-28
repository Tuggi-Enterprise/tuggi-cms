-- Migration: dashboard_realtime_activity — presença por user_location_history + janela em SEGUNDOS
-- Date: 2026-06-28
-- Description:
--   "Online agora" = teve ping em drive.user_location_history nos últimos `window_seconds`.
--   Não há evento de "offline": é inferência por recência. Janela em SEGUNDOS (não minutos)
--   para acompanhar a cadência real do ping de background (~30s) e derrubar o usuário rápido
--   quando a localização para de chegar.
--
--   Regra prática: window_seconds ≈ 2–3× a cadência do ping. Com ping ~30s → 90–120s.
--   active_pois (POIs ouvidas) segue em drive.poi_visits, com a mesma janela.
--
--   ⚠️ Muda a ASSINATURA (interval_minutes → window_seconds): precisa DROP antes do CREATE.
--   ⚠️ Rodar manualmente no painel SQL do Supabase (nunca DDL via CLI).

DROP FUNCTION IF EXISTS core.dashboard_realtime_activity(integer);

CREATE OR REPLACE FUNCTION core.dashboard_realtime_activity(window_seconds integer DEFAULT 120)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '30s'
SET search_path TO 'core', 'public', 'extensions'
AS $$
DECLARE
  active_users jsonb;
  active_pois jsonb;
  time_threshold timestamptz;
BEGIN
  time_threshold := NOW() - make_interval(secs => GREATEST(window_seconds, 15));

  -- 1) Usuários online = último ping de presença dentro da janela (1 por user)
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
           user_id, latitude, longitude, created_at AS ping_time
    FROM drive.user_location_history
    WHERE created_at >= time_threshold
      AND latitude IS NOT NULL AND longitude IS NOT NULL
    ORDER BY user_id, created_at DESC
  ) sub;

  -- 2) POIs Tocados (mesma janela)
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
    'window_seconds', window_seconds,
    'generated_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION core.dashboard_realtime_activity(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_realtime_activity(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_realtime_activity(integer) TO service_role;

COMMENT ON FUNCTION core.dashboard_realtime_activity(integer) IS
  'Atividade ao vivo. active_users = presença em drive.user_location_history dentro de window_seconds (online agora); active_pois = drive.poi_visits. Janela em segundos para acompanhar o ping ~30s.';
