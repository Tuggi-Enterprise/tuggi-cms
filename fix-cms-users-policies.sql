-- Fix CMS Users RLS Policies - Remove Infinite Recursion
-- Run this script to fix the cms_users table policies

-- ===========================================
-- STEP 1: DROP ALL EXISTING POLICIES
-- ===========================================

-- Drop all existing policies on cms_users table
DROP POLICY IF EXISTS "Authenticated users can read active cms users" ON core.cms_users;
DROP POLICY IF EXISTS "Users can read their own cms profile" ON core.cms_users;
DROP POLICY IF EXISTS "Admin users can manage cms users" ON core.cms_users;
DROP POLICY IF EXISTS "Authenticated users can read cms users" ON core.cms_users;
DROP POLICY IF EXISTS "Only service role can modify cms users" ON core.cms_users;
DROP POLICY IF EXISTS "Service role can manage cms users" ON core.cms_users;

-- ===========================================
-- STEP 2: CREATE NEW SIMPLE POLICIES (NO RECURSION)
-- ===========================================

-- Allow authenticated users to read cms_users (needed for login/middleware)
CREATE POLICY "Allow authenticated read on cms_users" 
ON core.cms_users FOR SELECT 
TO authenticated 
USING (true);

-- Allow service role full access (for admin operations)
CREATE POLICY "Allow service role full access on cms_users" 
ON core.cms_users FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);

-- ===========================================
-- STEP 3: VERIFY SETUP
-- ===========================================

-- Check that policies were created successfully
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'cms_users';

SELECT 'CMS Users policies fixed successfully!' as status; 