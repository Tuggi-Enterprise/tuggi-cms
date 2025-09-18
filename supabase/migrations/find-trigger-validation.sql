-- Find the function causing "POI not found for trigger point" error
-- The error uses the trigger point ID instead of attraction_id, suggesting 
-- there's a function that gets the trigger point ID and tries to find a POI with that ID

-- 1. List all functions in core schema that might be related
SELECT 
    'Core Functions' as check_type,
    routine_name,
    routine_type,
    routine_definition
FROM information_schema.routines 
WHERE routine_schema = 'core' 
AND (
    routine_definition ILIKE '%trigger_point%' OR
    routine_definition ILIKE '%attraction%' OR
    routine_definition ILIKE '%POI%' OR
    routine_name ILIKE '%trigger%' OR
    routine_name ILIKE '%extract%' OR
    routine_name ILIKE '%context%'
)
ORDER BY routine_name;

-- 2. Check if there are any active triggers (even if disabled, they might show up)
SELECT 
    'All Triggers Status' as check_type,
    trigger_name,
    event_object_table,
    action_timing,
    event_manipulation,
    action_statement,
    action_condition,
    CASE 
        WHEN tgenabled = 'O' THEN 'ENABLED'
        WHEN tgenabled = 'D' THEN 'DISABLED'
        WHEN tgenabled = 'A' THEN 'ENABLED (ALWAYS)'
        WHEN tgenabled = 'R' THEN 'ENABLED (REPLICA)'
        ELSE 'UNKNOWN'
    END as trigger_status
FROM information_schema.triggers t
JOIN pg_trigger pt ON pt.tgname = t.trigger_name
WHERE t.event_object_table = 'attraction_trigger_points'
AND t.event_object_schema = 'core';

-- 3. Look for any RPC functions that might be called automatically
SELECT 
    'RPC Functions' as check_type,
    routine_name,
    routine_definition
FROM information_schema.routines 
WHERE routine_schema = 'core' 
AND routine_type = 'FUNCTION'
AND (
    routine_definition ILIKE '%RAISE%' OR
    routine_definition ILIKE '%EXCEPTION%'
)
ORDER BY routine_name;

-- 4. Check for any policies on the table that might call functions
SELECT 
    'RLS Policies' as check_type,
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'attraction_trigger_points';
