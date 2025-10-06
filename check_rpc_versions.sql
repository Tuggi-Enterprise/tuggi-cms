-- Check if there are multiple versions of cms_search_pois RPC
-- This will help us identify which RPC is actually being used

-- Check all functions with similar names
SELECT 
  routine_name,
  routine_type,
  data_type,
  created,
  last_altered
FROM information_schema.routines 
WHERE routine_schema = 'core' 
  AND routine_name LIKE '%cms_search%'
ORDER BY last_altered DESC;

-- Check the current RPC definition
SELECT pg_get_functiondef(oid) as function_definition
FROM pg_proc 
WHERE proname = 'cms_search_pois' 
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'core');
