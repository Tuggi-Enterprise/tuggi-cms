-- Test trigger point creation without user tracking fields
-- This will help us identify if the issue is with the new foreign key constraints

DO $$
DECLARE
    test_id uuid;
    error_msg text;
    error_detail text;
    error_hint text;
    error_context text;
BEGIN
    BEGIN
        -- Try inserting WITHOUT created_by and updated_by fields
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
            'Test without user tracking'
        ) RETURNING id INTO test_id;
        
        RAISE NOTICE 'SUCCESS: Test trigger point created WITHOUT user tracking. ID: %', test_id;
        
        -- Clean up
        DELETE FROM core.attraction_trigger_points WHERE id = test_id;
        RAISE NOTICE 'Test trigger point cleaned up successfully';
        
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS 
            error_msg = MESSAGE_TEXT,
            error_detail = PG_EXCEPTION_DETAIL,
            error_hint = PG_EXCEPTION_HINT,
            error_context = PG_EXCEPTION_CONTEXT;
            
        RAISE NOTICE 'ERROR without user tracking: %', error_msg;
        RAISE NOTICE 'SQLSTATE: %', SQLSTATE;
        RAISE NOTICE 'DETAIL: %', error_detail;
        RAISE NOTICE 'CONTEXT: %', error_context;
    END;
    
    -- Now try WITH user tracking but with a valid user ID
    BEGIN
        -- Try inserting WITH valid user tracking
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
            'Test with valid user tracking',
            '7f6a0516-4867-44c7-964a-2fd99fbdbb0f',
            '7f6a0516-4867-44c7-964a-2fd99fbdbb0f'
        ) RETURNING id INTO test_id;
        
        RAISE NOTICE 'SUCCESS: Test trigger point created WITH valid user tracking. ID: %', test_id;
        
        -- Clean up
        DELETE FROM core.attraction_trigger_points WHERE id = test_id;
        RAISE NOTICE 'Test trigger point with user tracking cleaned up successfully';
        
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS 
            error_msg = MESSAGE_TEXT,
            error_detail = PG_EXCEPTION_DETAIL,
            error_hint = PG_EXCEPTION_HINT,
            error_context = PG_EXCEPTION_CONTEXT;
            
        RAISE NOTICE 'ERROR with user tracking: %', error_msg;
        RAISE NOTICE 'SQLSTATE: %', SQLSTATE;
        RAISE NOTICE 'DETAIL: %', error_detail;
        RAISE NOTICE 'CONTEXT: %', error_context;
    END;
END $$;
