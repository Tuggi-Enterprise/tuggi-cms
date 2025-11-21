-- Migration: Add function to get accurate user count from trail_heatmap_grid
-- Purpose: Get actual unique user count (not sum of per-cell counts)
-- Created: 2024-01-31
-- 
-- The materialized view aggregates by grid cell, so SUM(unique_users) 
-- will overcount users who appear in multiple cells.
-- This function queries the source table to get the actual unique count.

CREATE OR REPLACE FUNCTION drive.get_trail_heatmap_stats()
RETURNS TABLE (
  total_users BIGINT,
  total_points BIGINT,
  total_trips BIGINT,
  grid_cells_count BIGINT,
  points_in_grid BIGINT,
  users_in_grid_sum BIGINT,
  trips_in_grid_sum BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH real_stats AS (
    SELECT 
      COUNT(DISTINCT user_id)::BIGINT as real_users,
      COUNT(*)::BIGINT as real_points,
      COUNT(DISTINCT trip_session_id)::BIGINT as real_trips
    FROM drive.route_trail
  ),
  grid_stats AS (
    SELECT 
      COUNT(*)::BIGINT as cells,
      SUM(point_count)::BIGINT as points,
      SUM(unique_users)::BIGINT as users_sum,
      SUM(unique_trips)::BIGINT as trips_sum
    FROM drive.trail_heatmap_grid
  )
  SELECT 
    rs.real_users as total_users,
    rs.real_points as total_points,
    rs.real_trips as total_trips,
    gs.cells as grid_cells_count,
    gs.points as points_in_grid,
    gs.users_sum as users_in_grid_sum,
    gs.trips_sum as trips_in_grid_sum
  FROM real_stats rs
  CROSS JOIN grid_stats gs;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION drive.get_trail_heatmap_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION drive.get_trail_heatmap_stats() TO service_role;

-- Comment
COMMENT ON FUNCTION drive.get_trail_heatmap_stats() IS 'Returns accurate statistics comparing real data vs materialized view. total_users is the actual unique user count (not sum of per-cell counts).';

-- Example usage:
-- SELECT * FROM drive.get_trail_heatmap_stats();
-- This will show:
-- - total_users: Actual unique users (7 in your case)
-- - total_points: Total points in route_trail
-- - points_in_grid: Total points in materialized view (should match if refreshed)
-- - users_in_grid_sum: Sum of unique_users from all cells (will be >= total_users if users appear in multiple cells)

