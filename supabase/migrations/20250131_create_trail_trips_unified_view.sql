-- Migration: Create view to unify trips and extract unique users
-- Purpose: Organize trips by trip_session_id and extract unique users from trips
-- Created: 2024-01-31
-- 
-- This view unifies trip information and makes it easy to:
-- 1. Get all trips grouped by trip_session_id
-- 2. Extract unique users from trips
-- 3. Handle cases where one trip may have multiple sessions (fractionated recording)

-- View to get unified trip information
CREATE OR REPLACE VIEW drive.trail_trips_unified AS
SELECT 
  trip_session_id,
  user_id,
  COUNT(*) as point_count,
  MIN(timestamp) as trip_start,
  MAX(timestamp) as trip_end,
  MIN(sequence_order) as min_sequence,
  MAX(sequence_order) as max_sequence,
  -- Calculate trip duration
  EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 60 as duration_minutes,
  -- Get first and last coordinates
  (ARRAY_AGG(latitude ORDER BY sequence_order ASC))[1] as start_latitude,
  (ARRAY_AGG(longitude ORDER BY sequence_order ASC))[1] as start_longitude,
  (ARRAY_AGG(latitude ORDER BY sequence_order DESC))[1] as end_latitude,
  (ARRAY_AGG(longitude ORDER BY sequence_order DESC))[1] as end_longitude,
  -- Calculate approximate distance (simple straight-line distance)
  -- For more accurate distance, use PostGIS functions
  AVG(speed) as avg_speed,
  MAX(speed) as max_speed,
  SUM(CASE WHEN is_moving THEN 1 ELSE 0 END) as moving_points,
  SUM(CASE WHEN is_moving = false OR is_moving IS NULL THEN 1 ELSE 0 END) as stationary_points
FROM drive.route_trail
GROUP BY trip_session_id, user_id;

-- Index on the underlying table for better performance
-- (Indexes already exist, but we ensure they're optimal)

-- View to get unique users from trips
CREATE OR REPLACE VIEW drive.trail_users_from_trips AS
SELECT DISTINCT
  user_id,
  COUNT(DISTINCT trip_session_id) as trip_count,
  MIN(trip_start) as first_trip,
  MAX(trip_end) as last_trip,
  SUM(point_count) as total_points,
  SUM(duration_minutes) as total_duration_minutes
FROM drive.trail_trips_unified
GROUP BY user_id;

-- Index for performance (on underlying table)
-- The existing idx_route_trail_user index should help

-- Grant permissions
GRANT SELECT ON drive.trail_trips_unified TO authenticated;
GRANT SELECT ON drive.trail_trips_unified TO service_role;
GRANT SELECT ON drive.trail_users_from_trips TO authenticated;
GRANT SELECT ON drive.trail_users_from_trips TO service_role;

-- Comments
COMMENT ON VIEW drive.trail_trips_unified IS 'Unified view of trips grouped by trip_session_id. Each row represents one complete trip session with aggregated statistics.';
COMMENT ON VIEW drive.trail_users_from_trips IS 'Unique users extracted from trips with aggregated trip statistics per user.';

