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
  SELECT 
    t.user_id,
    COALESCE(p.nickname, p.full_name, 'Anonymous') as name,
    t.trip_start as last_activity,
    t.duration_minutes::numeric,
    COALESCE(p.last_platform, 'unknown') as platform
  FROM drive.trail_trips_unified t
  LEFT JOIN drive.profiles p ON p.id = t.user_id
  ORDER BY t.trip_start DESC
  LIMIT limit_count;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_recent_app_users(int) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_recent_app_users(int) TO service_role;
