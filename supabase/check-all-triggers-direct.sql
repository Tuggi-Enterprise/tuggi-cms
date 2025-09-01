-- Direct check of ALL triggers on attraction_trigger_points table using pg_trigger
-- This bypasses information_schema and goes directly to PostgreSQL system tables

-- 1. Get ALL triggers directly from pg_trigger
SELECT 
    'Direct Trigger Check' as check_type,
    t.tgname as trigger_name,
    c.relname as table_name,
    n.nspname as schema_name,
    p.proname as function_name,
    CASE t.tgenabled
        WHEN 'O' THEN 'ENABLED'
        WHEN 'D' THEN 'DISABLED' 
        WHEN 'A' THEN 'ENABLED (ALWAYS)'
        WHEN 'R' THEN 'ENABLED (REPLICA)'
        ELSE 'UNKNOWN: ' || t.tgenabled
    END as status,
    CASE t.tgtype & 2
        WHEN 0 THEN 'BEFORE'
        ELSE 'AFTER'
    END as timing,
    CASE 
        WHEN t.tgtype & 4 = 4 THEN 'INSERT '
        ELSE ''
    END ||
    CASE 
        WHEN t.tgtype & 8 = 8 THEN 'DELETE '
        ELSE ''
    END ||
    CASE 
        WHEN t.tgtype & 16 = 16 THEN 'UPDATE '
        ELSE ''
    END as events
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'attraction_trigger_points'
AND n.nspname = 'core'
ORDER BY t.tgname;

-- 2. Get the actual function definitions for any triggers found
SELECT 
    'Trigger Function Definitions' as check_type,
    p.proname as function_name,
    p.prosrc as function_body
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'attraction_trigger_points'
AND n.nspname = 'core';

-- 3. Check if the learning trigger is really disabled
SELECT 
    'Learning Trigger Status' as check_type,
    t.tgname,
    CASE t.tgenabled
        WHEN 'O' THEN 'ENABLED'
        WHEN 'D' THEN 'DISABLED' 
        WHEN 'A' THEN 'ENABLED (ALWAYS)'
        WHEN 'R' THEN 'ENABLED (REPLICA)'
        ELSE 'UNKNOWN: ' || t.tgenabled
    END as status
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE c.relname = 'attraction_trigger_points'
AND n.nspname = 'core'
AND t.tgname ILIKE '%learning%';

-- 4. Also check for any triggers with 'capture' in the name
SELECT 
    'Capture Triggers' as check_type,
    t.tgname,
    CASE t.tgenabled
        WHEN 'O' THEN 'ENABLED'
        WHEN 'D' THEN 'DISABLED' 
        WHEN 'A' THEN 'ENABLED (ALWAYS)'
        WHEN 'R' THEN 'ENABLED (REPLICA)'
        ELSE 'UNKNOWN: ' || t.tgenabled
    END as status,
    p.proname as function_name
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE c.relname = 'attraction_trigger_points'
AND n.nspname = 'core'
AND (t.tgname ILIKE '%capture%' OR p.proname ILIKE '%capture%');
