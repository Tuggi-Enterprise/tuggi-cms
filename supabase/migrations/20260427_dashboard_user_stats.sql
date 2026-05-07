-- User Analytics - Materialized Performance Optimization
-- This implementation caches MAU (Monthly Active Users) and User Growth stats.

-- 1. Create the Materialized View for monthly user statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS drive.mv_user_monthly_stats AS
WITH monthly_activity AS (
    -- Group activity by partner and month
    SELECT 
        p.partner_id as owner_id,
        to_char(date_trunc('month', v.visit_timestamp), 'YYYY-MM') as month,
        v.user_id
    FROM drive.poi_visits v
    INNER JOIN drive.profiles p ON v.user_id = p.id
    GROUP BY 1, 2, 3
),
monthly_mau AS (
    SELECT 
        owner_id,
        month,
        COUNT(DISTINCT user_id)::bigint as mau
    FROM monthly_activity
    GROUP BY 1, 2
),
monthly_new_users AS (
    SELECT 
        partner_id as owner_id,
        to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
        COUNT(*)::bigint as new_users
    FROM drive.profiles
    GROUP BY 1, 2
)
SELECT 
    COALESCE(mau.owner_id, nu.owner_id) as owner_id,
    COALESCE(mau.month, nu.month) as month,
    COALESCE(mau.mau, 0)::bigint as mau,
    COALESCE(nu.new_users, 0)::bigint as new_users
FROM monthly_mau mau
FULL OUTER JOIN monthly_new_users nu ON mau.owner_id = nu.owner_id AND mau.month = nu.month
WITH DATA;

-- 2. Unique index to allow CONCURRENT refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_user_monthly_stats_owner_month 
ON drive.mv_user_monthly_stats (owner_id, month);

-- 3. Refresh function
CREATE OR REPLACE FUNCTION drive.refresh_user_stats()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY drive.mv_user_monthly_stats;
END;
$$;

-- 4. Update dashboard_user_analytics to use the view
-- We'll replace the heavy user_growth and parts of MAU history calculation
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
  free_tier_id uuid := '984a7cd3-c937-4218-842a-9c5fdf824f25';
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

  RETURN QUERY SELECT
    -- 1. TOTAL USERS (Fast lookup from profiles)
    (SELECT COUNT(*)::bigint FROM drive.profiles p
     WHERE (target_owner_id IS NULL OR p.partner_id = target_owner_id)) AS total_users,
    
    -- 2. ACTIVE USERS (MAU 30d)
    (SELECT COUNT(*)::bigint FROM drive.profiles p
     WHERE p.last_sign_in_at > NOW() - INTERVAL '30 days'
       AND (target_owner_id IS NULL OR p.partner_id = target_owner_id)) AS active_users_30d,
    
    -- 3. TOTAL TRIPS
    (SELECT COUNT(*)::bigint FROM drive.trail_trips_unified t
     INNER JOIN drive.profiles p ON t.user_id = p.id
     WHERE (target_owner_id IS NULL OR p.partner_id = target_owner_id)) AS total_trips,
     
    -- 4. TOTAL KM
    (SELECT COALESCE(SUM(distance_km), 0)::numeric FROM drive.trail_trips_unified t
     INNER JOIN drive.profiles p ON t.user_id = p.id
     WHERE (target_owner_id IS NULL OR p.partner_id = target_owner_id)) AS total_km_driven,
     
    -- 5. TOTAL POI VISITS
    (SELECT COUNT(*)::bigint FROM drive.poi_visits v
     INNER JOIN drive.profiles p ON v.user_id = p.id
     WHERE (target_owner_id IS NULL OR p.partner_id = target_owner_id)) AS total_poi_visits,
     
    -- 6. TOTAL AUDIO PLAYS
    (SELECT COUNT(*)::bigint FROM drive.poi_visits v
     INNER JOIN drive.profiles p ON v.user_id = p.id
     WHERE v.audio_played = true
       AND (target_owner_id IS NULL OR p.partner_id = target_owner_id)) AS total_audio_plays,
    
    -- 7. AVG TRIP DURATION
    (SELECT COALESCE(ROUND(AVG(duration_minutes))::text, '0') || ' min' 
     FROM drive.trail_trips_unified t
     INNER JOIN drive.profiles p ON t.user_id = p.id
     WHERE t.duration_minutes > 0
       AND (target_owner_id IS NULL OR p.partner_id = target_owner_id)) AS avg_trip_duration,
    
    -- 8. TRIPS BY PLATFORM
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('platform', platform, 'count', cnt)), '[]'::jsonb) 
     FROM (
       SELECT COALESCE(p.last_platform, 'unknown') as platform, COUNT(t.trip_session_id) as cnt
       FROM drive.trail_trips_unified t
       LEFT JOIN drive.profiles p ON t.user_id = p.id
       WHERE (target_owner_id IS NULL OR p.partner_id = target_owner_id)
       GROUP BY p.last_platform
       ORDER BY cnt DESC
     ) sub) AS trips_by_platform,
    
    -- 9. MAU HISTORY (Optimized using View)
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', month, 'count', mau)), '[]'::jsonb)
     FROM (
       SELECT month, SUM(mau)::int as mau
       FROM drive.mv_user_monthly_stats
       WHERE (target_owner_id IS NULL OR owner_id = target_owner_id)
       GROUP BY month
       ORDER BY month ASC
       LIMIT 12
     ) dau) AS mau_history,

    -- 10. USER GROWTH (Optimized using View)
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('month', month, 'count', cumulative_users)), '[]'::jsonb)
     FROM (
       SELECT 
         month, 
         SUM(SUM(new_users)) OVER (ORDER BY month)::int as cumulative_users
       FROM drive.mv_user_monthly_stats
       WHERE (target_owner_id IS NULL OR owner_id = target_owner_id)
       GROUP BY month
       ORDER BY month ASC
     ) sub) AS user_growth,

    -- 11. TOTAL PREMIUM USERS
    (SELECT COUNT(*)::bigint FROM drive.profiles p
     WHERE p.subscription_tier_id IS NOT NULL 
       AND p.subscription_tier_id != free_tier_id
       AND (target_owner_id IS NULL OR p.partner_id = target_owner_id)) AS total_premium_users,

    -- 12. UPCOMING EXPIRATIONS
    (SELECT COALESCE(jsonb_agg(exp), '[]'::jsonb)
     FROM (
       SELECT 
         p.id as user_id,
         COALESCE(p.full_name, 'Anonymous') as full_name,
         '' as email, -- Email removed for privacy/performance in summary
         'Premium' as tier_name,
         p.subscription_end_date as end_date
       FROM drive.profiles p
       WHERE p.subscription_tier_id IS NOT NULL 
         AND p.subscription_tier_id != free_tier_id
         AND p.subscription_end_date IS NOT NULL
         AND p.subscription_end_date >= NOW()
         AND (target_owner_id IS NULL OR p.partner_id = target_owner_id)
       ORDER BY p.subscription_end_date ASC
       LIMIT 5
     ) exp) AS upcoming_expirations;
END;
$$;

GRANT EXECUTE ON FUNCTION drive.refresh_user_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO authenticated, service_role;
