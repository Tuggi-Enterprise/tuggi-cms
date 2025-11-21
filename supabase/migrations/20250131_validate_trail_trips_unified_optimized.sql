-- Validation script for trail_trips_unified views (OPTIMIZED)
-- Run queries one at a time to avoid timeout
-- Created: 2024-01-31

-- ============================================================================
-- QUERY 1: Check if views exist (FAST)
-- ============================================================================
SELECT 
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'drive'
  AND table_name IN ('trail_trips_unified', 'trail_users_from_trips')
ORDER BY table_name;

-- ============================================================================
-- QUERY 2: Basic counts from unified view (LIMITED)
-- ============================================================================
-- Use LIMIT to avoid processing all rows
SELECT 
  COUNT(*) as total_unified_trips,
  COUNT(DISTINCT user_id) as unique_users,
  SUM(point_count) as total_points,
  AVG(duration_minutes) as avg_duration_minutes
FROM (
  SELECT * FROM drive.trail_trips_unified LIMIT 10000
) limited;

-- ============================================================================
-- QUERY 3: Sample unified trips (TOP 10)
-- ============================================================================
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

-- ============================================================================
-- QUERY 4: Compare counts (LIMITED - only first 1000 sessions)
-- ============================================================================
-- Compare only a sample to avoid timeout
WITH sample_sessions AS (
  SELECT DISTINCT trip_session_id 
  FROM drive.route_trail 
  LIMIT 1000
)
SELECT 
  'Raw route_trail (sample)' as source,
  COUNT(DISTINCT rt.trip_session_id) as trip_sessions,
  COUNT(DISTINCT rt.user_id) as unique_users,
  COUNT(*) as total_points
FROM drive.route_trail rt
INNER JOIN sample_sessions ss ON rt.trip_session_id = ss.trip_session_id
UNION ALL
SELECT 
  'Unified trips (sample)' as source,
  COUNT(*) as trip_sessions,
  COUNT(DISTINCT user_id) as unique_users,
  SUM(point_count) as total_points
FROM drive.trail_trips_unified
WHERE trip_session_id IN (SELECT trip_session_id FROM sample_sessions);

-- ============================================================================
-- QUERY 5: Check users from trips view (LIMITED)
-- ============================================================================
SELECT 
  COUNT(*) as total_users,
  SUM(trip_count) as total_trips,
  SUM(total_points) as total_points,
  AVG(trip_count) as avg_trips_per_user
FROM (
  SELECT * FROM drive.trail_users_from_trips LIMIT 1000
) limited;

-- ============================================================================
-- QUERY 6: Sample users from trips (TOP 10)
-- ============================================================================
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

-- ============================================================================
-- QUERY 7: Verify point counts (LIMITED - only check 100 sessions)
-- ============================================================================
-- This should return 0 rows if everything is correct
WITH sample_sessions AS (
  SELECT trip_session_id 
  FROM drive.trail_trips_unified 
  LIMIT 100
)
SELECT 
  ttu.trip_session_id,
  ttu.point_count as view_count,
  COUNT(rt.id) as actual_count,
  COUNT(rt.id) - ttu.point_count as difference
FROM drive.trail_trips_unified ttu
INNER JOIN sample_sessions ss ON ttu.trip_session_id = ss.trip_session_id
LEFT JOIN drive.route_trail rt ON rt.trip_session_id = ttu.trip_session_id
GROUP BY ttu.trip_session_id, ttu.point_count
HAVING COUNT(rt.id) != ttu.point_count
LIMIT 10;

-- ============================================================================
-- NOTES
-- ============================================================================
-- If you need full counts without limits:
-- 1. Run queries individually
-- 2. Increase statement timeout in Supabase dashboard
-- 3. Use pgAdmin or direct database connection for large queries
-- 4. Consider creating materialized views for frequently accessed aggregations

