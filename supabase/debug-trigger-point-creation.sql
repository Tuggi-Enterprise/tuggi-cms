-- Debug trigger point creation issue
-- Check all triggers and functions that might be causing "POI not found" error

-- 1. List all triggers on attraction_trigger_points table
SELECT 
    'Triggers on attraction_trigger_points' as check_type,
    trigger_name,
    event_manipulation,
    action_timing,
    action_statement,
    action_condition,
    action_orientation
FROM information_schema.triggers 
WHERE event_object_table = 'attraction_trigger_points'
AND event_object_schema = 'core'
ORDER BY trigger_name;

-- 2. Get trigger function definitions
SELECT 
    'Trigger Function Definitions' as check_type,
    routine_name,
    routine_definition
FROM information_schema.routines 
WHERE routine_schema = 'core' 
AND routine_name IN (
    SELECT DISTINCT 
        REGEXP_REPLACE(action_statement, '.*EXECUTE (?:PROCEDURE|FUNCTION) ([^(]+).*', '\1') as function_name
    FROM information_schema.triggers 
    WHERE event_object_table = 'attraction_trigger_points'
    AND event_object_schema = 'core'
);

-- 3. Search for any function containing "POI not found" or similar validation
SELECT 
    'Functions with POI validation' as check_type,
    routine_name,
    routine_definition
FROM information_schema.routines 
WHERE routine_schema = 'core' 
AND (
    routine_definition ILIKE '%POI not found%' OR
    routine_definition ILIKE '%attraction%not%found%' OR
    routine_definition ILIKE '%RAISE%' OR
    routine_definition ILIKE '%extract_trigger_point_context%'
)
ORDER BY routine_name;

-- 4. Check if the specific attraction exists
SELECT 
    'Attraction Existence Check' as check_type,
    id,
    name,
    city,
    country,
    created_at
FROM core.attractions 
WHERE id = 'cb2103ad-af06-48c6-9ee6-853379bc390c';

-- 5. Check attraction coordinates
SELECT 
    'Attraction Coordinates Check' as check_type,
    ac.attraction_id,
    ac.latitude,
    ac.longitude,
    a.name
FROM core.attraction_coordinate ac
JOIN core.attractions a ON ac.attraction_id = a.id
WHERE ac.attraction_id = 'cb2103ad-af06-48c6-9ee6-853379bc390c';

-- 6. Check if there are any foreign key constraints that might fail
SELECT 
    'Foreign Key Constraints' as check_type,
    kcu.constraint_name,
    kcu.table_name,
    kcu.column_name,
    fkcu.table_name as foreign_table_name,
    fkcu.column_name as foreign_column_name
FROM information_schema.key_column_usage kcu
JOIN information_schema.referential_constraints rc 
    ON kcu.constraint_name = rc.constraint_name
JOIN information_schema.key_column_usage fkcu 
    ON rc.unique_constraint_name = fkcu.constraint_name
WHERE kcu.table_name = 'attraction_trigger_points'
AND kcu.table_schema = 'core';

-- 7. Try a simple test insert to see what happens
DO $$
DECLARE
    test_id uuid;
    error_msg text;
BEGIN
    BEGIN
        INSERT INTO core.attraction_trigger_points (
            attraction_id,
            location,
            radius_meters,
            type,
            priority,
            is_active,
            confidence_score,
            manual_status,
            generation_method,
            validation_notes
        ) VALUES (
            'cb2103ad-af06-48c6-9ee6-853379bc390c',
            ST_SetSRID(ST_MakePoint(-8.299929721704496, 51.84914348533807), 4326)::geography,
            50,
            'primary',
            1,
            true,
            0.8,
            'approved',
            'manual',
            'Test trigger point creation'
        ) RETURNING id INTO test_id;
        
        RAISE NOTICE 'SUCCESS: Test trigger point created with ID: %', test_id;
        
        -- Clean up the test record
        DELETE FROM core.attraction_trigger_points WHERE id = test_id;
        RAISE NOTICE 'Test trigger point cleaned up successfully';
        
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS error_msg = MESSAGE_TEXT;
        RAISE NOTICE 'ERROR: Failed to create test trigger point: %', error_msg;
        RAISE NOTICE 'SQLSTATE: %', SQLSTATE;
    END;
END $$;
