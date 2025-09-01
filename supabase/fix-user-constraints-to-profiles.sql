-- Fix foreign key constraints to point to core.cms_users table instead of auth.users
-- The user exists in core.cms_users but not in auth.users

-- ===========================================
-- CHECK CURRENT CONSTRAINTS
-- ===========================================

-- Show current foreign key constraints
SELECT 
  'Current FK Constraints' as check_type,
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

-- Drop the existing foreign key constraints that point to auth.users
ALTER TABLE core.attraction_trigger_points 
DROP CONSTRAINT IF EXISTS attraction_trigger_points_created_by_fkey;

ALTER TABLE core.attraction_trigger_points 
DROP CONSTRAINT IF EXISTS attraction_trigger_points_updated_by_fkey;

-- ===========================================
-- ADD CORRECT FOREIGN KEY CONSTRAINTS
-- ===========================================

-- Add correct foreign key constraints pointing to core.cms_users table
ALTER TABLE core.attraction_trigger_points 
ADD CONSTRAINT attraction_trigger_points_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES core.cms_users(id) ON DELETE SET NULL;

ALTER TABLE core.attraction_trigger_points 
ADD CONSTRAINT attraction_trigger_points_updated_by_fkey 
FOREIGN KEY (updated_by) REFERENCES core.cms_users(id) ON DELETE SET NULL;

-- ===========================================
-- VERIFY NEW CONSTRAINTS
-- ===========================================

-- Show the corrected foreign key constraints
SELECT 
  'Fixed FK Constraints' as check_type,
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
-- TEST THE FIX
-- ===========================================

-- Test trigger point creation with the user that exists in profiles
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
            validation_notes,
            created_by,
            updated_by
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
            'Test with cms_users FK constraint',
            '4294eb5d-bbb6-4344-a6a7-5375532ffeaf',
            '4294eb5d-bbb6-4344-a6a7-5375532ffeaf'
        ) RETURNING id INTO test_id;
        
        RAISE NOTICE 'SUCCESS: Trigger point created with profiles constraint. ID: %', test_id;
        
        -- Clean up
        DELETE FROM core.attraction_trigger_points WHERE id = test_id;
        RAISE NOTICE 'Test trigger point cleaned up successfully';
        
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS error_msg = MESSAGE_TEXT;
        RAISE NOTICE 'ERROR: %', error_msg;
        RAISE NOTICE 'SQLSTATE: %', SQLSTATE;
    END;
END $$;

SELECT 'Foreign key constraints fixed to point to core.cms_users table!' as status;
