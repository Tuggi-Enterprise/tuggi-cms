-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Admin users can view all profiles" ON drive.profiles;
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON drive.profiles;

-- Add policy for all authenticated users to view all profiles
CREATE POLICY "Authenticated users can view all profiles" 
ON drive.profiles FOR SELECT 
TO authenticated 
USING (true);

-- Verify the policy was created
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'profiles' AND schemaname = 'drive';