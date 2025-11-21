-- Verification script for trail_heatmap_grid
-- Run this after refreshing the materialized view to verify it's counting all users correctly

-- IMPORTANT: The view aggregates by grid cell, so a user can appear in multiple cells.
-- SUM(unique_users) will count the same user multiple times if they appear in multiple cells.
-- To get the actual unique user count, we need to query the source table.

-- 1. Total unique users in route_trail table (THE REAL COUNT)
SELECT COUNT(DISTINCT user_id) as total_users_real
FROM drive.route_trail;

-- 2. Total unique users aggregated in heatmap_grid (sum across all cells)
-- WARNING: This may have duplicates if same user appears in multiple cells
SELECT SUM(unique_users) as total_users_in_grid_sum
FROM drive.trail_heatmap_grid;

-- 3. To get actual unique users from the view, we'd need to reconstruct from source
-- But since the view doesn't store individual user_ids, we can't get exact count from view alone
-- The view is correct per cell, but summing across cells will overcount users

-- 4. Total points in route_trail
SELECT COUNT(*) as total_points_real
FROM drive.route_trail;

-- 5. Total points in heatmap_grid (should match if view is refreshed)
SELECT SUM(point_count) as total_points_in_grid
FROM drive.trail_heatmap_grid;

-- 6. Check if view exists and has data
SELECT 
  COUNT(*) as grid_cells_count,
  SUM(point_count) as total_points,
  SUM(unique_users) as sum_unique_users,
  SUM(unique_trips) as sum_unique_trips,
  SUM(moving_points) as total_moving_points,
  SUM(stationary_points) as total_stationary_points
FROM drive.trail_heatmap_grid;

-- 7. Sample of grid cells to verify structure
SELECT 
  grid_lat,
  grid_lng,
  point_count,
  unique_users,
  unique_trips,
  moving_points,
  stationary_points
FROM drive.trail_heatmap_grid
ORDER BY point_count DESC
LIMIT 10;

-- 8. Verify: Points should match (if view is refreshed)
-- If total_points_in_grid < total_points_real, the view needs to be refreshed
-- If total_points_in_grid > total_points_real, there's a problem with the view
