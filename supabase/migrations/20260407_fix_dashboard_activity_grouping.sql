-- Migration: Fix Dashboard Recent Activity Grouping
-- Date: 2026-04-07
-- Purpose: Group recent app activity by user and day, summing total duration and being timezone-aware.

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
      -- Agrupamos por Data LOCAL do usuário
      (ts.start_time AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date as activity_date,
      MAX(ts.start_time) as last_activity_time,
      -- Convertemos INTERVAL em Minutos (Numeric)
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

GRANT EXECUTE ON FUNCTION core.dashboard_recent_app_users(int) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_recent_app_users(int) TO service_role;
