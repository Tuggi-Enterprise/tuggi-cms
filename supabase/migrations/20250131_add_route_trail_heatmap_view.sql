-- Migration: Create Materialized View for Trail Heat Map
-- Purpose: Pre-aggregate heat map data for better performance
-- Created: 2024-01-31
-- 
-- IMPORTANT: This should be run AFTER the spatial indexes are created.
-- This view can take a long time to build on large datasets.
-- 
-- Execute this separately if you want the materialized view for heat maps.
-- It's optional - the system will work without it using real-time aggregation.

-- Pre-aggregate heat map data by grid cells
-- This dramatically improves heat map query performance
-- Grid size: 0.001 degrees ≈ 100m at equator
CREATE MATERIALIZED VIEW IF NOT EXISTS drive.trail_heatmap_grid AS
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
  SUM(CASE WHEN is_moving THEN 1 ELSE 0 END) AS moving_points
FROM drive.route_trail
WHERE is_moving = true  -- Filter out stationary points
GROUP BY grid_lat, grid_lng;

-- Index on materialized view for fast lookups
CREATE INDEX IF NOT EXISTS idx_heatmap_grid_coords 
ON drive.trail_heatmap_grid (grid_lat, grid_lng)
TABLESPACE pg_default;

-- ============================================================================
-- REFRESH STRATEGY
-- ============================================================================
-- Manual refresh command (run after initial data load or periodically)
-- REFRESH MATERIALIZED VIEW drive.trail_heatmap_grid;
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
-- 1. This view can take 10-30 minutes to build on large datasets (100k+ rows)
-- 2. Refresh it periodically to keep data up to date
-- 3. The view is optional - the system works without it using real-time aggregation
-- 4. If you need different grid sizes, create additional views with different precisions

