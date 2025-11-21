-- Migration: Add Spatial Indexes for route_trail Table
-- Purpose: Optimize viewport-based queries for trail visualization
-- Created: 2024-01-31
-- 
-- IMPORTANT: This migration may take time on large tables.
-- If you encounter timeout errors, execute the statements individually.
-- 
-- These indexes are CRITICAL for performance when querying trails by geographic bounds.
-- Without these indexes, viewport queries on 10,000+ records will be extremely slow.

-- ============================================================================
-- STEP 1: SPATIAL INDEXES FOR VIEWPORT QUERIES (MOST IMPORTANT)
-- ============================================================================
-- Execute these first, one at a time if needed

-- Primary spatial index: Composite B-tree on latitude + longitude
-- This enables efficient bounding box queries (north, south, east, west)
-- Performance impact: 10-100x faster for viewport queries
-- 
-- NOTE: This index creation may take several minutes on large tables.
-- If it times out, try creating it directly via Supabase SQL Editor with increased timeout.
CREATE INDEX IF NOT EXISTS idx_route_trail_lat_lng 
ON drive.route_trail (latitude, longitude)
TABLESPACE pg_default;

-- ============================================================================
-- STEP 2: COMPOSITE INDEXES (EXECUTE AFTER STEP 1)
-- ============================================================================
-- These can be created after the primary index is done

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
-- STEP 3: MATERIALIZED VIEW (OPTIONAL - CAN BE CREATED LATER)
-- ============================================================================
-- This is OPTIONAL and can be created separately if needed.
-- It significantly improves heat map performance but takes time to build.
-- 
-- Uncomment and execute separately if you want the materialized view:
/*
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
*/

-- ============================================================================
-- ALTERNATIVE: CREATE INDEXES WITH CONCURRENTLY (FOR PRODUCTION)
-- ============================================================================
-- If you're running this on a production database with active traffic,
-- use CONCURRENTLY to avoid locking the table:
-- 
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_route_trail_lat_lng 
-- ON drive.route_trail (latitude, longitude);
-- 
-- Note: CONCURRENTLY cannot be used inside a transaction block.
-- Execute these statements directly in Supabase SQL Editor, not in a migration.

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- After creating indexes, verify they exist:
-- SELECT indexname, indexdef 
-- FROM pg_indexes 
-- WHERE tablename = 'route_trail' AND schemaname = 'drive';
-- 
-- Check index usage:
-- SELECT * FROM pg_stat_user_indexes 
-- WHERE indexrelname LIKE 'idx_route_trail%';

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. Index creation may take time on large tables (10,000+ rows)
--    - For tables with 10k-100k rows: 1-5 minutes per index
--    - For tables with 100k+ rows: 5-15 minutes per index
--    - Consider running during off-peak hours
--
-- 2. If you encounter timeout errors:
--    a) Execute statements one at a time via Supabase SQL Editor
--    b) Increase statement timeout in Supabase settings
--    c) Use CONCURRENTLY option (see above) for production
--    d) Create indexes during low-traffic periods
--
-- 3. Monitor index creation progress:
--    SELECT pid, now() - pg_stat_activity.query_start AS duration, query
--    FROM pg_stat_activity
--    WHERE query LIKE '%CREATE INDEX%' AND state = 'active';
--
-- 4. If you need different grid sizes for different zoom levels,
--    create additional materialized views with different precisions:
--    - 0.0001 (10m) for high zoom
--    - 0.001 (100m) for medium zoom (default)
--    - 0.01 (1km) for low zoom
--
-- 5. Consider partitioning the route_trail table by time if it grows
--    beyond 1 million rows for better query performance
