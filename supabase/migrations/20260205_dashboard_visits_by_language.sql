-- Migration: Dashboard Visits by Language
-- Purpose: Get statistics of POI visits and audio plays grouped by audio language
-- Date: 2026-02-05

CREATE OR REPLACE FUNCTION core.dashboard_visits_by_language()
RETURNS TABLE (
  language_code text,
  visit_count bigint,
  audio_played_count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(v.audio_language, 'unknown') as language_code,
    COUNT(*)::bigint as visit_count,
    COUNT(*) FILTER (WHERE v.audio_played = true)::bigint as audio_played_count
  FROM drive.poi_visits v
  WHERE v.audio_language IS NOT NULL AND v.audio_language <> ''
  GROUP BY v.audio_language
  ORDER BY visit_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.dashboard_visits_by_language() TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_visits_by_language() TO service_role;
