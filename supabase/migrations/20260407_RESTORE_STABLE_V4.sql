-- Migration: RESTORE STABLE DASHBOARD V4 (Senior Baseline: Commit 30d5702)
-- Goal: Restore exact RPC signatures and logic as of 2026-04-07 12:57:25 -0300
-- This undoes all experimental changes post-30d5702 and ensures stability.

-- 1. dashboard_recent_app_users (from 20260407_fix_dashboard_activity_grouping.sql)
DROP FUNCTION IF EXISTS core.dashboard_recent_app_users(int);
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

-- 2. dashboard_content_quality (from 20260205_fix_dashboard_content_stats.sql)
DROP FUNCTION IF EXISTS core.dashboard_content_quality();
CREATE OR REPLACE FUNCTION core.dashboard_content_quality()
RETURNS TABLE (
  total_with_audio bigint,
  total_with_descriptions bigint,
  coverage_percentage numeric,
  languages_breakdown jsonb
) AS $$
DECLARE
  total_approved bigint;
BEGIN
  SELECT COUNT(*) INTO total_approved FROM core.attractions WHERE approved = true;
  
  RETURN QUERY
  WITH lang_stats AS (
    SELECT language as lang, COUNT(*) as count 
    FROM core.attraction_descriptions ad
    JOIN core.attractions a ON a.id = ad.attraction_id
    WHERE a.approved = true
    GROUP BY language
    ORDER BY 2 DESC
  )
  SELECT 
    (SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions ad 
     JOIN core.attractions a ON a.id = ad.attraction_id 
     WHERE a.approved = true AND ad.audio_url IS NOT NULL AND ad.audio_url <> '')::bigint as total_with_audio,
    (SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions ad 
     JOIN core.attractions a ON a.id = ad.attraction_id WHERE a.approved = true)::bigint as total_with_description,
    ROUND(
      ((SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions ad 
        JOIN core.attractions a ON a.id = ad.attraction_id WHERE a.approved = true)::numeric / 
      NULLIF(total_approved, 0) * 100), 
      1
    ) as coverage_percentage,
    (SELECT jsonb_agg(jsonb_build_object('language', lang, 'count', count) ORDER BY count DESC) FROM lang_stats) as languages_breakdown;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. dashboard_inventory_funnel (from 15c1c5c Stable Baseline)
DROP FUNCTION IF EXISTS core.dashboard_inventory_funnel();
CREATE OR REPLACE FUNCTION core.dashboard_inventory_funnel()
RETURNS TABLE (
  core_approved bigint,
  core_pending bigint,
  homolog_raw bigint,
  total_inventory bigint
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT
    (SELECT COUNT(*) FROM core.attractions WHERE approved = true)::bigint AS core_approved,
    (SELECT COUNT(*) FROM core.attractions WHERE approved = false)::bigint AS core_pending,
    (SELECT COUNT(*) FROM homolog.pois)::bigint AS homolog_raw,
    (SELECT COUNT(*) FROM core.attractions)::bigint + (SELECT COUNT(*) FROM homolog.pois)::bigint AS total_inventory;
END; $$;

-- 4. dashboard_visits_by_language (from 20260407_fix_live_feed_language.sql metadata logic)
DROP FUNCTION IF EXISTS core.dashboard_visits_by_language();
CREATE OR REPLACE FUNCTION core.dashboard_visits_by_language()
RETURNS TABLE (
  language_code text,
  visit_count bigint,
  audio_played_count bigint
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT 
    COALESCE(audio_language, 'unknown'), COUNT(*)::bigint, COUNT(*) FILTER (WHERE audio_played = true)::bigint
  FROM drive.poi_visits GROUP BY 1 ORDER BY 2 DESC;
END;
$$;

-- Permissions
GRANT USAGE ON SCHEMA core TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_recent_app_users(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_content_quality() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_inventory_funnel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_visits_by_language() TO authenticated, service_role;
