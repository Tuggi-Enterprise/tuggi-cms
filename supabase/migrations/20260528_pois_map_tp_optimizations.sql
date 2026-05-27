-- ============================================================
-- POIs map view — Trigger Point optimizations
-- Date: 2026-05-28
--
-- ⚠️ EXECUTAR MANUALMENTE NO PAINEL SUPABASE (regra: nunca DDL via CLI)
--
-- Mudanças:
--   1. cms_search_pois_map: remove o array `trigger_points` detalhado do
--      metadata JSONB (mantém apenas escalares de count).
--   2. cms_get_trigger_points_map_bbox: nova RPC que retorna TPs (todos os
--      status, não só aprovados) dentro de um bbox, com os campos que o
--      mapa precisa para desenhar (bearing, is_active, type, priority).
--   3. cms_count_trigger_points_map_bbox: nova RPC para guardrail (count-only).
-- ============================================================

-- ============================================================
-- 1. Recreate cms_search_pois_map WITHOUT the trigger_points array
-- ============================================================
-- Past migrations created multiple overloads (10, 11 and 12 params).
-- Drop ALL of them dynamically before recreating.

DO $$
DECLARE
  func record;
BEGIN
  FOR func IN
    SELECT 'core.cms_search_pois_map(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'core' AND p.proname = 'cms_search_pois_map'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func.sig;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION core.cms_search_pois_map(
  min_lat double precision,
  min_lng double precision,
  max_lat double precision,
  max_lng double precision,
  zoom_level integer,
  search_term text DEFAULT NULL,
  status_filter text DEFAULT 'all',
  country_filter text DEFAULT NULL,
  state_filter text DEFAULT NULL,
  city_filter text DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  is_active_filter text DEFAULT 'all'
)
RETURNS TABLE(
  id uuid,
  name text,
  latitude double precision,
  longitude double precision,
  type text,
  count integer,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET statement_timeout = '60s'
AS $$
DECLARE
  eps float8;
  min_points int := 2;
  caller_cms_id UUID;
  is_admin BOOLEAN := FALSE;
  effective_owner_id UUID;
BEGIN
  effective_owner_id := p_owner_id;

  BEGIN
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true));
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := TRUE;
  END;

  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN
    effective_owner_id := caller_cms_id;
  END IF;

  IF zoom_level <= 4 THEN eps := 1.0;
  ELSIF zoom_level <= 5 THEN eps := 0.5;
  ELSIF zoom_level <= 6 THEN eps := 0.25;
  ELSIF zoom_level <= 7 THEN eps := 0.1;
  ELSIF zoom_level <= 8 THEN eps := 0.05;
  ELSIF zoom_level <= 9 THEN eps := 0.02;
  ELSIF zoom_level <= 10 THEN eps := 0.01;
  ELSIF zoom_level <= 11 THEN eps := 0.005;
  ELSE eps := 0;
  END IF;

  RETURN QUERY
  WITH base_pois AS (
    SELECT
      a.id AS poi_id,
      a.name AS poi_name,
      a.city,
      a.state,
      a.country,
      a.approved,
      a.is_active,
      c.latitude AS poi_lat,
      c.longitude AS poi_lng,
      ST_SetSRID(ST_MakePoint(c.longitude, c.latitude), 4326) as geom
    FROM core.attractions a
    JOIN core.attraction_coordinate c ON c.attraction_id = a.id
    WHERE
      c.latitude BETWEEN (min_lat - 0.02) AND (max_lat + 0.02)
      AND c.longitude BETWEEN (min_lng - 0.02) AND (max_lng + 0.02)
      AND (search_term IS NULL OR a.name ILIKE '%' || search_term || '%')
      AND (status_filter = 'all' OR (status_filter = 'approved' AND a.approved = true) OR (status_filter = 'pending' AND a.approved = false))
      AND (country_filter IS NULL OR a.country = country_filter)
      AND (state_filter IS NULL OR a.state = state_filter)
      AND (city_filter IS NULL OR a.city = city_filter)
      AND (effective_owner_id IS NULL OR a.created_by = effective_owner_id)
      AND (
        is_active_filter = 'all'
        OR (is_active_filter = 'active' AND COALESCE(a.is_active, true) = true)
        OR (is_active_filter = 'inactive' AND COALESCE(a.is_active, true) = false)
      )
  ),
  filtered_pois AS (
    SELECT
      bp.*,
      COALESCE(ad_stats.has_description, false) AS has_description,
      COALESCE(ad_stats.has_audio, false) AS has_audio
    FROM base_pois bp
    LEFT JOIN LATERAL (
      SELECT
        bool_or(ad.description IS NOT NULL AND ad.description <> '') AS has_description,
        bool_or(ad.audio_url IS NOT NULL AND ad.audio_url <> '') AS has_audio
      FROM core.attraction_descriptions ad
      WHERE ad.attraction_id = bp.poi_id
    ) ad_stats ON true
  ),
  clustered AS (
    SELECT
      fp.poi_id, fp.poi_name, fp.city, fp.state, fp.country, fp.approved, fp.is_active,
      fp.has_description, fp.has_audio, fp.poi_lat, fp.poi_lng,
      CASE WHEN eps > 0 THEN
        ST_ClusterDBSCAN(fp.geom, eps, min_points) OVER ()
      ELSE
        NULL
      END as cluster_id
    FROM filtered_pois fp
  ),
  aggregated_clusters AS (
    SELECT
      (array_agg(cl.poi_id))[1] as id,
      'Cluster (' || count(*) || ')' as name,
      avg(cl.poi_lat)::double precision as latitude,
      avg(cl.poi_lng)::double precision as longitude,
      'cluster'::text as type,
      count(*)::int as count,
      jsonb_build_object('count', count(*)) as metadata
    FROM clustered cl
    WHERE cl.cluster_id IS NOT NULL
    GROUP BY cl.cluster_id
  ),
  individual_points AS (
    SELECT
      cl.poi_id as id,
      cl.poi_name as name,
      cl.poi_lat as latitude,
      cl.poi_lng as longitude,
      'poi'::text as type,
      1 as count,
      jsonb_build_object(
        'city', cl.city,
        'state', cl.state,
        'country', cl.country,
        'approved', cl.approved,
        'is_active', cl.is_active,
        'has_description', cl.has_description,
        'has_audio', cl.has_audio,
        'trigger_points_count', COALESCE(tp_counts.total, 0),
        'active_trigger_points_count', COALESCE(tp_counts.active, 0)
      ) as metadata
    FROM clustered cl
    LEFT JOIN LATERAL (
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE tp.is_active) AS active
      FROM core.attraction_trigger_points tp
      WHERE tp.attraction_id = cl.poi_id
    ) tp_counts ON true
    WHERE cl.cluster_id IS NULL
  )
  SELECT * FROM aggregated_clusters
  UNION ALL
  SELECT * FROM individual_points;
END;
$$;

GRANT EXECUTE ON FUNCTION core.cms_search_pois_map TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_search_pois_map TO service_role;

COMMENT ON FUNCTION core.cms_search_pois_map IS
  'Retorna POIs do mapa CMS com clustering por zoom. NÃO retorna o array detalhado de TPs (use cms_get_trigger_points_map_bbox para isso).';


-- ============================================================
-- 2. cms_get_trigger_points_map_bbox — TPs by bbox for the map
-- ============================================================
-- Unlike get_trigger_points_in_bbox (which filters approved+active only),
-- this returns ALL TPs so the map can show every TP for auditing.

DO $$
DECLARE
  func record;
BEGIN
  FOR func IN
    SELECT 'core.cms_get_trigger_points_map_bbox(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'core' AND p.proname = 'cms_get_trigger_points_map_bbox'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func.sig;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION core.cms_get_trigger_points_map_bbox(
  min_lat double precision,
  min_lng double precision,
  max_lat double precision,
  max_lng double precision,
  p_limit integer DEFAULT 1000
)
RETURNS TABLE (
  id              uuid,
  attraction_id   uuid,
  latitude        double precision,
  longitude       double precision,
  bearing         real,
  is_active       boolean,
  type            text,
  priority        integer,
  radius_meters   integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    tp.id,
    tp.attraction_id,
    ST_Y(tp.location::geometry) AS latitude,
    ST_X(tp.location::geometry) AS longitude,
    tp.expected_bearing         AS bearing,
    tp.is_active,
    tp.type,
    tp.priority,
    tp.radius_meters
  FROM core.attraction_trigger_points tp
  WHERE tp.location && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
  ORDER BY tp.attraction_id, tp.priority
  LIMIT p_limit
$$;

GRANT EXECUTE ON FUNCTION core.cms_get_trigger_points_map_bbox TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_get_trigger_points_map_bbox TO service_role;

COMMENT ON FUNCTION core.cms_get_trigger_points_map_bbox IS
  'CMS map view: retorna TODOS os TPs (ativos+inativos, qualquer status) dentro de um bbox. Usado pelo modo bulk de /pois.';


-- ============================================================
-- 3. cms_count_trigger_points_map_bbox — count guardrail
-- ============================================================

DO $$
DECLARE
  func record;
BEGIN
  FOR func IN
    SELECT 'core.cms_count_trigger_points_map_bbox(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'core' AND p.proname = 'cms_count_trigger_points_map_bbox'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func.sig;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION core.cms_count_trigger_points_map_bbox(
  min_lat double precision,
  min_lng double precision,
  max_lat double precision,
  max_lng double precision
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT count(*)::integer
  FROM core.attraction_trigger_points tp
  WHERE tp.location && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
$$;

GRANT EXECUTE ON FUNCTION core.cms_count_trigger_points_map_bbox TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_count_trigger_points_map_bbox TO service_role;

COMMENT ON FUNCTION core.cms_count_trigger_points_map_bbox IS
  'CMS map view: count rápido de TPs em um bbox. Usado como guardrail antes de carregar TPs em modo bulk.';
