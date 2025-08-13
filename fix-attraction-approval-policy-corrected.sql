-- Fix Attraction Approval Policy for CMS Admins Only
-- This script fixes the RLS policies for the attractions table to allow only CMS admins to manage POIs
-- CORRECTED VERSION: Uses email instead of user_id for cms_users table

-- ===========================================
-- STEP 1: DROP EXISTING POLICIES
-- ===========================================

-- Drop all existing policies on attractions table
DROP POLICY IF EXISTS "Users can update their own attractions" ON core.attractions;
DROP POLICY IF EXISTS "Authenticated users can insert attractions" ON core.attractions;
DROP POLICY IF EXISTS "Authenticated users can read attractions" ON core.attractions;
DROP POLICY IF EXISTS "CMS admins can insert attractions" ON core.attractions;
DROP POLICY IF EXISTS "CMS admins can read attractions" ON core.attractions;
DROP POLICY IF EXISTS "CMS admins can update attractions" ON core.attractions;
DROP POLICY IF EXISTS "CMS admins can delete attractions" ON core.attractions;
DROP POLICY IF EXISTS "Authenticated users can read all attractions" ON core.attractions;

-- ===========================================
-- STEP 2: CREATE NEW RESTRICTIVE POLICIES FOR CMS ADMINS ONLY
-- ===========================================

-- Only CMS admins can insert attractions
CREATE POLICY "CMS admins can insert attractions" 
ON core.attractions FOR INSERT 
TO authenticated 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM core.cms_users 
    WHERE email = auth.jwt() ->> 'email'
    AND role = 'admin' 
    AND is_active = true
  )
);

-- Only CMS admins can read attractions
CREATE POLICY "CMS admins can read attractions" 
ON core.attractions FOR SELECT 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM core.cms_users 
    WHERE email = auth.jwt() ->> 'email'
    AND role = 'admin' 
    AND is_active = true
  )
);

-- Only CMS admins can update attractions (including approval)
CREATE POLICY "CMS admins can update attractions" 
ON core.attractions FOR UPDATE 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM core.cms_users 
    WHERE email = auth.jwt() ->> 'email'
    AND role = 'admin' 
    AND is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM core.cms_users 
    WHERE email = auth.jwt() ->> 'email'
    AND role = 'admin' 
    AND is_active = true
  )
);

-- Only CMS admins can delete attractions
CREATE POLICY "CMS admins can delete attractions" 
ON core.attractions FOR DELETE 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM core.cms_users 
    WHERE email = auth.jwt() ->> 'email'
    AND role = 'admin' 
    AND is_active = true
  )
);

-- ===========================================
-- STEP 3: VERIFY SETUP
-- ===========================================

-- Check that policies were created successfully
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
-- STEP 4: TEST WITH SPECIFIC USER
-- ===========================================

-- Test the policy with leandro.ramos@tuggi.app
SELECT 
  'Testing CMS admin policy for leandro.ramos@tuggi.app:' as section,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM core.cms_users 
      WHERE email = 'leandro.ramos@tuggi.app'
      AND role = 'admin' 
      AND is_active = true
    ) THEN '✅ CMS admin policy should allow access'
    ELSE '❌ CMS admin policy will NOT allow access - user not admin or inactive'
  END as policy_test;

-- Show current CMS users for reference
SELECT 
  'Current CMS Users:' as section,
  id,
  email,
  full_name,
  role,
  is_active,
  created_at,
  CASE 
    WHEN email = 'leandro.ramos@tuggi.app' THEN 'CURRENT USER'
    ELSE 'OTHER USER'
  END as status
FROM core.cms_users 
ORDER BY role, email;

-- ===========================================
-- STEP 5: CHECK FOR POLICY CONFLICTS
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
-- STEP 6: SUMMARY
-- ===========================================

SELECT 
  'Summary for leandro.ramos@tuggi.app:' as section,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM core.cms_users 
      WHERE email = 'leandro.ramos@tuggi.app'
      AND role = 'admin' 
      AND is_active = true
    ) THEN '✅ Is CMS admin - should be able to approve POIs'
    ELSE '❌ Is NOT CMS admin - will NOT be able to approve POIs'
  END as cms_status;

SELECT 'Attraction policies updated for CMS admins only!' as status;

