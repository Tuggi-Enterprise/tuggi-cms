-- Migration: Add translation support to custom routes RPCs
-- Adds p_user_language parameter and LEFT JOIN with custom_route_descriptions.
-- Returns translated_name, translated_description, description_audio_url, translation_status.
-- Falls back gracefully: if no translation exists, translated_* fields are NULL
-- and the app uses the original name/description.
-- Date: 2026-05-21

-- ============================================================================
-- RPC 1 (updated): get_nearby_custom_routes + translation support
-- ============================================================================

CREATE OR REPLACE FUNCTION core.get_nearby_custom_routes(
  user_lat        DOUBLE PRECISION,
  user_lng        DOUBLE PRECISION,
  radius_km       DOUBLE PRECISION DEFAULT 2,
  p_user_language TEXT             DEFAULT 'en-us',
  p_voice_gender  TEXT             DEFAULT 'male'   -- 'male' | 'female'
)
RETURNS TABLE (
  id                      UUID,
  name                    VARCHAR(255),
  description             TEXT,
  -- Translation fields (NULL if not available for the requested language + gender)
  translated_name         VARCHAR(500),
  translated_description  TEXT,
  description_audio_url   TEXT,
  translation_status      TEXT,
  -- Geometry + route data
  geometry_json           JSONB,
  waypoints               JSONB,
  route_metadata          JSONB,
  stops_count             INTEGER,
  accessibility           TEXT,
  drivability             TEXT,
  scenic_profile          TEXT[],
  best_time               TEXT[],
  road_conditions         TEXT[],
  photogenic_rating       TEXT,
  resources               JSONB,
  usage_count             BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH user_point AS (
    SELECT ST_SetSRID(ST_Point(user_lng, user_lat), 4326)::geography AS geog
  ),
  route_usage AS (
    SELECT route_id, COUNT(DISTINCT user_id) AS cnt
    FROM drive.custom_route_usage
    WHERE action = 'route_explored'
    GROUP BY route_id
  )
  SELECT
    r.id,
    r.name,
    r.description,
    -- Translation: NULL if language not yet generated (app falls back to original)
    crd.name        AS translated_name,
    crd.description AS translated_description,
    crd.audio_url   AS description_audio_url,
    crd.status      AS translation_status,
    -- Geometry simplified for mobile payload
    ST_AsGeoJSON(
      ST_Simplify(r.geometry::geometry, 0.0001)
    )::jsonb AS geometry_json,
    r.waypoints,
    r.metadata AS route_metadata,
    r.stops_count,
    r.accessibility,
    r.drivability,
    r.scenic_profile,
    r.best_time,
    r.road_conditions,
    r.photogenic_rating,
    r.resources,
    COALESCE(ru.cnt, 0)::bigint AS usage_count
  FROM core.custom_routes r
  CROSS JOIN user_point up
  LEFT JOIN route_usage ru ON ru.route_id = r.id
  -- LEFT JOIN: returns NULL fields when no translation exists for this language+gender
  LEFT JOIN core.custom_route_descriptions crd
    ON crd.route_id = r.id
    AND crd.language = p_user_language
    AND crd.gender   = p_voice_gender
    AND crd.status   = 'ready'
  WHERE r.is_active = true
    AND ST_DWithin(r.geometry, up.geog, radius_km * 1000)
  ORDER BY ST_Distance(r.geometry, up.geog)
  LIMIT 5;
$$;

-- Re-grant for new signature (5 params: lat, lng, radius, language, gender)
GRANT EXECUTE ON FUNCTION core.get_nearby_custom_routes(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_nearby_custom_routes(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) TO anon;
-- Backward compat: old 3-param signature (defaults language='pt-br', gender='male')
GRANT EXECUTE ON FUNCTION core.get_nearby_custom_routes(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_nearby_custom_routes(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon;


-- ============================================================================
-- RPC 2 (updated): get_custom_route_by_id + translation support
-- ============================================================================

CREATE OR REPLACE FUNCTION core.get_custom_route_by_id(
  p_route_id      UUID,
  p_user_language TEXT DEFAULT 'en-us',
  p_voice_gender  TEXT DEFAULT 'male'
)
RETURNS TABLE (
  id                      UUID,
  name                    VARCHAR(255),
  description             TEXT,
  -- Translation fields (NULL if not available for the requested language)
  translated_name         VARCHAR(500),
  translated_description  TEXT,
  description_audio_url   TEXT,
  translation_status      TEXT,
  -- Route data
  geometry_json           JSONB,
  waypoints               JSONB,
  route_metadata          JSONB,
  stops_count             INTEGER,
  accessibility           TEXT,
  drivability             TEXT,
  scenic_profile          TEXT[],
  best_time               TEXT[],
  road_conditions         TEXT[],
  photogenic_rating       TEXT,
  resources               JSONB,
  usage_count             BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    r.id,
    r.name,
    r.description,
    crd.name        AS translated_name,
    crd.description AS translated_description,
    crd.audio_url   AS description_audio_url,
    crd.status      AS translation_status,
    ST_AsGeoJSON(
      ST_Simplify(r.geometry::geometry, 0.0001)
    )::jsonb AS geometry_json,
    r.waypoints,
    r.metadata AS route_metadata,
    r.stops_count,
    r.accessibility,
    r.drivability,
    r.scenic_profile,
    r.best_time,
    r.road_conditions,
    r.photogenic_rating,
    r.resources,
    COALESCE(
      (SELECT COUNT(DISTINCT u.user_id)
       FROM drive.custom_route_usage u
       WHERE u.route_id = r.id
         AND u.action = 'route_explored'),
      0
    ) AS usage_count
  FROM core.custom_routes r
  LEFT JOIN core.custom_route_descriptions crd
    ON crd.route_id = r.id
    AND crd.language = p_user_language
    AND crd.gender   = p_voice_gender
    AND crd.status   = 'ready'
  WHERE r.id = p_route_id
    AND r.is_active = true;
$$;

-- Re-grant (3-param: id, language, gender)
GRANT EXECUTE ON FUNCTION core.get_custom_route_by_id(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_custom_route_by_id(UUID, TEXT, TEXT) TO anon;
-- Backward compat (1-param and 2-param)
GRANT EXECUTE ON FUNCTION core.get_custom_route_by_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_custom_route_by_id(UUID) TO anon;
