-- Migration: Fix Live Feed Language and POI details
-- Date: 2026-04-07
-- Purpose: Redefine the recent visited POIs RPC to include the audio language and ensure all details are present.

CREATE OR REPLACE FUNCTION core.dashboard_recent_visited_pois(
  limit_count int DEFAULT 10
)
RETURNS TABLE (
  visit_id uuid,
  poi_id uuid,
  poi_name text,
  poi_city text,
  poi_country text,
  poi_category text,
  user_nickname text,
  visit_timestamp timestamptz,
  audio_played boolean,
  visit_source text,
  platform text,
  audio_language text
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id as visit_id,
    v.poi_id::uuid,
    a.name as poi_name,
    a.city as poi_city,
    a.country as poi_country,
    a.category as poi_category,
    COALESCE(p.nickname, 'Anonymous') as user_nickname,
    v.visit_timestamp,
    v.audio_played,
    COALESCE(v.visit_source, 'unknown') as visit_source,
    COALESCE(v.platform, 'unknown') as platform,
    COALESCE(v.audio_language, 'unknown') as audio_language
  FROM drive.poi_visits v
  JOIN core.attractions a ON a.id = v.poi_id
  LEFT JOIN drive.profiles p ON p.id = v.user_id
  ORDER BY v.visit_timestamp DESC
  LIMIT limit_count;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.dashboard_recent_visited_pois(int) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_recent_visited_pois(int) TO service_role;
