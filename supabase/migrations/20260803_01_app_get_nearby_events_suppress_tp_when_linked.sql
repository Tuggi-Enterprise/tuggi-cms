-- ============================================================================
-- 20260803_01 — app_get_nearby_events: suprimir trigger_points de evento vinculado
-- ⚠️ APLICAR MANUAL NO PAINEL (SQL Editor). NUNCA via CLI (regra do projeto).
--
-- POR QUE, se a 20260727_01 já desativa os TPs no vínculo?
-- O gatilho `event_venue_deactivate_tps` dispara em INSERT/UPDATE OF
-- venue_attraction_id — ou seja, UMA vez, no momento do vínculo. Nada impede
-- que um TP seja criado (ou reativado) DEPOIS, num evento que já tem anfitrião:
-- não existe gatilho em core.attraction_trigger_points que olhe o vínculo
-- (verificado em produção, 2026-08-03: os 6 triggers da tabela são dirty-queue,
-- updated_at, status e learning — nenhum consulta event_details).
-- Nesse caso o app volta a receber trigger_points do evento E do POI anfitrião,
-- que é exatamente a narração dupla que o PEDIDO_BACKEND_EVENTOS.md §2(b) manda
-- impedir NO BANCO.
--
-- Esta migration põe a regra no ponto de leitura, que é onde ela é verdadeira
-- para todo estado possível da tabela — o gatilho de 27/jul vira redundância
-- barata (cinto + suspensório), não a única defesa.
--
-- NÃO muda a assinatura (RETURNS TABLE idêntico) → CREATE OR REPLACE, sem
-- DROP e sem perder grants. Corpo idêntico ao de produção exceto UMA projeção.
--
-- Custo: nenhum. `ed.venue_attraction_id` já está no FROM (join de event_details),
-- o CASE é avaliado por linha já materializada, e o LATERAL de trigger_points
-- continua rodando igual (Postgres não poda LATERAL por CASE) — o plano não muda.
-- ============================================================================

-- ── UP ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.app_get_nearby_events(
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
  venue_attraction_id uuid,
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
    ed.venue_attraction_id,
    -- ✅ ÚNICA MUDANÇA: evento com anfitrião nunca entrega TP próprio.
    -- Quem dispara é o TP do POI; o app escolhe o áudio pela janela de datas.
    CASE
      WHEN ed.venue_attraction_id IS NOT NULL THEN '[]'::jsonb
      ELSE COALESCE(tp.trigger_points, '[]'::jsonb)
    END                                           AS trigger_points,
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

-- Grants: CREATE OR REPLACE preserva os existentes (anon, authenticated,
-- service_role — conferidos em produção). Reafirmados por idempotência.
GRANT EXECUTE ON FUNCTION core.app_get_nearby_events(
  double precision, double precision, double precision, integer, text, integer
) TO anon, authenticated, service_role;

-- ── VERIFICAÇÃO (painel, depois de aplicar) ─────────────────────────────────
--   -- 1) o vínculo existente continua sem TP (já era 0 pelo gatilho):
--   SELECT id, name, venue_attraction_id, jsonb_array_length(trigger_points) AS n_tp
--   FROM core.app_get_nearby_events(-21.13, -47.75, 200, 50, 'pt-br', 365)
--   WHERE venue_attraction_id IS NOT NULL;      -- n_tp = 0
--
--   -- 2) o caso que o gatilho NÃO cobria — TP criado depois do vínculo.
--   --    Reative o TP existente da Festa da Padroeira e confira que a RPC
--   --    continua devolvendo [] (antes desta migration, devolveria 1):
--   UPDATE core.attraction_trigger_points SET is_active = true
--    WHERE attraction_id = 'f6c5e31a-8a1f-4d92-8aa7-f5996f4169b7';
--   -- rode a query (1) de novo → n_tp deve continuar 0
--   UPDATE core.attraction_trigger_points SET is_active = false
--    WHERE attraction_id = 'f6c5e31a-8a1f-4d92-8aa7-f5996f4169b7';   -- desfaz
--
--   -- 3) não-regressão: evento autônomo continua entregando seus TPs:
--   SELECT count(*) FILTER (WHERE jsonb_array_length(trigger_points) > 0)
--   FROM core.app_get_nearby_events(-21.13, -47.75, 200, 50, 'pt-br', 365)
--   WHERE venue_attraction_id IS NULL;

-- ── DOWN ─────────────────────────────────────────────────────────────────────
-- Restaura a projeção sem o CASE (estado de produção em 2026-08-03, vindo da
-- 20260727_02). Mesma assinatura → CREATE OR REPLACE, sem DROP, sem perda de
-- grants. Basta trocar a projeção de trigger_points de volta para:
--
--   COALESCE(tp.trigger_points, '[]'::jsonb) AS trigger_points,
--
-- e reaplicar o corpo acima sem alterações. O arquivo íntegro do estado anterior
-- está em supabase/migrations/20260727_02_app_get_nearby_events_venue.sql —
-- executá-lo na íntegra é o rollback completo (ele faz DROP+CREATE e re-GRANT).
-- ============================================================================
