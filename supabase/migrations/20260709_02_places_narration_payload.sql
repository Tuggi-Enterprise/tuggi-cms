-- ============================================================================
-- APP RPC — paridade dos PLACES com os eventos (narração + tradução)
-- ----------------------------------------------------------------------------
-- Places são core.attractions (entity_kind='place') com descrição em
-- attraction_descriptions — exatamente como os eventos. Para os places terem o
-- MESMO comportamento (card "Listen" + nome/descrição traduzidos on-demand),
-- o RPC precisa expor os mesmos sinais que o de eventos:
--   • original_name        := a.name          → "nome traduzido + original".
--   • description_language  := tr.t_lang       → idioma REAL da descrição (o app
--     detecta quando precisa traduzir). tr agora casa a MELHOR linha em QUALQUER
--     idioma (não só target/base/en) para o sinal ser confiável.
--   • audio_descriptions    := jsonb[]         → tracks de narração por idioma
--     (VERBATIM da LATERAL dos eventos); vazio '[]' quando não há áudio.
--
-- Muda a assinatura de retorno (novas colunas) → DROP + CREATE. Idempotente.
-- ============================================================================

-- ── 1) LISTA (app_get_nearby_places) ─────────────────────────────────────────
DROP FUNCTION IF EXISTS core.app_get_nearby_places(
  double precision, double precision, double precision, integer, text
);

CREATE FUNCTION core.app_get_nearby_places(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision DEFAULT 10,
  max_results integer DEFAULT 20,
  preferred_language text DEFAULT 'en'
)
RETURNS TABLE(
  id uuid, name text, original_name text,
  description text, description_language text,
  image_url text, city text, country text,
  latitude double precision, longitude double precision, distance_meters double precision,
  place_type text, cuisine text[], price_range smallint, tags text[],
  opening_hours jsonb, is_open_now boolean,
  contact_phone text, website text,
  is_tuggi_partner boolean, app_benefit text,
  reservation_url text, menu_url text,
  audio_descriptions jsonb
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
    a.name                             AS original_name,
    COALESCE(tr.t_desc, a.description) AS description,
    tr.t_lang                          AS description_language,
    a.image_url, a.city, a.country,
    ac.latitude, ac.longitude,
    ST_Distance(ac.location_geography, u) AS distance_meters,
    pd.place_type, pd.cuisine, pd.price_range, pd.tags,
    a.opening_hours,
    core.is_poi_open_now(a.opening_hours, now()) AS is_open_now,
    a.contact_phone, a.website,
    pd.is_tuggi_partner, pd.app_benefit,
    pd.reservation_url, pd.menu_url,
    COALESCE(aud.audio_descriptions, '[]'::jsonb) AS audio_descriptions
  FROM core.attractions a
  JOIN core.place_details pd         ON pd.attraction_id = a.id
  JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  LEFT JOIN LATERAL (
    SELECT ad.name AS t_name, ad.description AS t_desc, ad.language AS t_lang
    FROM core.attraction_descriptions ad
    WHERE ad.attraction_id = a.id
      AND ad.description IS NOT NULL
      AND ad.description <> '[PROCESSING]'
    ORDER BY
      CASE
        WHEN ad.language = lang THEN 1
        WHEN split_part(ad.language,'-',1) = split_part(lang,'-',1) THEN 2
        WHEN ad.language IN ('en','en-us') THEN 3
        ELSE 4
      END,
      ad.gender
    LIMIT 1
  ) tr ON true
  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(jsonb_build_object(
        'id', d.id,
        'language', d.language,
        'audio_url', d.audio_url,
        'description', d.description,
        'description_hash', d.description_hash
      ) ORDER BY CASE WHEN d.language='pt-br' THEN 1 WHEN d.language='pt' THEN 2 ELSE 3 END)
        FILTER (WHERE d.audio_url IS NOT NULL) AS audio_descriptions
    FROM core.attraction_descriptions d
    WHERE d.attraction_id = a.id
  ) aud ON true
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

-- ── 2) DETALHE (app_get_place_details) ───────────────────────────────────────
DROP FUNCTION IF EXISTS core.app_get_place_details(uuid, text);

CREATE FUNCTION core.app_get_place_details(
  p_place_id uuid,
  preferred_language text DEFAULT 'en'
)
RETURNS TABLE(
  id uuid, name text, original_name text,
  description text, description_language text,
  image_url text, city text, country text,
  latitude double precision, longitude double precision,
  place_type text, cuisine text[], price_range smallint, tags text[],
  opening_hours jsonb, is_open_now boolean,
  contact_phone text, website text,
  is_tuggi_partner boolean, app_benefit text,
  reservation_url text, menu_url text, delivery_url text, order_online_url text,
  accepts_reservations boolean,
  has_wifi boolean, has_outdoor_seating boolean, has_delivery boolean,
  has_takeaway boolean, serves_alcohol boolean,
  audio_descriptions jsonb
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
    a.name                             AS original_name,
    COALESCE(tr.t_desc, a.description) AS description,
    tr.t_lang                          AS description_language,
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
    pd.has_takeaway, pd.serves_alcohol,
    COALESCE(aud.audio_descriptions, '[]'::jsonb) AS audio_descriptions
  FROM core.attractions a
  JOIN core.place_details pd          ON pd.attraction_id = a.id
  LEFT JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  LEFT JOIN LATERAL (
    SELECT ad.name AS t_name, ad.description AS t_desc, ad.language AS t_lang
    FROM core.attraction_descriptions ad
    WHERE ad.attraction_id = a.id
      AND ad.description IS NOT NULL
      AND ad.description <> '[PROCESSING]'
    ORDER BY
      CASE
        WHEN ad.language = lang THEN 1
        WHEN split_part(ad.language,'-',1) = split_part(lang,'-',1) THEN 2
        WHEN ad.language IN ('en','en-us') THEN 3
        ELSE 4
      END,
      ad.gender
    LIMIT 1
  ) tr ON true
  LEFT JOIN LATERAL (
    SELECT
      jsonb_agg(jsonb_build_object(
        'id', d.id,
        'language', d.language,
        'audio_url', d.audio_url,
        'description', d.description,
        'description_hash', d.description_hash
      ) ORDER BY CASE WHEN d.language='pt-br' THEN 1 WHEN d.language='pt' THEN 2 ELSE 3 END)
        FILTER (WHERE d.audio_url IS NOT NULL) AS audio_descriptions
    FROM core.attraction_descriptions d
    WHERE d.attraction_id = a.id
  ) aud ON true
  WHERE a.id = p_place_id
    AND a.entity_kind = 'place'
    AND a.approved = true
    AND a.is_active = true;
END;
$$;
GRANT EXECUTE ON FUNCTION core.app_get_place_details(uuid,text)
  TO anon, authenticated, service_role;

-- ── VERIFICAÇÃO ──────────────────────────────────────────────────────────────
-- SET ROLE anon;
-- SELECT id, name, original_name, description_language, audio_descriptions
--   FROM core.app_get_nearby_places(-22.7566, -43.4630, 10);
-- RESET ROLE;
