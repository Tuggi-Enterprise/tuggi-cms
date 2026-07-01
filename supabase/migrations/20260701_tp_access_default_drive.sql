-- ============================================================================
-- Walk/Drive: gate por-TP via `access` (default 'car'), + expor `access` e
-- simplificar `boundary_geojson` no read-model app_poi_read.
-- ============================================================================
--
-- Contexto: feature Walk/Drive automático. O campo core.attraction_trigger_points.access
-- já existe (CHECK 'walk'|'car'|'both'). Semântica usada pelo app:
--   'car'  = dispara só em DRIVE (default)
--   'both' = dispara em WALK e DRIVE
-- ('walk' fica sem uso; não removemos o CHECK p/ não reescrever a tabela.)
--
-- Esta migration é ADITIVA e NÃO altera o comportamento do app em produção:
--   1. Flip do DEFAULT da coluna 'both' -> 'car' (metadata-only; só afeta inserts novos).
--   2. replace_trigger_points_atomic: default do access 'both' -> 'car' (caminho de escrita do CMS).
--   3. app_poi_read_build: APENAS expõe 'access' no array trigger_points (campo novo,
--      ignorado pelo app atual). O boundary_geojson permanece IDÊNTICO ao de hoje.
--
-- Por que é seguro p/ o app em produção (que ainda NÃO tem walk):
--   - Nenhum consumidor filtra por 'access' hoje → o valor não muda o que o app recebe/dispara.
--   - 'access' no jsonb é aditivo → o app atual ignora campo desconhecido.
--   - boundary_geojson NÃO é simplificado aqui (mantido byte-a-byte). O ST_Simplify
--     mudaria a precisão dos geofences já em produção; foi ADIADO para uma migration
--     futura, junto do app novo. A mitigação de CPU do broadening é o bbox pre-filter
--     no device (fase nativa), não a simplificação no servidor.
--
-- ⚠️ NÃO inclui o BACKFILL das ~15MM linhas existentes (todas leem 'both' hoje).
--    O backfill é operação pesada e roda FORA da transação da migration:
--    ver runbook 20260701_tp_access_backfill_RUNBOOK.sql (pausar cron + lotes + refresh).
--
-- ⚠️ PROD-DRIFT: as funções de read-model foram patchadas direto em prod no
--    passado (ver memória app_get_nearby_pois_prod_drift). ANTES de aplicar,
--    DIFF a versão de prod:
--      SELECT pg_get_functiondef('core.app_poi_read_build(uuid[])'::regprocedure);
--      SELECT pg_get_functiondef('core.replace_trigger_points_atomic(uuid,jsonb)'::regprocedure);
--    e reconcilie qualquer patch de prod neste arquivo antes do CREATE OR REPLACE,
--    senão este deploy REVERTE mudanças feitas manualmente em produção.
-- ============================================================================

-- 1. DEFAULT da coluna: 'both' -> 'car' (só afeta linhas NOVAS; instantâneo).
ALTER TABLE core.attraction_trigger_points
  ALTER COLUMN access SET DEFAULT 'car';

-- 2. RPC atômica: default do access 'both' -> 'car' (linha 93 do original).
CREATE OR REPLACE FUNCTION core.replace_trigger_points_atomic(
  p_attraction_id uuid,
  p_trigger_points jsonb
)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
BEGIN
  -- 1. Validate attraction exists (early fail with clear message)
  IF NOT EXISTS (SELECT 1 FROM core.attractions WHERE attractions.id = p_attraction_id) THEN
    RAISE EXCEPTION 'Attraction not found: %', p_attraction_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. Delete existing TPs for this attraction (cascade-safe)
  DELETE FROM core.attraction_trigger_points
  WHERE attraction_id = p_attraction_id;

  -- 3. Insert all new TPs in single statement (implicitly transactional).
  RETURN QUERY
  INSERT INTO core.attraction_trigger_points (
    attraction_id,
    location,
    radius_meters,
    expected_bearing,
    bearing_threshold,
    type,
    priority,
    is_active,
    confidence_score,
    auto_status,
    manual_status,
    final_status,
    score_factors,
    generation_method,
    validation_notes,
    access,
    custom_description_id,
    geometry_geojson,
    created_at,
    updated_at
  )
  SELECT
    p_attraction_id,
    ST_SetSRID(ST_MakePoint((tp->>'lng')::float8, (tp->>'lat')::float8), 4326)::geography,
    COALESCE((tp->>'radius_meters')::integer, 20),
    NULLIF(tp->>'expected_bearing', '')::real,
    COALESCE(NULLIF(tp->>'bearing_threshold', '')::real, 30),
    tp->>'type',
    COALESCE(NULLIF(tp->>'priority', '')::integer, 1),
    COALESCE(NULLIF(tp->>'is_active', '')::boolean, true),
    NULLIF(tp->>'confidence_score', '')::real,
    NULLIF(tp->>'auto_status', ''),
    COALESCE(NULLIF(tp->>'manual_status', ''), 'pending'),
    NULLIF(tp->>'final_status', ''),
    CASE WHEN tp ? 'score_factors' AND tp->'score_factors' != 'null'::jsonb THEN tp->'score_factors' ELSE NULL END,
    NULLIF(tp->>'generation_method', ''),
    NULLIF(tp->>'validation_notes', ''),
    COALESCE(NULLIF(tp->>'access', ''), 'car'),   -- ⬅ default drive (era 'both')
    NULLIF(tp->>'custom_description_id', '')::uuid,
    NULLIF(tp->>'geometry_geojson', ''),
    COALESCE(NULLIF(tp->>'created_at', '')::timestamptz, now()),
    COALESCE(NULLIF(tp->>'updated_at', '')::timestamptz, now())
  FROM jsonb_array_elements(p_trigger_points) AS tp
  RETURNING attraction_trigger_points.id;
END;
$$;

COMMENT ON FUNCTION core.replace_trigger_points_atomic(uuid, jsonb) IS
  'Atomically replaces all trigger points for an attraction. DELETE + INSERT in single transaction; rolls back on any error so POI never ends up with zero TPs. Returns inserted TP IDs. access default = car (drive).';

-- 3. Read-model builder: ÚNICA diferença vs. 20260622_app_read_model.sql é
--    adicionar 'access' ao array trigger_points (COALESCE p/ 'car'). Tudo o mais
--    — incluindo boundary_geojson — é idêntico ao atual, para NÃO mudar o app em prod.
CREATE OR REPLACE FUNCTION core.app_poi_read_build(p_ids uuid[] DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core','public','extensions'
AS $$
BEGIN
  -- Remove os que não estão (mais) visíveis.
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
    -- boundary_geojson IDÊNTICO ao atual (sem ST_Simplify) p/ não mudar o app em prod.
    -- Simplificação adiada p/ migration futura, junto do app novo.
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
        'direction', t.direction,
        'access', COALESCE(t.access, 'car')   -- ⬅ gate walk/drive
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

-- Após aplicar (e após o backfill do runbook), rodar UM full rebuild controlado:
--   SELECT core.refresh_app_poi_read(true);
