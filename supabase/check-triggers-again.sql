-- Check if any triggers were re-enabled after our changes
-- The POI error is back, suggesting a trigger is active again

-- 1. Check all triggers on attraction_trigger_points table
SELECT 
    'Active Triggers' as check_type,
    t.tgname as trigger_name,
    c.relname as table_name,
    n.nspname as schema_name,
    p.proname as function_name,
    CASE t.tgenabled
        WHEN 'O' THEN 'ENABLED'
        WHEN 'D' THEN 'DISABLED' 
        WHEN 'A' THEN 'ENABLED (ALWAYS)'
        WHEN 'R' THEN 'ENABLED (REPLICA)'
        ELSE 'UNKNOWN: ' || t.tgenabled::text
    END as status
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'attraction_trigger_points'
AND n.nspname = 'core'
ORDER BY t.tgname;

-- 2. Specifically check the learning trigger status
SELECT 
    'Learning Trigger Check' as check_type,
    t.tgname,
    CASE t.tgenabled
        WHEN 'O' THEN 'ENABLED'
        WHEN 'D' THEN 'DISABLED' 
        WHEN 'A' THEN 'ENABLED (ALWAYS)'
        WHEN 'R' THEN 'ENABLED (REPLICA)'
        ELSE 'UNKNOWN: ' || t.tgenabled::text
    END as status,
    p.proname as function_name
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'attraction_trigger_points'
AND n.nspname = 'core'
AND (t.tgname ILIKE '%learning%' OR t.tgname ILIKE '%capture%');

-- 3. If the learning trigger is enabled again, disable it
DO $$
BEGIN
    -- Disable the trigger if it exists and is enabled
    IF EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE c.relname = 'attraction_trigger_points'
        AND n.nspname = 'core'
        AND t.tgname = 'trigger_capture_learning'
        AND t.tgenabled = 'O'
    ) THEN
        ALTER TABLE core.attraction_trigger_points DISABLE TRIGGER trigger_capture_learning;
        RAISE NOTICE 'Learning trigger was re-enabled - disabled it again';
    ELSE
        RAISE NOTICE 'Learning trigger is not enabled';
    END IF;
END $$;

-- 4. Check for any other triggers that might be causing the POI validation
SELECT 
    'All Core Functions with POI' as check_type,
    routine_name,
    routine_type,
    CASE 
        WHEN LENGTH(routine_definition) > 300 
        THEN LEFT(routine_definition, 300) || '...'
        ELSE routine_definition
    END as routine_definition_preview
FROM information_schema.routines 
WHERE routine_schema = 'core' 
AND (
    routine_definition ILIKE '%POI not found%' OR
    routine_definition ILIKE '%extract_trigger_point_context%' OR
    routine_definition ILIKE '%trigger_point%'
)
ORDER BY routine_name;
