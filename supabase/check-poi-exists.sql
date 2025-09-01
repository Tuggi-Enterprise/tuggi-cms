-- Check if POI exists and investigate the trigger point creation issue

-- 1. Check if the POI exists in the attractions table
SELECT 
    'POI Check' as check_type,
    id,
    name,
    city,
    country
FROM core.attractions 
WHERE id = 'c07f9b8e-8b66-45fa-b57b-a5b65e505354';

-- 2. Check if POI has coordinates
SELECT 
    'POI Coordinates Check' as check_type,
    ac.attraction_id,
    ac.latitude,
    ac.longitude,
    a.name
FROM core.attraction_coordinate ac
JOIN core.attractions a ON ac.attraction_id = a.id
WHERE ac.attraction_id = 'c07f9b8e-8b66-45fa-b57b-a5b65e505354';

-- 3. List all triggers on attraction_trigger_points table
SELECT 
    'Triggers Check' as check_type,
    trigger_name,
    event_manipulation,
    action_timing,
    action_statement
FROM information_schema.triggers 
WHERE event_object_table = 'attraction_trigger_points'
AND event_object_schema = 'core';

-- 4. List all functions that might be validating POIs
SELECT 
    'Functions Check' as check_type,
    routine_name,
    routine_definition
FROM information_schema.routines 
WHERE routine_schema = 'core' 
AND routine_definition ILIKE '%POI%' 
AND routine_definition ILIKE '%not found%';

-- 5. Check if there are any constraints that might be causing the issue
SELECT 
    'Constraints Check' as check_type,
    constraint_name,
    constraint_type,
    is_deferrable,
    initially_deferred
FROM information_schema.table_constraints 
WHERE table_name = 'attraction_trigger_points' 
AND table_schema = 'core';

-- 6. Try to create a test trigger point to see the exact error
-- This will help us understand what's happening
DO $$
DECLARE
    test_id uuid;
BEGIN
    -- Try to insert a test trigger point
    INSERT INTO core.attraction_trigger_points (
        attraction_id,
        location,
        radius_meters,
        type,
        priority,
        is_active
    ) VALUES (
        'c07f9b8e-8b66-45fa-b57b-a5b65e505354',
        ST_SetSRID(ST_MakePoint(-8.277179, 51.8519229), 4326)::geography,
        30,
        'primary',
        1,
        true
    ) RETURNING id INTO test_id;
    
    RAISE NOTICE 'Test trigger point created successfully: %', test_id;
    
    -- Clean up the test trigger point
    DELETE FROM core.attraction_trigger_points WHERE id = test_id;
    
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error creating test trigger point: % - %', SQLSTATE, SQLERRM;
END $$;
