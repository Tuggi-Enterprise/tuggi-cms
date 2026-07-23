-- Migration: filtro de prioridade MULTI-SELECT (somar níveis) + prioridade no mapa
-- Date: 2026-07-23
-- Descrição:
--   O filtro de prioridade em /pois vira multi-select ("ver 1 e 2, mas não 3"). Antes o param
--   era `priority_filter INTEGER` (match exato de 1 nível). Agora é `priority_levels SMALLINT[]`
--   e o WHERE usa `= ANY(priority_levels)`. Também expõe priority_level no metadata do mapa e
--   permite filtrar o mapa por nível.
--
--   O frontend só envia priority_levels quando é subconjunto REAL (1 ou 2 níveis); "todos" ou
--   "nenhum" não envia nada → sem filtro (compat: NULL). As 3 funções mudam de ASSINATURA
--   (troca/adiciona o último param) → precisa DROP antes do CREATE.
--
--   ⚠️ Rodar manualmente no painel SQL do Supabase (nunca DDL via CLI).
--   ⚠️ Reaplica os GRANTs originais: authenticated + service_role (NÃO anon).

-- ============================================================================
-- 1) core.cms_list_pois — priority_filter INTEGER → priority_levels SMALLINT[]
-- ============================================================================
DROP FUNCTION IF EXISTS core.cms_list_pois(text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,boolean,uuid,text,timestamp with time zone,uuid,integer);

CREATE OR REPLACE FUNCTION core.cms_list_pois(
  search_term text DEFAULT NULL::text, status_filter text DEFAULT 'all'::text,
  country_filter text DEFAULT NULL::text, state_filter text DEFAULT NULL::text,
  city_filter text DEFAULT NULL::text, google_types_filter text DEFAULT NULL::text,
  category_filter text DEFAULT NULL::text, osm_category_filter text DEFAULT NULL::text,
  content_status_filter text DEFAULT 'all'::text, group_status_filter text DEFAULT 'all'::text,
  score_filter text DEFAULT 'all'::text, trigger_points_filter text DEFAULT 'all'::text,
  limit_count integer DEFAULT 20, offset_count integer DEFAULT 0, fetch_all boolean DEFAULT false,
  owner_id uuid DEFAULT NULL::uuid, is_active_filter text DEFAULT 'all'::text,
  p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_before_id uuid DEFAULT NULL::uuid, priority_levels smallint[] DEFAULT NULL::smallint[])
 RETURNS TABLE(id text, name text, city text, state text, country text, google_place_id text, google_types text[], category text, osm_category text, priority_level smallint, rating numeric, image_url text, approved boolean, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone, user_id text, business_status text, formatted_phone_number text, latitude numeric, longitude numeric, descriptions jsonb, trigger_points jsonb, group_membership jsonb, verification_data jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  base_query TEXT;
  where_conditions TEXT[] := ARRAY['a.entity_kind = ''poi''']::text[];
  where_clause TEXT := '';
  select_cols TEXT;
  page_clause TEXT := '';
  use_materialize BOOLEAN := (search_term IS NOT NULL AND search_term != '');
  caller_cms_id UUID;
  is_admin BOOLEAN := FALSE;
BEGIN
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
  -- MULTI-SELECT de prioridade: mostra qualquer nível do array (somatório de níveis).
  IF priority_levels IS NOT NULL AND array_length(priority_levels, 1) > 0 THEN
    where_conditions := array_append(where_conditions, format('a.priority_level = ANY(%L::smallint[])', priority_levels));
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

  IF p_before_created_at IS NOT NULL AND p_before_id IS NOT NULL THEN
    where_conditions := array_append(where_conditions,
      format('(a.created_at, a.id) < (%L::timestamptz, %L::uuid)', p_before_created_at, p_before_id));
  END IF;

  where_clause := CASE WHEN array_length(where_conditions, 1) > 0
                       THEN 'WHERE ' || array_to_string(where_conditions, ' AND ') ELSE '' END;

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

  IF use_materialize THEN
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
$function$;

GRANT EXECUTE ON FUNCTION core.cms_list_pois(text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,boolean,uuid,text,timestamp with time zone,uuid,smallint[]) TO authenticated, service_role;


-- ============================================================================
-- 2) core.cms_poi_facets — priority_filter INTEGER → priority_levels SMALLINT[]
--    (fast-path por prioridade agora SOMA os níveis selecionados na MV)
-- ============================================================================
DROP FUNCTION IF EXISTS core.cms_poi_facets(text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,integer);

CREATE OR REPLACE FUNCTION core.cms_poi_facets(
  search_term text DEFAULT NULL::text, status_filter text DEFAULT 'all'::text,
  country_filter text DEFAULT NULL::text, state_filter text DEFAULT NULL::text,
  city_filter text DEFAULT NULL::text, google_types_filter text DEFAULT NULL::text,
  category_filter text DEFAULT NULL::text, osm_category_filter text DEFAULT NULL::text,
  content_status_filter text DEFAULT 'all'::text, group_status_filter text DEFAULT 'all'::text,
  score_filter text DEFAULT 'all'::text, trigger_points_filter text DEFAULT 'all'::text,
  owner_id uuid DEFAULT NULL::uuid, is_active_filter text DEFAULT 'all'::text,
  priority_levels smallint[] DEFAULT NULL::smallint[])
 RETURNS TABLE(total_count bigint, approved_count bigint, pending_count bigint, with_description_count bigint, with_audio_count bigint, with_trigger_points_count bigint, complete_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  where_conditions TEXT[] := ARRAY['a.entity_kind = ''poi''']::text[];
  caller_cms_id UUID;
  is_admin BOOLEAN := FALSE;
  others_empty BOOLEAN;
  stats_query TEXT;
BEGIN
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
  IF others_empty AND priority_levels IS NULL THEN
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
  -- Multi-select: SOMA os níveis pedidos (= ANY). Aggregate → sempre 1 linha (COALESCE p/ 0).
  IF others_empty AND priority_levels IS NOT NULL AND owner_id IS NULL THEN
    RETURN QUERY
      SELECT COALESCE(SUM(p.total_count),0)::bigint,
             COALESCE(SUM(p.approved_count),0)::bigint,
             COALESCE(SUM(p.pending_count),0)::bigint,
             COALESCE(SUM(p.with_description_count),0)::bigint,
             COALESCE(SUM(p.with_audio_count),0)::bigint,
             COALESCE(SUM(p.with_trigger_points_count),0)::bigint,
             COALESCE(SUM(p.complete_count),0)::bigint
      FROM core.mv_poi_list_facets_by_priority p
      WHERE p.priority_level = ANY(priority_levels);
    RETURN;
  END IF;

  -- ===== Caminho filtrado: count live em passada única =====
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
  -- MULTI-SELECT de prioridade (mesmo WHERE do cms_list_pois, p/ coerência exata do total).
  IF priority_levels IS NOT NULL AND array_length(priority_levels, 1) > 0 THEN
    where_conditions := array_append(where_conditions, format('a.priority_level = ANY(%L::smallint[])', priority_levels));
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
$function$;

GRANT EXECUTE ON FUNCTION core.cms_poi_facets(text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,smallint[]) TO authenticated, service_role;


-- ============================================================================
-- 3) core.cms_search_pois_map — expõe priority_level no metadata + filtro por nível
-- ============================================================================
DROP FUNCTION IF EXISTS core.cms_search_pois_map(double precision,double precision,double precision,double precision,integer,text,text,text,text,text,uuid,text);

CREATE OR REPLACE FUNCTION core.cms_search_pois_map(
  min_lat double precision, min_lng double precision, max_lat double precision, max_lng double precision,
  zoom_level integer, search_term text DEFAULT NULL::text, status_filter text DEFAULT 'all'::text,
  country_filter text DEFAULT NULL::text, state_filter text DEFAULT NULL::text, city_filter text DEFAULT NULL::text,
  p_owner_id uuid DEFAULT NULL::uuid, is_active_filter text DEFAULT 'all'::text,
  priority_levels smallint[] DEFAULT NULL::smallint[])
 RETURNS TABLE(id uuid, name text, latitude double precision, longitude double precision, type text, count integer, metadata jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  eps float8;
  min_points int := 2;
  caller_cms_id UUID;
  is_admin BOOLEAN := FALSE;
  effective_owner_id UUID;
BEGIN
  effective_owner_id := p_owner_id;

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
    effective_owner_id := caller_cms_id;
  END IF;

  IF zoom_level <= 4 THEN eps := 1.0;
  ELSIF zoom_level <= 5 THEN eps := 0.5;
  ELSIF zoom_level <= 6 THEN eps := 0.25;
  ELSIF zoom_level <= 7 THEN eps := 0.1;
  ELSIF zoom_level <= 8 THEN eps := 0.05;
  ELSIF zoom_level <= 9 THEN eps := 0.02;
  ELSIF zoom_level <= 10 THEN eps := 0.01;
  ELSIF zoom_level <= 11 THEN eps := 0.005;
  ELSE eps := 0;
  END IF;

  RETURN QUERY
  WITH base_pois AS (
    SELECT
      a.id AS poi_id,
      a.name AS poi_name,
      a.city,
      a.state,
      a.country,
      a.approved,
      a.is_active,
      a.priority_level,
      c.latitude AS poi_lat,
      c.longitude AS poi_lng,
      ST_SetSRID(ST_MakePoint(c.longitude, c.latitude), 4326) as geom
    FROM core.attractions a
    JOIN core.attraction_coordinate c ON c.attraction_id = a.id
    WHERE
      a.entity_kind = 'poi' AND c.latitude BETWEEN (min_lat - 0.02) AND (max_lat + 0.02)
      AND c.longitude BETWEEN (min_lng - 0.02) AND (max_lng + 0.02)
      AND (search_term IS NULL OR a.name ILIKE '%' || search_term || '%')
      AND (status_filter = 'all' OR (status_filter = 'approved' AND a.approved = true) OR (status_filter = 'pending' AND a.approved = false))
      AND (country_filter IS NULL OR a.country = country_filter)
      AND (state_filter IS NULL OR a.state = state_filter)
      AND (city_filter IS NULL OR a.city = city_filter)
      AND (effective_owner_id IS NULL OR a.created_by = effective_owner_id)
      AND (priority_levels IS NULL OR a.priority_level = ANY(priority_levels))
      AND (
        is_active_filter = 'all'
        OR (is_active_filter = 'active' AND COALESCE(a.is_active, true) = true)
        OR (is_active_filter = 'inactive' AND COALESCE(a.is_active, true) = false)
      )
  ),
  filtered_pois AS (
    SELECT
      bp.*,
      COALESCE(ad_stats.has_description, false) AS has_description,
      COALESCE(ad_stats.has_audio, false) AS has_audio
    FROM base_pois bp
    LEFT JOIN LATERAL (
      SELECT
        bool_or(ad.description IS NOT NULL AND ad.description <> '') AS has_description,
        bool_or(ad.audio_url IS NOT NULL AND ad.audio_url <> '') AS has_audio
      FROM core.attraction_descriptions ad
      WHERE ad.attraction_id = bp.poi_id
    ) ad_stats ON true
  ),
  clustered AS (
    SELECT
      fp.poi_id, fp.poi_name, fp.city, fp.state, fp.country, fp.approved, fp.is_active,
      fp.priority_level,
      fp.has_description, fp.has_audio, fp.poi_lat, fp.poi_lng,
      CASE WHEN eps > 0 THEN
        ST_ClusterDBSCAN(fp.geom, eps, min_points) OVER ()
      ELSE
        NULL
      END as cluster_id
    FROM filtered_pois fp
  ),
  aggregated_clusters AS (
    SELECT
      (array_agg(cl.poi_id))[1] as id,
      'Cluster (' || count(*) || ')' as name,
      avg(cl.poi_lat)::double precision as latitude,
      avg(cl.poi_lng)::double precision as longitude,
      'cluster'::text as type,
      count(*)::int as count,
      jsonb_build_object('count', count(*)) as metadata
    FROM clustered cl
    WHERE cl.cluster_id IS NOT NULL
    GROUP BY cl.cluster_id
  ),
  individual_points AS (
    SELECT
      cl.poi_id as id,
      cl.poi_name as name,
      cl.poi_lat as latitude,
      cl.poi_lng as longitude,
      'poi'::text as type,
      1 as count,
      jsonb_build_object(
        'city', cl.city,
        'state', cl.state,
        'country', cl.country,
        'approved', cl.approved,
        'is_active', cl.is_active,
        'priority_level', cl.priority_level,
        'has_description', cl.has_description,
        'has_audio', cl.has_audio,
        'trigger_points_count', COALESCE(tp_counts.total, 0),
        'active_trigger_points_count', COALESCE(tp_counts.active, 0)
      ) as metadata
    FROM clustered cl
    LEFT JOIN LATERAL (
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE tp.is_active) AS active
      FROM core.attraction_trigger_points tp
      WHERE tp.attraction_id = cl.poi_id
    ) tp_counts ON true
    WHERE cl.cluster_id IS NULL
  )
  SELECT * FROM aggregated_clusters
  UNION ALL
  SELECT * FROM individual_points;
END;
$function$;

GRANT EXECUTE ON FUNCTION core.cms_search_pois_map(double precision,double precision,double precision,double precision,integer,text,text,text,text,text,uuid,text,smallint[]) TO authenticated, service_role;
