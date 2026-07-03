-- ============================================================================
-- EVENTS RPCs — listagem, facets, detalhe e criação atômica (módulo Eventos)
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI (regra do projeto).
--
-- Pré-requisitos: 01_entity_kind, 02_event_details.
--
-- Propositalmente enxutas (não copiam cms_list_pois, que carrega ~230 colunas de
-- POI). Reusam os satélites de attractions via attraction_id. Todas filtram
-- entity_kind='event' — o espelho do retrofit de POI, para não misturar catálogos.
-- Expostas em core (PostgREST). SECURITY DEFINER só onde escreve.
-- ============================================================================

-- 1) LISTAGEM ----------------------------------------------------------------
DROP FUNCTION IF EXISTS core.cms_list_events(text, text, text, text, text, text, text, timestamptz, timestamptz, integer, integer, boolean);
CREATE FUNCTION core.cms_list_events(
  search_term       text DEFAULT NULL,
  status_filter     text DEFAULT 'all',      -- all | approved | pending
  country_filter    text DEFAULT NULL,
  state_filter      text DEFAULT NULL,
  city_filter       text DEFAULT NULL,
  event_status_filter text DEFAULT 'all',    -- all | scheduled | cancelled | ...
  time_filter       text DEFAULT 'all',      -- all | upcoming | past
  starts_after      timestamptz DEFAULT NULL,
  starts_before     timestamptz DEFAULT NULL,
  limit_count       integer DEFAULT 50,
  offset_count      integer DEFAULT 0,
  fetch_all         boolean DEFAULT false
) RETURNS TABLE(
  id uuid, name text, city text, state text, country text,
  approved boolean, is_active boolean, priority_level smallint,
  image_url text, created_at timestamptz, updated_at timestamptz,
  latitude double precision, longitude double precision,
  starts_at timestamptz, ends_at timestamptz, timezone text, all_day boolean,
  status text, event_category text, tags text[],
  is_free boolean, price_min numeric, price_max numeric,
  description_count bigint, trigger_point_count bigint, total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
BEGIN
  -- CMS-only tool (espelha cms_list_pois SECURITY DEFINER). Não-CMS => vazio.
  IF NOT core.is_active_cms_user() THEN RETURN; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT a.id, a.name, a.city, a.state, a.country, a.approved, a.is_active,
           a.priority_level, a.image_url, a.created_at, a.updated_at,
           ac.latitude, ac.longitude,
           ed.starts_at, ed.ends_at, ed.timezone, ed.all_day, ed.status,
           ed.event_category, ed.tags, ed.is_free, ed.price_min, ed.price_max
    FROM core.attractions a
    JOIN core.event_details ed ON ed.attraction_id = a.id
    LEFT JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
    WHERE a.entity_kind = 'event'
      AND (search_term IS NULL OR a.name ILIKE '%' || search_term || '%')
      AND (status_filter = 'all'
           OR (status_filter = 'approved' AND a.approved = true)
           OR (status_filter = 'pending'  AND a.approved = false))
      AND (country_filter IS NULL OR a.country = country_filter)
      AND (state_filter   IS NULL OR a.state   = state_filter)
      AND (city_filter    IS NULL OR a.city    = city_filter)
      AND (event_status_filter = 'all' OR ed.status = event_status_filter)
      AND (time_filter = 'all'
           OR (time_filter = 'upcoming' AND COALESCE(ed.ends_at, ed.starts_at) >= now())
           OR (time_filter = 'past'     AND COALESCE(ed.ends_at, ed.starts_at) <  now()))
      AND (starts_after  IS NULL OR ed.starts_at >= starts_after)
      AND (starts_before IS NULL OR ed.starts_at <= starts_before)
  ), counted AS (
    SELECT b.*, count(*) OVER() AS total_count FROM base b
  )
  SELECT c.id, c.name, c.city, c.state, c.country, c.approved, c.is_active,
         c.priority_level, c.image_url, c.created_at, c.updated_at,
         c.latitude, c.longitude,
         c.starts_at, c.ends_at, c.timezone, c.all_day, c.status,
         c.event_category, c.tags, c.is_free, c.price_min, c.price_max,
         (SELECT count(*) FROM core.attraction_descriptions ad WHERE ad.attraction_id = c.id) AS description_count,
         (SELECT count(*) FROM core.attraction_trigger_points tp WHERE tp.attraction_id = c.id) AS trigger_point_count,
         c.total_count
  FROM counted c
  ORDER BY c.starts_at DESC NULLS LAST, c.created_at DESC
  LIMIT CASE WHEN fetch_all THEN NULL ELSE limit_count END
  OFFSET CASE WHEN fetch_all THEN 0 ELSE offset_count END;
END;
$$;

-- 2) FACETS / CONTADORES -----------------------------------------------------
DROP FUNCTION IF EXISTS core.cms_event_facets(text, text, text, text);
CREATE FUNCTION core.cms_event_facets(
  search_term    text DEFAULT NULL,
  country_filter text DEFAULT NULL,
  state_filter   text DEFAULT NULL,
  city_filter    text DEFAULT NULL
) RETURNS TABLE(
  total_count bigint, approved_count bigint, pending_count bigint,
  upcoming_count bigint, past_count bigint,
  with_description_count bigint, with_trigger_points_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
BEGIN
  -- CMS-only tool (espelha cms_list_pois SECURITY DEFINER). Não-CMS => vazio.
  IF NOT core.is_active_cms_user() THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    count(*),
    count(*) FILTER (WHERE a.approved),
    count(*) FILTER (WHERE NOT a.approved),
    count(*) FILTER (WHERE COALESCE(ed.ends_at, ed.starts_at) >= now()),
    count(*) FILTER (WHERE COALESCE(ed.ends_at, ed.starts_at) <  now()),
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)),
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_trigger_points tp WHERE tp.attraction_id = a.id))
  FROM core.attractions a
  JOIN core.event_details ed ON ed.attraction_id = a.id
  WHERE a.entity_kind = 'event'
    AND (search_term IS NULL OR a.name ILIKE '%' || search_term || '%')
    AND (country_filter IS NULL OR a.country = country_filter)
    AND (state_filter   IS NULL OR a.state   = state_filter)
    AND (city_filter    IS NULL OR a.city    = city_filter);
END;
$$;

-- 3) DETALHE (1 evento) ------------------------------------------------------
DROP FUNCTION IF EXISTS core.get_event_details(uuid);
CREATE FUNCTION core.get_event_details(p_event_id uuid) RETURNS TABLE(
  id uuid, name text, description text, city text, state text, country text,
  approved boolean, is_active boolean, priority_level smallint,
  image_url text, created_at timestamptz, updated_at timestamptz,
  latitude double precision, longitude double precision,
  event_details jsonb, audio_descriptions jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
BEGIN
  -- CMS-only tool (espelha cms_list_pois SECURITY DEFINER). Não-CMS => vazio.
  IF NOT core.is_active_cms_user() THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    a.id, a.name, a.description, a.city, a.state, a.country,
    a.approved, a.is_active, a.priority_level,
    a.image_url, a.created_at, a.updated_at,
    ac.latitude, ac.longitude,
    to_jsonb(ed.*) AS event_details,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ad.id, 'language', ad.language, 'audio_url', ad.audio_url,
        'description', ad.description, 'name', ad.name, 'gender', ad.gender))
      FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id
    ), '[]'::jsonb) AS audio_descriptions
  FROM core.attractions a
  JOIN core.event_details ed ON ed.attraction_id = a.id
  LEFT JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  WHERE a.id = p_event_id AND a.entity_kind = 'event';
END;
$$;

-- 4) CRIAÇÃO ATÔMICA (attractions + event_details [+ coordinate]) ------------
-- SECURITY DEFINER: insere attraction (entity_kind='event') + event_details na
-- MESMA transação, evitando attraction órfã. created_by vem do JWT do chamador.
-- Campos ricos (organizer/ingressos/tags/etc.) são preenchidos depois via update.
DROP FUNCTION IF EXISTS core.cms_create_event(text, text, text, text, double precision, double precision, timestamptz, timestamptz, text, boolean);
CREATE FUNCTION core.cms_create_event(
  p_name        text,
  p_city        text,
  p_country     text,
  p_state       text DEFAULT NULL,
  p_latitude    double precision DEFAULT NULL,
  p_longitude   double precision DEFAULT NULL,
  p_starts_at   timestamptz DEFAULT NULL,
  p_ends_at     timestamptz DEFAULT NULL,
  p_timezone    text DEFAULT 'America/Sao_Paulo',
  p_all_day     boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
DECLARE
  v_attraction_id uuid;
  v_created_by uuid;
BEGIN
  IF NOT core.is_active_cms_editor_or_admin() THEN
    RAISE EXCEPTION 'not authorized to create events';
  END IF;
  IF p_starts_at IS NULL THEN
    RAISE EXCEPTION 'starts_at is required';
  END IF;

  SELECT id INTO v_created_by FROM core.cms_users WHERE email = auth.jwt() ->> 'email';

  INSERT INTO core.attractions (name, city, state, country, entity_kind, approved, is_active, created_by)
  VALUES (p_name, p_city, p_state, p_country, 'event', false, true, v_created_by)
  RETURNING id INTO v_attraction_id;

  INSERT INTO core.event_details (attraction_id, starts_at, ends_at, timezone, all_day, created_by)
  VALUES (v_attraction_id, p_starts_at, p_ends_at, p_timezone, p_all_day, v_created_by);

  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    INSERT INTO core.attraction_coordinate (attraction_id, latitude, longitude)
    VALUES (v_attraction_id, p_latitude, p_longitude);
  END IF;

  RETURN v_attraction_id;
END;
$$;

-- Grants (leitura p/ authenticated gated por RLS; escrita via SECURITY DEFINER).
GRANT EXECUTE ON FUNCTION core.cms_list_events(text, text, text, text, text, text, text, timestamptz, timestamptz, integer, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.cms_event_facets(text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.get_event_details(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.cms_create_event(text, text, text, text, double precision, double precision, timestamptz, timestamptz, text, boolean) TO authenticated, service_role;
