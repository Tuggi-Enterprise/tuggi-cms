-- Migration: Add/Fix Top Visited POIs RPC
-- Date: 2026-04-01
-- Purpose: Standardize the calculation of top visited POIs with correct sorting by total visits

DROP FUNCTION IF EXISTS core.dashboard_top_visited_pois(int);

CREATE OR REPLACE FUNCTION core.dashboard_top_visited_pois(
  limit_count int DEFAULT 10
)
RETURNS TABLE (
  poi_id text,
  poi_name text,
  city text,
  country text,
  category text,
  total_visits bigint,
  audio_plays bigint,
  unique_visitors bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.poi_id::text as poi_id,
    a.name as poi_name,
    a.city,
    a.country,
    a.category,
    COUNT(*)::bigint as total_visits,
    COUNT(*) FILTER (WHERE v.audio_played = true)::bigint as audio_plays,
    COUNT(DISTINCT v.user_id)::bigint as unique_visitors
  FROM drive.poi_visits v
  JOIN core.attractions a ON a.id = v.poi_id
  GROUP BY v.poi_id, a.name, a.city, a.country, a.category
  ORDER BY total_visits DESC -- ORDENAÇÃO EXPLÍCITA POR VISITAS
  LIMIT limit_count;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_top_visited_pois(int) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_top_visited_pois(int) TO service_role;
