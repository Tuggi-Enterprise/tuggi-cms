-- Migration: Fix trail_heatmap_grid to count ALL users (not just moving)
-- Purpose: Include all trail points, not just moving ones, to get accurate user counts
-- Created: 2024-01-31
-- 
-- This fixes the issue where the materialized view was only counting users
-- who were moving, missing stationary users.

-- Drop existing view if it exists
DROP MATERIALIZED VIEW IF EXISTS drive.trail_heatmap_grid;

-- Recreate with ALL points (not just moving)
-- This ensures we count all users, including those who were stationary
CREATE MATERIALIZED VIEW drive.trail_heatmap_grid AS
SELECT 
  -- Grid cell coordinates (100m x 100m cells)
  FLOOR(latitude * 1000) / 1000 AS grid_lat,
  FLOOR(longitude * 1000) / 1000 AS grid_lng,
  COUNT(*) AS point_count,
  COUNT(DISTINCT user_id) AS unique_users,
  COUNT(DISTINCT trip_session_id) AS unique_trips,
  MIN(timestamp) AS first_seen,
  MAX(timestamp) AS last_seen,
  AVG(speed) AS avg_speed,
  SUM(CASE WHEN is_moving THEN 1 ELSE 0 END) AS moving_points,
  SUM(CASE WHEN is_moving = false OR is_moving IS NULL THEN 1 ELSE 0 END) AS stationary_points
FROM drive.route_trail
-- REMOVED: WHERE is_moving = true
-- Now includes ALL points to count ALL users
GROUP BY grid_lat, grid_lng;

-- Recreate index on materialized view for fast lookups
CREATE INDEX IF NOT EXISTS idx_heatmap_grid_coords 
ON drive.trail_heatmap_grid (grid_lat, grid_lng)
TABLESPACE pg_default;

-- ============================================================================
-- REFRESH STRATEGY
-- ============================================================================
-- IMPORTANT: After running this migration, refresh the view:
-- REFRESH MATERIALIZED VIEW drive.trail_heatmap_grid;
-- 
-- This may take 10-30 minutes on large datasets (100k+ rows)
-- 
-- To set up automatic refresh, you can use Supabase cron or pg_cron:
-- Example: Refresh every hour
-- SELECT cron.schedule(
--   'refresh-trail-heatmap',
--   '0 * * * *',
--   'REFRESH MATERIALIZED VIEW drive.trail_heatmap_grid'
-- );

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. This view now includes ALL trail points (moving + stationary)
-- 2. This ensures accurate user counts - all users are counted
-- 3. The moving_points column still shows how many points were moving
-- 4. The stationary_points column shows how many points were stationary
-- 5. Refresh it periodically to keep data up to date
-- 6. The view is optional - the system works without it using real-time aggregation

