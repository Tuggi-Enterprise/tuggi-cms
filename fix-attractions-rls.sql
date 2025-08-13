-- Fix RLS policies for attractions to allow reading all POIs
-- Drop the restrictive policy
DROP POLICY IF EXISTS "Authenticated users can read attractions" ON core.attractions;

-- Create a new policy that allows reading all attractions
CREATE POLICY "Authenticated users can read all attractions" 
  ON core.attractions FOR SELECT TO authenticated USING (true);

-- Verify the change
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'attractions' 
  AND schemaname = 'core';

-- Test the fix by checking if we can now see all attractions
SELECT 
    COUNT(*) as total_attractions,
    COUNT(CASE WHEN user_id IS NOT NULL THEN 1 END) as with_user_id,
    COUNT(CASE WHEN user_id IS NULL THEN 1 END) as without_user_id
FROM core.attractions;

-- Check distribution by user_id after fix
SELECT 
    user_id,
    COUNT(*) as poi_count
FROM core.attractions 
WHERE user_id IS NOT NULL
GROUP BY user_id
ORDER BY poi_count DESC;
