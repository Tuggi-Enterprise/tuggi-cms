-- ============================================================================
-- FIX perf: filtro de prioridade SEM geo estourava o statement_timeout.
--
-- Causa (medida): cms_poi_facets, quando o ÚNICO filtro é priority_level, cai no
-- caminho filtrado (count live com EXISTS por linha) sobre um conjunto de baixa
-- seletividade (nível 1 ≈ 216k, nível 3 ≈ 605k) → >8s → timeout do role
-- `authenticated` → getFacets falha → o total no front cai pro fallback 0.
-- (Com país o conjunto encolhe e completa; sem filtro nenhum usa a MV global.)
--
-- Correção (consistente com a arquitetura): MV irmã da mv_poi_list_facets_global,
-- agora particionada por priority_level (3 linhas), construída por AGREGAÇÃO PELO
-- LADO PEQUENO (não EXISTS por linha). cms_poi_facets ganha um fast-path: quando
-- prioridade é o único filtro e o escopo é global (admin), lê 1 linha da MV.
--
-- ⚠️ RODAR MANUALMENTE no painel. Construir WITH DATA agrega a base toda → subir
--    o statement_timeout só nesta sessão de criação.
-- ============================================================================
SET statement_timeout = '600s';

-- ----------------------------------------------------------------------------
-- 1. Facets por nível de prioridade (1/2/3). Mesmo padrão da mv_poi_list_facets:
--    base = count(*) por nível; description/audio/complete e trigger points
--    agregados pelo lado pequeno (~15k descriptions, índice em attraction_id).
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS core.mv_poi_list_facets_by_priority CASCADE;
CREATE MATERIALIZED VIEW core.mv_poi_list_facets_by_priority AS
WITH base AS (
  SELECT
    priority_level,
    COUNT(*)::bigint                              AS total_count,
    COUNT(*) FILTER (WHERE approved)::bigint       AS approved_count,
    COUNT(*) FILTER (WHERE NOT approved)::bigint   AS pending_count
  FROM core.attractions
  GROUP BY priority_level
),
desc_agg AS (   -- lado pequeno: attraction_descriptions
  SELECT
    a.priority_level,
    COUNT(DISTINCT ad.attraction_id)::bigint AS with_description_count,
    COUNT(DISTINCT ad.attraction_id) FILTER (WHERE ad.audio_url IS NOT NULL AND ad.audio_url <> '')::bigint AS with_audio_count,
    COUNT(DISTINCT ad.attraction_id) FILTER (WHERE a.approved)::bigint AS complete_count
  FROM core.attraction_descriptions ad
  JOIN core.attractions a ON a.id = ad.attraction_id
  GROUP BY a.priority_level
),
tp_agg AS (
  SELECT
    a.priority_level,
    COUNT(DISTINCT atp.attraction_id)::bigint AS with_trigger_points_count
  FROM core.attraction_trigger_points atp
  JOIN core.attractions a ON a.id = atp.attraction_id
  GROUP BY a.priority_level
)
SELECT
  b.priority_level,
  b.total_count, b.approved_count, b.pending_count,
  COALESCE(d.with_description_count, 0)      AS with_description_count,
  COALESCE(d.with_audio_count, 0)            AS with_audio_count,
  COALESCE(t.with_trigger_points_count, 0)   AS with_trigger_points_count,
  COALESCE(d.complete_count, 0)              AS complete_count
FROM base b
LEFT JOIN desc_agg d USING (priority_level)
LEFT JOIN tp_agg   t USING (priority_level)
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_poi_list_facets_by_priority
  ON core.mv_poi_list_facets_by_priority (priority_level);

-- ----------------------------------------------------------------------------
-- 2. Refresh: plugar a nova MV na função existente (mesmo cron).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.refresh_poi_list_facets()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY core.mv_poi_list_facets;
    REFRESH MATERIALIZED VIEW CONCURRENTLY core.mv_poi_list_facets_global;
    REFRESH MATERIALIZED VIEW CONCURRENTLY core.mv_poi_list_facets_by_priority;
END;
$$;

GRANT SELECT ON core.mv_poi_list_facets_by_priority TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. cms_poi_facets — fast-path "só prioridade" (global) lê a MV por nível.
--    Assinatura inalterada (priority_filter já existe) → CREATE OR REPLACE.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.cms_poi_facets(
  search_term TEXT DEFAULT NULL,
  status_filter TEXT DEFAULT 'all',
  country_filter TEXT DEFAULT NULL,
  state_filter TEXT DEFAULT NULL,
  city_filter TEXT DEFAULT NULL,
  google_types_filter TEXT DEFAULT NULL,
  category_filter TEXT DEFAULT NULL,
  osm_category_filter TEXT DEFAULT NULL,
  content_status_filter TEXT DEFAULT 'all',
  group_status_filter TEXT DEFAULT 'all',
  score_filter TEXT DEFAULT 'all',
  trigger_points_filter TEXT DEFAULT 'all',
  owner_id UUID DEFAULT NULL,
  is_active_filter TEXT DEFAULT 'all',
  priority_filter INTEGER DEFAULT NULL
)
RETURNS TABLE (
  total_count BIGINT,
  approved_count BIGINT,
  pending_count BIGINT,
  with_description_count BIGINT,
  with_audio_count BIGINT,
  with_trigger_points_count BIGINT,
  complete_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  where_conditions TEXT[] := '{}';
  caller_cms_id UUID;
  is_admin BOOLEAN := FALSE;
  others_empty BOOLEAN;   -- todos os filtros EXCETO priority estão vazios
  stats_query TEXT;
BEGIN
  -- Resolve caller identity (mesmo padrão)
  BEGIN
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true));
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := TRUE;
  END;

  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN
    owner_id := caller_cms_id;
  END IF;

  -- Filtros (exceto priority e owner) todos vazios? owner_id NÃO conta (escopo
  -- de tenant; as MVs já são particionadas por owner / por nível).
  others_empty := (search_term IS NULL OR search_term = '')
            AND (status_filter IS NULL OR status_filter = 'all')
            AND (country_filter IS NULL OR country_filter = '')
            AND (state_filter IS NULL OR state_filter = '')
            AND (city_filter IS NULL OR city_filter = '')
            AND (google_types_filter IS NULL OR google_types_filter = '')
            AND (category_filter IS NULL OR category_filter = '')
            AND (osm_category_filter IS NULL OR osm_category_filter = '')
            AND (content_status_filter IS NULL OR content_status_filter = 'all')
            AND (group_status_filter IS NULL OR group_status_filter = 'all')
            AND (score_filter IS NULL OR score_filter = 'all')
            AND (trigger_points_filter IS NULL OR trigger_points_filter = 'all')
            AND (is_active_filter IS NULL OR is_active_filter = 'all');

  -- ===== Fast-path 1: nenhum filtro → MV (global/owner) =====
  IF others_empty AND priority_filter IS NULL THEN
    IF owner_id IS NOT NULL THEN
      RETURN QUERY
        SELECT f.total_count, f.approved_count, f.pending_count,
               f.with_description_count, f.with_audio_count,
               f.with_trigger_points_count, f.complete_count
        FROM core.mv_poi_list_facets f
        WHERE f.owner_id = cms_poi_facets.owner_id;
      IF NOT FOUND THEN
        RETURN QUERY SELECT 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint;
      END IF;
    ELSE
      RETURN QUERY
        SELECT g.total_count, g.approved_count, g.pending_count,
               g.with_description_count, g.with_audio_count,
               g.with_trigger_points_count, g.complete_count
        FROM core.mv_poi_list_facets_global g
        WHERE g.id = 1;
    END IF;
    RETURN;
  END IF;

  -- ===== Fast-path 2: SÓ prioridade, escopo global (admin) → MV por nível =====
  -- (owner-scoped + prioridade cai no count path; lá o conjunto é pequeno
  --  porque já filtra a.created_by = owner.)
  IF others_empty AND priority_filter IS NOT NULL AND owner_id IS NULL THEN
    RETURN QUERY
      SELECT p.total_count, p.approved_count, p.pending_count,
             p.with_description_count, p.with_audio_count,
             p.with_trigger_points_count, p.complete_count
      FROM core.mv_poi_list_facets_by_priority p
      WHERE p.priority_level = priority_filter;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint,0::bigint;
    END IF;
    RETURN;
  END IF;

  -- ===== Caminho filtrado: count live em passada única =====
  -- Reconstrói o MESMO WHERE do cms_list_pois para coerência exata.
  IF search_term IS NOT NULL AND search_term != '' THEN
    where_conditions := array_append(where_conditions,
      format('a.name ILIKE %L', '%' || search_term || '%'));
  END IF;
  IF status_filter IS NOT NULL AND status_filter != 'all' THEN
    IF status_filter = 'approved' THEN
      where_conditions := array_append(where_conditions, 'a.approved = TRUE');
    ELSIF status_filter = 'pending' THEN
      where_conditions := array_append(where_conditions, 'a.approved = FALSE');
    END IF;
  END IF;
  IF country_filter IS NOT NULL AND country_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.country = %L', country_filter));
  END IF;
  IF state_filter IS NOT NULL AND state_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.state = %L', state_filter));
  END IF;
  IF city_filter IS NOT NULL AND city_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.city = %L', city_filter));
  END IF;
  IF category_filter IS NOT NULL AND category_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.category = %L', category_filter));
  END IF;
  IF osm_category_filter IS NOT NULL AND osm_category_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.osm_category = %L', osm_category_filter));
  END IF;
  IF priority_filter IS NOT NULL THEN
    where_conditions := array_append(where_conditions, format('a.priority_level = %s', priority_filter));
  END IF;
  IF owner_id IS NOT NULL THEN
    where_conditions := array_append(where_conditions, format('a.created_by = %L', owner_id));
  END IF;
  IF is_active_filter IS NOT NULL AND is_active_filter != 'all' THEN
    IF is_active_filter = 'active' THEN
      where_conditions := array_append(where_conditions, 'COALESCE(a.is_active, true) = TRUE');
    ELSIF is_active_filter = 'inactive' THEN
      where_conditions := array_append(where_conditions, 'COALESCE(a.is_active, true) = FALSE');
    END IF;
  END IF;
  IF content_status_filter IS NOT NULL AND content_status_filter != 'all' THEN
    IF content_status_filter = 'missing_description' THEN
      where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)');
    ELSIF content_status_filter = 'missing_audio' THEN
      where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
    ELSIF content_status_filter = 'complete' THEN
      where_conditions := array_append(where_conditions, 'a.approved = TRUE AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
    END IF;
  END IF;
  IF group_status_filter IS NOT NULL AND group_status_filter != 'all' THEN
    IF group_status_filter = 'grouped' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id)');
    ELSIF group_status_filter = 'ungrouped' THEN
      where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id)');
    ELSIF group_status_filter = 'group_main' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id AND agm.group_role = ''main'')');
    ELSIF group_status_filter = 'group_member' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id AND agm.group_role = ''member'')');
    END IF;
  END IF;
  IF trigger_points_filter IS NOT NULL AND trigger_points_filter != 'all' THEN
    IF trigger_points_filter = 'with_trigger_points' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)');
    ELSIF trigger_points_filter = 'without_trigger_points' THEN
      where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)');
    END IF;
  END IF;
  IF score_filter IS NOT NULL AND score_filter != 'all' THEN
    IF score_filter = 'no_score' THEN
      where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.last_score_overall IS NOT NULL)');
    ELSIF score_filter = 'rejected' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.last_score_overall < 50)');
    ELSIF score_filter = 'pending' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.last_score_overall >= 50 AND ad.last_score_overall < 80)');
    ELSIF score_filter = 'approved' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.last_score_overall >= 80)');
    END IF;
  END IF;

  stats_query := format('
    SELECT
      COUNT(*)::bigint,
      COUNT(*) FILTER (WHERE a.approved)::bigint,
      COUNT(*) FILTER (WHERE NOT a.approved)::bigint,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id))::bigint,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url <> ''''))::bigint,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id))::bigint,
      COUNT(*) FILTER (WHERE a.approved AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id))::bigint
    FROM core.attractions a
    %s
  ', CASE WHEN array_length(where_conditions, 1) > 0 THEN 'WHERE ' || array_to_string(where_conditions, ' AND ') ELSE '' END);

  RETURN QUERY EXECUTE stats_query;
END;
$$;

GRANT EXECUTE ON FUNCTION core.cms_poi_facets(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, INTEGER
) TO authenticated, service_role;

-- Popular a MV uma vez agora (admin global lê instantâneo):
--   SELECT core.refresh_poi_list_facets();
NOTIFY pgrst, 'reload schema';
