-- ─────────────────────────────────────────────────────────────────────────────
-- 20260710_01 — RPC de refresh incremental do cliente (refetch autoritativo por-id)
--
-- CONTEXTO
-- O app é offline-first: uma vez cacheado no SQLite local, o conteúdo do POI
-- (texto, áudio, traduções, trigger points) congela até expirar (TTL 5d) ou ser
-- purgado. Precisamos revalidar sob demanda, sem abrir mão do offline-first.
--
-- O read-model core.app_poi_read é o SSOT:
--   • trigger_points — TODOS os TPs ativos do POI (conjunto A), pré-agregados.
--   • audio_descriptions — todas as línguas (com description_hash gerado = sha256
--     do texto; muda sse o texto/tradução muda).
--   • refreshed_at — bumpado pela dirty-queue (20260708_02) em QUALQUER mudança.
--
-- app_get_pois_by_ids expõe esse eixo ao cliente. Ele dirige DOIS gatilhos de
-- refresh no app (KISS — sem probe de frescor, sem comparação de timestamp):
--   • toggle do guide (nativo): refetch autoritativo do working-set → replace no
--     SQLite (remove TP apagado/movido) → limpa o cache em memória → reativação
--     reconstrói limpo.
--   • on-open (JS): refetch do POI aberto + invalidação de áudio por description_hash.
--
-- NOTA: uma versão anterior deste arquivo criava também core.app_get_poi_freshness
-- (um probe {id, refreshed_at}). O cliente NÃO o usa mais — o cone carimba
-- server_updated_at = now(), o que mascarava a comparação de frescor, então
-- passamos a refazer de forma incondicional. O DROP abaixo limpa prod.
--
-- DRIFT: objeto NET-NEW (não há patch em função existente) e SÓ LÊ core.app_poi_read
-- → risco de drift nulo. SECURITY DEFINER + search_path fixo p/ contornar a RLS
-- cara (mesmo padrão de app_get_pois_by_cone / app_get_nearby_pois).
-- ─────────────────────────────────────────────────────────────────────────────

-- Limpeza do probe morto (criado por uma versão anterior deste arquivo).
DROP FUNCTION IF EXISTS core.app_get_poi_freshness(uuid[]);

-- REFETCH AUTORITATIVO POR-ID -------------------------------------------------
-- Payload completo do read-model. Serve o refetch do working-set (guide toggle)
-- E o enrich on-open do single POI.
--
-- trigger_points: reemitido na MESMA shape (camelCase) de app_get_pois_by_cone,
-- porém o CONJUNTO A COMPLETO (sem filtro de cone/raio) — habilita o replace-all
-- autoritativo por poi_id no cache (remove TP apagado, move o que mudou, adiciona
-- novo). audio_descriptions passa direto do read-model (todas as línguas +
-- description_hash).
--
-- Filtro de entitlement (max_priority_level): um id pedido mas AUSENTE no
-- resultado significa "não mais elegível / removido" — o cliente pode evictar.
CREATE OR REPLACE FUNCTION core.app_get_pois_by_ids(
  p_ids uuid[],
  max_priority_level integer DEFAULT 3
)
RETURNS TABLE(
  id uuid, name text, description text, city text, country text,
  category text, type text,
  latitude double precision, longitude double precision,
  priority_level smallint, business_status text,
  schedule jsonb, has_boundary boolean, boundary_geojson text,
  has_audio boolean, audio_descriptions jsonb,
  trigger_points jsonb, refreshed_at timestamptz)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path TO 'core','public','extensions'
AS $$
  SELECT
    r.id, r.name, r.description, r.city, r.country,
    r.category, r.type,
    r.latitude, r.longitude,
    r.priority_level, r.business_status,
    r.schedule, r.has_boundary, r.boundary_geojson,
    r.has_audio, r.audio_descriptions,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',              tp->>'id',
        'attraction_id',   tp->>'attraction_id',
        'name',            tp->>'name',
        'latitude',        (tp->>'latitude')::float8,
        'longitude',       (tp->>'longitude')::float8,
        'radius',          (tp->>'radius')::int,
        'type',            tp->>'type',
        'priority',        (tp->>'priority')::int,
        'expectedBearing', (tp->>'expected_bearing')::float8,
        'isActive',        (tp->>'is_active')::boolean,
        'direction',       tp->>'direction',
        'access',          tp->>'access'
      ))
      FROM jsonb_array_elements(r.trigger_points) tp
    ), '[]'::jsonb) AS trigger_points,
    r.refreshed_at
  FROM core.app_poi_read r
  WHERE p_ids IS NOT NULL
    AND r.id = ANY(p_ids)
    AND r.priority_level <= COALESCE(max_priority_level, 3);
$$;
GRANT EXECUTE ON FUNCTION core.app_get_pois_by_ids(uuid[], integer)
  TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (rodar após aplicar):
--   SELECT id, jsonb_array_length(trigger_points) AS n_tp,
--          jsonb_array_length(audio_descriptions) AS n_lang, refreshed_at
--     FROM core.app_get_pois_by_ids(ARRAY(
--       SELECT id FROM core.app_poi_read LIMIT 5));
--   -- conjunto A: n_tp deve bater com o total de TPs ativos do POI:
--   SELECT attraction_id, count(*) FROM core.attraction_trigger_points
--     WHERE is_active GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
-- ─────────────────────────────────────────────────────────────────────────────
