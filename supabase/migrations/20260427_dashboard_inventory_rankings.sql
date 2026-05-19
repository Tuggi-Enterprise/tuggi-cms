-- Inventory & Rankings - Materialized Performance Optimization
-- This implementation caches the Catalog, Quality metrics, and Rankings.

-- 1. View for Catalog and Quality (Círculo de Inventário e Suporte de Linguagem)
DROP MATERIALIZED VIEW IF EXISTS core.mv_inventory_stats CASCADE;
CREATE MATERIALIZED VIEW core.mv_inventory_stats AS
SELECT 
    1 AS id,
    (SELECT COUNT(*) FROM core.attractions WHERE approved = true)::bigint AS core_approved,
    (SELECT COUNT(*) FROM core.attractions WHERE approved = false)::bigint AS core_pending,
    (SELECT COUNT(*) FROM homolog.pois)::bigint AS homolog_raw,
    (SELECT jsonb_agg(jsonb_build_object('language', lang, 'count', count)) 
     FROM (
       SELECT language as lang, COUNT(*) as count 
       FROM core.attraction_descriptions ad
       JOIN core.attractions a ON a.id = ad.attraction_id
       WHERE a.approved = true
       GROUP BY language
       ORDER BY count DESC
     ) lang_sub) as languages_breakdown,
    -- Content Quality Metrics
    (SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions ad 
     JOIN core.attractions a ON a.id = ad.attraction_id 
     WHERE a.approved = true AND ad.audio_url IS NOT NULL AND ad.audio_url <> '')::bigint as total_with_audio,
    (SELECT COUNT(DISTINCT attraction_id) FROM core.attraction_descriptions ad 
     JOIN core.attractions a ON a.id = ad.attraction_id WHERE a.approved = true)::bigint as total_with_description
WITH DATA;

-- 2. View for Top Visited POIs (Ranking de Visitas)
-- Alinhado com a interface DashboardStats completa para evitar NaN no mapeamento
DROP MATERIALIZED VIEW IF EXISTS drive.mv_top_visited_pois CASCADE;
CREATE MATERIALIZED VIEW drive.mv_top_visited_pois AS
SELECT 
    v.poi_id,
    a.name as poi_name,
    a.city,
    a.country,
    COALESCE(a.category, 'General') as category,
    COUNT(*)::bigint as total_visits,
    0::bigint as audio_plays,      -- Placeholder para compatibilidade
    0::bigint as unique_visitors  -- Placeholder para compatibilidade
FROM drive.poi_visits v
JOIN core.attractions a ON v.poi_id = a.id
GROUP BY v.poi_id, a.name, a.city, a.country, a.category
ORDER BY total_visits DESC
LIMIT 100
WITH DATA;

-- 3. View for Top Generators (Ranking de Produção)
DROP MATERIALIZED VIEW IF EXISTS core.mv_top_generators CASCADE;
CREATE MATERIALIZED VIEW core.mv_top_generators AS
SELECT 
    ad.generated_by_user_id as user_id,
    COALESCE(p.nickname, p.full_name, 'Anonymous') as nickname,
    COUNT(*)::bigint as content_count
FROM core.attraction_descriptions ad
LEFT JOIN drive.profiles p ON p.id = ad.generated_by_user_id
WHERE ad.generated_by_user_id IS NOT NULL
GROUP BY ad.generated_by_user_id, p.nickname, p.full_name
ORDER BY content_count DESC
LIMIT 50
WITH DATA;

-- 4. Unique Indexes to allow CONCURRENT refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_inventory_stats_id ON core.mv_inventory_stats (id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_top_visited_pois_poi_id ON drive.mv_top_visited_pois (poi_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_top_generators_user_id ON core.mv_top_generators (user_id);

-- 5. Refresh Functions
CREATE OR REPLACE FUNCTION core.refresh_inventory_rankings()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY core.mv_inventory_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY drive.mv_top_visited_pois;
    REFRESH MATERIALIZED VIEW CONCURRENTLY core.mv_top_generators;
END;
$$;

-- 6. Clean up existing functions
DROP FUNCTION IF EXISTS core.dashboard_inventory_funnel();
DROP FUNCTION IF EXISTS core.dashboard_content_quality();
DROP FUNCTION IF EXISTS core.dashboard_top_visited_pois(integer);
DROP FUNCTION IF EXISTS core.dashboard_top_generators(integer);

-- 7. Optimized RPCs

-- dashboard_inventory_funnel
CREATE OR REPLACE FUNCTION core.dashboard_inventory_funnel()
RETURNS TABLE (
  core_approved bigint,
  core_pending bigint,
  homolog_raw bigint,
  total_inventory bigint
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT
    s.core_approved,
    s.core_pending,
    s.homolog_raw,
    (s.core_approved + s.core_pending + s.homolog_raw) as total_inventory
  FROM core.mv_inventory_stats s;
END; $$;

-- dashboard_content_quality
CREATE OR REPLACE FUNCTION core.dashboard_content_quality()
RETURNS TABLE (
  total_with_audio bigint,
  total_with_descriptions bigint,
  coverage_percentage numeric,
  languages_breakdown jsonb
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT 
    s.total_with_audio,
    s.total_with_description as total_with_descriptions,
    ROUND((s.total_with_description::numeric / NULLIF(s.core_approved, 0) * 100), 1) as coverage_percentage,
    s.languages_breakdown
  FROM core.mv_inventory_stats s;
END; $$;

-- dashboard_top_visited_pois
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
  RETURN QUERY SELECT * FROM drive.mv_top_visited_pois LIMIT limit_count;
END; $$;

-- dashboard_top_generators
CREATE OR REPLACE FUNCTION core.dashboard_top_generators(limit_count int DEFAULT 5)
RETURNS TABLE (
  user_id uuid,
  nickname text,
  content_count bigint
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT * FROM core.mv_top_generators LIMIT limit_count;
END; $$;

GRANT EXECUTE ON FUNCTION core.refresh_inventory_rankings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_inventory_funnel() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_content_quality() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_top_visited_pois(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_top_generators(int) TO authenticated, service_role;

-- 8. Initial Refresh
SELECT core.refresh_inventory_rankings();
