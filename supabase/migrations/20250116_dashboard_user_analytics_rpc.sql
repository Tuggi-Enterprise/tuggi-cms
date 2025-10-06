-- Dashboard User Analytics RPC
-- Optimized RPC for dashboard user analytics data
-- Replaces multiple direct queries with single optimized call

CREATE OR REPLACE FUNCTION core.dashboard_user_analytics()
RETURNS TABLE (
  total_users BIGINT,
  total_trips BIGINT,
  total_km_driven NUMERIC,
  total_pois_played BIGINT,
  avg_trip_duration INTERVAL,
  trips_by_platform JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    -- Total users count
    (SELECT COUNT(*) FROM drive.profiles) as total_users,
    
    -- Total trips count (only completed trips)
    (SELECT COUNT(*) FROM drive.trip_sessions WHERE end_time IS NOT NULL) as total_trips,
    
    -- Total distance driven
    (SELECT COALESCE(SUM(distance_km), 0) FROM drive.trip_sessions WHERE end_time IS NOT NULL) as total_km_driven,
    
    -- Total POIs played (last 30 days)
    (SELECT COUNT(*) FROM drive.trip_session_attractions 
     WHERE played_at >= NOW() - INTERVAL '30 days') as total_pois_played,
    
    -- Average trip duration
    (SELECT AVG(EXTRACT(EPOCH FROM (end_time - start_time)) * INTERVAL '1 second') 
     FROM drive.trip_sessions 
     WHERE end_time IS NOT NULL AND start_time IS NOT NULL) as avg_trip_duration,
    
    -- Trips by platform (JSONB format)
    (SELECT jsonb_agg(
      jsonb_build_object(
        'platform', platform, 
        'trips', trips
      )
    ) FROM (
      SELECT 
        COALESCE(platform, 'Unknown') as platform, 
        COUNT(*) as trips 
      FROM drive.trip_sessions 
      WHERE end_time IS NOT NULL 
      GROUP BY platform
      ORDER BY trips DESC
    ) platform_stats) as trips_by_platform;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics() TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION core.dashboard_user_analytics() IS 'Optimized RPC for dashboard user analytics - replaces multiple direct queries with single call';
