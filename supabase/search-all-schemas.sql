-- Search for the POI validation function in ALL schemas
-- The error might be coming from a different schema or extension

-- 1. Search for any function containing the error message in ANY schema
SELECT 
    'Functions with POI validation (all schemas)' as check_type,
    routine_schema,
    routine_name,
    routine_type,
    routine_definition
FROM information_schema.routines 
WHERE (
    routine_definition ILIKE '%POI not found%' OR
    routine_definition ILIKE '%POI%not%found%' OR
    routine_definition ILIKE '%trigger point%' OR
    routine_definition ILIKE '%extract_trigger_point_context%'
)
ORDER BY routine_schema, routine_name;

-- 2. Check ALL triggers on attraction_trigger_points (including system ones)
SELECT 
    'All Triggers (all schemas)' as check_type,
    t.trigger_schema,
    t.trigger_name,
    t.event_object_table,
    t.action_timing,
    t.event_manipulation,
    t.action_statement,
    CASE 
        WHEN pt.tgenabled = 'O' THEN 'ENABLED'
        WHEN pt.tgenabled = 'D' THEN 'DISABLED'
        WHEN pt.tgenabled = 'A' THEN 'ENABLED (ALWAYS)'
        WHEN pt.tgenabled = 'R' THEN 'ENABLED (REPLICA)'
        ELSE 'UNKNOWN'
    END as trigger_status
FROM information_schema.triggers t
LEFT JOIN pg_trigger pt ON pt.tgname = t.trigger_name
WHERE t.event_object_table = 'attraction_trigger_points'
ORDER BY t.trigger_schema, t.trigger_name;

-- 3. Look for any function that might be called by the system
SELECT 
    'System Functions with Exceptions' as check_type,
    routine_schema,
    routine_name,
    routine_type,
    CASE 
        WHEN LENGTH(routine_definition) > 200 
        THEN LEFT(routine_definition, 200) || '...'
        ELSE routine_definition
    END as routine_definition_preview
FROM information_schema.routines 
WHERE routine_definition ILIKE '%RAISE%EXCEPTION%'
AND (
    routine_definition ILIKE '%trigger%' OR
    routine_definition ILIKE '%attraction%' OR
    routine_definition ILIKE '%POI%'
)
ORDER BY routine_schema, routine_name;

-- 4. Check if there are any event triggers or other system-level triggers
SELECT 
    'Event Triggers' as check_type,
    evtname as trigger_name,
    evtevent as event_type,
    evtfoid::regproc as function_name,
    evtenabled as enabled
FROM pg_event_trigger;

-- 5. Try to find the exact function by searching for the error pattern
SELECT 
    'Functions with exact error pattern' as check_type,
    routine_schema,
    routine_name,
    routine_definition
FROM information_schema.routines 
WHERE routine_definition ILIKE '%not found for trigger point%'
ORDER BY routine_schema, routine_name;
