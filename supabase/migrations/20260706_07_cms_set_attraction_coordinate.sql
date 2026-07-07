-- ============================================================================
-- CMS — upsert de coordenada pós-criação (evento/local)
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor).
--
-- Root cause de "evento sem localização": o CMS só inseria coordenada na criação
-- (cms_create_event/place) e o LocationPicker ficava read-only na edição. Esta RPC
-- permite definir/editar a coordenada a qualquer momento (upsert 1:1 em
-- core.attraction_coordinate). SECURITY DEFINER + gate de editor CMS, no mesmo
-- padrão de cms_create_event. location_geography é GENERATED (auto).
--
-- ⚠️ Upsert MANUAL (UPDATE→INSERT), NÃO ON CONFLICT: attraction_coordinate NÃO
-- tem constraint UNIQUE em attraction_id (só um índice partial NÃO-unique de nome
-- enganoso, idx_attraction_coordinate_attraction_id_unique) — ON CONFLICT falharia.
-- Mesmo padrão de core.insert_coordinate_safe.
-- ============================================================================

CREATE OR REPLACE FUNCTION core.cms_set_attraction_coordinate(
  p_attraction_id uuid,
  p_latitude      double precision,
  p_longitude     double precision
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'core','public','extensions'
AS $$
BEGIN
  IF NOT core.is_active_cms_editor_or_admin() THEN
    RAISE EXCEPTION 'not authorized to set coordinate';
  END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'latitude/longitude required';
  END IF;

  UPDATE core.attraction_coordinate
    SET latitude   = p_latitude,
        longitude  = p_longitude,
        show_in_map = true,
        updated_at = now()
    WHERE attraction_id = p_attraction_id;

  IF NOT FOUND THEN
    INSERT INTO core.attraction_coordinate (attraction_id, latitude, longitude, show_in_map)
    VALUES (p_attraction_id, p_latitude, p_longitude, true);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION core.cms_set_attraction_coordinate(uuid, double precision, double precision)
  TO authenticated, service_role;
