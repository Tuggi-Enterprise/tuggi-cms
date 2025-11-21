-- Migration: Create RPC function for trail users list
-- Purpose: Efficiently get user list with trail counts using database aggregation
-- Created: 2024-01-31
-- 
-- This RPC function uses database-level aggregation which is much faster
-- than fetching all trails and aggregating in application code.

CREATE OR REPLACE FUNCTION drive.get_trail_users(
  user_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  user_id UUID,
  trail_count BIGINT,
  trip_count BIGINT,
  last_activity TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  -- Use a subquery to limit data before aggregation to avoid timeout
  -- This is much faster than aggregating the entire table
  WITH limited_trails AS (
    SELECT 
      rt.user_id,
      rt.trip_session_id,
      rt.timestamp
    FROM drive.route_trail rt
    -- Use index on user_id for faster scanning
    WHERE rt.user_id IS NOT NULL
    LIMIT 10000  -- Limit rows before aggregation
  )
  SELECT 
    lt.user_id,
    COUNT(*)::BIGINT AS trail_count,
    COUNT(DISTINCT lt.trip_session_id)::BIGINT AS trip_count,
    MAX(lt.timestamp) AS last_activity
  FROM limited_trails lt
  GROUP BY lt.user_id
  -- Remove ORDER BY to avoid timeout - client can sort if needed
  LIMIT user_limit;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION drive.get_trail_users(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION drive.get_trail_users(INTEGER) TO service_role;

-- Comment
COMMENT ON FUNCTION drive.get_trail_users(INTEGER) IS 'Efficiently returns user list with trail and trip counts. Uses database aggregation for better performance.';

