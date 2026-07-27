-- ============================================================================
-- 20260727_02_app_get_nearby_events_venue — expor venue_attraction_id na RPC
-- ⚠️ APLICAR MANUAL NO PAINEL (SQL Editor). NUNCA via CLI.
--
-- Entrega 3 (final): o app precisa saber, ao disparar o TP do POI, se há um
-- evento vinculado ativo ali → tocar o áudio do evento em vez do POI. A RPC já
-- devolve os eventos + audio_descriptions + datas; falta SÓ o campo do vínculo.
--
-- Mudança 100% ADITIVA: acrescenta 1 coluna (venue_attraction_id) ao RETURNS
-- TABLE e ao SELECT. Nenhuma outra linha muda. Consumidores atuais do app leem
-- por NOME (JSON), então a coluna nova é ignorada por quem não a conhece — não
-- quebra nada do que já funciona.
--
-- Base: definição REAL em produção (pg_get_functiondef, 27/jul/2026), que é a
-- 20260709_01. Mudar o RETURNS TABLE exige DROP + CREATE.
-- ============================================================================

DROP FUNCTION IF EXISTS core.app_get_nearby_events(
  double precision, double precision, double precision, integer, text, integer
);

CREATE FUNCTION core.app_get_nearby_events(
  user_lat double precision,
  user_lng double precision,
  radius_km double precision DEFAULT 30,
  max_results integer DEFAULT 20,
  preferred_language text DEFAULT 'en'::text,
  horizon_days integer DEFAULT 365
)
RETURNS TABLE(
  id uuid, name text, original_name text,
  description text, description_language text,
  image_url text, poster_url text, city text, country text,
  latitude double precision, longitude double precision, distance_meters double precision,
  starts_at timestamp with time zone, ends_at timestamp with time zone, timezone text, all_day boolean,
  status text, event_category text, tags text[],
  is_free boolean, price_min numeric, price_max numeric, currency text,
  ticket_url text, organizer_name text,
  venue_attraction_id uuid,                      -- ✅ NOVO: POI anfitrião (NULL = autônomo)
  trigger_points jsonb, audio_descriptions jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $function$
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
    ed.venue_attraction_id,                       -- ✅ NOVO
    COALESCE(tp.trigger_points, '[]'::jsonb)   AS trigger_points,
    COALESCE(aud.audio_descriptions, '[]'::jsonb) AS audio_descriptions
  FROM core.attractions a
  JOIN core.event_details ed        ON ed.attraction_id = a.id
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
$function$;

-- Re-aplicar os grants originais (DROP+CREATE os remove).
GRANT EXECUTE ON FUNCTION core.app_get_nearby_events(
  double precision, double precision, double precision, integer, text, integer
) TO anon, authenticated, service_role;

-- VERIFICAÇÃO (painel):
--   SELECT id, name, venue_attraction_id
--   FROM core.app_get_nearby_events(-22.9, -43.2, 50, 20, 'pt-br', 365)
--   WHERE venue_attraction_id IS NOT NULL;   -- deve trazer a Festa da Padroeira
