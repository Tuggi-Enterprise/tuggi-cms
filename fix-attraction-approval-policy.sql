-- Fix Attraction Approval Policy for CMS Admins Only
-- This script fixes the RLS policies for the attractions table to allow only CMS admins to manage POIs

-- ===========================================
-- STEP 1: DROP EXISTING POLICIES
-- ===========================================

-- Drop the existing restrictive update policy
DROP POLICY IF EXISTS "Users can update their own attractions" ON core.attractions;
DROP POLICY IF EXISTS "Authenticated users can insert attractions" ON core.attractions;
DROP POLICY IF EXISTS "Authenticated users can read attractions" ON core.attractions;
DROP POLICY IF EXISTS "CMS admins can insert attractions" ON core.attractions;
DROP POLICY IF EXISTS "CMS admins can read attractions" ON core.attractions;
DROP POLICY IF EXISTS "CMS admins can update attractions" ON core.attractions;
DROP POLICY IF EXISTS "CMS admins can delete attractions" ON core.attractions;

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
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'attractions' AND schemaname = 'core';

-- Test the policy with current user
SELECT 
  'Testing CMS admin policy' as info,
  auth.jwt() ->> 'email' as current_user_email,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM core.cms_users 
      WHERE email = auth.jwt() ->> 'email'
      AND role = 'admin' 
      AND is_active = true
    ) THEN '✅ CMS admin policy should allow access'
    ELSE '❌ CMS admin policy will NOT allow access - user not admin or inactive'
  END as policy_test;

-- Show current CMS users for reference
SELECT 
  'Current CMS Users:' as info,
  email,
  role,
  is_active,
  CASE 
    WHEN email = auth.jwt() ->> 'email' THEN 'CURRENT USER'
    ELSE 'OTHER USER'
  END as status
FROM core.cms_users 
ORDER BY role, email;

SELECT 'Attraction policies updated for CMS admins only!' as status;




