-- Check Current RLS Policies and Test User Access
-- This script will help us understand why leandro.ramos@tuggi.app can save while others cannot

-- ===========================================
-- STEP 1: CHECK CURRENT POLICIES ON ATTRACTIONS
-- ===========================================

SELECT 
  'Current Policies on core.attractions:' as section,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'attractions' AND schemaname = 'core'
ORDER BY cmd, policyname;

-- ===========================================
-- STEP 2: CHECK CMS USER STATUS FOR leandro.ramos@tuggi.app
-- ===========================================

SELECT 
  'CMS User Status for leandro.ramos@tuggi.app:' as section,
  id,
  email,
  full_name,
  role,
  is_active,
  created_at,
  last_login_at
FROM core.cms_users 
WHERE email = 'leandro.ramos@tuggi.app';

-- ===========================================
-- STEP 3: CHECK AUTH USER STATUS
-- ===========================================

SELECT 
  'Auth User Status:' as section,
  auth.uid() as current_user_id,
  auth.jwt() ->> 'email' as current_user_email,
  auth.jwt() ->> 'role' as jwt_role;

-- ===========================================
-- STEP 4: TEST DIFFERENT POLICY CONDITIONS
-- ===========================================

-- Test CMS admin policy condition
SELECT 
  'Testing CMS Admin Policy:' as section,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM core.cms_users 
      WHERE email = 'leandro.ramos@tuggi.app'
      AND role = 'admin' 
      AND is_active = true
    ) THEN '✅ CMS admin policy would allow access'
    ELSE '❌ CMS admin policy would NOT allow access'
  END as cms_admin_test;

-- Test user_id policy condition
SELECT 
  'Testing User ID Policy:' as section,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM auth.users 
      WHERE email = 'leandro.ramos@tuggi.app'
    ) THEN '✅ User exists in auth.users'
    ELSE '❌ User does not exist in auth.users'
  END as auth_user_test,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM core.attractions 
      WHERE user_id = (SELECT id FROM auth.users WHERE email = 'leandro.ramos@tuggi.app')
    ) THEN '✅ User has POIs with user_id set'
    ELSE '❌ User has no POIs with user_id set'
  END as user_pois_test;

-- ===========================================
-- STEP 5: CHECK ATTRACTIONS CREATED BY THE USER
-- ===========================================

SELECT 
  'POIs created by leandro.ramos@tuggi.app:' as section,
  COUNT(*) as total_pois,
  COUNT(CASE WHEN user_id IS NOT NULL THEN 1 END) as with_user_id,
  COUNT(CASE WHEN user_id IS NULL THEN 1 END) as without_user_id,
  COUNT(CASE WHEN approved = true THEN 1 END) as approved_pois,
  COUNT(CASE WHEN approved = false THEN 1 END) as pending_pois
FROM core.attractions 
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'leandro.ramos@tuggi.app');

-- ===========================================
-- STEP 6: TEST POLICY CONFLICTS
-- ===========================================

-- Check if there are multiple policies for the same operation
SELECT 
  'Policy Conflicts Check:' as section,
  cmd,
  COUNT(*) as policy_count,
  STRING_AGG(policyname, ', ') as policy_names
FROM pg_policies 
WHERE tablename = 'attractions' AND schemaname = 'core'
GROUP BY cmd
HAVING COUNT(*) > 1;

-- ===========================================
-- STEP 7: SUMMARY
-- ===========================================

SELECT 
  'Summary for leandro.ramos@tuggi.app:' as section,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM core.cms_users 
      WHERE email = 'leandro.ramos@tuggi.app'
      AND role = 'admin' 
      AND is_active = true
    ) THEN '✅ Is CMS admin'
    ELSE '❌ Is NOT CMS admin'
  END as cms_status,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM auth.users 
      WHERE email = 'leandro.ramos@tuggi.app'
    ) THEN '✅ Exists in auth.users'
    ELSE '❌ Does NOT exist in auth.users'
  END as auth_status,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'attractions' 
      AND schemaname = 'core'
      AND cmd = 'UPDATE'
      AND qual LIKE '%auth.uid() = user_id%'
    ) THEN '✅ Has user_id based policy'
    ELSE '❌ No user_id based policy'
  END as user_id_policy_status;

SELECT 'Policy check completed!' as status;
