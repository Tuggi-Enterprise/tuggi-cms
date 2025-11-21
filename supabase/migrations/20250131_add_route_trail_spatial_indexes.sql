-- Migration: Add Spatial Indexes for route_trail Table
-- Purpose: Optimize viewport-based queries for trail visualization
-- Created: 2024-01-31
-- 
-- These indexes are CRITICAL for performance when querying trails by geographic bounds.
-- Without these indexes, viewport queries on 10,000+ records will be extremely slow.

-- ============================================================================
-- SPATIAL INDEXES FOR VIEWPORT QUERIES
-- ============================================================================

-- Primary spatial index: Composite B-tree on latitude + longitude
-- This enables efficient bounding box queries (north, south, east, west)
-- Performance impact: 10-100x faster for viewport queries
CREATE INDEX IF NOT EXISTS idx_route_trail_lat_lng 
ON drive.route_trail (latitude, longitude)
TABLESPACE pg_default;

-- Alternative: PostGIS spatial index (if PostGIS extension is available)
-- Uncomment if PostGIS is enabled in your database
-- This is more efficient for complex spatial queries but requires PostGIS
-- CREATE INDEX IF NOT EXISTS idx_route_trail_location_gist 
-- ON drive.route_trail USING GIST (ST_MakePoint(longitude, latitude))
-- TABLESPACE pg_default;

-- ============================================================================
-- COMPOSITE INDEXES FOR COMMON QUERY PATTERNS
-- ============================================================================

-- Index for user + time + location queries
-- Useful when filtering by user and time range within a viewport
CREATE INDEX IF NOT EXISTS idx_route_trail_user_time_location 
ON drive.route_trail (user_id, timestamp DESC, latitude, longitude)
TABLESPACE pg_default;

-- Index for global time-based filtering (not per trip)
-- Useful for time-range queries across all users
CREATE INDEX IF NOT EXISTS idx_route_trail_timestamp_global 
ON drive.route_trail (timestamp DESC)
TABLESPACE pg_default;

-- Index for trip session with location
-- Useful for trip-based queries with geographic filtering
CREATE INDEX IF NOT EXISTS idx_route_trail_trip_location 
ON drive.route_trail (trip_session_id, sequence_order, latitude, longitude)
TABLESPACE pg_default;

-- ============================================================================
-- MATERIALIZED VIEW FOR HEAT MAP (OPTIONAL BUT RECOMMENDED)
-- ============================================================================

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

-- 1. Index creation may take time on large tables (10,000+ rows)
--    Consider running during off-peak hours
--
-- 2. Monitor index usage with:
--    SELECT * FROM pg_stat_user_indexes WHERE indexrelname LIKE 'idx_route_trail%';
--
-- 3. If you need different grid sizes for different zoom levels,
--    create additional materialized views with different precisions:
--    - 0.0001 (10m) for high zoom
--    - 0.001 (100m) for medium zoom (default)
--    - 0.01 (1km) for low zoom
--
-- 4. Consider partitioning the route_trail table by time if it grows
--    beyond 1 million rows for better query performance

