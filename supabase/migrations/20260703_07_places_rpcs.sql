-- ============================================================================
-- PLACES RPCs — listagem, facets, detalhe e criação atômica (módulo Locais)
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI (regra do projeto).
--
-- Pré-requisitos: 01_entity_kind, 03_place_details.
--
-- Espelha as RPCs de eventos. Locais reusam horário (attractions.opening_hours +
-- core.is_poi_open_now), acessibilidade e contato de attractions; place_details
-- guarda só o específico de comércio. Todas filtram entity_kind='place'.
-- ============================================================================

-- 1) LISTAGEM ----------------------------------------------------------------
DROP FUNCTION IF EXISTS core.cms_list_places(text, text, text, text, text, text, integer, integer, boolean);
CREATE FUNCTION core.cms_list_places(
  search_term      text DEFAULT NULL,
  status_filter    text DEFAULT 'all',      -- all | approved | pending
  country_filter   text DEFAULT NULL,
  state_filter     text DEFAULT NULL,
  city_filter      text DEFAULT NULL,
  place_type_filter text DEFAULT NULL,
  limit_count      integer DEFAULT 50,
  offset_count     integer DEFAULT 0,
  fetch_all        boolean DEFAULT false
) RETURNS TABLE(
  id uuid, name text, city text, state text, country text,
  approved boolean, is_active boolean, priority_level smallint,
  image_url text, created_at timestamptz, updated_at timestamptz,
  latitude double precision, longitude double precision,
  place_type text, price_range smallint, tags text[], has_hours boolean,
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
           pd.place_type, pd.price_range, pd.tags,
           (a.opening_hours IS NOT NULL) AS has_hours
    FROM core.attractions a
    JOIN core.place_details pd ON pd.attraction_id = a.id
    LEFT JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
    WHERE a.entity_kind = 'place'
      AND (search_term IS NULL OR a.name ILIKE '%' || search_term || '%')
      AND (status_filter = 'all'
           OR (status_filter = 'approved' AND a.approved = true)
           OR (status_filter = 'pending'  AND a.approved = false))
      AND (country_filter    IS NULL OR a.country = country_filter)
      AND (state_filter      IS NULL OR a.state   = state_filter)
      AND (city_filter       IS NULL OR a.city    = city_filter)
      AND (place_type_filter IS NULL OR pd.place_type = place_type_filter)
  ), counted AS (
    SELECT b.*, count(*) OVER() AS total_count FROM base b
  )
  SELECT c.id, c.name, c.city, c.state, c.country, c.approved, c.is_active,
         c.priority_level, c.image_url, c.created_at, c.updated_at,
         c.latitude, c.longitude, c.place_type, c.price_range, c.tags, c.has_hours,
         (SELECT count(*) FROM core.attraction_descriptions ad WHERE ad.attraction_id = c.id),
         (SELECT count(*) FROM core.attraction_trigger_points tp WHERE tp.attraction_id = c.id),
         c.total_count
  FROM counted c
  ORDER BY c.created_at DESC
  LIMIT CASE WHEN fetch_all THEN NULL ELSE limit_count END
  OFFSET CASE WHEN fetch_all THEN 0 ELSE offset_count END;
END;
$$;

-- 2) FACETS ------------------------------------------------------------------
DROP FUNCTION IF EXISTS core.cms_place_facets(text, text, text, text);
CREATE FUNCTION core.cms_place_facets(
  search_term    text DEFAULT NULL,
  country_filter text DEFAULT NULL,
  state_filter   text DEFAULT NULL,
  city_filter    text DEFAULT NULL
) RETURNS TABLE(
  total_count bigint, approved_count bigint, pending_count bigint,
  with_hours_count bigint, with_description_count bigint, with_trigger_points_count bigint
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
    count(*) FILTER (WHERE a.opening_hours IS NOT NULL),
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)),
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_trigger_points tp WHERE tp.attraction_id = a.id))
  FROM core.attractions a
  JOIN core.place_details pd ON pd.attraction_id = a.id
  WHERE a.entity_kind = 'place'
    AND (search_term IS NULL OR a.name ILIKE '%' || search_term || '%')
    AND (country_filter IS NULL OR a.country = country_filter)
    AND (state_filter   IS NULL OR a.state   = state_filter)
    AND (city_filter    IS NULL OR a.city    = city_filter);
END;
$$;

-- 3) DETALHE -----------------------------------------------------------------
DROP FUNCTION IF EXISTS core.get_place_details(uuid);
CREATE FUNCTION core.get_place_details(p_place_id uuid) RETURNS TABLE(
  id uuid, name text, description text, city text, state text, country text,
  approved boolean, is_active boolean, priority_level smallint,
  image_url text, created_at timestamptz, updated_at timestamptz,
  latitude double precision, longitude double precision,
  opening_hours jsonb, contact_phone text, website text,
  place_details jsonb, audio_descriptions jsonb
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
    a.opening_hours, a.contact_phone, a.website,
    to_jsonb(pd.*) AS place_details,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ad.id, 'language', ad.language, 'audio_url', ad.audio_url,
        'description', ad.description, 'name', ad.name, 'gender', ad.gender))
      FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id
    ), '[]'::jsonb) AS audio_descriptions
  FROM core.attractions a
  JOIN core.place_details pd ON pd.attraction_id = a.id
  LEFT JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  WHERE a.id = p_place_id AND a.entity_kind = 'place';
END;
$$;

-- 4) CRIAÇÃO ATÔMICA ---------------------------------------------------------
DROP FUNCTION IF EXISTS core.cms_create_place(text, text, text, text, double precision, double precision, text);
CREATE FUNCTION core.cms_create_place(
  p_name       text,
  p_city       text,
  p_country    text,
  p_state      text DEFAULT NULL,
  p_latitude   double precision DEFAULT NULL,
  p_longitude  double precision DEFAULT NULL,
  p_place_type text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
DECLARE
  v_attraction_id uuid;
  v_created_by uuid;
BEGIN
  IF NOT core.is_active_cms_editor_or_admin() THEN
    RAISE EXCEPTION 'not authorized to create places';
  END IF;

  SELECT id INTO v_created_by FROM core.cms_users WHERE email = auth.jwt() ->> 'email';

  INSERT INTO core.attractions (name, city, state, country, entity_kind, approved, is_active, created_by)
  VALUES (p_name, p_city, p_state, p_country, 'place', false, true, v_created_by)
  RETURNING id INTO v_attraction_id;

  INSERT INTO core.place_details (attraction_id, place_type, created_by)
  VALUES (v_attraction_id, p_place_type, v_created_by);

  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    INSERT INTO core.attraction_coordinate (attraction_id, latitude, longitude)
    VALUES (v_attraction_id, p_latitude, p_longitude);
  END IF;

  RETURN v_attraction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION core.cms_list_places(text, text, text, text, text, text, integer, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.cms_place_facets(text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.get_place_details(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.cms_create_place(text, text, text, text, double precision, double precision, text) TO authenticated, service_role;
