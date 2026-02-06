-- ============================================================================
-- ATUALIZAÇÃO: Regra de Active Users (30D)
-- Data: 2026-02-05
-- Objetivo: Incluir usuários que atualizaram perfil ou criaram conta recentemente
-- ============================================================================

CREATE OR REPLACE FUNCTION core.dashboard_user_analytics(
  owner_id uuid DEFAULT NULL
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
  user_growth jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '120s'
AS $$
DECLARE
  caller_cms_id uuid;
  is_admin boolean := false;
  effective_owner_id uuid;
BEGIN
  effective_owner_id := owner_id;
  
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

  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN
    effective_owner_id := caller_cms_id;
  END IF;

  RETURN QUERY SELECT
    (SELECT COUNT(*)::bigint FROM drive.profiles) AS total_users,
    
    (SELECT COUNT(DISTINCT u.id)::bigint FROM (
      -- Atividade 1: Viagens
      SELECT user_id as id FROM drive.trail_trips_unified WHERE trip_start > NOW() - INTERVAL '30 days'
      UNION
      -- Atividade 2: Visitas a POIs
      SELECT user_id as id FROM drive.poi_visits WHERE visit_timestamp > NOW() - INTERVAL '30 days'
      UNION
      -- Atividade 3: Atualização de perfil ou criação de conta (Garante novos usuários e ativos no app)
      -- Nota: Usamos COALESCE no updated_at para garantir que mesmo sem updates ele pegue o created_at
      SELECT id FROM drive.profiles 
      WHERE created_at > NOW() - INTERVAL '30 days' 
         OR updated_at > NOW() - INTERVAL '30 days'
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
    
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day, 'count', active_users)), '[]'::jsonb)
     FROM (
       SELECT to_char(date_trunc('day', visit_timestamp), 'DD/MM') as day,
              COUNT(DISTINCT user_id)::int as active_users
       FROM drive.poi_visits
       WHERE visit_timestamp > NOW() - INTERVAL '30 days'
       GROUP BY date_trunc('day', visit_timestamp)
       ORDER BY date_trunc('day', visit_timestamp) ASC
     ) dau) AS mau_history,

    (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day, 'new_users', new_users)), '[]'::jsonb)
     FROM (
       SELECT to_char(date_trunc('day', created_at), 'DD/MM') as day,
              COUNT(*)::int as new_users
       FROM drive.profiles
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY date_trunc('day', created_at)
       ORDER BY date_trunc('day', created_at) ASC
     ) growth) AS user_growth;
END;
$$;

-- Permissões
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO authenticated, service_role;
