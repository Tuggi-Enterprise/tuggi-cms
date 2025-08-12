-- Fix RLS Policies for Drive Schema Tables
-- This script adds CMS-specific policies to existing RLS setup
-- Works with the actual drive.profiles table structure

-- ===========================================
-- STEP 1: VERIFY EXISTING TABLES IN DRIVE SCHEMA
-- ===========================================

-- Check which tables exist in drive schema
SELECT 
  'Existing tables in drive schema:' as info,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'drive'
ORDER BY tablename;

-- ===========================================
-- STEP 2: VERIFY EXISTING POLICIES AND RLS STATUS
-- ===========================================

-- Check if RLS is enabled on drive.profiles
SELECT 
  'RLS Status for drive.profiles:' as info,
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'drive' AND tablename = 'profiles';

-- Check existing policies on drive.profiles
SELECT 
  'Existing policies on drive.profiles:' as info,
  policyname,
  cmd,
  roles,
  permissive
FROM pg_policies 
WHERE schemaname = 'drive' AND tablename = 'profiles';

-- ===========================================
-- STEP 3: ENABLE RLS ON EXISTING TABLES
-- ===========================================

-- Enable RLS on drive.profiles if not already enabled
ALTER TABLE drive.profiles ENABLE ROW LEVEL SECURITY;

-- Enable RLS on other drive tables that exist
DO $$
DECLARE
    table_name text;
BEGIN
    -- Enable RLS on trip_sessions if it exists
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'trip_sessions') THEN
        ALTER TABLE drive.trip_sessions ENABLE ROW LEVEL SECURITY;
        RAISE NOTICE 'Enabled RLS on drive.trip_sessions';
    END IF;
    
    -- Enable RLS on trip_session_attractions if it exists
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'trip_session_attractions') THEN
        ALTER TABLE drive.trip_session_attractions ENABLE ROW LEVEL SECURITY;
        RAISE NOTICE 'Enabled RLS on drive.trip_session_attractions';
    END IF;
    
    -- Enable RLS on attraction_feedback if it exists
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'attraction_feedback') THEN
        ALTER TABLE drive.attraction_feedback ENABLE ROW LEVEL SECURITY;
        RAISE NOTICE 'Enabled RLS on drive.attraction_feedback';
    END IF;
END $$;

-- ===========================================
-- STEP 4: ADD CMS-SPECIFIC POLICIES (KEEPING EXISTING ONES)
-- ===========================================

-- Add CMS-specific policy for profiles (in addition to existing admin policy)
-- This policy allows CMS users to view all profiles regardless of JWT role
CREATE POLICY "CMS users can view all profiles for dashboard" 
ON drive.profiles FOR SELECT 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM core.cms_users 
    WHERE email = auth.jwt() ->> 'email' 
    AND is_active = true 
    AND role IN ('admin', 'editor')
  )
);

-- Add CMS-specific policy for trip_sessions (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'trip_sessions') THEN
        EXECUTE 'CREATE POLICY "CMS users can view all trip sessions for dashboard" 
                ON drive.trip_sessions FOR SELECT 
                TO authenticated 
                USING (
                  EXISTS (
                    SELECT 1 FROM core.cms_users 
                    WHERE email = auth.jwt() ->> ''email'' 
                    AND is_active = true 
                    AND role IN (''admin'', ''editor'')
                  )
                )';
        RAISE NOTICE 'Created CMS policy for drive.trip_sessions';
    END IF;
END $$;

-- Add CMS-specific policy for trip_session_attractions (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'trip_session_attractions') THEN
        EXECUTE 'CREATE POLICY "CMS users can view all trip session attractions for dashboard" 
                ON drive.trip_session_attractions FOR SELECT 
                TO authenticated 
                USING (
                  EXISTS (
                    SELECT 1 FROM core.cms_users 
                    WHERE email = auth.jwt() ->> ''email'' 
                    AND is_active = true 
                    AND role IN (''admin'', ''editor'')
                  )
                )';
        RAISE NOTICE 'Created CMS policy for drive.trip_session_attractions';
    END IF;
END $$;

-- Add CMS-specific policy for attraction_feedback (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'attraction_feedback') THEN
        EXECUTE 'CREATE POLICY "CMS users can view all attraction feedback for dashboard" 
                ON drive.attraction_feedback FOR SELECT 
                TO authenticated 
                USING (
                  EXISTS (
                    SELECT 1 FROM core.cms_users 
                    WHERE email = auth.jwt() ->> ''email'' 
                    AND is_active = true 
                    AND role IN (''admin'', ''editor'')
                  )
                )';
        RAISE NOTICE 'Created CMS policy for drive.attraction_feedback';
    END IF;
END $$;

-- ===========================================
-- STEP 5: GRANT ADDITIONAL PERMISSIONS
-- ===========================================

-- Grant SELECT permissions to authenticated users for existing tables
GRANT SELECT ON drive.profiles TO authenticated;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'trip_sessions') THEN
        EXECUTE 'GRANT SELECT ON drive.trip_sessions TO authenticated';
        RAISE NOTICE 'Granted SELECT on drive.trip_sessions';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'trip_session_attractions') THEN
        EXECUTE 'GRANT SELECT ON drive.trip_session_attractions TO authenticated';
        RAISE NOTICE 'Granted SELECT on drive.trip_session_attractions';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'attraction_feedback') THEN
        EXECUTE 'GRANT SELECT ON drive.attraction_feedback TO authenticated';
        RAISE NOTICE 'Granted SELECT on drive.attraction_feedback';
    END IF;
END $$;

-- ===========================================
-- STEP 6: VERIFY ALL POLICIES
-- ===========================================

-- Check all policies on drive schema tables
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  permissive, 
  roles, 
  cmd, 
  qual 
FROM pg_policies 
WHERE schemaname = 'drive'
ORDER BY tablename, policyname;

-- ===========================================
-- STEP 7: TEST DATA ACCESS
-- ===========================================

-- Test query to verify CMS users can see all profiles
SELECT 
  'Profiles count' as table_name,
  COUNT(*) as total_records
FROM drive.profiles;

-- Test trip_sessions if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'trip_sessions') THEN
        RAISE NOTICE 'Trip sessions count: %', (SELECT COUNT(*) FROM drive.trip_sessions);
    ELSE
        RAISE NOTICE 'Table drive.trip_sessions does not exist';
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'drive' AND tablename = 'trip_session_attractions') THEN
        RAISE NOTICE 'Trip session attractions count: %', (SELECT COUNT(*) FROM drive.trip_session_attractions);
    ELSE
        RAISE NOTICE 'Table drive.trip_session_attractions does not exist';
    END IF;
END $$;

-- ===========================================
-- STEP 8: SHOW CURRENT JWT ROLE AND CMS STATUS
-- ===========================================

-- Check what role the current user has in their JWT
SELECT 
  'Current JWT role' as info,
  (auth.jwt() ->> 'role') as role,
  (auth.jwt() ->> 'email') as email;

-- Check if current user is in CMS users table
SELECT 
  'CMS User Status' as info,
  email,
  role,
  is_active
FROM core.cms_users 
WHERE email = auth.jwt() ->> 'email';

-- ===========================================
-- STEP 9: DEBUG EXISTING ADMIN POLICY
-- ===========================================

-- Check if the existing admin policy is working
SELECT 
  'Testing existing admin policy' as info,
  CASE 
    WHEN (auth.jwt() ->> 'role') = 'admin' THEN 'JWT role is admin'
    ELSE 'JWT role is NOT admin: ' || (auth.jwt() ->> 'role')
  END as jwt_role_check;

-- ===========================================
-- STEP 10: TEST SPECIFIC POLICIES
-- ===========================================

-- Test if CMS policy is working
SELECT 
  'Testing CMS policy' as info,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM core.cms_users 
      WHERE email = auth.jwt() ->> 'email' 
      AND is_active = true 
      AND role IN ('admin', 'editor')
    ) THEN 'CMS policy should allow access'
    ELSE 'CMS policy will NOT allow access - user not in cms_users table'
  END as cms_policy_check;

-- Show all CMS users for reference
SELECT 
  'All CMS Users:' as info,
  email,
  role,
  is_active
FROM core.cms_users 
ORDER BY role, email;

SELECT 'CMS-specific policies added successfully! Existing policies preserved.' as status;
