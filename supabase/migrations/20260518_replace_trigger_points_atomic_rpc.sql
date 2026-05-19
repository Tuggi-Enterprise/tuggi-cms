-- ===========================================
-- ATOMIC TRIGGER POINTS REPLACEMENT (Tier 1.2)
-- ===========================================
--
-- Problem: TriggerPointSavingService.saveTriggerPoints com mode='replace_all'
-- faz DELETE seguido de INSERT em 2 chamadas separadas. Se o INSERT falhar
-- (constraint, network blip), o POI fica com ZERO TPs em produção até alguém
-- regerar manualmente.
--
-- Solution: PL/pgSQL function que envolve DELETE + INSERT no mesmo statement
-- transactional (funções PL/pgSQL têm rollback automático em qualquer erro).
--
-- Usage from app:
--   const { data, error } = await supabase
--     .schema('core')
--     .rpc('replace_trigger_points_atomic', {
--       p_attraction_id: attractionId,
--       p_trigger_points: tpsArray  -- JSONB array of TP objects
--     });
--
-- The function returns rows of inserted TP IDs. Errors propagate as Postgres
-- exceptions.

-- ===========================================
-- FUNCTION DEFINITION
-- ===========================================

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

  -- 2. Delete existing TPs for this attraction (cascade-safe: TPs ON DELETE CASCADE referenced)
  DELETE FROM core.attraction_trigger_points
  WHERE attraction_id = p_attraction_id;

  -- 3. Insert all new TPs in single statement. If any row violates a
  -- constraint, the entire INSERT (and the previous DELETE) rolls back —
  -- PL/pgSQL function is implicitly transactional. POI retains its old TPs.
  --
  -- Note: NULLIF(text, '')::cast guards against empty strings coming from JSON
  -- being incorrectly cast to numbers/uuids.
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
    COALESCE(NULLIF(tp->>'access', ''), 'both'),
    NULLIF(tp->>'custom_description_id', '')::uuid,
    NULLIF(tp->>'geometry_geojson', ''),
    COALESCE(NULLIF(tp->>'created_at', '')::timestamptz, now()),
    COALESCE(NULLIF(tp->>'updated_at', '')::timestamptz, now())
  FROM jsonb_array_elements(p_trigger_points) AS tp
  RETURNING attraction_trigger_points.id;
END;
$$;

COMMENT ON FUNCTION core.replace_trigger_points_atomic(uuid, jsonb) IS
  'Atomically replaces all trigger points for an attraction. DELETE + INSERT in single transaction; rolls back on any error so POI never ends up with zero TPs. Returns inserted TP IDs.';

-- ===========================================
-- PERMISSIONS
-- ===========================================

GRANT EXECUTE ON FUNCTION core.replace_trigger_points_atomic(uuid, jsonb)
  TO authenticated, service_role;
