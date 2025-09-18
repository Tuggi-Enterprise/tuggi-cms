-- Permanently disable the learning trigger that's causing POI errors
-- The extract_trigger_point_context function is failing when called by capture_trigger_point_learning

-- 1. Check current trigger status
SELECT 
    'Current Learning Trigger Status' as check_type,
    t.tgname,
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
WHERE c.relname = 'attraction_trigger_points'
AND n.nspname = 'core'
AND t.tgname = 'trigger_capture_learning';

-- 2. Disable the trigger (force it even if already disabled)
ALTER TABLE core.attraction_trigger_points DISABLE TRIGGER trigger_capture_learning;

-- 3. Verify it's disabled
SELECT 
    'Learning Trigger After Disable' as check_type,
    t.tgname,
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
WHERE c.relname = 'attraction_trigger_points'
AND n.nspname = 'core'
AND t.tgname = 'trigger_capture_learning';

-- 4. Test trigger point creation without the learning trigger
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
            'Test after disabling learning trigger',
            '4294eb5d-bbb6-4344-a6a7-5375532ffeaf',
            '4294eb5d-bbb6-4344-a6a7-5375532ffeaf'
        ) RETURNING id INTO test_id;
        
        RAISE NOTICE 'SUCCESS: Trigger point created after disabling learning trigger. ID: %', test_id;
        
        -- Clean up
        DELETE FROM core.attraction_trigger_points WHERE id = test_id;
        RAISE NOTICE 'Test trigger point cleaned up successfully';
        
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS error_msg = MESSAGE_TEXT;
        RAISE NOTICE 'ERROR: %', error_msg;
        RAISE NOTICE 'SQLSTATE: %', SQLSTATE;
    END;
END $$;

SELECT 'Learning trigger permanently disabled!' as status;
