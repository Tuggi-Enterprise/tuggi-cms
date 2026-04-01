CREATE OR REPLACE FUNCTION core.dashboard_recent_active_users(limit_count int DEFAULT 5)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  last_activity timestamptz,
  last_km numeric,
  last_duration text,
  platform text
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH last_trips AS (
    SELECT DISTINCT ON (t.user_id)
      t.user_id,
      t.trip_start as activity_at,
      t.distance_km,
      t.duration_minutes,
      COALESCE(p.last_platform, 'unknown') as platform
    FROM drive.trail_trips_unified t
    LEFT JOIN drive.profiles p ON t.user_id = p.id
    ORDER BY t.user_id, t.trip_start DESC
  )
  SELECT 
    lt.user_id,
    COALESCE(p.full_name, p.nickname, 'Unknown User') as full_name,
    lt.activity_at as last_activity,
    lt.distance_km::numeric as last_km,
    (lt.duration_minutes::int || ' min')::text as last_duration,
    lt.platform
  FROM last_trips lt
  JOIN drive.profiles p ON lt.user_id = p.id
  ORDER BY lt.activity_at DESC
  LIMIT limit_count;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_recent_active_users(int) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_recent_active_users(int) TO service_role;
