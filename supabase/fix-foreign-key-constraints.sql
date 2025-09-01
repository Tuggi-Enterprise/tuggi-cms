-- Fix foreign key constraints for user tracking
-- The current constraints are pointing to wrong tables

-- ===========================================
-- CHECK CURRENT CONSTRAINTS
-- ===========================================

-- Show current foreign key constraints
SELECT 
  tc.constraint_name, 
  tc.table_name, 
  kcu.column_name, 
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

-- ===========================================
-- DROP INCORRECT FOREIGN KEY CONSTRAINTS
-- ===========================================

-- Drop the existing foreign key constraints that point to wrong tables
ALTER TABLE core.attraction_trigger_points 
DROP CONSTRAINT IF EXISTS attraction_trigger_points_created_by_fkey;

ALTER TABLE core.attraction_trigger_points 
DROP CONSTRAINT IF EXISTS attraction_trigger_points_updated_by_fkey;

-- ===========================================
-- ADD CORRECT FOREIGN KEY CONSTRAINTS
-- ===========================================

-- Add correct foreign key constraints pointing to auth.users
ALTER TABLE core.attraction_trigger_points 
ADD CONSTRAINT attraction_trigger_points_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE core.attraction_trigger_points 
ADD CONSTRAINT attraction_trigger_points_updated_by_fkey 
FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ===========================================
-- VERIFY NEW CONSTRAINTS
-- ===========================================

-- Show the corrected foreign key constraints
SELECT 
  tc.constraint_name, 
  tc.table_name, 
  kcu.column_name, 
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

SELECT 'Foreign key constraints fixed successfully!' as status;
