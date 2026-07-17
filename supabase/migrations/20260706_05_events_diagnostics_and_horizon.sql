-- ============================================================================
-- EVENTOS — diagnóstico "por que não aparece" + horizonte 60→365 dias
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor).
--
-- Contexto: locais aparecem no app mas eventos não. Diferente de locais, a RPC de
-- eventos tem gates temporais/status. Este arquivo: (1) query de diagnóstico que
-- mostra QUAL gate falha por evento; (2) amplia o horizonte padrão de 60→365 dias
-- (60 dias escondia silenciosamente eventos futuros — UX ruim para descoberta).
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- (1) DIAGNÓSTICO — rode como service_role/owner (NÃO anon) e leia as colunas *_ok.
--     Qualquer coluna FALSE explica por que o evento some no app.
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT
--   a.name,
--   a.approved,
--   a.is_active,
--   (ac.attraction_id IS NOT NULL)                                   AS has_coordinate,
--   ed.status,
--   (ed.status IN ('scheduled','rescheduled','sold_out'))            AS status_ok,
--   ed.starts_at, ed.ends_at,
--   (COALESCE(ed.ends_at, ed.starts_at + interval '24 hours') >= now()) AS not_expired,
--   (ed.starts_at <= now() + interval '365 days')                    AS within_horizon
-- FROM core.attractions a
-- JOIN core.event_details ed        ON ed.attraction_id = a.id
-- LEFT JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
-- WHERE a.entity_kind = 'event'
-- ORDER BY a.created_at DESC;
--
-- Teste direto da RPC (troque lat/lng pela sua localização de teste):
-- SET ROLE anon;
-- SELECT id, name, distance_meters, starts_at
--   FROM core.app_get_nearby_events(-22.7566, -43.4630, 30);
-- RESET ROLE;
--
-- Causa mais comum: evento continua approved=false (locais foram aprovados, eventos
-- não). Aprovação só existe no modal de EDIÇÃO do CMS, não na criação.


-- ─────────────────────────────────────────────────────────────────────────────
-- (2) Horizonte 60→365 dias (recria só a função de nearby de eventos).
--     Mantém tudo igual à 20260706_04, exceto horizon_days DEFAULT 365.
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
  hzn  int  := COALESCE(horizon_days, 365);
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
