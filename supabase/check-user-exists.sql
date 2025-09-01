-- Check if the user ID from the error exists in auth.users
-- User ID from error: 7f6a0516-4867-44c7-964a-2fd99fbdbb0f

-- 1. Check if the user exists in auth.users
SELECT 
    'User Existence Check' as check_type,
    id,
    email,
    created_at,
    email_confirmed_at
FROM auth.users 
WHERE id = '7f6a0516-4867-44c7-964a-2fd99fbdbb0f';

-- 2. Check current foreign key constraints
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

-- 3. Try to insert WITHOUT user tracking to see if that's the issue
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
            -- NOTE: NOT including created_by and updated_by
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
            'Test WITHOUT user tracking fields'
        ) RETURNING id INTO test_id;
        
        RAISE NOTICE 'SUCCESS: Trigger point created WITHOUT user fields. ID: %', test_id;
        
        -- Clean up
        DELETE FROM core.attraction_trigger_points WHERE id = test_id;
        RAISE NOTICE 'Cleaned up test trigger point';
        
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS error_msg = MESSAGE_TEXT;
        RAISE NOTICE 'ERROR without user fields: %', error_msg;
        RAISE NOTICE 'SQLSTATE: %', SQLSTATE;
    END;
END $$;

-- 4. If the user doesn't exist, let's see what users DO exist
SELECT 
    'Available Users' as check_type,
    id,
    email,
    created_at
FROM auth.users 
ORDER BY created_at DESC
LIMIT 5;
