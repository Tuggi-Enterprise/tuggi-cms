-- REPAIR SCRIPT: Fix dashboard analytics regression
-- This script restores missing columns (active_users_30d, history, growth) 
-- and ensures proper scoping by owner_id or created_by.
-- 
-- Date: 2026-02-25
-- Regression fix for: patch_dashboard_rpc_scope.sql
-- Fix: Replace non-existent attraction_id with bridge via poi_visits

-- 1. dashboard_user_analytics
DROP FUNCTION IF EXISTS core.dashboard_user_analytics(uuid);
DROP FUNCTION IF EXISTS core.dashboard_user_analytics();

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
  user_growth jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller_cms_id uuid;
  is_admin boolean := false;
  target_owner_id uuid;
BEGIN
  -- Security Resolution
  BEGIN
    caller_cms_id := (SELECT id FROM core.cms_users WHERE email = current_setting('request.jwt.claims.email', true));
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
    -- total_users 
    (SELECT COUNT(DISTINCT u.id)::bigint FROM (
        SELECT id FROM drive.profiles WHERE target_owner_id IS NULL
        UNION ALL
        SELECT v.user_id FROM drive.poi_visits v 
        JOIN core.attractions a ON v.poi_id = a.id 
        WHERE target_owner_id IS NOT NULL 
          AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
    ) u) AS total_users,

    -- active_users_30d
    (SELECT COUNT(DISTINCT u.id)::bigint FROM (
      -- Trips (Global or via POI visit bridge)
      SELECT t.user_id as id FROM drive.trail_trips_unified t 
      WHERE t.trip_start > NOW() - INTERVAL '30 days'
        AND (target_owner_id IS NULL OR EXISTS (
          SELECT 1 FROM drive.poi_visits v 
          JOIN core.attractions a ON v.poi_id = a.id
          WHERE v.trip_session_id = t.trip_session_id 
            AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
        ))
      UNION
      -- POI Visits
      SELECT v.user_id as id FROM drive.poi_visits v 
      WHERE v.visit_timestamp > NOW() - INTERVAL '30 days'
        AND (target_owner_id IS NULL OR EXISTS (
          SELECT 1 FROM core.attractions a 
          WHERE a.id = v.poi_id AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
        ))
      UNION
      -- Profile-based activity (only for global dashboard)
      SELECT id FROM drive.profiles 
      WHERE target_owner_id IS NULL 
        AND (created_at > NOW() - INTERVAL '30 days' OR updated_at > NOW() - INTERVAL '30 days')
    ) u) AS active_users_30d,

    -- total_trips
    (SELECT COUNT(DISTINCT trip_id)::bigint FROM (
       SELECT t.trip_session_id as trip_id FROM drive.trail_trips_unified t WHERE target_owner_id IS NULL
       UNION ALL
       SELECT v.trip_session_id as trip_id FROM drive.poi_visits v 
       JOIN core.attractions a ON v.poi_id = a.id
       WHERE target_owner_id IS NOT NULL 
         AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
    ) trips) AS total_trips,

    -- total_km_driven
    (SELECT COALESCE(SUM(km), 0)::numeric FROM (
       SELECT t.distance_km as km FROM drive.trail_trips_unified t WHERE target_owner_id IS NULL
       UNION ALL
       SELECT t.distance_km as km FROM drive.trail_trips_unified t
       WHERE target_owner_id IS NOT NULL 
         AND EXISTS (
           SELECT 1 FROM drive.poi_visits v 
           JOIN core.attractions a ON v.poi_id = a.id
           WHERE v.trip_session_id = t.trip_session_id 
             AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
         )
    ) kms) AS total_km_driven,

    -- total_poi_visits
    (SELECT COUNT(*)::bigint FROM drive.poi_visits v
     WHERE (target_owner_id IS NULL OR EXISTS (
       SELECT 1 FROM core.attractions a 
       WHERE a.id = v.poi_id AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
     ))) AS total_poi_visits,

    -- total_audio_plays
    (SELECT COUNT(*)::bigint FROM drive.poi_visits v
     WHERE v.audio_played = true 
       AND (target_owner_id IS NULL OR EXISTS (
         SELECT 1 FROM core.attractions a 
         WHERE a.id = v.poi_id AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
       ))) AS total_audio_plays,

    -- avg_trip_duration
    (SELECT (COALESCE(ROUND(AVG(duration)), 0)::text || ' min')
     FROM (
       SELECT t.duration_minutes as duration FROM drive.trail_trips_unified t 
       WHERE target_owner_id IS NULL AND t.duration_minutes > 0.1 AND t.duration_minutes < 1440
       UNION ALL
       SELECT t.duration_minutes as duration FROM drive.trail_trips_unified t 
       WHERE target_owner_id IS NOT NULL 
         AND EXISTS (
           SELECT 1 FROM drive.poi_visits v 
           JOIN core.attractions a ON v.poi_id = a.id
           WHERE v.trip_session_id = t.trip_session_id 
             AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
         ) AND t.duration_minutes > 0.1 AND t.duration_minutes < 1440
     ) durations) AS avg_trip_duration,

    -- trips_by_platform
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('platform', platform, 'count', cnt)), '[]'::jsonb) 
     FROM (
       SELECT COALESCE(p.last_platform, 'unknown') as platform, COUNT(DISTINCT t.trip_session_id) as cnt
       FROM drive.trail_trips_unified t
       LEFT JOIN drive.profiles p ON t.user_id = p.id
       WHERE (target_owner_id IS NULL OR EXISTS (
         SELECT 1 FROM drive.poi_visits v 
         JOIN core.attractions a ON v.poi_id = a.id
         WHERE v.trip_session_id = t.trip_session_id 
           AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
       ))
       GROUP BY p.last_platform
       ORDER BY cnt DESC
     ) sub) AS trips_by_platform,

    -- mau_history
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', day, 'count', active_users)), '[]'::jsonb)
     FROM (
       SELECT to_char(date_trunc('day', v.visit_timestamp), 'DD/MM') as day,
              COUNT(DISTINCT v.user_id)::int as active_users
       FROM drive.poi_visits v
       WHERE v.visit_timestamp > NOW() - INTERVAL '30 days'
         AND (target_owner_id IS NULL OR EXISTS (
           SELECT 1 FROM core.attractions a 
           WHERE a.id = v.poi_id AND (a.owner_id = target_owner_id OR a.created_by = target_owner_id)
         ))
       GROUP BY date_trunc('day', v.visit_timestamp)
       ORDER BY date_trunc('day', v.visit_timestamp) ASC
     ) dau) AS mau_history,

    -- user_growth
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('month', m, 'count', c)), '[]'::jsonb)
     FROM (
       SELECT to_char(date_trunc('month', created_at), 'MM/YY') as m,
              SUM(COUNT(*)) OVER (ORDER BY date_trunc('month', created_at))::int as c
       FROM drive.profiles
       WHERE target_owner_id IS NULL
       GROUP BY date_trunc('month', created_at)
       ORDER BY date_trunc('month', created_at) ASC
     ) sub) AS user_growth;
END;
$$;

-- 2. dashboard_city_stats
DROP FUNCTION IF EXISTS core.dashboard_city_stats(uuid);
DROP FUNCTION IF EXISTS core.dashboard_city_stats();

CREATE OR REPLACE FUNCTION core.dashboard_city_stats(
  p_owner_id uuid DEFAULT NULL
)
RETURNS TABLE (
  city text,
  country text,
  poi_count bigint,
  approved_count bigint,
  pending_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller_cms_id uuid;
  is_admin boolean := false;
  target_owner_id uuid;
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

  RETURN QUERY
  SELECT 
    INITCAP(TRIM(LOWER(a.city))) as city,
    (ARRAY_AGG(a.country ORDER BY a.country NULLS LAST))[1] as country,
    COUNT(*)::bigint AS poi_count,
    COUNT(*) FILTER (WHERE a.approved = true)::bigint AS approved_count,
    COUNT(*) FILTER (WHERE a.approved = false)::bigint AS pending_count
  FROM core.attractions a
  WHERE (target_owner_id IS NULL OR a.owner_id = target_owner_id OR a.created_by = target_owner_id)
    AND a.city IS NOT NULL AND TRIM(a.city) <> ''
  GROUP BY INITCAP(TRIM(LOWER(a.city)))
  ORDER BY poi_count DESC
  LIMIT 50;
END;
$$;

-- 3. Compatibility wrappers for common frontend calls
CREATE OR REPLACE FUNCTION core.dashboard_user_analytics_old()
RETURNS TABLE (total_users bigint, total_trips bigint, total_km_driven numeric, total_pois_played bigint, avg_trip_duration text, trips_by_platform jsonb)
LANGUAGE sql STABLE AS $$ SELECT total_users, total_trips, total_km_driven, total_audio_plays, avg_trip_duration, trips_by_platform FROM core.dashboard_user_analytics(NULL); $$;

GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_city_stats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics_old() TO authenticated, service_role;
