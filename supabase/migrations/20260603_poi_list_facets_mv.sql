-- ============================================================================
-- FASE 2b — Materialized views dos facets de POI (stats cards, uso LAZY).
-- Aplicar MANUALMENTE no SQL editor. DDL idempotente.
--
-- Decisões (alinhadas com o usuário):
--  - Os 4 contadores pesados (description/audio/TP/complete) NÃO ficam no caminho
--    quente da lista. Ficam disponíveis via endpoint lazy servido DESTA MV.
--  - Construção por AGREGAÇÃO PELO LADO PEQUENO (não EXISTS por linha):
--    attraction_descriptions tem ~15k linhas → count(DISTINCT attraction_id) é
--    instantâneo. Mesmo padrão da mv_inventory_stats existente. Refresh ~poucos s
--    em vez dos ~22s medidos com EXISTS por linha na Fase 0.
--  - Refresh DESACOPLADO da migração: função própria + cron (ver seção 3).
--
-- ⚠️ Criar WITH DATA executa a agregação; sob o statement_timeout padrão de 8s
--    poderia falhar. Subir o timeout só para esta sessão de criação:
SET statement_timeout = '600s';

-- Sentinela para created_by NULL (POIs órfãos): mantém a chave não-nula para que
-- REFRESH ... CONCURRENTLY consiga casar as linhas no diff (NULL não junta).
-- '00000000-0000-0000-0000-000000000000' nunca é um cms_users.id real.

-- ----------------------------------------------------------------------------
-- 1. Facets por owner (escopo cliente). Agregação pelo lado pequeno via CTEs.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS core.mv_poi_list_facets CASCADE;
CREATE MATERIALIZED VIEW core.mv_poi_list_facets AS
WITH base AS (
  SELECT
    COALESCE(created_by, '00000000-0000-0000-0000-000000000000'::uuid) AS owner_id,
    COUNT(*)::bigint                              AS total_count,
    COUNT(*) FILTER (WHERE approved)::bigint       AS approved_count,
    COUNT(*) FILTER (WHERE NOT approved)::bigint   AS pending_count
  FROM core.attractions
  GROUP BY 1
),
desc_agg AS (   -- lado pequeno: attraction_descriptions (~15k linhas)
  SELECT
    COALESCE(a.created_by, '00000000-0000-0000-0000-000000000000'::uuid) AS owner_id,
    COUNT(DISTINCT ad.attraction_id)::bigint AS with_description_count,
    COUNT(DISTINCT ad.attraction_id) FILTER (WHERE ad.audio_url IS NOT NULL AND ad.audio_url <> '')::bigint AS with_audio_count,
    COUNT(DISTINCT ad.attraction_id) FILTER (WHERE a.approved)::bigint AS complete_count
  FROM core.attraction_descriptions ad
  JOIN core.attractions a ON a.id = ad.attraction_id
  GROUP BY 1
),
tp_agg AS (     -- uma passada sobre trigger_points (índice em attraction_id)
  SELECT
    COALESCE(a.created_by, '00000000-0000-0000-0000-000000000000'::uuid) AS owner_id,
    COUNT(DISTINCT atp.attraction_id)::bigint AS with_trigger_points_count
  FROM core.attraction_trigger_points atp
  JOIN core.attractions a ON a.id = atp.attraction_id
  GROUP BY 1
)
SELECT
  b.owner_id,
  b.total_count, b.approved_count, b.pending_count,
  COALESCE(d.with_description_count, 0)      AS with_description_count,
  COALESCE(d.with_audio_count, 0)            AS with_audio_count,
  COALESCE(t.with_trigger_points_count, 0)   AS with_trigger_points_count,
  COALESCE(d.complete_count, 0)              AS complete_count
FROM base b
LEFT JOIN desc_agg d USING (owner_id)
LEFT JOIN tp_agg   t USING (owner_id)
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_poi_list_facets_owner
  ON core.mv_poi_list_facets (owner_id);

-- ----------------------------------------------------------------------------
-- 2. Rollup global (1 linha) — admin sem filtro lê uma única linha.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS core.mv_poi_list_facets_global CASCADE;
CREATE MATERIALIZED VIEW core.mv_poi_list_facets_global AS
WITH base AS (
  SELECT
    COUNT(*)::bigint                             AS total_count,
    COUNT(*) FILTER (WHERE approved)::bigint      AS approved_count,
    COUNT(*) FILTER (WHERE NOT approved)::bigint  AS pending_count
  FROM core.attractions
),
desc_agg AS (
  SELECT
    COUNT(DISTINCT ad.attraction_id)::bigint AS with_description_count,
    COUNT(DISTINCT ad.attraction_id) FILTER (WHERE ad.audio_url IS NOT NULL AND ad.audio_url <> '')::bigint AS with_audio_count,
    COUNT(DISTINCT ad.attraction_id) FILTER (WHERE a.approved)::bigint AS complete_count
  FROM core.attraction_descriptions ad
  JOIN core.attractions a ON a.id = ad.attraction_id
),
tp_agg AS (
  SELECT COUNT(DISTINCT attraction_id)::bigint AS with_trigger_points_count
  FROM core.attraction_trigger_points
)
SELECT
  1 AS id,
  b.total_count, b.approved_count, b.pending_count,
  d.with_description_count, d.with_audio_count,
  t.with_trigger_points_count, d.complete_count
FROM base b, desc_agg d, tp_agg t
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_poi_list_facets_global
  ON core.mv_poi_list_facets_global (id);

-- ----------------------------------------------------------------------------
-- 3. Refresh DEDICADO (não plugar no pós-lote da migração).
--    Mesmo com agregação barata, é leitura de toda a base — rodar por cron.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.refresh_poi_list_facets()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY core.mv_poi_list_facets;
    REFRESH MATERIALIZED VIEW CONCURRENTLY core.mv_poi_list_facets_global;
END;
$$;

-- Agendamento (pg_cron). Como os cards são informativos, intervalo folgado basta.
--   SELECT cron.schedule('refresh_poi_list_facets', '*/30 * * * *',
--                        $$ SELECT core.refresh_poi_list_facets(); $$);
-- Popular uma vez agora:
--   SELECT core.refresh_poi_list_facets();

-- Permissões + reload do schema cache do PostgREST.
GRANT SELECT ON core.mv_poi_list_facets        TO authenticated, service_role;
GRANT SELECT ON core.mv_poi_list_facets_global TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
