-- Simple validation script (run queries one at a time)
-- Each query is independent and optimized to avoid timeout

-- 1. Check if views exist
SELECT 
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'drive'
  AND table_name IN ('trail_trips_unified', 'trail_users_from_trips');

-- 2. Count unified trips (with limit for safety)
SELECT COUNT(*) as total_unified_trips
FROM drive.trail_trips_unified;

-- 3. Count unique users in unified trips
SELECT COUNT(DISTINCT user_id) as unique_users
FROM drive.trail_trips_unified;

-- 4. Sample of unified trips
SELECT 
  trip_session_id,
  user_id,
  point_count,
  duration_minutes
FROM drive.trail_trips_unified
ORDER BY point_count DESC
LIMIT 5;

-- 5. Count users from trips view
SELECT COUNT(*) as total_users
FROM drive.trail_users_from_trips;

-- 6. Sample users from trips
SELECT 
  user_id,
  trip_count,
  total_points
FROM drive.trail_users_from_trips
ORDER BY trip_count DESC
LIMIT 5;

