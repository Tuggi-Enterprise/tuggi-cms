-- Validation script for trail_trips_unified views
-- Run this after creating the views to verify they're working correctly

-- 1. Check if views exist
SELECT 
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'drive'
  AND table_name IN ('trail_trips_unified', 'trail_users_from_trips')
ORDER BY table_name;

-- 2. Count trips in unified view
SELECT 
  COUNT(*) as total_unified_trips,
  COUNT(DISTINCT user_id) as unique_users,
  SUM(point_count) as total_points,
  AVG(duration_minutes) as avg_duration_minutes,
  SUM(moving_points) as total_moving_points,
  SUM(stationary_points) as total_stationary_points
FROM drive.trail_trips_unified;

-- 3. Compare with raw data
SELECT 
  'Raw route_trail' as source,
  COUNT(DISTINCT trip_session_id) as trip_sessions,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) as total_points
FROM drive.route_trail
UNION ALL
SELECT 
  'Unified trips' as source,
  COUNT(*) as trip_sessions,
  COUNT(DISTINCT user_id) as unique_users,
  SUM(point_count) as total_points
FROM drive.trail_trips_unified;

-- 4. Sample unified trips (top 10 by point count)
SELECT 
  trip_session_id,
  user_id,
  point_count,
  trip_start,
  trip_end,
  duration_minutes,
  moving_points,
  stationary_points
FROM drive.trail_trips_unified
ORDER BY point_count DESC
LIMIT 10;

-- 5. Check users from trips view
SELECT 
  COUNT(*) as total_users,
  SUM(trip_count) as total_trips,
  SUM(total_points) as total_points,
  AVG(trip_count) as avg_trips_per_user,
  MAX(trip_count) as max_trips_per_user
FROM drive.trail_users_from_trips;

-- 6. Sample users from trips (top 10 by trip count)
SELECT 
  user_id,
  trip_count,
  first_trip,
  last_trip,
  total_points,
  total_duration_minutes
FROM drive.trail_users_from_trips
ORDER BY trip_count DESC
LIMIT 10;

-- 7. Verify: Check if unified trips have correct point counts
-- This should return 0 rows if everything is correct
SELECT 
  ttu.trip_session_id,
  ttu.point_count as view_count,
  COUNT(rt.id) as actual_count,
  COUNT(rt.id) - ttu.point_count as difference
FROM drive.trail_trips_unified ttu
LEFT JOIN drive.route_trail rt ON rt.trip_session_id = ttu.trip_session_id
GROUP BY ttu.trip_session_id, ttu.point_count
HAVING COUNT(rt.id) != ttu.point_count
LIMIT 10;

