-- ============================================================================
-- App read-model — core.app_poi_read + funções app_* (CQRS / isolamento)
-- ============================================================================
-- ⚠️ RODAR MANUALMENTE no painel SQL do Supabase, EM STAGING PRIMEIRO.
--    O bloco de cron/populate inicial e os índices podem ser pesados — ver notas.
--    VALIDAR (checklist no fim) que app_* devolve o MESMO shape que as funções
--    originais antes de repontar o app.
--
-- PORQUÊ (provado por EXPLAIN ANALYZE BUFFERS):
--   get_nearby_pois_complete quente = ~75ms tocando ~7040 buffers (~55MB) p/ 50
--   POIs; o cone toca ~3370. A frio esses buffers viram leitura aleatória de
--   disco → statement_timeout (57014) intermitente. Causa = agregação pesada por
--   request (jsonb_agg de TPs sobre 12,8M de attraction_trigger_points, LATERAL
--   de áudio, ST_AsGeoJSON) + joins, sobre tabelas write-heavy.
--
-- SOLUÇÃO: read-model denormalizado, ESTÁTICO entre updates (⇒ ~100% all-visible
--   ⇒ sem heap thrash), GiST-indexado, filtrado ao visível ao app. As funções
--   app_* viram SELECT fino → o working set cai ~10-50x e o frio também fica ms.
--   Mantido por UPSERT incremental por updated_at via pg_cron (Supabase-native;
--   NÃO pg_ivm). Conteúdo curado (POI/TP/áudio) tolera atraso de minutos; o
--   tempo-real (GPS, matching de gatilho no nativo) NÃO passa por aqui.
--
-- ISOLAMENTO (Req 1): o app passa a chamar SÓ app_* / app_poi_read; o CMS escreve
--   as tabelas-fonte; mudança de schema no CMS só atinge o app via a projeção.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TABELA read-model (uma linha por POI visível ao app)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.app_poi_read (
  id                  uuid PRIMARY KEY,
  name                text,
  description         text,
  city                text,
  country             text,
  category            text,
  type                text,
  latitude            double precision,     -- centroide
  longitude           double precision,
  centroid_geog       geography(Point,4326),-- p/ distância exata ao centroide
  -- match_geog = centroide ∪ TODOS os TPs ativos (MultiPoint). Um único
  -- ST_DWithin(match_geog, user, r) reproduz o "centroide-no-raio ∪ tem-TP-no-raio"
  -- do original (resolve POI distribuído tipo Pão de Açúcar) sem UNION nem scan
  -- dos 12,8M no request.
  match_geog          geography,
  priority_level      smallint,
  business_status     text,
  schedule            jsonb,
  has_boundary        boolean,
  boundary_area_m2    double precision,
  boundary_geojson    text,                 -- ST_AsGeoJSON pré-computado
  has_audio           boolean,
  audio_descriptions  jsonb,                -- todas as línguas (escalar resolvido no request)
  trigger_points      jsonb,                -- TODOS os TPs ativos do POI, pré-agregados
  refreshed_at        timestamptz DEFAULT now()
);

-- Índices (segmentam por localização; não olham o banco todo)
-- EXPLORAR (app_get_nearby_pois): busca por CENTROIDE do POI. Point ⇒ bbox
-- minúsculo ⇒ zero falso-positivo no índice ⇒ ST_DWithin desce a R-tree até a
-- janela ~5km e devolve só os candidatos reais.
CREATE INDEX IF NOT EXISTS idx_app_poi_read_centroid_gist
  ON core.app_poi_read USING gist (centroid_geog);
-- GUIDE/cone (app_get_pois_by_cone): casa por match_geog (centroide ∪ TODOS os
-- TPs ativos) p/ pegar POI distribuído por um TP próximo. Mantido só p/ o cone.
CREATE INDEX IF NOT EXISTS idx_app_poi_read_match_gist
  ON core.app_poi_read USING gist (match_geog);
-- Parcial p/ o 1º anel/tier (priority 1 = "Padrão Tuggi") — instantâneo.
CREATE INDEX IF NOT EXISTS idx_app_poi_read_match_gist_p1
  ON core.app_poi_read USING gist (match_geog) WHERE priority_level = 1;
CREATE INDEX IF NOT EXISTS idx_app_poi_read_priority
  ON core.app_poi_read (priority_level);

GRANT SELECT ON core.app_poi_read TO anon, authenticated, service_role;

-- Watermark do refresh incremental
CREATE TABLE IF NOT EXISTS core.app_poi_read_state (
  id       smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- ⚠️ Start at now(), NOT -infinity. With -infinity the first cron run treats
  -- ALL ~1.3M POIs as "dirty" and tries a full rebuild (heavy aggregation over
  -- 12.8M trigger points) every 2 min → 100% IOwait. The cron must only ever do
  -- DELTAS; the initial backfill is the explicit refresh_app_poi_read(true) below.
  last_run timestamptz NOT NULL DEFAULT now()
);
INSERT INTO core.app_poi_read_state (id) VALUES (1, now())
  ON CONFLICT (id) DO NOTHING;

-- Índices de updated_at p/ o delta ser barato (range scan dos recém-mudados).
-- ⚠️ RODAR ANTES, SEPARADAMENTE, via psql/conexão direta com CONCURRENTLY (NÃO no
--    editor — CONCURRENTLY não roda em transação) — são tabelas write-heavy e o de
--    attraction_trigger_points (12,8M) travaria escrita se não-concorrente.
--    Habilitar o cron (passo 3) SÓ depois que estes existirem.
--
--    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attractions_updated_at
--      ON core.attractions (updated_at);
--    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attraction_coordinate_updated_at
--      ON core.attraction_coordinate (updated_at);
--    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_atp_touched_at
--      ON core.attraction_trigger_points (COALESCE(updated_at, created_at));
--    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_addesc_touched_at
--      ON core.attraction_descriptions (COALESCE(updated_at, created_at));


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CONSTRUTOR de linhas: (re)constrói app_poi_read p/ um conjunto de POIs.
--    Visível = approved AND show_in_map AND tem coordenada. Quem deixou de ser
--    visível é REMOVIDO. p_ids = NULL ⇒ full rebuild.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.app_poi_read_build(p_ids uuid[] DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core','public','extensions'
AS $$
BEGIN
  -- Remove os que não estão (mais) visíveis (no escopo de p_ids, ou em tudo no full).
  DELETE FROM core.app_poi_read r
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
    AND NOT EXISTS (
      SELECT 1
      FROM core.attractions a
      JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
      WHERE a.id = r.id
        AND a.approved = true
        AND COALESCE(ac.show_in_map, true) = true
        AND ac.location_geography IS NOT NULL
    );

  -- Upsert dos visíveis.
  INSERT INTO core.app_poi_read AS r (
    id, name, description, city, country, category, type,
    latitude, longitude, centroid_geog, match_geog, priority_level,
    business_status, schedule, has_boundary, boundary_area_m2, boundary_geojson,
    has_audio, audio_descriptions, trigger_points, refreshed_at
  )
  SELECT
    a.id, a.name, a.description, a.city, a.country,
    a.category::text, a.type::text,
    ac.latitude, ac.longitude,
    ac.location_geography AS centroid_geog,
    CASE
      WHEN tp.tp_collect IS NULL THEN ac.location_geography
      ELSE ST_Collect(ac.location_geography::geometry, tp.tp_collect)::geography
    END AS match_geog,
    a.priority_level,
    a.business_status,
    COALESCE(a.schedule, '[]'::jsonb) AS schedule,
    (ac.boundary_geometry IS NOT NULL) AS has_boundary,
    ac.boundary_area_m2::double precision,
    CASE WHEN ac.boundary_geometry IS NOT NULL
         THEN ST_AsGeoJSON(ac.boundary_geometry::geometry)::text END AS boundary_geojson,
    COALESCE(aud.has_audio, false) AS has_audio,
    COALESCE(aud.audio_descriptions, '[]'::jsonb) AS audio_descriptions,
    COALESCE(tp.trigger_points, '[]'::jsonb) AS trigger_points,
    now()
  FROM core.attractions a
  JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  LEFT JOIN LATERAL (
    SELECT
      ST_Collect(t.location::geometry) AS tp_collect,
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
      bool_or(d.audio_url IS NOT NULL) AS has_audio,
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
  WHERE a.approved = true
    AND COALESCE(ac.show_in_map, true) = true
    AND ac.location_geography IS NOT NULL
    AND (p_ids IS NULL OR a.id = ANY(p_ids))
  ON CONFLICT (id) DO UPDATE SET
    name=EXCLUDED.name, description=EXCLUDED.description, city=EXCLUDED.city,
    country=EXCLUDED.country, category=EXCLUDED.category, type=EXCLUDED.type,
    latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
    centroid_geog=EXCLUDED.centroid_geog, match_geog=EXCLUDED.match_geog,
    priority_level=EXCLUDED.priority_level, business_status=EXCLUDED.business_status,
    schedule=EXCLUDED.schedule, has_boundary=EXCLUDED.has_boundary,
    boundary_area_m2=EXCLUDED.boundary_area_m2, boundary_geojson=EXCLUDED.boundary_geojson,
    has_audio=EXCLUDED.has_audio, audio_descriptions=EXCLUDED.audio_descriptions,
    trigger_points=EXCLUDED.trigger_points, refreshed_at=now();
END;
$$;
GRANT EXECUTE ON FUNCTION core.app_poi_read_build(uuid[]) TO service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. REFRESH incremental (delta por updated_at) — chamado pelo cron.
--    p_full = true ⇒ rebuild total (populate inicial / manutenção manual).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.refresh_app_poi_read(p_full boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core','public','extensions'
AS $$
DECLARE
  v_w     timestamptz;
  -- margem de 5s: o próximo run reprocessa uma janelinha (upsert idempotente) p/
  -- não perder linhas comitadas em corrida com o scan do delta.
  v_now   timestamptz := now() - interval '5 seconds';
  v_ids   uuid[];
BEGIN
  IF p_full THEN
    PERFORM core.app_poi_read_build(NULL);
    -- ✅ Refresh planner stats so app_get_nearby_pois uses the GiST/KNN index
    -- instead of seq-scanning the freshly-(re)built table (stale reltuples after
    -- a bulk load → seq scan → 57014). ANALYZE is transaction-safe (unlike VACUUM).
    ANALYZE core.app_poi_read;
    UPDATE core.app_poi_read_state SET last_run = v_now WHERE id = 1;
    RETURN;
  END IF;

  SELECT last_run INTO v_w FROM core.app_poi_read_state WHERE id = 1;

  -- POIs "sujos" desde o watermark (união dos 4 updated_at; COALESCE p/ nulos;
  -- TP é timestamp WITHOUT tz → comparar em UTC naive).
  SELECT array_agg(DISTINCT aid) INTO v_ids FROM (
    SELECT a.id AS aid FROM core.attractions a WHERE a.updated_at > v_w
    UNION
    SELECT ac.attraction_id FROM core.attraction_coordinate ac WHERE ac.updated_at > v_w
    UNION
    SELECT t.attraction_id FROM core.attraction_trigger_points t
      WHERE COALESCE(t.updated_at, t.created_at) > (v_w AT TIME ZONE 'UTC')
    UNION
    SELECT d.attraction_id FROM core.attraction_descriptions d
      WHERE COALESCE(d.updated_at, d.created_at) > v_w
  ) s;

  IF v_ids IS NOT NULL AND array_length(v_ids, 1) > 0 THEN
    PERFORM core.app_poi_read_build(v_ids);
  END IF;

  UPDATE core.app_poi_read_state SET last_run = v_now WHERE id = 1;
END;
$$;
GRANT EXECUTE ON FUNCTION core.refresh_app_poi_read(boolean) TO service_role;

-- ⚠️⚠️ ORDEM OBRIGATÓRIA (não inverter — senão o cron põe o banco a 100% IOwait):
--   1) Criar os 4 índices de updated_at (bloco no topo) — o delta do cron os usa.
--   2) POPULATE INICIAL (full, pesado, UMA vez; via conexão direta se estourar o
--      timeout do editor). Já roda ANALYZE e seta o watermark p/ now():
--        SELECT core.refresh_app_poi_read(true);
--   3) SÓ ENTÃO agendar o cron incremental (delta barato, idempotente).
--      Cadência: a ativação de POIs é em LOTE/esporádica (não muda a cada 2 min),
--      então 30 min é suficiente e reduz ruído. O custo de um run é o DELTA, não a
--      cadência — com watermark são + índices, cada run só toca o que mudou.
--        SELECT cron.schedule('refresh-app-poi-read', '*/30 * * * *',
--                             $$ SELECT core.refresh_app_poi_read(false); $$);
-- NUNCA agendar o cron com o watermark em -infinity / sem os índices: cada run
-- vira um full-rebuild (agregação sobre 12,8M TPs) — foi isso (não a cadência) que
-- pôs o banco a 100% IOwait.


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. app_get_nearby_pois — mesmo shape de get_nearby_pois_complete, lendo a MV.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.app_get_nearby_pois(
  user_lat double precision, user_lng double precision,
  radius_km double precision DEFAULT 3,
  min_radius_km double precision DEFAULT 0,           -- p/ anéis (Fase 3)
  max_results integer DEFAULT 50,
  preferred_language text DEFAULT NULL,
  max_priority_level integer DEFAULT 3
)
RETURNS TABLE(
  id uuid, name text, description text, city text, country text, category text,
  type text, latitude double precision, longitude double precision,
  distance_meters double precision, has_audio boolean, audio_descriptions jsonb,
  audio_url text, audio_language text, audio_duration integer,
  audio_description_id uuid, trigger_radius integer, trigger_type text,
  has_boundary boolean, boundary_area_m2 double precision, business_status text,
  boundary_geojson text, schedule jsonb, trigger_points jsonb, priority_level smallint)
LANGUAGE plpgsql STABLE
SECURITY DEFINER                       -- contorna a RLS cara de app_poi_read (POI é dado público; a função É a fronteira de segurança)
SET search_path TO 'core','public','extensions'
AS $$
DECLARE
  u geography := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography;
  lvl int := COALESCE(max_priority_level, 3);
BEGIN
  IF lvl < 1 OR lvl > 3 THEN lvl := 3; END IF;

  -- ── EXPLORAR = busca por POI, payload ENXUTO (só o que pinta o marcador). ──
  -- NÃO traz trigger_points / audio_descriptions / boundary_geojson / schedule:
  -- esses são pesados (TOAST/LATERAL) e custam ~855ms até p/ 4 POIs, sem pintar
  -- nada no mapa. TP/áudio/boundary vêm SÓ onde fazem sentido: cone (guide ativo)
  -- e app_get_poi_details (tap no POI). Match por CENTROIDE do POI (não match_geog
  -- = centroide∪TPs — isso é lógica de TP vazando p/ o explorar).
  -- Só o que pinta o marcador: id, nome, lat/long, categoria, priority (+ distância
  -- p/ ordenar e has_audio p/ o ícone — ambos de graça). Todo o resto = NULL.
  -- description/city/country/boundary/schedule/áudio/TP vêm no detalhe (tap) ou no
  -- cone (guide). description é text e pode TOAST → fica fora do explorar também.
  RETURN QUERY
  SELECT
    r.id, r.name,
    NULL::text     AS description,
    NULL::text     AS city,
    NULL::text     AS country,
    r.category,
    NULL::text     AS type,
    r.latitude, r.longitude,
    ST_Distance(r.centroid_geog, u) AS distance_meters,
    r.has_audio,
    NULL::jsonb    AS audio_descriptions,
    NULL::text     AS audio_url,
    NULL::text     AS audio_language,
    NULL::integer  AS audio_duration,
    NULL::uuid     AS audio_description_id,
    30 AS trigger_radius,
    CASE WHEN r.category = 'geofence' THEN 'geofence' ELSE 'circle' END::text AS trigger_type,
    NULL::boolean          AS has_boundary,
    NULL::double precision AS boundary_area_m2,
    NULL::text             AS business_status,
    NULL::text     AS boundary_geojson,
    NULL::jsonb    AS schedule,
    NULL::jsonb    AS trigger_points,
    r.priority_level
  FROM core.app_poi_read r
  WHERE r.priority_level <= lvl
    AND ST_DWithin(r.centroid_geog, u, radius_km * 1000)
    AND (min_radius_km <= 0 OR ST_Distance(r.centroid_geog, u) >= min_radius_km * 1000)
  -- Busca por raio LIMITADO: ST_DWithin (GiST no centroide) limita a varredura à
  -- janela; ST_Distance ordena esse conjunto pequeno. SEM o KNN <-> (que varreria
  -- o índice inteiro p/ encher o LIMIT quando o filtro é esparso → 57014).
  ORDER BY ST_Distance(r.centroid_geog, u)
  LIMIT max_results;
END;
$$;
GRANT EXECUTE ON FUNCTION core.app_get_nearby_pois(double precision,double precision,double precision,double precision,integer,text,integer)
  TO anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. app_get_pois_by_cone — mesmo shape de get_pois_by_cone_triggers, lendo a MV.
--    Candidatos por match_geog (GiST), depois teste de cone por-TP expandindo o
--    trigger_points jsonb (sobre o conjunto pequeno de candidatos).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.app_get_pois_by_cone(
  user_lat double precision, user_lng double precision,
  radius_km double precision DEFAULT 2.0,
  heading double precision DEFAULT NULL,
  angle_width double precision DEFAULT 90.0,
  target_language text DEFAULT 'pt-br',
  max_priority_level integer DEFAULT 3
)
RETURNS TABLE(
  id uuid, name text, latitude double precision, longitude double precision,
  type text, trigger_radius integer, trigger_priority integer,
  trigger_points jsonb, audio_descriptions jsonb, schedule jsonb,
  schedule_exceptions jsonb, is_active boolean, distance_meters double precision,
  in_cone boolean, priority_level smallint)
LANGUAGE plpgsql STABLE
SECURITY DEFINER                       -- contorna a RLS cara de app_poi_read (chamado contínuo no guide; não pode tomar timeout)
SET search_path TO 'core','public','extensions'
AS $$
DECLARE
  u geography := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography;
  v_head double precision := heading;
  v_ang  double precision := angle_width;
  lvl int := COALESCE(max_priority_level, 3);
BEGIN
  IF user_lat IS NULL OR user_lng IS NULL THEN RETURN; END IF;
  IF radius_km IS NULL OR radius_km <= 0 THEN radius_km := 2.0;
  ELSIF radius_km > 50 THEN radius_km := 50.0; END IF;
  IF v_ang IS NULL OR v_ang <= 0 THEN v_ang := 90.0;
  ELSIF v_ang > 360 THEN v_ang := 360.0; END IF;
  IF v_head IS NOT NULL AND (v_head < 0 OR v_head > 360) THEN v_head := NULL; END IF;
  IF lvl < 1 OR lvl > 3 THEN lvl := 3; END IF;

  RETURN QUERY
  WITH cand AS (   -- POIs com algum ponto no raio (GiST)
    SELECT r.*
    FROM core.app_poi_read r
    WHERE r.priority_level <= lvl
      AND ST_DWithin(r.match_geog, u, radius_km * 1000)
  ),
  tps AS (         -- expande os TPs ativos e aplica raio + cone por-TP
    SELECT c.id AS poi_id, c.name, c.latitude, c.longitude, c.type,
           c.schedule, c.audio_descriptions, c.priority_level,
           tp AS tp_obj,
           ST_Distance(
             ST_SetSRID(ST_MakePoint((tp->>'longitude')::float8, (tp->>'latitude')::float8),4326)::geography, u
           ) AS dist,
           CASE
             WHEN v_head IS NULL THEN true
             ELSE (
               MOD((COALESCE(degrees(ST_Azimuth(u,
                 ST_SetSRID(ST_MakePoint((tp->>'longitude')::float8, (tp->>'latitude')::float8),4326)::geography)),0)
                 - v_head + 540)::numeric, 360) - 180
             ) BETWEEN -(v_ang/2) AND (v_ang/2)
           END AS tp_in_cone
    FROM cand c, jsonb_array_elements(c.trigger_points) tp
    WHERE ST_DWithin(
            ST_SetSRID(ST_MakePoint((tp->>'longitude')::float8, (tp->>'latitude')::float8),4326)::geography,
            u, radius_km * 1000)
  ),
  hit AS (SELECT * FROM tps WHERE tp_in_cone)
  SELECT
    h.poi_id AS id, MIN(h.name) AS name, MIN(h.latitude) AS latitude, MIN(h.longitude) AS longitude,
    MIN(h.type) AS type,
    COALESCE((array_agg((h.tp_obj->>'radius')::int ORDER BY h.dist))[1], 30) AS trigger_radius,
    COALESCE((array_agg((h.tp_obj->>'priority')::int ORDER BY h.dist))[1], 1) AS trigger_priority,
    -- trigger_points no shape do cone original (camelCase), só os TPs no raio
    jsonb_agg(jsonb_build_object(
      'id', h.tp_obj->>'id',
      'latitude', (h.tp_obj->>'latitude')::float8,
      'longitude', (h.tp_obj->>'longitude')::float8,
      'radius', (h.tp_obj->>'radius')::int,
      'type', h.tp_obj->>'type',
      'priority', (h.tp_obj->>'priority')::int,
      'expectedBearing', (h.tp_obj->>'expected_bearing')::float8,
      'isActive', (h.tp_obj->>'is_active')::boolean,
      'direction', h.tp_obj->>'direction',
      'attraction_id', h.tp_obj->>'attraction_id'
    ) ORDER BY h.dist) AS trigger_points,
    (array_agg(h.audio_descriptions))[1] AS audio_descriptions,
    (array_agg(h.schedule))[1] AS schedule,
    '[]'::jsonb AS schedule_exceptions,
    true AS is_active,
    MIN(h.dist) AS distance_meters,
    true AS in_cone,
    MIN(h.priority_level)::smallint AS priority_level
  FROM hit h
  GROUP BY h.poi_id
  ORDER BY MIN(h.dist) ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION core.app_get_pois_by_cone(double precision,double precision,double precision,double precision,double precision,text,integer)
  TO anon, authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. app_get_poi_details — clone de get_poi_details (tabelas vivas; PK barato).
--    Single-row por PK não sofre o heap thrash; evita excluir POIs não-visíveis
--    (ex.: welcome POI que pode não ter show_in_map).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core.app_get_poi_details(p_poi_id uuid)
RETURNS TABLE(
  id uuid, name text, description text, city text, country text, state text,
  category text, rating numeric, image_url text, google_types text[],
  latitude double precision, longitude double precision, audio_descriptions jsonb,
  approved boolean, created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql STABLE
SECURITY DEFINER                       -- contorna a RLS cara (mesmo motivo do nearby/cone)
SET search_path TO 'core','public','extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.name, a.description, a.city, a.country, a.state, a.category,
         a.rating, a.image_url, a.google_types, ac.latitude, ac.longitude,
         COALESCE(jsonb_agg(jsonb_build_object(
           'id', ad.id, 'language', ad.language, 'audio_url', ad.audio_url,
           'description', ad.description, 'play_count', ad.play_count,
           'last_played_at', ad.last_played_at, 'gender', ad.gender
         ) ORDER BY CASE WHEN ad.language='pt-br' THEN 1 WHEN ad.language='pt' THEN 2 ELSE 3 END)
           FILTER (WHERE ad.id IS NOT NULL), '[]'::jsonb) AS audio_descriptions,
         a.approved, a.created_at, a.updated_at
  FROM core.attractions a
  JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  LEFT JOIN core.attraction_descriptions ad ON ad.attraction_id = a.id AND ad.audio_url IS NOT NULL
  WHERE a.id = p_poi_id AND a.approved = true
  GROUP BY a.id, a.name, a.description, a.city, a.country, a.state, a.category,
           a.rating, a.image_url, a.google_types, ac.latitude, ac.longitude,
           a.approved, a.created_at, a.updated_at;
END;
$$;
GRANT EXECUTE ON FUNCTION core.app_get_poi_details(uuid) TO anon, authenticated, service_role;


-- ============================================================================
-- VALIDAÇÃO EM STAGING (rodar antes de repontar o app)
-- ----------------------------------------------------------------------------
-- 1) Popular: SELECT core.refresh_app_poi_read(true);  -- medir duração
--    Contagem: SELECT count(*) FROM core.app_poi_read;
-- 2) Latência fria (esperado: poucos ms, poucos buffers):
--    EXPLAIN (ANALYZE, BUFFERS)
--      SELECT * FROM core.app_get_nearby_pois(-22.9488,-46.5302,3,0,50,'pt-br',3);
--    EXPLAIN (ANALYZE, BUFFERS)
--      SELECT * FROM core.app_get_pois_by_cone(-22.9488,-46.5302,1.0,NULL,360,'pt-br',3);
-- 3) Paridade de shape/conteúdo vs original (mesma coordenada): comparar nº de
--    linhas e colunas — diferença esperada só em TPs (read-model traz todos os
--    TPs ativos do POI; nearby original trazia só os do raio).
-- 4) Incremental: alterar 1 POI (UPDATE ... updated_at=now()), esperar 2min,
--    confirmar que app_poi_read refletiu (refreshed_at recente só naquele id).
-- 5) Custo do delta: rodar SELECT core.refresh_app_poi_read(false) e medir.
-- ============================================================================
