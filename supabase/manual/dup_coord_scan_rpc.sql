-- ============================================================
-- Varredura de POIs duplicados por COORDENADA EXATA, EM FASES (por país).
-- Read-only. Roda UMA VEZ no painel (DDL). Métrica: mesma (lat,lng) exata,
-- ignorando (0,0) e nulos. Espelha o critério usado em Rio/São Paulo.
-- Escopar por país mantém cada varredura pequena e rápida (sem timeout).
-- ============================================================

-- Remove a versão sem-argumento da 1ª execução (evita ambiguidade com a nova).
DROP FUNCTION IF EXISTS core.dup_coord_summary();

-- (0) Países com contagem de POIs — pra decidir as fases.
CREATE OR REPLACE FUNCTION core.poi_country_counts()
RETURNS TABLE(country text, total_pois bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, public
SET statement_timeout = '120s' AS $$
  SELECT coalesce(country, '(sem país)') AS country, count(*) AS total_pois
  FROM core.attractions
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

-- (1) RESUMO por cidade DENTRO de um país (ou banco todo se p_country = NULL).
CREATE OR REPLACE FUNCTION core.dup_coord_summary(p_country text DEFAULT NULL)
RETURNS TABLE(city text, dup_groups bigint, excess_pois bigint, total_pois bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, public
SET statement_timeout = '180s' AS $$
  WITH g AS (
    SELECT c.latitude, c.longitude, count(*) AS n, min(a.city) AS city
    FROM core.attraction_coordinate c
    JOIN core.attractions a ON a.id = c.attraction_id
    WHERE (p_country IS NULL OR a.country = p_country)
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      AND NOT (c.latitude = 0 AND c.longitude = 0)
    GROUP BY c.latitude, c.longitude
    HAVING count(*) > 1
  )
  SELECT coalesce(city, '(sem cidade)') AS city,
         count(*)   AS dup_groups,
         sum(n - 1) AS excess_pois,
         sum(n)     AS total_pois
  FROM g
  GROUP BY 1
  ORDER BY excess_pois DESC;
$$;

-- (2) DETALHE de uma cidade (membros de cada grupo) — pra montar o plano de merge.
CREATE OR REPLACE FUNCTION core.dup_coord_detail(p_city text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, public
SET statement_timeout = '180s' AS $$
  WITH g AS (
    SELECT c.latitude, c.longitude
    FROM core.attraction_coordinate c
    JOIN core.attractions a ON a.id = c.attraction_id
    WHERE a.city = p_city
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      AND NOT (c.latitude = 0 AND c.longitude = 0)
    GROUP BY c.latitude, c.longitude
    HAVING count(*) > 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'lat', g.latitude, 'lng', g.longitude,
           'members', (
             SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'category', a.category))
             FROM core.attraction_coordinate c2
             JOIN core.attractions a ON a.id = c2.attraction_id
             WHERE c2.latitude = g.latitude AND c2.longitude = g.longitude AND a.city = p_city
           ))), '[]'::jsonb)
  FROM g;
$$;

GRANT EXECUTE ON FUNCTION core.poi_country_counts()      TO service_role;
GRANT EXECUTE ON FUNCTION core.dup_coord_summary(text)   TO service_role;
GRANT EXECUTE ON FUNCTION core.dup_coord_detail(text)    TO service_role;
NOTIFY pgrst, 'reload schema';
