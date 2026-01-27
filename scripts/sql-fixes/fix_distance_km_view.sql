-- Fix drive.trail_trips_unified view to include distance_km
CREATE OR REPLACE VIEW drive.trail_trips_unified AS
SELECT 
  trip_session_id,
  user_id,
  COUNT(*) as point_count,
  MIN(timestamp) as trip_start,
  MAX(timestamp) as trip_end,
  MIN(sequence_order) as min_sequence,
  MAX(sequence_order) as max_sequence,
  EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 60 as duration_minutes,
  (ARRAY_AGG(latitude ORDER BY sequence_order ASC))[1] as start_latitude,
  (ARRAY_AGG(longitude ORDER BY sequence_order ASC))[1] as start_longitude,
  (ARRAY_AGG(latitude ORDER BY sequence_order DESC))[1] as end_latitude,
  (ARRAY_AGG(longitude ORDER BY sequence_order DESC))[1] as end_longitude,
  AVG(speed) as avg_speed,
  MAX(speed) as max_speed,
  SUM(CASE WHEN is_moving THEN 1 ELSE 0 END) as moving_points,
  SUM(CASE WHEN is_moving = false OR is_moving IS NULL THEN 1 ELSE 0 END) as stationary_points,
  (SUM(COALESCE(distance_from_previous, 0)) / 1000.0)::numeric as distance_km
FROM drive.route_trail
GROUP BY trip_session_id, user_id;

-- Ensure permissions are maintained
GRANT SELECT ON drive.trail_trips_unified TO authenticated;
GRANT SELECT ON drive.trail_trips_unified TO service_role;
