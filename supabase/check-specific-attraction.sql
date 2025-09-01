-- Check if the specific attraction exists and has coordinates
-- This is the attraction ID from the error log: cb2103ad-af06-48c6-9ee6-853379bc390c

-- 1. Check if attraction exists
SELECT 
    'Attraction Check' as check_type,
    id,
    name,
    city,
    country,
    created_at
FROM core.attractions 
WHERE id = 'cb2103ad-af06-48c6-9ee6-853379bc390c';

-- 2. Check if attraction has coordinates
SELECT 
    'Attraction Coordinates' as check_type,
    ac.attraction_id,
    ac.latitude,
    ac.longitude,
    a.name
FROM core.attraction_coordinate ac
JOIN core.attractions a ON ac.attraction_id = a.id
WHERE ac.attraction_id = 'cb2103ad-af06-48c6-9ee6-853379bc390c';

-- 3. Try to insert a test trigger point with the exact same data
DO $$
DECLARE
    test_id uuid;
    error_msg text;
    error_detail text;
    error_hint text;
    error_context text;
BEGIN
    BEGIN
        INSERT INTO core.attraction_trigger_points (
            attraction_id,
            location,
            radius_meters,
            expected_bearing,
            bearing_threshold,
            type,
            priority,
            is_active,
            direction,
            confidence_score,
            manual_status,
            generation_method,
            validation_notes
        ) VALUES (
            'cb2103ad-af06-48c6-9ee6-853379bc390c',
            ST_SetSRID(ST_MakePoint(-8.299929721704496, 51.84914348533807), 4326)::geography,
            50,
            NULL,
            30,
            'primary',
            1,
            true,
            NULL,
            0.8,
            'approved',
            'manual',
            'Test trigger point creation - debug'
        ) RETURNING id INTO test_id;
        
        RAISE NOTICE 'SUCCESS: Test trigger point created with ID: %', test_id;
        
        -- Clean up the test record
        DELETE FROM core.attraction_trigger_points WHERE id = test_id;
        RAISE NOTICE 'Test trigger point cleaned up successfully';
        
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS 
            error_msg = MESSAGE_TEXT,
            error_detail = PG_EXCEPTION_DETAIL,
            error_hint = PG_EXCEPTION_HINT,
            error_context = PG_EXCEPTION_CONTEXT;
            
        RAISE NOTICE 'ERROR: %', error_msg;
        RAISE NOTICE 'SQLSTATE: %', SQLSTATE;
        RAISE NOTICE 'DETAIL: %', error_detail;
        RAISE NOTICE 'HINT: %', error_hint;
        RAISE NOTICE 'CONTEXT: %', error_context;
    END;
END $$;
