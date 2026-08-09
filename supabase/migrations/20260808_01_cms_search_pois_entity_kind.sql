-- 20260808_01_cms_search_pois_entity_kind.sql
--
-- Fecha o último vazamento Tier 1 do retrofit de entity_kind (runbook 20260703_05).
--
-- core.cms_search_pois é a RPC que o map view da /pois usa
-- (app/api/pois/search/route.ts, ramo mapView). Ela é a única do Tier 1 que
-- lê core.attractions SEM filtrar entity_kind — resultado: Locais e Eventos
-- aparecem no mapa do catálogo de POIs, mesmo estando corretamente cadastrados
-- como place/event (foi o que fez os 12 estabelecimentos do Festival Delícias
-- do Vale do Café parecerem POIs).
--
-- cms_list_pois, cms_poi_facets, cms_search_pois_map, get_poi_details e
-- app_poi_read_build já filtram. Esta migration só acrescenta a condição
-- a.entity_kind = 'poi' à lista de where_conditions; o resto do corpo é
-- idêntico ao que está em produção.

CREATE OR REPLACE FUNCTION core.cms_search_pois(
  search_term text DEFAULT NULL::text,
  status_filter text DEFAULT 'all'::text,
  country_filter text DEFAULT NULL::text,
  state_filter text DEFAULT NULL::text,
  city_filter text DEFAULT NULL::text,
  google_types_filter text DEFAULT NULL::text,
  category_filter text DEFAULT NULL::text,
  osm_category_filter text DEFAULT NULL::text,
  content_status_filter text DEFAULT 'all'::text,
  group_status_filter text DEFAULT 'all'::text,
  score_filter text DEFAULT 'all'::text,
  trigger_points_filter text DEFAULT 'all'::text,
  limit_count integer DEFAULT 1000,
  offset_count integer DEFAULT 0,
  fetch_all boolean DEFAULT false,
  p_owner_id uuid DEFAULT NULL::uuid,
  is_active_filter text DEFAULT 'all'::text
)
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
    FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true);
    IF NOT (caller_role IN ('admin', 'super_admin') AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = caller_client_id AND c.is_platform_owner = TRUE)) THEN
      p_owner_id := caller_client_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Catálogo de POIs não mostra Locais nem Eventos (retrofit entity_kind).
  where_conditions := array_append(where_conditions, 'a.entity_kind = ''poi''');

  -- FILTROS (Corrigidos com Estado e Cidade)
  IF search_term IS NOT NULL AND search_term != '' THEN
    where_conditions := array_append(where_conditions, format('(a.name ILIKE %L OR a.city ILIKE %L)', '%'||search_term||'%', '%'||search_term||'%'));
  END IF;
  IF country_filter IS NOT NULL AND country_filter != '' THEN where_conditions := array_append(where_conditions, format('a.country = %L', country_filter)); END IF;
  IF state_filter IS NOT NULL AND state_filter != '' THEN where_conditions := array_append(where_conditions, format('a.state = %L', state_filter)); END IF;
  IF city_filter IS NOT NULL AND city_filter != '' THEN where_conditions := array_append(where_conditions, format('a.city = %L', city_filter)); END IF;
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
