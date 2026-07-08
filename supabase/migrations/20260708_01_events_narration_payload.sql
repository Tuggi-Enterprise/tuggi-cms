-- ============================================================================
-- APP RPC — app_get_nearby_events: expor trigger_points + audio_descriptions
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ REVISAR no painel antes de aplicar em prod.
--
-- Objetivo: eventos passam a NARRAR no guia como POIs, dirigidos 100% pelo CMS.
-- O player nativo já toca qualquer trigger point com áudio; falta apenas o
-- app_get_nearby_events ENTREGAR o TP + áudio que o CMS autorou. Este patch
-- adiciona 2 colunas jsonb, copiando VERBATIM as 2 LATERAIS do read-model de POI
-- (core.app_poi_read_build, 20260622_app_read_model.sql:159-191):
--   • trigger_points   — core.attraction_trigger_points (entity-agnóstico)
--   • audio_descriptions — core.attraction_descriptions (áudio translate-only)
--
-- NÃO mexe no read-model de POI nem no retrofit entity_kind='poi' (20260706_01):
--   eventos continuam FORA de app_get_nearby_pois → sem marker nativo → sem duplo
--   (o app mantém o pin + EventDetailSheet do discover). Detection-only: o app
--   repassa esses TPs pro player nativo (setExternalEventTriggerPoints).
--
-- Mudar o RETURNS TABLE exige DROP+CREATE (não dá p/ CREATE OR REPLACE a assinatura).
-- Corpo idêntico ao git (20260706_04) + as 2 colunas/LATERAIS. app_get_nearby_events
-- é un-drifted (bate com git) → seguro reproduzir aqui.
-- ============================================================================

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
  id uuid, name text, description text, image_url text, poster_url text,
  city text, country text,
  latitude double precision, longitude double precision, distance_meters double precision,
  starts_at timestamptz, ends_at timestamptz, timezone text, all_day boolean,
  status text, event_category text, tags text[],
  is_free boolean, price_min numeric, price_max numeric, currency text,
  ticket_url text, organizer_name text,
  -- ✅ NOVO: payload de narração (vazio '[]' quando o evento não tem TP/áudio)
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
    COALESCE(tr.t_desc, a.description) AS description,
    a.image_url, ed.poster_url, a.city, a.country,
    ac.latitude, ac.longitude,
    ST_Distance(ac.location_geography, u) AS distance_meters,
    ed.starts_at, ed.ends_at, ed.timezone, ed.all_day,
    ed.status, ed.event_category, ed.tags,
    ed.is_free, ed.price_min, ed.price_max, ed.currency::text,
    ed.ticket_url, ed.organizer_name,
    -- ✅ NOVO: mesmas LATERAIS do app_poi_read_build (shape que o app já consome)
    COALESCE(tp.trigger_points, '[]'::jsonb)   AS trigger_points,
    COALESCE(aud.audio_descriptions, '[]'::jsonb) AS audio_descriptions
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
  -- ✅ NOVO: trigger points ativos do evento (VERBATIM de app_poi_read_build)
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
  -- ✅ NOVO: audio_descriptions do evento (VERBATIM de app_poi_read_build)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (rodar depois de autorar TP + áudio num evento de teste)
-- ─────────────────────────────────────────────────────────────────────────────
-- SET ROLE anon;
-- SELECT id, name, trigger_points, audio_descriptions
--   FROM core.app_get_nearby_events(<lat>, <lng>, 30);
--   → trigger_points/audio_descriptions NÃO-nulos p/ o evento equipado.
-- RESET ROLE;
-- E confirmar que o mesmo evento NÃO aparece em app_get_nearby_pois (retrofit ok).

-- ============================================================================
-- NOTA (áudio do evento — NENHUMA mudança de edge function necessária)
-- ============================================================================
-- A descrição do evento vive em core.attraction_descriptions (event_details.sql:
-- "Descrições multi-idioma + áudio vêm de attraction_descriptions"). cms_create_event
-- NÃO grava attractions.description. Logo o generate-translated-audio JÁ funciona:
-- getOriginalDescription lê a descrição do evento de attraction_descriptions e o
-- Gemini TRADUZ (não inventa) para cada idioma alvo (idempotente por
-- attraction_id+language+gender). Para um evento narrar, o fluxo é o mesmo do POI:
--   1) autorar a descrição do evento (row em attraction_descriptions);
--   2) generate-translated-audio por idioma de áudio (gera texto traduzido + audio_url);
--   3) autorar o trigger point (attraction_trigger_points).
-- ============================================================================
