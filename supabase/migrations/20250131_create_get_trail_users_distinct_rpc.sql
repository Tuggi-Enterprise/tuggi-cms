-- RPC Function to get distinct users from route_trail
-- Much more efficient than fetching all rows and deduplicating in memory
-- Created: 2025-01-31

CREATE OR REPLACE FUNCTION drive.get_trail_users_distinct(
  user_limit INTEGER DEFAULT 1000
)
RETURNS TABLE (
  user_id UUID,
  first_seen TIMESTAMP WITH TIME ZONE,
  last_seen TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    rt.user_id,
    MIN(rt.timestamp) AS first_seen,
    MAX(rt.timestamp) AS last_seen
  FROM drive.route_trail rt
  GROUP BY rt.user_id
  ORDER BY MAX(rt.timestamp) DESC NULLS LAST
  LIMIT user_limit;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION drive.get_trail_users_distinct(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION drive.get_trail_users_distinct(INTEGER) TO service_role;

-- Comment
COMMENT ON FUNCTION drive.get_trail_users_distinct(INTEGER) IS 'Get distinct user_ids from route_trail efficiently using GROUP BY. Much faster than fetching all rows and deduplicating in memory.';

