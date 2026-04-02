-- Migration: Refine Active User metric using last_sign_in_at
-- Date: 2026-04-01

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
SET statement_timeout = '120s'
AS $$
DECLARE
  caller_cms_id uuid;
  is_admin boolean := false;
  effective_owner_id uuid;
  free_tier_id uuid := '984a7cd3-c937-4218-842a-9c5fdf824f25';
BEGIN
  effective_owner_id := p_owner_id;
  
  -- Determine effective owner_id based on who is calling
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
    -- 1. TOTAL USERS: Filtered by partner_id if not admin
    (SELECT COUNT(*)::bigint FROM drive.profiles p
     WHERE (effective_owner_id IS NULL OR p.partner_id = effective_owner_id)) AS total_users,
    
    -- 2. ACTIVE USERS (MAU): Login in the last 30 days (as per request)
    (SELECT COUNT(*)::bigint FROM drive.profiles p
     WHERE p.last_sign_in_at > NOW() - INTERVAL '30 days'
       AND (effective_owner_id IS NULL OR p.partner_id = effective_owner_id)) AS active_users_30d,
    
    -- 3. TOTAL TRIPS: Aggregated from unified trips
    (SELECT COUNT(*)::bigint FROM drive.trail_trips_unified t
     INNER JOIN drive.profiles p ON t.user_id = p.id
     WHERE (effective_owner_id IS NULL OR p.partner_id = effective_owner_id)) AS total_trips,
     
    -- 4. TOTAL KM: Aggregated KM
    (SELECT COALESCE(SUM(distance_km), 0)::numeric FROM drive.trail_trips_unified t
     INNER JOIN drive.profiles p ON t.user_id = p.id
     WHERE (effective_owner_id IS NULL OR p.partner_id = effective_owner_id)) AS total_km_driven,
     
    -- 5. TOTAL POI VISITS: Aggregated visits
    (SELECT COUNT(*)::bigint FROM drive.poi_visits v
     INNER JOIN drive.profiles p ON v.user_id = p.id
     WHERE (effective_owner_id IS NULL OR p.partner_id = effective_owner_id)) AS total_poi_visits,
     
    -- 6. TOTAL AUDIO PLAYS: Aggregated plays
    (SELECT COUNT(*)::bigint FROM drive.poi_visits v
     INNER JOIN drive.profiles p ON v.user_id = p.id
     WHERE v.audio_played = true
       AND (effective_owner_id IS NULL OR p.partner_id = effective_owner_id)) AS total_audio_plays,
    
    -- 7. AVG TRIP DURATION: Textual duration
    (SELECT COALESCE(ROUND(AVG(duration_minutes))::text, '0') || ' min' 
     FROM drive.trail_trips_unified t
     INNER JOIN drive.profiles p ON t.user_id = p.id
     WHERE t.duration_minutes > 0
       AND (effective_owner_id IS NULL OR p.partner_id = effective_owner_id)) AS avg_trip_duration,
    
    -- 8. TRIPS BY PLATFORM: Grouped by profile platform
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('platform', platform, 'count', cnt)), '[]'::jsonb) 
     FROM (
       SELECT COALESCE(p.last_platform, 'unknown') as platform, COUNT(t.trip_session_id) as cnt
       FROM drive.trail_trips_unified t
       LEFT JOIN drive.profiles p ON t.user_id = p.id
       WHERE (effective_owner_id IS NULL OR p.partner_id = effective_owner_id)
       GROUP BY p.last_platform
       ORDER BY cnt DESC
     ) sub) AS trips_by_platform,
    
    -- 9. DAU HISTORY (Chart logic): Based on POI visits (most granular activity)
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day, 'count', active_users)), '[]'::jsonb)
     FROM (
       SELECT to_char(date_trunc('day', v.visit_timestamp), 'DD/MM') as day,
              COUNT(DISTINCT v.user_id)::int as active_users
       FROM drive.poi_visits v
       INNER JOIN drive.profiles p ON v.user_id = p.id
       WHERE v.visit_timestamp > NOW() - INTERVAL '30 days'
         AND (effective_owner_id IS NULL OR p.partner_id = effective_owner_id)
       GROUP BY date_trunc('day', v.visit_timestamp)
       ORDER BY date_trunc('day', v.visit_timestamp) ASC
     ) dau) AS mau_history,

    -- 10. USER GROWTH: Monthly cumulative growth
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('month', m, 'count', c)), '[]'::jsonb)
     FROM (
       SELECT to_char(date_trunc('month', created_at), 'MM/YY') as m,
              SUM(COUNT(*)) OVER (ORDER BY date_trunc('month', created_at))::int as c
       FROM drive.profiles p
       WHERE (effective_owner_id IS NULL OR p.partner_id = effective_owner_id)
       GROUP BY date_trunc('month', created_at)
       ORDER BY date_trunc('month', created_at) ASC
     ) sub) AS user_growth,

    -- 11. PREMIUM METRICS: Active premium subscribers
    (SELECT COUNT(*)::bigint FROM drive.profiles p
     WHERE p.subscription_tier_id IS NOT NULL 
       AND p.subscription_tier_id != free_tier_id
       AND (effective_owner_id IS NULL OR p.partner_id = effective_owner_id)) AS total_premium_users,

    -- 12. UPCOMING EXPIRATIONS: Next 5 users to expire
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
         AND (effective_owner_id IS NULL OR p.partner_id = effective_owner_id)
       ORDER BY p.subscription_end_date ASC
       LIMIT 5
     ) exp) AS upcoming_expirations;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO service_role;
