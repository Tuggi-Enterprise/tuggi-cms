-- Migration: Add premium user metrics and upcoming expirations to dashboard
-- Date: 2026-04-01

-- Update the return table of dashboard_user_analytics
DROP FUNCTION IF EXISTS core.dashboard_user_analytics();
DROP FUNCTION IF EXISTS core.dashboard_user_analytics(uuid);

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
  user_growth jsonb,
  total_premium_users bigint, -- ADICIONADO
  upcoming_expirations jsonb  -- ADICIONADO
)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '120s'
AS $$
DECLARE
  caller_cms_id uuid;
  is_admin boolean := false;
  effective_owner_id uuid;
  free_tier_id uuid := '984a7cd3-c937-4218-842a-9c5fdf824f25';
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
      SELECT user_id as id FROM drive.trail_trips_unified WHERE trip_start > NOW() - INTERVAL '30 days'
      UNION
      SELECT user_id as id FROM drive.poi_visits WHERE visit_timestamp > NOW() - INTERVAL '30 days'
      UNION
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

    (SELECT COALESCE(jsonb_agg(jsonb_build_object('month', m, 'count', c)), '[]'::jsonb)
     FROM (
       SELECT to_char(date_trunc('month', created_at), 'MM/YY') as m,
              SUM(COUNT(*)) OVER (ORDER BY date_trunc('month', created_at))::int as c
       FROM drive.profiles
       GROUP BY date_trunc('month', created_at)
       ORDER BY date_trunc('month', created_at) ASC
     ) sub) AS user_growth,

    -- PREMIUM METRICS
    (SELECT COUNT(*)::bigint FROM drive.profiles WHERE subscription_tier_id IS NOT NULL AND subscription_tier_id != free_tier_id) AS total_premium_users,

    -- UPCOMING EXPIRATIONS (Next 5 users)
    (SELECT COALESCE(jsonb_agg(exp), '[]'::jsonb)
     FROM (
       SELECT 
         p.id as user_id,
         p.full_name,
         au.email::text,
         st.display_name as tier_name,
         p.subscription_end_date as end_date
       FROM drive.profiles p
       LEFT JOIN auth.users au ON au.id = p.id
       LEFT JOIN drive.subscription_tiers st ON st.id = p.subscription_tier_id
       WHERE p.subscription_tier_id IS NOT NULL 
         AND p.subscription_tier_id != free_tier_id
         AND p.subscription_end_date IS NOT NULL
         AND p.subscription_end_date >= NOW()
       ORDER BY p.subscription_end_date ASC
       LIMIT 5
     ) exp) AS upcoming_expirations;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO service_role;
