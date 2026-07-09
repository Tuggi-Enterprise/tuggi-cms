-- ============================================================================
-- APP RPC — expor NOME ORIGINAL + IDIOMA DA DESCRIÇÃO dos eventos
-- ----------------------------------------------------------------------------
-- Contexto: app_get_nearby_events / app_get_event_details retornam `name` e
-- `description` JÁ LOCALIZADOS (COALESCE(attraction_descriptions.*, a.*)). O app
-- precisa de DOIS sinais que o COALESCE esconde:
--   • original_name       := a.name        → "nome traduzido + original (menor)"
--     (mesmo layout do POI single).
--   • description_language := tr.t_lang     → idioma REAL da descrição devolvida
--     (null = caiu no fallback a.description). Deixa o app detectar quando a
--     descrição NÃO está no idioma do user e disparar a tradução on-demand
--     (generate-description, que TRADUZ a fonte existente — nunca inventa p/
--     eventos, pois sempre há uma descrição autorada como fonte).
--
-- Muda a assinatura de retorno (novas colunas) → exige DROP + CREATE.
-- Nenhuma outra regra é alterada. Idempotente (DROP IF EXISTS).
-- ============================================================================

-- ── 1) LISTA (app_get_nearby_events) — payload de narração + original_name ────
DROP FUNCTION IF EXISTS core.app_get_nearby_events(
  double precision, double precision, double precision, integer, text, integer
);

CREATE FUNCTION core.app_get_nearby_events(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision DEFAULT 30,
  max_results integer DEFAULT 20,
  preferred_language text DEFAULT 'en',
  horizon_days integer DEFAULT 365
)
RETURNS TABLE(
  id uuid, name text, original_name text,
  description text, description_language text,
  image_url text, poster_url text, city text, country text,
  latitude double precision, longitude double precision, distance_meters double precision,
  starts_at timestamptz, ends_at timestamptz, timezone text, all_day boolean,
  status text, event_category text, tags text[],
  is_free boolean, price_min numeric, price_max numeric, currency text,
  ticket_url text, organizer_name text,
  trigger_points jsonb, audio_descriptions jsonb
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
    a.name                             AS original_name,
    COALESCE(tr.t_desc, a.description) AS description,
    tr.t_lang                          AS description_language,
    a.image_url, ed.poster_url, a.city, a.country,
    ac.latitude, ac.longitude,
    ST_Distance(ac.location_geography, u) AS distance_meters,
    ed.starts_at, ed.ends_at, ed.timezone, ed.all_day,
    ed.status, ed.event_category, ed.tags,
    ed.is_free, ed.price_min, ed.price_max, ed.currency::text,
    ed.ticket_url, ed.organizer_name,
    COALESCE(tp.trigger_points, '[]'::jsonb)   AS trigger_points,
    COALESCE(aud.audio_descriptions, '[]'::jsonb) AS audio_descriptions
  FROM core.attractions a
  JOIN core.event_details ed        ON ed.attraction_id = a.id
  JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  LEFT JOIN LATERAL (
    SELECT ad.name AS t_name, ad.description AS t_desc, ad.language AS t_lang
    FROM core.attraction_descriptions ad
    -- Match the BEST-AVAILABLE description in ANY language (not just
    -- target/base/en), so description_language reflects the REAL language of the
    -- returned text. Otherwise a pt-br-only event served to an en-us user would
    -- return description_language=null → the app couldn't tell it needs
    -- translating. Preference: exact > base > en > any-other.
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
        'id', t.id,
        'attraction_id', t.attraction_id,
        'name', COALESCE(t.name, 'Trigger Point'),
        'latitude', ST_Y(t.location::geometry),
        'longitude', ST_X(t.location::geometry),
        'radius', t.radius_meters,
        'type', t.type,
        'priority', t.priority,
        'expected_bearing', t.expected_bearing,
        'is_active', t.is_active,
        'direction', t.direction
      )) AS trigger_points
    FROM core.attraction_trigger_points t
    WHERE t.attraction_id = a.id AND t.is_active = true
  ) tp ON true
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

-- ── 2) DETALHE (app_get_event_details) — original_name p/ deep link/refresh ───
DROP FUNCTION IF EXISTS core.app_get_event_details(uuid, text);

CREATE FUNCTION core.app_get_event_details(
  p_event_id uuid,
  preferred_language text DEFAULT 'en'
)
RETURNS TABLE(
  id uuid, name text, original_name text,
  description text, description_language text,
  image_url text, poster_url text, city text, country text,
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
    a.name                             AS original_name,
    COALESCE(tr.t_desc, a.description) AS description,
    tr.t_lang                          AS description_language,
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
    SELECT ad.name AS t_name, ad.description AS t_desc, ad.language AS t_lang
    FROM core.attraction_descriptions ad
    -- Match the BEST-AVAILABLE description in ANY language (not just
    -- target/base/en), so description_language reflects the REAL language of the
    -- returned text. Otherwise a pt-br-only event served to an en-us user would
    -- return description_language=null → the app couldn't tell it needs
    -- translating. Preference: exact > base > en > any-other.
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
  WHERE a.id = p_event_id
    AND a.entity_kind = 'event'
    AND a.approved = true
    AND a.is_active = true;
END;
$$;
GRANT EXECUTE ON FUNCTION core.app_get_event_details(uuid,text)
  TO anon, authenticated, service_role;

-- ── VERIFICAÇÃO ──────────────────────────────────────────────────────────────
-- SET ROLE anon;
-- SELECT id, name, original_name FROM core.app_get_nearby_events(<lat>,<lng>,30);
--   → name = traduzido (idioma pedido), original_name = canônico (a.name).
-- RESET ROLE;
