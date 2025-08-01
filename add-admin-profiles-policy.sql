-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Admin users can view all profiles" ON drive.profiles;

-- Add policy for admin users to view all profiles
CREATE POLICY "Admin users can view all profiles" 
ON drive.profiles FOR SELECT 
TO authenticated 
USING ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Verify the policy was created
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'profiles' AND schemaname = 'drive';
