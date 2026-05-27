-- Fix dashboard rankings ordering
-- Materialized views guarantee ORDER BY only at creation time.
-- After REFRESH MATERIALIZED VIEW CONCURRENTLY the physical row order is NOT preserved.
-- Solution: add explicit ORDER BY in the RPC functions.

-- Fix: dashboard_top_visited_pois
CREATE OR REPLACE FUNCTION core.dashboard_top_visited_pois(limit_count int DEFAULT 10)
RETURNS TABLE (
  poi_id uuid,
  poi_name text,
  city text,
  country text,
  category text,
  total_visits bigint,
  audio_plays bigint,
  unique_visitors bigint
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
    SELECT * FROM drive.mv_top_visited_pois
    ORDER BY total_visits DESC
    LIMIT limit_count;
END; $$;

-- Fix: dashboard_top_generators
CREATE OR REPLACE FUNCTION core.dashboard_top_generators(limit_count int DEFAULT 5)
RETURNS TABLE (
  user_id uuid,
  nickname text,
  content_count bigint
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
    SELECT * FROM core.mv_top_generators
    ORDER BY content_count DESC
    LIMIT limit_count;
END; $$;

GRANT EXECUTE ON FUNCTION core.dashboard_top_visited_pois(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_top_generators(int) TO authenticated, service_role;
