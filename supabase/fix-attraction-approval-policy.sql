-- Fix Attraction Approval Policy for CMS Admins Only
-- This script fixes the RLS policies for the attractions table to allow only CMS admins to manage POIs

-- ===========================================
-- STEP 1: DROP EXISTING POLICIES
-- ===========================================

-- Drop the existing restrictive update policy
DROP POLICY IF EXISTS "Users can update their own attractions" ON core.attractions;
DROP POLICY IF EXISTS "Authenticated users can insert attractions" ON core.attractions;
DROP POLICY IF EXISTS "Authenticated users can read attractions" ON core.attractions;

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
    WHERE user_id = auth.uid() 
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
    WHERE user_id = auth.uid() 
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
    WHERE user_id = auth.uid() 
    AND role = 'admin' 
    AND is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM core.cms_users 
    WHERE user_id = auth.uid() 
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
    WHERE user_id = auth.uid() 
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

SELECT 'Attraction policies updated for CMS admins only!' as status;
