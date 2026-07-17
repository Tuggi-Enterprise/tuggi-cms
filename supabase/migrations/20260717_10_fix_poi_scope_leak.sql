-- ============================================================================
-- Migration: fechar o vazamento de POI nas 8 cms_* (GUC inválida)
-- Date: 2026-07-17
-- Depende de: 20260717_02 (core.caller_email)
--
-- O PROBLEMA (visto em produção)
-- ------------------------------
-- Um coordenador/cliente logado abria /clients/dashboard e via 1.520.394 POIs — o
-- catálogo INTEIRO da plataforma — sendo dono de ZERO. Fonte: core.cms_poi_facets, uma
-- das 8 funções que ainda resolviam identidade com a GUC inexistente
-- current_setting(request.jwt.claims.email) → NULL sempre → escopo desligado.
-- (As dashboard_* já foram corrigidas na 02/04; estas 8 ficaram como dívida.)
--
-- A CORREÇÃO (mecânica, mínima, verbatim exceto o bloco de identidade)
-- -------------------------------------------------------------------
--   1. current_setting(request.jwt.claims.email, true)  →  core.caller_email()
--      (auth.jwt() ->> email, o padrão que funciona). Como caller_email() NÃO lança,
--      a identidade passa a resolver para todo caller logado → o filtro de escopo aplica.
--   2. fail-open → fail-closed:
--        is_platform_admin := TRUE   →  FALSE; caller_client_id := NULL   (get_*)
--        is_admin := TRUE            →  FALSE; caller_cms_id := NULL       (list/facets/map)
--      Defesa em profundidade — com caller_email() o handler é inalcançável, mas some o
--      landmine de "erro na identidade ⇒ admin irrestrito".
--
-- SEMÂNTICA DE ESCOPO PRESERVADA (não padronizada nesta migration):
--   - cms_get_{countries,states,cities}: escopam por owner_id = caller_client_id (CLIENT).
--   - cms_list_pois / cms_poi_facets / cms_search_pois_map / _internal: por created_by
--     = caller_cms_id (USER). cms_search_pois: por owner_id (CLIENT).
--   Para o estado atual (clientes têm 0 POIs; owner_id de 2,2M = Tuggi), ambos os escopos
--   dão 0 para um cliente sem POIs — o vazamento fecha. A padronização created_by→owner_id
--   e o trigger set_attraction_owner_on_insert (lê cms_users.client_id morto) ficam como
--   follow-up para quando clientes REALMENTE criarem POIs.
--
-- Corpo de cada função extraído verbatim de pg_get_functiondef() e transformado por script
-- determinístico; só as linhas de identidade acima mudaram.
--
-- ⚠️ APLICAR MANUALMENTE NO PAINEL. NUNCA DDL via CLI.
-- ============================================================================

-- ===== cms_get_countries =====
CREATE OR REPLACE FUNCTION core.cms_get_countries(p_category text DEFAULT NULL::text)
 RETURNS TABLE(value text, label text, count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE caller_client_id UUID; caller_role TEXT; is_platform_admin BOOLEAN := FALSE;
BEGIN
  BEGIN
    SELECT cu.client_id, cu.role INTO caller_client_id, caller_role
    FROM core.cms_users cu WHERE cu.email = core.caller_email();
    IF caller_role IS NULL THEN is_platform_admin := TRUE;
    ELSE is_platform_admin := EXISTS (SELECT 1 FROM core.clients c WHERE c.id = caller_client_id AND c.is_platform_owner = TRUE)
                              AND (caller_role IN ('admin','super_admin'));
    END IF;
  EXCEPTION WHEN OTHERS THEN is_platform_admin := FALSE; caller_client_id := NULL; END;

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

-- ===== cms_get_states =====
CREATE OR REPLACE FUNCTION core.cms_get_states(country_name text, p_category text DEFAULT NULL::text)
 RETURNS TABLE(value text, label text, count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE caller_client_id UUID; caller_role TEXT; is_platform_admin BOOLEAN := FALSE;
BEGIN
  BEGIN
    SELECT cu.client_id, cu.role INTO caller_client_id, caller_role
    FROM core.cms_users cu WHERE cu.email = core.caller_email();
    IF caller_role IS NULL THEN is_platform_admin := TRUE;
    ELSE is_platform_admin := EXISTS (SELECT 1 FROM core.clients c WHERE c.id = caller_client_id AND c.is_platform_owner = TRUE)
                              AND (caller_role IN ('admin','super_admin'));
    END IF;
  EXCEPTION WHEN OTHERS THEN is_platform_admin := FALSE; caller_client_id := NULL; END;

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

-- ===== cms_get_cities =====
CREATE OR REPLACE FUNCTION core.cms_get_cities(country_name text, state_name text DEFAULT NULL::text, p_category text DEFAULT NULL::text)
 RETURNS TABLE(value text, label text, count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE caller_client_id UUID; caller_role TEXT; is_platform_admin BOOLEAN := FALSE;
BEGIN
  BEGIN
    SELECT cu.client_id, cu.role INTO caller_client_id, caller_role
    FROM core.cms_users cu WHERE cu.email = core.caller_email();
    IF caller_role IS NULL THEN is_platform_admin := TRUE;
    ELSE is_platform_admin := EXISTS (SELECT 1 FROM core.clients c WHERE c.id = caller_client_id AND c.is_platform_owner = TRUE)
                              AND (caller_role IN ('admin','super_admin'));
    END IF;
  EXCEPTION WHEN OTHERS THEN is_platform_admin := FALSE; caller_client_id := NULL; END;

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

-- ===== cms_search_pois =====
CREATE OR REPLACE FUNCTION core.cms_search_pois(search_term text DEFAULT NULL::text, status_filter text DEFAULT 'all'::text, country_filter text DEFAULT NULL::text, state_filter text DEFAULT NULL::text, city_filter text DEFAULT NULL::text, google_types_filter text DEFAULT NULL::text, category_filter text DEFAULT NULL::text, osm_category_filter text DEFAULT NULL::text, content_status_filter text DEFAULT 'all'::text, group_status_filter text DEFAULT 'all'::text, score_filter text DEFAULT 'all'::text, trigger_points_filter text DEFAULT 'all'::text, limit_count integer DEFAULT 1000, offset_count integer DEFAULT 0, fetch_all boolean DEFAULT false, p_owner_id uuid DEFAULT NULL::uuid, is_active_filter text DEFAULT 'all'::text)
 RETURNS TABLE(id text, name text, city text, state text, country text, category text, osm_category text, rating numeric, image_url text, approved boolean, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone, user_id text, owner_id uuid, created_by uuid, business_status text, formatted_phone_number text, latitude numeric, longitude numeric, descriptions jsonb, trigger_points jsonb, group_membership jsonb, verification_data jsonb, total_count bigint, approved_count bigint, pending_count bigint, with_description_count bigint, with_audio_count bigint, with_trigger_points_count bigint, complete_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'public', 'extensions'
AS $function$
DECLARE
  base_query TEXT;
  where_conditions TEXT[] := '{}';
  stats_query TEXT;
  stats_result RECORD;
  caller_cms_id UUID;
  caller_client_id UUID;
  caller_role TEXT;
  is_platform_admin BOOLEAN := FALSE;
BEGIN
  -- Resolve Identidade (ACL)
  BEGIN
    SELECT cu.role, cu.client_id INTO caller_role, caller_client_id 
    FROM core.cms_users cu WHERE cu.email = core.caller_email();
    IF NOT (caller_role IN ('admin', 'super_admin') AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = caller_client_id AND c.is_platform_owner = TRUE)) THEN
      p_owner_id := caller_client_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN caller_client_id := NULL; caller_role := NULL;
  END;

  -- FILTROS (Corrigidos com Estado e Cidade)
  IF search_term IS NOT NULL AND search_term != '' THEN
    where_conditions := array_append(where_conditions, format('(a.name ILIKE %L OR a.city ILIKE %L)', '%'||search_term||'%', '%'||search_term||'%'));
  END IF;
  IF country_filter IS NOT NULL AND country_filter != '' THEN where_conditions := array_append(where_conditions, format('a.country = %L', country_filter)); END IF;
  IF state_filter IS NOT NULL AND state_filter != '' THEN where_conditions := array_append(where_conditions, format('a.state = %L', state_filter)); END IF; -- ADICIONADO
  IF city_filter IS NOT NULL AND city_filter != '' THEN where_conditions := array_append(where_conditions, format('a.city = %L', city_filter)); END IF; -- ADICIONADO
  IF category_filter IS NOT NULL AND category_filter != '' THEN where_conditions := array_append(where_conditions, format('a.category = %L', category_filter)); END IF;
  IF osm_category_filter IS NOT NULL AND osm_category_filter != '' THEN where_conditions := array_append(where_conditions, format('a.osm_category = %L', osm_category_filter)); END IF;
  IF p_owner_id IS NOT NULL THEN where_conditions := array_append(where_conditions, format('a.owner_id = %L', p_owner_id)); END IF;
  
  stats_query := format('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE a.approved = true) as appv FROM core.attractions a %s', 
    CASE WHEN array_length(where_conditions, 1) > 0 THEN 'WHERE ' || array_to_string(where_conditions, ' AND ') ELSE '' END);
  EXECUTE stats_query INTO stats_result;

  RETURN QUERY EXECUTE format('
    SELECT a.id::TEXT, a.name, a.city, a.state, a.country, a.category, a.osm_category, a.rating, a.image_url, a.approved, COALESCE(a.is_active, true), a.created_at, a.updated_at, a.user_id::TEXT, a.owner_id, a.created_by, a.business_status, a.formatted_phone_number, ac.latitude::NUMERIC, ac.longitude::NUMERIC, ''[]''::jsonb, ''[]''::jsonb, ''[]''::jsonb, ''{}''::jsonb, %L::BIGINT, %L::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT
    FROM core.attractions a
    LEFT JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
    %s ORDER BY a.created_at DESC LIMIT %L OFFSET %L',
    stats_result.total, stats_result.appv, 
    CASE WHEN array_length(where_conditions, 1) > 0 THEN 'WHERE ' || array_to_string(where_conditions, ' AND ') ELSE '' END,
    limit_count, offset_count);
END;
$function$;

-- ===== cms_search_pois_internal =====
CREATE OR REPLACE FUNCTION core.cms_search_pois_internal(search_term text DEFAULT NULL::text, status_filter text DEFAULT 'all'::text, country_filter text DEFAULT NULL::text, state_filter text DEFAULT NULL::text, city_filter text DEFAULT NULL::text, google_types_filter text DEFAULT NULL::text, category_filter text DEFAULT NULL::text, content_status_filter text DEFAULT NULL::text, group_status_filter text DEFAULT NULL::text, score_filter text DEFAULT NULL::text, trigger_points_filter text DEFAULT NULL::text, limit_count integer DEFAULT 1000, offset_count integer DEFAULT 0, fetch_all boolean DEFAULT false, p_owner_id text DEFAULT NULL::text)
 RETURNS TABLE(id text, name text, city text, state text, country text, google_place_id text, google_types text[], category text, rating numeric, image_url text, approved boolean, created_at timestamp with time zone, updated_at timestamp with time zone, user_id text, business_status text, formatted_phone_number text, latitude numeric, longitude numeric, descriptions jsonb, trigger_points jsonb, group_membership jsonb, verification_data jsonb, total_count bigint, approved_count bigint, pending_count bigint, with_description_count bigint, with_audio_count bigint, with_trigger_points_count bigint, complete_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'public', 'extensions'
AS $function$
DECLARE
  base_query TEXT;
  where_conditions TEXT[] := '{}';
  order_clause TEXT := 'ORDER BY a.created_at DESC';
  limit_clause TEXT := '';
  offset_clause TEXT := '';
  stats_query TEXT;
  stats_result RECORD;
  caller_cms_id UUID;
  is_admin BOOLEAN := FALSE;
BEGIN
  -- Enforce owner-limiting: if caller is not an admin, force p_owner_id to the caller's cms_users.id
  caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = core.caller_email());
  is_admin := EXISTS (
    SELECT 1 FROM core.cms_users cu
    WHERE cu.email = core.caller_email() AND cu.role IN ('admin','super_admin')
  );
  IF NOT is_admin THEN
    p_owner_id := caller_cms_id;
  END IF;

  IF search_term IS NOT NULL AND search_term != '' THEN
    where_conditions := array_append(where_conditions, 
      format('(a.name ILIKE %L OR a.city ILIKE %L OR a.country ILIKE %L)', 
        '%' || search_term || '%', '%' || search_term || '%', '%' || search_term || '%'));
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

  IF p_owner_id IS NOT NULL THEN
    where_conditions := array_append(where_conditions, format('a.created_by = %L', p_owner_id));
  END IF;

  IF array_length(where_conditions, 1) > 0 THEN
    where_conditions := array_append(where_conditions, '1=1');
  END IF;

  IF array_length(where_conditions, 1) > 0 THEN
    stats_query := format('
      SELECT 
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE a.approved = true) as approved_count,
        COUNT(*) FILTER (WHERE a.approved = false) as pending_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)) as with_description_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL)) as with_audio_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)) as with_trigger_points_count,
        COUNT(*) FILTER (WHERE a.approved = true AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)) as complete_count
      FROM core.attractions a
      WHERE %s
    ', array_to_string(where_conditions, ' AND '));
  ELSE
    stats_query := '
      SELECT 
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE a.approved = true) as approved_count,
        COUNT(*) FILTER (WHERE a.approved = false) as pending_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)) as with_description_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL)) as with_audio_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)) as with_trigger_points_count,
        COUNT(*) FILTER (WHERE a.approved = true AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)) as complete_count
      FROM core.attractions a
    ';
  END IF;

  EXECUTE stats_query INTO stats_result;

  IF array_length(where_conditions, 1) > 0 THEN
    base_query := format('
      SELECT 
        a.id::TEXT,
        a.name,
        a.city,
        a.state,
        a.country,
        a.google_place_id,
        a.google_types,
        a.category,
        a.rating,
        a.image_url,
        a.approved,
        a.created_at,
        a.updated_at,
        a.user_id::TEXT,
        a.business_status,
        a.formatted_phone_number,
        ac.latitude::NUMERIC,
        ac.longitude::NUMERIC,
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              ''id'', ad.id,
              ''language'', ad.language,
              ''description'', ad.description,
              ''audio_url'', ad.audio_url,
              ''created_at'', ad.created_at
            )
          ) FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id), 
          ''[]''::jsonb
        ) as descriptions,
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              ''id'', atp.id,
              ''is_active'', atp.is_active,
              ''type'', atp.type
            )
          ) FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id), 
          ''[]''::jsonb
        ) as trigger_points,
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              ''group_id'', ag.id,
              ''group_name'', ag.name,
              ''role'', agm.group_role
            )
          ) FROM core.attraction_groups ag 
           JOIN core.attraction_group_members agm ON ag.id = agm.group_id 
           WHERE agm.attraction_id = a.id), 
          ''[]''::jsonb
        ) as group_membership,
        ''{}''::jsonb as verification_data,
        %L::BIGINT as total_count,
        %L::BIGINT as approved_count,
        %L::BIGINT as pending_count,
        %L::BIGINT as with_description_count,
        %L::BIGINT as with_audio_count,
        %L::BIGINT as with_trigger_points_count,
        %L::BIGINT as complete_count
      FROM core.attractions a
      LEFT JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
      WHERE %s
      %s
    ', 
      stats_result.total_count,
      stats_result.approved_count,
      stats_result.pending_count,
      stats_result.with_description_count,
      stats_result.with_audio_count,
      stats_result.with_trigger_points_count,
      stats_result.complete_count,
      array_to_string(where_conditions, ' AND '),
      order_clause
    );
  ELSE
    base_query := format('
      SELECT 
        a.id::TEXT,
        a.name,
        a.city,
        a.state,
        a.country,
        a.google_place_id,
        a.google_types,
        a.category,
        a.rating,
        a.image_url,
        a.approved,
        a.created_at,
        a.updated_at,
        a.user_id::TEXT,
        a.business_status,
        a.formatted_phone_number,
        ac.latitude::NUMERIC,
        ac.longitude::NUMERIC,
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              ''id'', ad.id,
              ''language'', ad.language,
              ''description'', ad.description,
              ''audio_url'', ad.audio_url,
              ''created_at'', ad.created_at
            )
          ) FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id), 
          ''[]''::jsonb
        ) as descriptions,
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              ''id'', atp.id,
              ''is_active'', atp.is_active,
              ''type'', atp.type
            )
          ) FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id), 
          ''[]''::jsonb
        ) as trigger_points,
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              ''group_id'', ag.id,
              ''group_name'', ag.name,
              ''role'', agm.group_role
            )
          ) FROM core.attraction_groups ag 
           JOIN core.attraction_group_members agm ON ag.id = agm.group_id 
           WHERE agm.attraction_id = a.id), 
          ''[]''::jsonb
        ) as group_membership,
        ''{}''::jsonb as verification_data,
        %L::BIGINT as total_count,
        %L::BIGINT as approved_count,
        %L::BIGINT as pending_count,
        %L::BIGINT as with_description_count,
        %L::BIGINT as with_audio_count,
        %L::BIGINT as with_trigger_points_count,
        %L::BIGINT as complete_count
      FROM core.attractions a
      LEFT JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
      %s
    ', 
      stats_result.total_count,
      stats_result.approved_count,
      stats_result.pending_count,
      stats_result.with_description_count,
      stats_result.with_audio_count,
      stats_result.with_trigger_points_count,
      stats_result.complete_count,
      order_clause
    );
  END IF;

  IF NOT fetch_all THEN
    limit_clause := format(' LIMIT %s', limit_count);
    offset_clause := format(' OFFSET %s', offset_count);
  END IF;

  RETURN QUERY EXECUTE base_query || limit_clause || offset_clause;
END;
$function$;

-- ===== cms_search_pois_map =====
CREATE OR REPLACE FUNCTION core.cms_search_pois_map(min_lat double precision, min_lng double precision, max_lat double precision, max_lng double precision, zoom_level integer, search_term text DEFAULT NULL::text, status_filter text DEFAULT 'all'::text, country_filter text DEFAULT NULL::text, state_filter text DEFAULT NULL::text, city_filter text DEFAULT NULL::text, p_owner_id uuid DEFAULT NULL::uuid, is_active_filter text DEFAULT 'all'::text)
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
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = core.caller_email());
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = core.caller_email() AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := FALSE; caller_cms_id := NULL;
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

-- ===== cms_poi_facets =====
CREATE OR REPLACE FUNCTION core.cms_poi_facets(search_term text DEFAULT NULL::text, status_filter text DEFAULT 'all'::text, country_filter text DEFAULT NULL::text, state_filter text DEFAULT NULL::text, city_filter text DEFAULT NULL::text, google_types_filter text DEFAULT NULL::text, category_filter text DEFAULT NULL::text, osm_category_filter text DEFAULT NULL::text, content_status_filter text DEFAULT 'all'::text, group_status_filter text DEFAULT 'all'::text, score_filter text DEFAULT 'all'::text, trigger_points_filter text DEFAULT 'all'::text, owner_id uuid DEFAULT NULL::uuid, is_active_filter text DEFAULT 'all'::text, priority_filter integer DEFAULT NULL::integer)
 RETURNS TABLE(total_count bigint, approved_count bigint, pending_count bigint, with_description_count bigint, with_audio_count bigint, with_trigger_points_count bigint, complete_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  where_conditions TEXT[] := ARRAY['a.entity_kind = ''poi''']::text[];
  caller_cms_id UUID;
  is_admin BOOLEAN := FALSE;
  others_empty BOOLEAN;   -- todos os filtros EXCETO priority estão vazios
  stats_query TEXT;
BEGIN
  -- Resolve caller identity (mesmo padrão)
  BEGIN
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = core.caller_email());
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = core.caller_email() AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := FALSE; caller_cms_id := NULL;
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
$function$;

-- ===== cms_list_pois =====
CREATE OR REPLACE FUNCTION core.cms_list_pois(search_term text DEFAULT NULL::text, status_filter text DEFAULT 'all'::text, country_filter text DEFAULT NULL::text, state_filter text DEFAULT NULL::text, city_filter text DEFAULT NULL::text, google_types_filter text DEFAULT NULL::text, category_filter text DEFAULT NULL::text, osm_category_filter text DEFAULT NULL::text, content_status_filter text DEFAULT 'all'::text, group_status_filter text DEFAULT 'all'::text, score_filter text DEFAULT 'all'::text, trigger_points_filter text DEFAULT 'all'::text, limit_count integer DEFAULT 20, offset_count integer DEFAULT 0, fetch_all boolean DEFAULT false, owner_id uuid DEFAULT NULL::uuid, is_active_filter text DEFAULT 'all'::text, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, priority_filter integer DEFAULT NULL::integer)
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
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = core.caller_email());
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = core.caller_email() AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := FALSE; caller_cms_id := NULL;
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
$function$;


NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICAÇÃO
-- ============================================================================
-- 1) Nenhuma das 8 usa mais a GUC inválida (deve voltar VAZIO):
--      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--       WHERE n.nspname=core AND p.prosrc LIKE %request.jwt.claims.email% ORDER BY 1;
--
-- 2) O vazamento fechou para o coordenador demo (dono de 0 POIs):
--      Logado como demo@tuggi.app, /clients/coordinator (não /clients/dashboard, que agora
--      redireciona). E via API, cms_poi_facets deixa de devolver 1,5M.
--
-- 3) Admin não regrediu: a listagem /pois como admin continua mostrando tudo.
--    (Painel = sessão direta = admin via is_caller_* — mas cms_* usam o padrão antigo
--     caller_cms_id; no painel, caller_email() é NULL → caller_cms_id NULL → sem filtro
--     = comportamento admin/serviço, correto.)
