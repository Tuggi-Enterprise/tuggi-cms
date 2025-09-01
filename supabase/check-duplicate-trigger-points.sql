-- Function to check for duplicate trigger points PER POI
-- This prevents creating TPs that are too close to existing ones for the SAME attraction

-- ===========================================
-- FUNCTION TO CHECK FOR DUPLICATE TRIGGER POINTS (PER POI)
-- ===========================================

-- Drop existing function first to fix return type
DROP FUNCTION IF EXISTS core.check_duplicate_trigger_points(UUID, REAL, REAL, REAL);

CREATE OR REPLACE FUNCTION core.check_duplicate_trigger_points(
    p_attraction_id UUID,
    p_lat REAL,
    p_lng REAL,
    p_distance_threshold REAL DEFAULT 20.0
)
RETURNS TABLE(
    is_duplicate BOOLEAN,
    existing_tp_id UUID,
    distance_m DOUBLE PRECISION,
    existing_type TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        TRUE as is_duplicate,
        tp.id as existing_tp_id,
        ST_Distance(
            tp.location::geography,
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
        ) as distance_m,
        tp.type as existing_type
    FROM core.attraction_trigger_points tp
    WHERE tp.attraction_id = p_attraction_id  -- ONLY check for the same POI
        AND tp.is_active = TRUE
        AND ST_DWithin(
            tp.location::geography,
            ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
            p_distance_threshold
        )
    ORDER BY distance_m ASC
    LIMIT 1;
    
    -- If no duplicates found, return FALSE
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::DOUBLE PRECISION, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ===========================================
-- FUNCTION TO BATCH CHECK TRIGGER POINTS BEFORE INSERT
-- ===========================================

-- Drop existing function first to ensure clean recreation
DROP FUNCTION IF EXISTS core.validate_trigger_points_batch(UUID, JSONB, REAL);

CREATE OR REPLACE FUNCTION core.validate_trigger_points_batch(
    p_attraction_id UUID,
    p_trigger_points JSONB,
    p_distance_threshold REAL DEFAULT 20.0
)
RETURNS JSONB AS $$
DECLARE
    tp_record RECORD;
    duplicate_check RECORD;
    validated_tps JSONB := '[]'::JSONB;
    duplicates_found INTEGER := 0;
    total_tps INTEGER := 0;
BEGIN
    -- Count total TPs for logging
    SELECT jsonb_array_length(p_trigger_points) INTO total_tps;
    
    -- Loop through each trigger point in the JSONB array
    FOR tp_record IN SELECT * FROM jsonb_array_elements(p_trigger_points)
    LOOP
        -- Check for duplicates for this specific POI
        SELECT * INTO duplicate_check
        FROM core.check_duplicate_trigger_points(
            p_attraction_id,
            (tp_record.value->>'lat')::REAL,
            (tp_record.value->>'lng')::REAL,
            p_distance_threshold
        );
        
        -- If no duplicate found, add to validated data
        IF NOT duplicate_check.is_duplicate THEN
            validated_tps := validated_tps || tp_record.value;
        ELSE
            duplicates_found := duplicates_found + 1;
            -- Log the duplicate for debugging
            RAISE NOTICE 'Skipping duplicate TP for POI %: lat=%, lng=%, distance=%.1fm from existing % TP (id=%)', 
                p_attraction_id,
                tp_record.value->>'lat', 
                tp_record.value->>'lng', 
                duplicate_check.distance_m,
                duplicate_check.existing_type,
                duplicate_check.existing_tp_id;
        END IF;
    END LOOP;
    
    -- Log summary
    RAISE NOTICE 'TP validation complete for POI %: % validated, % duplicates skipped (threshold: %m)', 
        p_attraction_id, 
        jsonb_array_length(validated_tps), 
        duplicates_found, 
        p_distance_threshold;
    
    RETURN validated_tps;
END;
$$ LANGUAGE plpgsql STABLE;

-- ===========================================
-- GRANT PERMISSIONS
-- ===========================================

GRANT EXECUTE ON FUNCTION core.check_duplicate_trigger_points(UUID, REAL, REAL, REAL) TO authenticated;
GRANT EXECUTE ON FUNCTION core.check_duplicate_trigger_points(UUID, REAL, REAL, REAL) TO service_role;

GRANT EXECUTE ON FUNCTION core.validate_trigger_points_batch(UUID, JSONB, REAL) TO authenticated;
GRANT EXECUTE ON FUNCTION core.validate_trigger_points_batch(UUID, JSONB, REAL) TO service_role;

-- ===========================================
-- ADD COMMENTS
-- ===========================================

COMMENT ON FUNCTION core.check_duplicate_trigger_points(UUID, REAL, REAL, REAL) IS 'Checks if a trigger point already exists for the SAME attraction within the specified distance threshold. Does not check other POIs.';

COMMENT ON FUNCTION core.validate_trigger_points_batch(UUID, JSONB, REAL) IS 'Validates a batch of trigger points for a specific POI, filtering out duplicates based on proximity to existing TPs for that POI only';
