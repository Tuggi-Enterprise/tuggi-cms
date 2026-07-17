-- ============================================================================
-- APP RPCs — Eventos e Locais por proximidade (leitura anon-facing)
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ Rodar DEPOIS da 20260706_01 (retrofit) — senão eventos/locais aprovados
--    vazariam nas RPCs de POI.
--
-- Pré-requisitos: 01_entity_kind, 02_event_details, 03_place_details,
--                 20260706_03 (is_tuggi_partner, app_benefit).
--
-- Padrão canônico (espelha app_get_nearby_pois / get_nearby_custom_routes):
--   SECURITY DEFINER (a função É a fronteira de segurança; contorna a RLS que
--   bloqueia anon em event_details/place_details), STABLE, GRANT a anon.
-- RPCs SEPARADAS por entidade (sem payload monolítico): o app paraleliza no
--   consumidor (Promise.all) e cacheia cada uma independentemente.
--
-- Tradução (name/description): LEFT JOIN LATERAL em attraction_descriptions com
--   fallback idioma exato → prefixo → 'en' → canônico (a.name/a.description);
--   dedup de gênero via LIMIT 1. Reusa o motor de tradução dos POIs.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) EVENTOS por proximidade
--    Janela temporal: futuros + em andamento ("morre na data fim"), até horizon_days.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.app_get_nearby_events(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision DEFAULT 30,
  max_results integer DEFAULT 20,
  preferred_language text DEFAULT 'en',
  horizon_days integer DEFAULT 365
)
RETURNS TABLE(
  id uuid, name text, description text, image_url text, poster_url text,
  city text, country text,
  latitude double precision, longitude double precision, distance_meters double precision,
  starts_at timestamptz, ends_at timestamptz, timezone text, all_day boolean,
  status text, event_category text, tags text[],
  is_free boolean, price_min numeric, price_max numeric, currency text,
  ticket_url text, organizer_name text
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path TO 'core','public','extensions'
AS $$
DECLARE
  u    geography := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography;
  lang text := COALESCE(preferred_language, 'en');
  hzn  int  := COALESCE(horizon_days, 60);
  lim  int  := LEAST(GREATEST(COALESCE(max_results, 20), 1), 100);
BEGIN
  IF user_lat IS NULL OR user_lng IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    a.id,
    COALESCE(tr.t_name, a.name)        AS name,
    COALESCE(tr.t_desc, a.description) AS description,
    a.image_url, ed.poster_url, a.city, a.country,
    ac.latitude, ac.longitude,
    ST_Distance(ac.location_geography, u) AS distance_meters,
    ed.starts_at, ed.ends_at, ed.timezone, ed.all_day,
    ed.status, ed.event_category, ed.tags,
    ed.is_free, ed.price_min, ed.price_max, ed.currency::text,
    ed.ticket_url, ed.organizer_name
  FROM core.attractions a
  JOIN core.event_details ed        ON ed.attraction_id = a.id
  JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  LEFT JOIN LATERAL (
    SELECT ad.name AS t_name, ad.description AS t_desc
    FROM core.attraction_descriptions ad
    WHERE ad.attraction_id = a.id
      AND ( ad.language = lang
         OR split_part(ad.language,'-',1) = split_part(lang,'-',1)
         OR ad.language IN ('en','en-us') )
    ORDER BY
      CASE
        WHEN ad.language = lang THEN 1
        WHEN split_part(ad.language,'-',1) = split_part(lang,'-',1) THEN 2
        ELSE 3
      END,
      ad.gender
    LIMIT 1
  ) tr ON true
  WHERE a.entity_kind = 'event'
    AND a.approved = true
    AND a.is_active = true
    AND ed.status IN ('scheduled','rescheduled','sold_out')
    AND COALESCE(ed.ends_at, ed.starts_at + interval '24 hours') >= now()
    AND ed.starts_at <= now() + make_interval(days => hzn)
    AND ac.location_geography IS NOT NULL
    AND ST_DWithin(ac.location_geography, u, radius_km * 1000)
  ORDER BY ed.starts_at ASC, ST_Distance(ac.location_geography, u) ASC
  LIMIT lim;
END;
$$;
GRANT EXECUTE ON FUNCTION core.app_get_nearby_events(double precision,double precision,double precision,integer,text,integer)
  TO anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) DETALHE de 1 evento (deep link / refresh) — SEM filtro temporal
--    (precisa achar evento encerrado p/ mostrar "encerrado"); mantém approved+ativo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.app_get_event_details(
  p_event_id uuid,
  preferred_language text DEFAULT 'en'
)
RETURNS TABLE(
  id uuid, name text, description text, image_url text, poster_url text,
  city text, country text,
  latitude double precision, longitude double precision,
  starts_at timestamptz, ends_at timestamptz, timezone text, all_day boolean,
  status text, event_category text, tags text[],
  is_free boolean, price_min numeric, price_max numeric, currency text,
  ticket_url text, organizer_name text, organizer_url text, organizer_contact text,
  capacity integer, age_restriction text, rrule text, recurrence_end timestamptz,
  contact_phone text, website text
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path TO 'core','public','extensions'
AS $$
DECLARE lang text := COALESCE(preferred_language, 'en');
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    COALESCE(tr.t_name, a.name)        AS name,
    COALESCE(tr.t_desc, a.description) AS description,
    a.image_url, ed.poster_url, a.city, a.country,
    ac.latitude, ac.longitude,
    ed.starts_at, ed.ends_at, ed.timezone, ed.all_day,
    ed.status, ed.event_category, ed.tags,
    ed.is_free, ed.price_min, ed.price_max, ed.currency::text,
    ed.ticket_url, ed.organizer_name, ed.organizer_url, ed.organizer_contact,
    ed.capacity, ed.age_restriction, ed.rrule, ed.recurrence_end,
    a.contact_phone, a.website
  FROM core.attractions a
  JOIN core.event_details ed         ON ed.attraction_id = a.id
  LEFT JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  LEFT JOIN LATERAL (
    SELECT ad.name AS t_name, ad.description AS t_desc
    FROM core.attraction_descriptions ad
    WHERE ad.attraction_id = a.id
      AND ( ad.language = lang
         OR split_part(ad.language,'-',1) = split_part(lang,'-',1)
         OR ad.language IN ('en','en-us') )
    ORDER BY
      CASE
        WHEN ad.language = lang THEN 1
        WHEN split_part(ad.language,'-',1) = split_part(lang,'-',1) THEN 2
        ELSE 3
      END,
      ad.gender
    LIMIT 1
  ) tr ON true
  WHERE a.id = p_event_id
    AND a.entity_kind = 'event'
    AND a.approved = true
    AND a.is_active = true;
END;
$$;
GRANT EXECUTE ON FUNCTION core.app_get_event_details(uuid,text)
  TO anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) LOCAIS por proximidade
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.app_get_nearby_places(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision DEFAULT 10,
  max_results integer DEFAULT 20,
  preferred_language text DEFAULT 'en'
)
RETURNS TABLE(
  id uuid, name text, description text, image_url text,
  city text, country text,
  latitude double precision, longitude double precision, distance_meters double precision,
  place_type text, cuisine text[], price_range smallint, tags text[],
  opening_hours jsonb, is_open_now boolean,
  contact_phone text, website text,
  is_tuggi_partner boolean, app_benefit text,
  reservation_url text, menu_url text
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path TO 'core','public','extensions'
AS $$
DECLARE
  u    geography := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography;
  lang text := COALESCE(preferred_language, 'en');
  lim  int  := LEAST(GREATEST(COALESCE(max_results, 20), 1), 100);
BEGIN
  IF user_lat IS NULL OR user_lng IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    a.id,
    COALESCE(tr.t_name, a.name)        AS name,
    COALESCE(tr.t_desc, a.description) AS description,
    a.image_url, a.city, a.country,
    ac.latitude, ac.longitude,
    ST_Distance(ac.location_geography, u) AS distance_meters,
    pd.place_type, pd.cuisine, pd.price_range, pd.tags,
    a.opening_hours,
    core.is_poi_open_now(a.opening_hours, now()) AS is_open_now,
    a.contact_phone, a.website,
    pd.is_tuggi_partner, pd.app_benefit,
    pd.reservation_url, pd.menu_url
  FROM core.attractions a
  JOIN core.place_details pd         ON pd.attraction_id = a.id
  JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  LEFT JOIN LATERAL (
    SELECT ad.name AS t_name, ad.description AS t_desc
    FROM core.attraction_descriptions ad
    WHERE ad.attraction_id = a.id
      AND ( ad.language = lang
         OR split_part(ad.language,'-',1) = split_part(lang,'-',1)
         OR ad.language IN ('en','en-us') )
    ORDER BY
      CASE
        WHEN ad.language = lang THEN 1
        WHEN split_part(ad.language,'-',1) = split_part(lang,'-',1) THEN 2
        ELSE 3
      END,
      ad.gender
    LIMIT 1
  ) tr ON true
  WHERE a.entity_kind = 'place'
    AND a.approved = true
    AND a.is_active = true
    AND ac.location_geography IS NOT NULL
    AND ST_DWithin(ac.location_geography, u, radius_km * 1000)
  ORDER BY ST_Distance(ac.location_geography, u) ASC
  LIMIT lim;
END;
$$;
GRANT EXECUTE ON FUNCTION core.app_get_nearby_places(double precision,double precision,double precision,integer,text)
  TO anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) DETALHE de 1 local (deep link / refresh)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.app_get_place_details(
  p_place_id uuid,
  preferred_language text DEFAULT 'en'
)
RETURNS TABLE(
  id uuid, name text, description text, image_url text,
  city text, country text,
  latitude double precision, longitude double precision,
  place_type text, cuisine text[], price_range smallint, tags text[],
  opening_hours jsonb, is_open_now boolean,
  contact_phone text, website text,
  is_tuggi_partner boolean, app_benefit text,
  reservation_url text, menu_url text, delivery_url text, order_online_url text,
  accepts_reservations boolean,
  has_wifi boolean, has_outdoor_seating boolean, has_delivery boolean,
  has_takeaway boolean, serves_alcohol boolean
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path TO 'core','public','extensions'
AS $$
DECLARE lang text := COALESCE(preferred_language, 'en');
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    COALESCE(tr.t_name, a.name)        AS name,
    COALESCE(tr.t_desc, a.description) AS description,
    a.image_url, a.city, a.country,
    ac.latitude, ac.longitude,
    pd.place_type, pd.cuisine, pd.price_range, pd.tags,
    a.opening_hours,
    core.is_poi_open_now(a.opening_hours, now()) AS is_open_now,
    a.contact_phone, a.website,
    pd.is_tuggi_partner, pd.app_benefit,
    pd.reservation_url, pd.menu_url, pd.delivery_url, pd.order_online_url,
    pd.accepts_reservations,
    pd.has_wifi, pd.has_outdoor_seating, pd.has_delivery,
    pd.has_takeaway, pd.serves_alcohol
  FROM core.attractions a
  JOIN core.place_details pd          ON pd.attraction_id = a.id
  LEFT JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  LEFT JOIN LATERAL (
    SELECT ad.name AS t_name, ad.description AS t_desc
    FROM core.attraction_descriptions ad
    WHERE ad.attraction_id = a.id
      AND ( ad.language = lang
         OR split_part(ad.language,'-',1) = split_part(lang,'-',1)
         OR ad.language IN ('en','en-us') )
    ORDER BY
      CASE
        WHEN ad.language = lang THEN 1
        WHEN split_part(ad.language,'-',1) = split_part(lang,'-',1) THEN 2
        ELSE 3
      END,
      ad.gender
    LIMIT 1
  ) tr ON true
  WHERE a.id = p_place_id
    AND a.entity_kind = 'place'
    AND a.approved = true
    AND a.is_active = true;
END;
$$;
GRANT EXECUTE ON FUNCTION core.app_get_place_details(uuid,text)
  TO anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (painel; rodar como anon)
-- ─────────────────────────────────────────────────────────────────────────────
-- SET ROLE anon;
-- SELECT id, name, distance_meters, starts_at FROM core.app_get_nearby_events(-22.7566,-43.4630, 30);
-- SELECT id, name, distance_meters, is_open_now, is_tuggi_partner FROM core.app_get_nearby_places(-22.7566,-43.4630, 10);
-- SELECT * FROM core.app_get_event_details('<uuid>', 'pt-br');
-- SELECT * FROM core.app_get_place_details('<uuid>', 'pt-br');
-- RESET ROLE;
-- Checar: evento com ends_at no passado NÃO aparece no nearby; aparece no details.
