-- ============================================================
-- core.get_trigger_points_in_bbox
-- Retorna TPs ativos e aprovados dentro de um bounding box
-- Usado para análise de trips: quais POIs existiam no trajeto
-- ============================================================

CREATE OR REPLACE FUNCTION core.get_trigger_points_in_bbox(
  min_lat      double precision,
  max_lat      double precision,
  min_lon      double precision,
  max_lon      double precision,
  p_limit      integer  DEFAULT 5000,
  p_offset     integer  DEFAULT 0
)
RETURNS TABLE (
  tp_id           uuid,
  attraction_id   uuid,
  attraction_name text,
  city            text,
  category        text,
  tp_type         text,
  radius_meters   integer,
  confidence_score real,
  final_status    text,
  latitude        double precision,
  longitude       double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    tp.id                                   AS tp_id,
    tp.attraction_id,
    a.name                                  AS attraction_name,
    a.city,
    a.category,
    tp.type                                 AS tp_type,
    tp.radius_meters,
    tp.confidence_score,
    tp.final_status,
    ST_Y(tp.location::geometry)             AS latitude,
    ST_X(tp.location::geometry)             AS longitude
  FROM core.attraction_trigger_points tp
  JOIN core.attractions a ON a.id = tp.attraction_id
  WHERE
    tp.is_active     = true
    AND tp.final_status = 'approved'
    AND tp.location && ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)::geography
  ORDER BY tp.attraction_id, tp.type, tp.priority
  LIMIT p_limit
  OFFSET p_offset
$$;

COMMENT ON FUNCTION core.get_trigger_points_in_bbox IS
  'Retorna TPs ativos+aprovados dentro de um bounding box (lat/lon). Usado para análise de trips e debug de POIs perdidas.';
