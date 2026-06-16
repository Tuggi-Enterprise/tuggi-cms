-- ============================================================================
-- cms_list_pois — adiciona priority_filter (param) + priority_level (retorno)
-- ⚠️ RODAR MANUALMENTE no painel. DROP+CREATE (assinatura/retorno mudam).
-- Cópia fiel de 20260603_cms_list_pois_and_facets.sql + 4 adições do priority.
-- ============================================================================
DROP FUNCTION IF EXISTS core.cms_list_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  INTEGER, INTEGER, BOOLEAN, UUID, TEXT, TIMESTAMPTZ, UUID
);

CREATE OR REPLACE FUNCTION core.cms_list_pois(
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
  limit_count INTEGER DEFAULT 20,
  offset_count INTEGER DEFAULT 0,
  fetch_all BOOLEAN DEFAULT FALSE,
  owner_id UUID DEFAULT NULL,
  is_active_filter TEXT DEFAULT 'all',
  p_before_created_at TIMESTAMPTZ DEFAULT NULL,   -- cursor keyset opcional (scroll infinito)
  p_before_id UUID DEFAULT NULL,
  priority_filter INTEGER DEFAULT NULL            -- 1/2/3 (NULL = todos)
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  google_place_id TEXT,
  google_types TEXT[],
  category TEXT,
  osm_category TEXT,
  priority_level SMALLINT,
  rating NUMERIC,
  image_url TEXT,
  approved BOOLEAN,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  user_id TEXT,
  business_status TEXT,
  formatted_phone_number TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  descriptions JSONB,
  trigger_points JSONB,
  group_membership JSONB,
  verification_data JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_query TEXT;
  where_conditions TEXT[] := '{}';
  where_clause TEXT := '';
  select_cols TEXT;
  page_clause TEXT := '';
  -- Materializa-primeiro SÓ para busca por nome (trgm): o trgm não devolve ordenado,
  -- então sem materializar o planner cairia na armadilha de caminhar created_at.
  -- Todo o resto usa o caminho direto:
  --  - filtros de coluna (country/state/city/category/status) → índices compostos;
  --  - filtros EXISTS (content/group/score/trigger) → o custo é o anti/semi-join, que
  --    materializar não evita; o caminho direto caminha created_at e checa por linha.
  use_materialize BOOLEAN := (search_term IS NOT NULL AND search_term != '');
  caller_cms_id UUID;
  is_admin BOOLEAN := FALSE;
BEGIN
  -- Resolve caller identity (padrão Tuggi)
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

  -- ===== Bloco de filtros (idêntico ao cms_search_pois) =====
  IF search_term IS NOT NULL AND search_term != '' THEN
    -- Busca só por name (usa idx_attractions_name_trgm). Cidade/país têm dropdowns próprios.
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

  -- Cursor keyset (opcional): pega linhas "antes" do cursor no sort created_at DESC, id DESC.
  IF p_before_created_at IS NOT NULL AND p_before_id IS NOT NULL THEN
    where_conditions := array_append(where_conditions,
      format('(a.created_at, a.id) < (%L::timestamptz, %L::uuid)', p_before_created_at, p_before_id));
  END IF;

  where_clause := CASE WHEN array_length(where_conditions, 1) > 0
                       THEN 'WHERE ' || array_to_string(where_conditions, ' AND ') ELSE '' END;

  -- Lista de colunas (jsonb_agg por linha) — só projetada para a página final (LIMIT).
  select_cols := '
      a.id::TEXT,
      a.name, a.city, a.state, a.country,
      a.google_place_id, a.google_types, a.category, a.osm_category,
      a.priority_level,
      a.rating, a.image_url, a.approved,
      COALESCE(a.is_active, true) as is_active,
      a.created_at, a.updated_at,
      a.user_id::TEXT, a.business_status, a.formatted_phone_number,
      ac.latitude::NUMERIC, ac.longitude::NUMERIC,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        ''id'', ad.id, ''language'', ad.language, ''description'', ad.description,
        ''audio_url'', ad.audio_url, ''created_at'', ad.created_at,
        ''verification_status'', ad.verification_status, ''score_overall'', ad.last_score_overall
      )) FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id), ''[]''::jsonb) as descriptions,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        ''id'', atp.id, ''is_active'', atp.is_active, ''type'', atp.type,
        ''latitude'', ST_Y(atp.location::geometry), ''longitude'', ST_X(atp.location::geometry)
      )) FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id), ''[]''::jsonb) as trigger_points,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        ''group_id'', ag.id, ''group_name'', ag.name, ''role'', agm.group_role
      )) FROM core.attraction_groups ag
        JOIN core.attraction_group_members agm ON ag.id = agm.group_id
        WHERE agm.attraction_id = a.id), ''[]''::jsonb) as group_membership,
      ''{}''::jsonb as verification_data';

  IF NOT fetch_all THEN
    page_clause := format(' LIMIT %s OFFSET %s', limit_count, offset_count);
  END IF;

  -- Padrão de 2 fases: paginar só sobre (id, created_at) — leve e index-only,
  -- barato mesmo com OFFSET grande — e só então projetar as colunas pesadas
  -- (jsonb_agg) das poucas linhas da página. Evita projetar offset+limit linhas.
  IF use_materialize THEN
    -- BUSCA (trgm) ou filtro EXISTS (content/group/score/trigger): 'filtered'
    -- MATERIALIZED resolve o filtro PRIMEIRO (índice trgm / EXISTS), depois ordena
    -- só esse conjunto esparso. Evita caminhar o índice de created_at pela base toda.
    base_query := format('
      WITH filtered AS MATERIALIZED (
        SELECT a.id, a.created_at FROM core.attractions a %s
      ),
      page AS MATERIALIZED (
        SELECT id, created_at FROM filtered ORDER BY created_at DESC, id DESC %s
      )
      SELECT %s
      FROM page p
      JOIN core.attractions a ON a.id = p.id
      LEFT JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
      ORDER BY p.created_at DESC, p.id DESC
    ', where_clause, page_clause, select_cols);
  ELSE
    -- SEM FILTRO ou filtros de COLUNA (country/state/city/category/status/cursor):
    -- 'page' usa o índice composto (filtro, created_at DESC, id DESC) quando há filtro,
    -- ou idx_attractions_created_at_id quando não há — entregando os top-N já filtrados
    -- E ordenados direto do índice. Rápido p/ filtro esparso (Brasil) E maioria (US).
    base_query := format('
      WITH page AS MATERIALIZED (
        SELECT a.id, a.created_at FROM core.attractions a %s
        ORDER BY a.created_at DESC, a.id DESC %s
      )
      SELECT %s
      FROM page p
      JOIN core.attractions a ON a.id = p.id
      LEFT JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
      ORDER BY p.created_at DESC, p.id DESC
    ', where_clause, page_clause, select_cols);
  END IF;

  RETURN QUERY EXECUTE base_query;
END;
$$;

GRANT EXECUTE ON FUNCTION core.cms_list_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  INTEGER, INTEGER, BOOLEAN, UUID, TEXT, TIMESTAMPTZ, UUID, INTEGER
) TO authenticated, service_role;
