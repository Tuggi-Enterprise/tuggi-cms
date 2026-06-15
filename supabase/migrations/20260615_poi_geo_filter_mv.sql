-- ============================================================================
-- 20260615 — MV de contagens geo p/ os filtros da /pois (resolve 57014 frio)
-- ============================================================================
-- PROVA (EXPLAIN ANALYZE BUFFERS): cms_get_countries/states/cities agregavam a
-- attractions ao vivo; como a tabela é write-heavy (migração), só ~27% das
-- páginas estão all-visible no visibility map -> o "Index Only Scan" cai no heap
-- ~737k vezes -> frio = leitura aleatória de disco = 8s/timeout (intermitente
-- conforme o cache). Não é plano, não é os índices dropados.
--
-- Fix: MV minúscula e estática (100% all-visible) no grão (country, state, city)
-- serve os 3 filtros instantaneamente; o agregado pesado roda no cron, fora do
-- request. Casos live (owner / categoria específica) seguem direto (escopados).
-- Aplicar no painel.
-- ============================================================================

-- ── 1. MV global de contagens por (country, state, city) ────────────────────
DROP MATERIALIZED VIEW IF EXISTS core.mv_poi_geo_counts CASCADE;
CREATE MATERIALIZED VIEW core.mv_poi_geo_counts AS
  SELECT a.country,
         COALESCE(a.state, '') AS state,
         COALESCE(a.city, '')  AS city,
         COUNT(*)::bigint AS cnt
  FROM core.attractions a
  WHERE a.country IS NOT NULL AND a.country <> ''
  GROUP BY a.country, COALESCE(a.state, ''), COALESCE(a.city, '')
  WITH DATA;
CREATE UNIQUE INDEX idx_mv_poi_geo_counts ON core.mv_poi_geo_counts (country, state, city);
GRANT SELECT ON core.mv_poi_geo_counts TO authenticated, service_role;

-- ── 2. Refresh + cron (a cada 30 min; agregado pesado fora do request) ──────
CREATE OR REPLACE FUNCTION core.refresh_poi_geo_counts()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY core.mv_poi_geo_counts;
END; $$;
GRANT EXECUTE ON FUNCTION core.refresh_poi_geo_counts() TO service_role;
-- idempotente (cron.schedule por nome faz upsert)
SELECT cron.schedule('refresh-poi-geo-counts', '*/30 * * * *',
                     $$ SELECT core.refresh_poi_geo_counts(); $$);

-- ── 3. cms_get_countries — admin+sem-categoria lê a MV ──────────────────────
CREATE OR REPLACE FUNCTION core.cms_get_countries(p_category text DEFAULT NULL)
 RETURNS TABLE(value text, label text, count bigint)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'core','public','extensions' SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE caller_client_id UUID; caller_role TEXT; is_platform_admin BOOLEAN := FALSE;
BEGIN
  BEGIN
    SELECT cu.client_id, cu.role INTO caller_client_id, caller_role
    FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true);
    IF caller_role IS NULL THEN is_platform_admin := TRUE;
    ELSE is_platform_admin := EXISTS (SELECT 1 FROM core.clients c WHERE c.id = caller_client_id AND c.is_platform_owner = TRUE)
                              AND (caller_role IN ('admin','super_admin'));
    END IF;
  EXCEPTION WHEN OTHERS THEN is_platform_admin := TRUE; END;

  IF is_platform_admin AND p_category IS NULL THEN
    RETURN QUERY SELECT m.country, m.country, SUM(m.cnt)::bigint
      FROM core.mv_poi_geo_counts m GROUP BY m.country ORDER BY SUM(m.cnt) DESC;
  ELSIF is_platform_admin THEN
    RETURN QUERY SELECT a.country, a.country, COUNT(*)::bigint FROM core.attractions a
      WHERE a.category = p_category AND a.country IS NOT NULL AND a.country <> ''
      GROUP BY a.country ORDER BY COUNT(*) DESC;
  ELSE
    RETURN QUERY SELECT a.country, a.country, COUNT(*)::bigint FROM core.attractions a
      WHERE a.owner_id = caller_client_id AND (p_category IS NULL OR a.category = p_category)
        AND a.country IS NOT NULL AND a.country <> ''
      GROUP BY a.country ORDER BY COUNT(*) DESC;
  END IF;
END; $function$;

-- ── 4. cms_get_states ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.cms_get_states(country_name text, p_category text DEFAULT NULL)
 RETURNS TABLE(value text, label text, count bigint)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'core','public','extensions' SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE caller_client_id UUID; caller_role TEXT; is_platform_admin BOOLEAN := FALSE;
BEGIN
  BEGIN
    SELECT cu.client_id, cu.role INTO caller_client_id, caller_role
    FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true);
    IF caller_role IS NULL THEN is_platform_admin := TRUE;
    ELSE is_platform_admin := EXISTS (SELECT 1 FROM core.clients c WHERE c.id = caller_client_id AND c.is_platform_owner = TRUE)
                              AND (caller_role IN ('admin','super_admin'));
    END IF;
  EXCEPTION WHEN OTHERS THEN is_platform_admin := TRUE; END;

  IF is_platform_admin AND p_category IS NULL THEN
    RETURN QUERY SELECT m.state, m.state, SUM(m.cnt)::bigint FROM core.mv_poi_geo_counts m
      WHERE m.country = country_name AND m.state <> '' GROUP BY m.state ORDER BY SUM(m.cnt) DESC;
  ELSIF is_platform_admin THEN
    RETURN QUERY SELECT a.state, a.state, COUNT(*)::bigint FROM core.attractions a
      WHERE a.country = country_name AND a.category = p_category
        AND a.state IS NOT NULL AND a.state <> '' GROUP BY a.state ORDER BY COUNT(*) DESC;
  ELSE
    RETURN QUERY SELECT a.state, a.state, COUNT(*)::bigint FROM core.attractions a
      WHERE a.owner_id = caller_client_id AND a.country = country_name
        AND (p_category IS NULL OR a.category = p_category)
        AND a.state IS NOT NULL AND a.state <> '' GROUP BY a.state ORDER BY COUNT(*) DESC;
  END IF;
END; $function$;

-- ── 5. cms_get_cities ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.cms_get_cities(country_name text, state_name text DEFAULT NULL, p_category text DEFAULT NULL)
 RETURNS TABLE(value text, label text, count bigint)
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'core','public','extensions' SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE caller_client_id UUID; caller_role TEXT; is_platform_admin BOOLEAN := FALSE;
BEGIN
  BEGIN
    SELECT cu.client_id, cu.role INTO caller_client_id, caller_role
    FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true);
    IF caller_role IS NULL THEN is_platform_admin := TRUE;
    ELSE is_platform_admin := EXISTS (SELECT 1 FROM core.clients c WHERE c.id = caller_client_id AND c.is_platform_owner = TRUE)
                              AND (caller_role IN ('admin','super_admin'));
    END IF;
  EXCEPTION WHEN OTHERS THEN is_platform_admin := TRUE; END;

  IF is_platform_admin AND p_category IS NULL THEN
    RETURN QUERY SELECT m.city, m.city, SUM(m.cnt)::bigint FROM core.mv_poi_geo_counts m
      WHERE m.country = country_name AND (state_name IS NULL OR m.state = state_name) AND m.city <> ''
      GROUP BY m.city ORDER BY SUM(m.cnt) DESC;
  ELSIF is_platform_admin THEN
    RETURN QUERY SELECT a.city, a.city, COUNT(*)::bigint FROM core.attractions a
      WHERE a.country = country_name AND (state_name IS NULL OR a.state = state_name)
        AND a.category = p_category AND a.city IS NOT NULL AND a.city <> ''
      GROUP BY a.city ORDER BY COUNT(*) DESC;
  ELSE
    RETURN QUERY SELECT a.city, a.city, COUNT(*)::bigint FROM core.attractions a
      WHERE a.owner_id = caller_client_id AND a.country = country_name
        AND (state_name IS NULL OR a.state = state_name)
        AND (p_category IS NULL OR a.category = p_category)
        AND a.city IS NOT NULL AND a.city <> '' GROUP BY a.city ORDER BY COUNT(*) DESC;
  END IF;
END; $function$;

NOTIFY pgrst, 'reload schema';
