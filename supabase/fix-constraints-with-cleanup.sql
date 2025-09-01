-- Fix foreign key constraints with data cleanup
-- First clean invalid data, then recreate constraints

-- 1. Check current constraints
SELECT 
  'Current FK Constraints' as check_type,
  tc.constraint_name, 
  tc.table_name, 
  kcu.column_name, 
  ccu.table_schema AS foreign_table_schema,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name 
FROM 
  information_schema.table_constraints AS tc 
  JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_schema = 'core'
  AND tc.table_name = 'attraction_trigger_points'
  AND kcu.column_name IN ('created_by', 'updated_by');

-- 2. Drop existing constraints first
ALTER TABLE core.attraction_trigger_points 
DROP CONSTRAINT IF EXISTS attraction_trigger_points_created_by_fkey CASCADE;

ALTER TABLE core.attraction_trigger_points 
DROP CONSTRAINT IF EXISTS attraction_trigger_points_updated_by_fkey CASCADE;

-- 3. Clean up invalid data - map invalid user IDs to the correct CMS user ID
UPDATE core.attraction_trigger_points 
SET created_by = '4294eb5d-bbb6-4344-a6a7-5375532ffeaf'
WHERE created_by IS NOT NULL 
  AND created_by NOT IN (SELECT id FROM core.cms_users);

UPDATE core.attraction_trigger_points 
SET updated_by = '4294eb5d-bbb6-4344-a6a7-5375532ffeaf'
WHERE updated_by IS NOT NULL 
  AND updated_by NOT IN (SELECT id FROM core.cms_users);

-- 4. Show how many records were cleaned
SELECT 
  'Data Cleanup Results' as check_type,
  COUNT(*) as total_records,
  COUNT(created_by) as records_with_created_by,
  COUNT(updated_by) as records_with_updated_by
FROM core.attraction_trigger_points;

-- 5. Now create the correct constraints
ALTER TABLE core.attraction_trigger_points 
ADD CONSTRAINT attraction_trigger_points_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES core.cms_users(id) ON DELETE SET NULL;

ALTER TABLE core.attraction_trigger_points 
ADD CONSTRAINT attraction_trigger_points_updated_by_fkey 
FOREIGN KEY (updated_by) REFERENCES core.cms_users(id) ON DELETE SET NULL;

-- 6. Verify the fix
SELECT 
  'Fixed FK Constraints' as check_type,
  tc.constraint_name, 
  tc.table_name, 
  kcu.column_name, 
  ccu.table_schema AS foreign_table_schema,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name 
FROM 
  information_schema.table_constraints AS tc 
  JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_schema = 'core'
  AND tc.table_name = 'attraction_trigger_points'
  AND kcu.column_name IN ('created_by', 'updated_by');

SELECT 'Foreign key constraints fixed with user ID mapping!' as status;
