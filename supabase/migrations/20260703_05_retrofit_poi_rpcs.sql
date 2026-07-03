-- ============================================================================
-- RETROFIT entity_kind='poi' NAS LEITURAS DE POI DO CMS  —  EXECUTÁVEL
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI (regra do projeto).
--
-- Escopo: BLOQUEADOR do CMS (Tier 1) — impede eventos/locais (entity_kind != 'poi')
-- de aparecerem na tela /pois (lista, mapa e contadores). O Tier 2 (funções de
-- nearby/fetch do app Drive) NÃO entra aqui: você escolheu "só CMS por enquanto",
-- e essas funções filtram approved=true (nenhum evento/local estará aprovado).
-- A lista do Tier 2 está no fim, comentada, para o dia da 1ª aprovação no app.
--
-- PARTE A — funções (patch idempotente e à prova de staleness):
--   Cada bloco lê a definição VIVA da função (pg_get_functiondef), injeta o
--   predicado numa âncora estável e re-executa. É fail-closed: se a âncora mudou,
--   RAISE EXCEPTION (nada é corrompido); se já tem entity_kind, pula.
-- PARTE B — materialized views: DROP+CREATE (MV não aceita OR REPLACE) + índice
--   único + REFRESH.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE A.1 — core.cms_list_pois  (linhas da lista /pois)
--   Âncora: a inicialização do array de filtros. Pré-semeia entity_kind='poi',
--   então todo caminho (materialize/coluna/cursor) já filtra.
-- ─────────────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE q text := chr(39); src text; anchor text; repl text;
BEGIN
  src := pg_get_functiondef('core.cms_list_pois(text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,boolean,uuid,text,timestamp with time zone,uuid,integer)'::regprocedure);
  IF position('entity_kind' in src) > 0 THEN
    RAISE NOTICE 'cms_list_pois: já contém entity_kind — pulando';
  ELSE
    anchor := 'where_conditions TEXT[] := ' || q || '{}' || q || ';';
    repl   := 'where_conditions TEXT[] := ARRAY[' || q || 'a.entity_kind = ' || q||q || 'poi' || q||q || q || ']::text[];';
    IF position(anchor in src) = 0 THEN
      RAISE EXCEPTION 'cms_list_pois: âncora não encontrada — corpo mudou; aplicar manualmente';
    END IF;
    EXECUTE replace(src, anchor, repl);
    RAISE NOTICE 'cms_list_pois: patched OK';
  END IF;
END $mig$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE A.2 — core.cms_poi_facets  (contadores; caminho filtrado)
--   Mesma âncora do cms_list_pois. Os fast-paths sem filtro leem as MVs (Parte B).
-- ─────────────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE q text := chr(39); src text; anchor text; repl text;
BEGIN
  src := pg_get_functiondef('core.cms_poi_facets(text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,integer)'::regprocedure);
  IF position('entity_kind' in src) > 0 THEN
    RAISE NOTICE 'cms_poi_facets: já contém entity_kind — pulando';
  ELSE
    anchor := 'where_conditions TEXT[] := ' || q || '{}' || q || ';';
    repl   := 'where_conditions TEXT[] := ARRAY[' || q || 'a.entity_kind = ' || q||q || 'poi' || q||q || q || ']::text[];';
    IF position(anchor in src) = 0 THEN
      RAISE EXCEPTION 'cms_poi_facets: âncora não encontrada — corpo mudou; aplicar manualmente';
    END IF;
    EXECUTE replace(src, anchor, repl);
    RAISE NOTICE 'cms_poi_facets: patched OK';
  END IF;
END $mig$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE A.3 — core.cms_search_pois_map  (clustering do mapa /pois)
--   Âncora: o predicado de bbox no CTE base_pois. Injeta entity_kind antes dele.
-- ─────────────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE q text := chr(39); src text; anchor text; repl text;
BEGIN
  src := pg_get_functiondef('core.cms_search_pois_map(double precision,double precision,double precision,double precision,integer,text,text,text,text,text,uuid,text)'::regprocedure);
  IF position('entity_kind' in src) > 0 THEN
    RAISE NOTICE 'cms_search_pois_map: já contém entity_kind — pulando';
  ELSE
    anchor := 'c.latitude BETWEEN (min_lat - 0.02) AND (max_lat + 0.02)';
    repl   := 'a.entity_kind = ' || q || 'poi' || q || ' AND c.latitude BETWEEN (min_lat - 0.02) AND (max_lat + 0.02)';
    IF position(anchor in src) = 0 THEN
      RAISE EXCEPTION 'cms_search_pois_map: âncora não encontrada — corpo mudou; aplicar manualmente';
    END IF;
    EXECUTE replace(src, anchor, repl);
    RAISE NOTICE 'cms_search_pois_map: patched OK';
  END IF;
END $mig$;


-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE B — Materialized Views (contadores sem filtro + relatórios de geografia)
--   MV não aceita CREATE OR REPLACE → DROP + CREATE + índice único + REFRESH.
-- ─────────────────────────────────────────────────────────────────────────────

-- B.1 mv_poi_list_facets (por owner) — alimenta o fast-path owner de cms_poi_facets
DROP MATERIALIZED VIEW IF EXISTS core.mv_poi_list_facets;
CREATE MATERIALIZED VIEW core.mv_poi_list_facets AS
 WITH base AS (
   SELECT COALESCE(attractions.created_by, '00000000-0000-0000-0000-000000000000'::uuid) AS owner_id,
          count(*) AS total_count,
          count(*) FILTER (WHERE attractions.approved) AS approved_count,
          count(*) FILTER (WHERE (NOT attractions.approved)) AS pending_count
     FROM core.attractions
    WHERE attractions.entity_kind = 'poi'
    GROUP BY COALESCE(attractions.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
 ), desc_agg AS (
   SELECT COALESCE(a.created_by, '00000000-0000-0000-0000-000000000000'::uuid) AS owner_id,
          count(DISTINCT ad.attraction_id) AS with_description_count,
          count(DISTINCT ad.attraction_id) FILTER (WHERE ((ad.audio_url IS NOT NULL) AND (ad.audio_url <> ''::text))) AS with_audio_count,
          count(DISTINCT ad.attraction_id) FILTER (WHERE a.approved) AS complete_count
     FROM (core.attraction_descriptions ad JOIN core.attractions a ON ((a.id = ad.attraction_id)))
    WHERE a.entity_kind = 'poi'
    GROUP BY COALESCE(a.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
 ), tp_agg AS (
   SELECT COALESCE(a.created_by, '00000000-0000-0000-0000-000000000000'::uuid) AS owner_id,
          count(DISTINCT atp.attraction_id) AS with_trigger_points_count
     FROM (core.attraction_trigger_points atp JOIN core.attractions a ON ((a.id = atp.attraction_id)))
    WHERE a.entity_kind = 'poi'
    GROUP BY COALESCE(a.created_by, '00000000-0000-0000-0000-000000000000'::uuid)
 )
 SELECT b.owner_id, b.total_count, b.approved_count, b.pending_count,
        COALESCE(d.with_description_count, (0)::bigint) AS with_description_count,
        COALESCE(d.with_audio_count, (0)::bigint) AS with_audio_count,
        COALESCE(t.with_trigger_points_count, (0)::bigint) AS with_trigger_points_count,
        COALESCE(d.complete_count, (0)::bigint) AS complete_count
   FROM ((base b LEFT JOIN desc_agg d USING (owner_id)) LEFT JOIN tp_agg t USING (owner_id))
 WITH NO DATA;
CREATE UNIQUE INDEX idx_mv_poi_list_facets_owner ON core.mv_poi_list_facets USING btree (owner_id);
REFRESH MATERIALIZED VIEW core.mv_poi_list_facets;

-- B.2 mv_poi_list_facets_by_priority — fast-path de prioridade (admin)
DROP MATERIALIZED VIEW IF EXISTS core.mv_poi_list_facets_by_priority;
CREATE MATERIALIZED VIEW core.mv_poi_list_facets_by_priority AS
 WITH base AS (
   SELECT attractions.priority_level,
          count(*) AS total_count,
          count(*) FILTER (WHERE attractions.approved) AS approved_count,
          count(*) FILTER (WHERE (NOT attractions.approved)) AS pending_count
     FROM core.attractions
    WHERE attractions.entity_kind = 'poi'
    GROUP BY attractions.priority_level
 ), desc_agg AS (
   SELECT a.priority_level,
          count(DISTINCT ad.attraction_id) AS with_description_count,
          count(DISTINCT ad.attraction_id) FILTER (WHERE ((ad.audio_url IS NOT NULL) AND (ad.audio_url <> ''::text))) AS with_audio_count,
          count(DISTINCT ad.attraction_id) FILTER (WHERE a.approved) AS complete_count
     FROM (core.attraction_descriptions ad JOIN core.attractions a ON ((a.id = ad.attraction_id)))
    WHERE a.entity_kind = 'poi'
    GROUP BY a.priority_level
 ), tp_agg AS (
   SELECT a.priority_level,
          count(DISTINCT atp.attraction_id) AS with_trigger_points_count
     FROM (core.attraction_trigger_points atp JOIN core.attractions a ON ((a.id = atp.attraction_id)))
    WHERE a.entity_kind = 'poi'
    GROUP BY a.priority_level
 )
 SELECT b.priority_level, b.total_count, b.approved_count, b.pending_count,
        COALESCE(d.with_description_count, (0)::bigint) AS with_description_count,
        COALESCE(d.with_audio_count, (0)::bigint) AS with_audio_count,
        COALESCE(t.with_trigger_points_count, (0)::bigint) AS with_trigger_points_count,
        COALESCE(d.complete_count, (0)::bigint) AS complete_count
   FROM ((base b LEFT JOIN desc_agg d USING (priority_level)) LEFT JOIN tp_agg t USING (priority_level))
 WITH NO DATA;
CREATE UNIQUE INDEX idx_mv_poi_list_facets_by_priority ON core.mv_poi_list_facets_by_priority USING btree (priority_level);
REFRESH MATERIALIZED VIEW core.mv_poi_list_facets_by_priority;

-- B.3 mv_poi_list_facets_global — fast-path global (sem filtro, sem owner)
DROP MATERIALIZED VIEW IF EXISTS core.mv_poi_list_facets_global;
CREATE MATERIALIZED VIEW core.mv_poi_list_facets_global AS
 WITH base AS (
   SELECT count(*) AS total_count,
          count(*) FILTER (WHERE attractions.approved) AS approved_count,
          count(*) FILTER (WHERE (NOT attractions.approved)) AS pending_count
     FROM core.attractions
    WHERE attractions.entity_kind = 'poi'
 ), desc_agg AS (
   SELECT count(DISTINCT ad.attraction_id) AS with_description_count,
          count(DISTINCT ad.attraction_id) FILTER (WHERE ((ad.audio_url IS NOT NULL) AND (ad.audio_url <> ''::text))) AS with_audio_count,
          count(DISTINCT ad.attraction_id) FILTER (WHERE a.approved) AS complete_count
     FROM (core.attraction_descriptions ad JOIN core.attractions a ON ((a.id = ad.attraction_id)))
    WHERE a.entity_kind = 'poi'
 ), tp_agg AS (
   SELECT count(DISTINCT atp.attraction_id) AS with_trigger_points_count
     FROM (core.attraction_trigger_points atp JOIN core.attractions a ON ((a.id = atp.attraction_id)))
    WHERE a.entity_kind = 'poi'
 )
 SELECT 1 AS id, b.total_count, b.approved_count, b.pending_count,
        d.with_description_count, d.with_audio_count, t.with_trigger_points_count, d.complete_count
   FROM base b, desc_agg d, tp_agg t
 WITH NO DATA;
CREATE UNIQUE INDEX idx_mv_poi_list_facets_global ON core.mv_poi_list_facets_global USING btree (id);
REFRESH MATERIALIZED VIEW core.mv_poi_list_facets_global;

-- B.4 mv_poi_geo_counts — contagens por país/estado/cidade (filtros /pois)
DROP MATERIALIZED VIEW IF EXISTS core.mv_poi_geo_counts;
CREATE MATERIALIZED VIEW core.mv_poi_geo_counts AS
 SELECT a.country,
        COALESCE(a.state, ''::text) AS state,
        COALESCE(a.city, ''::text) AS city,
        count(*) AS cnt
   FROM core.attractions a
  WHERE ((a.country IS NOT NULL) AND (a.country <> ''::text) AND a.entity_kind = 'poi')
  GROUP BY a.country, COALESCE(a.state, ''::text), COALESCE(a.city, ''::text)
 WITH NO DATA;
CREATE UNIQUE INDEX idx_mv_poi_geo_counts ON core.mv_poi_geo_counts USING btree (country, state, city);
REFRESH MATERIALIZED VIEW core.mv_poi_geo_counts;

-- B.5 mv_geographic_stats — relatório de geografia
DROP MATERIALIZED VIEW IF EXISTS core.mv_geographic_stats;
CREATE MATERIALIZED VIEW core.mv_geographic_stats AS
 SELECT attractions.owner_id,
        attractions.country,
        initcap(TRIM(BOTH FROM lower(attractions.city))) AS city,
        count(*) AS poi_count,
        count(*) FILTER (WHERE (attractions.approved = true)) AS approved_count,
        count(*) FILTER (WHERE (attractions.approved = false)) AS pending_count
   FROM core.attractions
  WHERE ((attractions.city IS NOT NULL) AND (TRIM(BOTH FROM attractions.city) <> ''::text) AND attractions.entity_kind = 'poi')
  GROUP BY attractions.owner_id, attractions.country, (initcap(TRIM(BOTH FROM lower(attractions.city))))
 WITH NO DATA;
CREATE UNIQUE INDEX idx_mv_geographic_stats_owner_country_city ON core.mv_geographic_stats USING btree (owner_id, country, city);
REFRESH MATERIALIZED VIEW core.mv_geographic_stats;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (rodar depois; deve dar 0 vazamento)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT count(*) FROM core.cms_list_pois(fetch_all => true);   -- só POIs
-- SELECT * FROM core.cms_poi_facets();                          -- só POIs
-- Inserir 1 evento de teste (via UI ou cms_create_event) e confirmar que NÃO
-- aparece em cms_list_pois nem infla cms_poi_facets; depois apagar.


-- ============================================================================
-- TIER 2 — APP DRIVE (NÃO rodar agora; fazer antes da 1ª aprovação p/ o app).
-- Adicionar "AND a.entity_kind='poi'" (mesmo padrão) a cada uma, no painel:
--   get_nearby_pois / _basic / _complete / _secure / _v2
--   get_nearby_trigger_points (2) / _complete / _v2 (2)   (join TP->attractions a)
--   fetch_attractions_within_bbox (2) / _optimized
--   fetch_attractions_within_radius (2) / _optimized
--   get_attractions_by_proximity_v3 / get_map_attractions_bulk_v4
--   get_city_pois / _basic / _basic_paginated / _optimized / _smart
--   pois_in_polygon / get_pois_with_trigger_coords / get_nearby_cities_with_pois
--   get_poi_details / get_pois_without_description (2)
-- (Opcional, dashboards: mv_inventory_stats, mv_migration_monthly_stats.)
-- ============================================================================
