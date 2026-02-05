-- Migration: Generic/Dynamic Dashboard Content Quality
-- Date: 2026-02-05
-- Purpose: Remove hardcoded languages and make content quality metrics dynamic

CREATE OR REPLACE FUNCTION core.dashboard_content_quality()
RETURNS TABLE (
  total_with_description bigint,
  total_with_audio bigint,
  coverage_percentage numeric,
  languages_breakdown jsonb
) AS $$
DECLARE
  total_approved bigint;
BEGIN
  -- Total de POIs aprovados (base para a cobertura)
  SELECT COUNT(*) INTO total_approved FROM core.attractions WHERE approved = true;
  
  RETURN QUERY
  WITH lang_stats AS (
    -- Agrupamento dinâmico por idioma (normalizando para 2 letras, ex: pt-BR -> PT)
    SELECT 
      UPPER(LEFT(ad.language, 2)) as lang,
      COUNT(DISTINCT a.id) as count
    FROM core.attractions a
    JOIN core.attraction_descriptions ad ON a.id = ad.attraction_id
    WHERE a.approved = true
    GROUP BY UPPER(LEFT(ad.language, 2))
    ORDER BY count DESC
  )
  SELECT 
    (SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions ad 
     JOIN core.attractions a ON a.id = ad.attraction_id WHERE a.approved = true)::bigint as total_with_description,
    (SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions ad 
     JOIN core.attractions a ON a.id = ad.attraction_id 
     WHERE a.approved = true AND ad.audio_url IS NOT NULL AND ad.audio_url <> '')::bigint as total_with_audio,
    ROUND(
      ((SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions ad 
        JOIN core.attractions a ON a.id = ad.attraction_id WHERE a.approved = true)::numeric / 
      NULLIF(total_approved, 0) * 100), 
      1
    ) as coverage_percentage,
    (SELECT jsonb_agg(jsonb_build_object('language', lang, 'count', count)) FROM lang_stats) as languages_breakdown;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.dashboard_content_quality() TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_content_quality() TO service_role;
