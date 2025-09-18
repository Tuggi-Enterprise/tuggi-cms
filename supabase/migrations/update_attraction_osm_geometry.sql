-- Function to update attraction geometry using PostGIS ST_GeomFromText
-- This allows safe handling of WKT geometry strings

CREATE OR REPLACE FUNCTION core.update_attraction_osm_geometry(
    p_attraction_id UUID,
    p_wkt_geometry TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Validate that the attraction exists
    IF NOT EXISTS (SELECT 1 FROM core.attractions WHERE id = p_attraction_id) THEN
        RAISE EXCEPTION 'Attraction with ID % not found', p_attraction_id;
    END IF;
    
    -- Validate WKT format
    IF p_wkt_geometry IS NULL OR p_wkt_geometry = '' THEN
        RAISE EXCEPTION 'WKT geometry cannot be null or empty';
    END IF;
    
    -- Update the geometry using ST_GeomFromText
    UPDATE core.attractions 
    SET 
        osm_geometry = ST_GeomFromText(p_wkt_geometry, 4326)::geography,
        updated_at = now()
    WHERE id = p_attraction_id;
    
    -- Check if the update was successful
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to update attraction geometry for ID %', p_attraction_id;
    END IF;
    
    RETURN TRUE;
    
EXCEPTION
    WHEN OTHERS THEN
        -- Log the error and re-raise with more context
        RAISE EXCEPTION 'Error updating attraction geometry: %', SQLERRM;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION core.update_attraction_osm_geometry(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION core.update_attraction_osm_geometry(UUID, TEXT) TO service_role;

-- Add comment for documentation
COMMENT ON FUNCTION core.update_attraction_osm_geometry(UUID, TEXT) IS 'Updates attraction OSM geometry from WKT string using PostGIS ST_GeomFromText';
