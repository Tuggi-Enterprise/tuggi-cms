-- Test Dashboard Access - Verify RLS Policies are Working
-- Run this script to test if CMS users can access all data

-- ===========================================
-- STEP 1: CHECK CURRENT USER AND JWT
-- ===========================================

SELECT 
  'Current User Info:' as section,
  auth.uid() as user_id,
  auth.jwt() ->> 'email' as email,
  auth.jwt() ->> 'role' as jwt_role;

-- ===========================================
-- STEP 2: CHECK CMS USER STATUS
-- ===========================================

SELECT 
  'CMS User Status:' as section,
  email,
  role,
  is_active,
  CASE 
    WHEN email = auth.jwt() ->> 'email' THEN 'MATCH - Current user found in CMS'
    ELSE 'NO MATCH - Current user not in CMS'
  END as status
FROM core.cms_users 
WHERE email = auth.jwt() ->> 'email';

-- ===========================================
-- STEP 3: CHECK EXISTING TABLES IN DRIVE SCHEMA
-- ===========================================

SELECT 
  'Existing tables in drive schema:' as section,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'drive'
ORDER BY tablename;

-- ===========================================
-- STEP 4: TEST PROFILE ACCESS
-- ===========================================

-- Test direct count
SELECT 
  'Direct Profile Count:' as section,
  COUNT(*) as total_profiles
FROM drive.profiles;

-- Test with pagination (like dashboard does)
WITH profile_chunks AS (
  SELECT id, full_name, created_at
  FROM drive.profiles
  ORDER BY created_at
  LIMIT 1000
)
SELECT 
  'Paginated Profile Count:' as section,
  COUNT(*) as profiles_in_chunk
FROM profile_chunks;

-- ===========================================
-- STEP 5: TEST TRIP SESSIONS ACCESS (IF EXISTS)
-- ===========================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'trip_sessions') THEN
        RAISE NOTICE 'Trip sessions table exists - testing access';
        -- This will be executed if the table exists
        PERFORM COUNT(*) FROM drive.trip_sessions;
        RAISE NOTICE 'Trip sessions count: %', (SELECT COUNT(*) FROM drive.trip_sessions);
        
        -- Test with date filter (like dashboard does)
        RAISE NOTICE 'Recent trip sessions count (last 30 days): %', 
          (SELECT COUNT(*) FROM drive.trip_sessions WHERE start_time >= NOW() - INTERVAL '30 days');
    ELSE
        RAISE NOTICE 'Table drive.trip_sessions does not exist';
    END IF;
END $$;

-- ===========================================
-- STEP 6: TEST TRIP SESSION ATTRACTIONS ACCESS (IF EXISTS)
-- ===========================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'trip_session_attractions') THEN
        RAISE NOTICE 'Trip session attractions table exists - testing access';
        -- This will be executed if the table exists
        PERFORM COUNT(*) FROM drive.trip_session_attractions;
        RAISE NOTICE 'Trip session attractions count: %', (SELECT COUNT(*) FROM drive.trip_session_attractions);
        
        -- Test with date filter (like dashboard does)
        RAISE NOTICE 'Recent trip session attractions count (last 30 days): %', 
          (SELECT COUNT(*) FROM drive.trip_session_attractions WHERE played_at >= NOW() - INTERVAL '30 days');
    ELSE
        RAISE NOTICE 'Table drive.trip_session_attractions does not exist';
    END IF;
END $$;

-- ===========================================
-- STEP 7: TEST RLS POLICIES EXPLICITLY
-- ===========================================

-- Test if CMS policy condition is met
SELECT 
  'CMS Policy Test:' as section,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM core.cms_users 
      WHERE email = auth.jwt() ->> 'email' 
      AND is_active = true 
      AND role IN ('admin', 'editor')
    ) THEN 'PASS - CMS policy should allow access'
    ELSE 'FAIL - CMS policy will block access'
  END as cms_policy_result;

-- Test if admin policy condition is met
SELECT 
  'Admin Policy Test:' as section,
  CASE 
    WHEN (auth.jwt() ->> 'role') = 'admin' THEN 'PASS - Admin policy should allow access'
    ELSE 'FAIL - Admin policy will block access (JWT role: ' || (auth.jwt() ->> 'role') || ')'
  END as admin_policy_result;

-- ===========================================
-- STEP 8: SHOW SAMPLE DATA (IF ACCESSIBLE)
-- ===========================================

-- Show sample profiles (first 5)
SELECT 
  'Sample Profiles:' as section,
  id,
  full_name,
  nickname,
  country,
  created_at
FROM drive.profiles
ORDER BY created_at DESC
LIMIT 5;

-- Show sample trip sessions (first 5) if table exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'trip_sessions') THEN
        RAISE NOTICE 'Sample Trip Sessions:';
        -- This would show the data if we could do it in a DO block
        -- For now, just note that the table exists
        RAISE NOTICE 'Trip sessions table exists and is accessible';
    ELSE
        RAISE NOTICE 'Trip sessions table does not exist';
    END IF;
END $$;

-- ===========================================
-- STEP 9: SUMMARY
-- ===========================================

SELECT 
  'Dashboard Access Summary:' as section,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM core.cms_users 
      WHERE email = auth.jwt() ->> 'email' 
      AND is_active = true 
      AND role IN ('admin', 'editor')
    ) THEN '✅ CMS user - should have full dashboard access'
    WHEN (auth.jwt() ->> 'role') = 'admin' THEN '✅ Admin user - should have full dashboard access'
    ELSE '❌ User not authorized for dashboard access'
  END as access_status;

SELECT 'Dashboard access test completed!' as status;
