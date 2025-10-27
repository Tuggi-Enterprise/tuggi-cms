-- Test UUID functions availability in Supabase
-- This migration tests which UUID functions are available

-- Test 1: Check if uuid-ossp extension is available
DO $$
BEGIN
    -- Try to create extension
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    RAISE NOTICE 'uuid-ossp extension created successfully';
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'uuid-ossp extension error: %', SQLERRM;
END $$;

-- Test 2: Check available UUID functions
DO $$
DECLARE
    func_exists boolean;
BEGIN
    -- Test uuid_generate_v4
    BEGIN
        PERFORM uuid_generate_v4();
        RAISE NOTICE 'uuid_generate_v4: AVAILABLE';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE 'uuid_generate_v4: NOT AVAILABLE - %', SQLERRM;
    END;
    
    -- Test uuid_generate_v5
    BEGIN
        PERFORM uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'test');
        RAISE NOTICE 'uuid_generate_v5: AVAILABLE';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE 'uuid_generate_v5: NOT AVAILABLE - %', SQLERRM;
    END;
    
    -- Test uuid_ns_dns
    BEGIN
        PERFORM uuid_ns_dns();
        RAISE NOTICE 'uuid_ns_dns: AVAILABLE';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE 'uuid_ns_dns: NOT AVAILABLE - %', SQLERRM;
    END;
    
    -- Test gen_random_uuid (PostgreSQL 13+)
    BEGIN
        PERFORM gen_random_uuid();
        RAISE NOTICE 'gen_random_uuid: AVAILABLE';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE 'gen_random_uuid: NOT AVAILABLE - %', SQLERRM;
    END;
END $$;
