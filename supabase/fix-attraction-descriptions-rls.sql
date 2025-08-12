-- ===========================================
-- FIX RLS POLICIES FOR ATTRACTION_DESCRIPTIONS TABLE
-- ===========================================
-- This script adds the missing RLS policies for the attraction_descriptions table
-- Required for the POI management modal to work correctly

-- ===========================================
-- ENABLE ROW LEVEL SECURITY
-- ===========================================

-- Enable RLS on attraction_descriptions table
ALTER TABLE core.attraction_descriptions ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- CREATE RLS POLICIES
-- ===========================================

-- Allow CMS users to insert attraction descriptions
CREATE POLICY "CMS users can insert attraction descriptions" 
ON core.attraction_descriptions FOR INSERT 
TO authenticated 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM core.cms_users 
    WHERE email = auth.jwt() ->> 'email' 
    AND is_active = true 
    AND role IN ('admin', 'editor')
  )
);

-- Allow CMS users to update attraction descriptions
CREATE POLICY "CMS users can update attraction descriptions" 
ON core.attraction_descriptions FOR UPDATE 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM core.cms_users 
    WHERE email = auth.jwt() ->> 'email' 
    AND is_active = true 
    AND role IN ('admin', 'editor')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM core.cms_users 
    WHERE email = auth.jwt() ->> 'email' 
    AND is_active = true 
    AND role IN ('admin', 'editor')
  )
);

-- Allow CMS users to delete attraction descriptions
CREATE POLICY "CMS users can delete attraction descriptions" 
ON core.attraction_descriptions FOR DELETE 
TO authenticated 
USING (
  EXISTS (
    SELECT 1 FROM core.cms_users 
    WHERE email = auth.jwt() ->> 'email' 
    AND is_active = true 
    AND role IN ('admin', 'editor')
  )
);

-- Service role full access (for edge functions)
CREATE POLICY "Service role can manage attraction descriptions" 
ON core.attraction_descriptions FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);

-- ===========================================
-- GRANT PERMISSIONS
-- ===========================================

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON core.attraction_descriptions TO authenticated;

-- Grant full permissions to service role
GRANT ALL ON core.attraction_descriptions TO service_role;

-- ===========================================
-- VERIFY POLICIES
-- ===========================================

-- Display all policies on attraction_descriptions table
SELECT 
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'attraction_descriptions' 
  AND schemaname = 'core'
ORDER BY policyname;

-- ===========================================
-- COMPLETION MESSAGE
-- ===========================================

SELECT 'RLS policies for attraction_descriptions table created successfully!' as status;
