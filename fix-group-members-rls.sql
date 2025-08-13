-- Fix RLS policies for attraction_group_members to allow reading all groups
-- Drop the restrictive policy
DROP POLICY IF EXISTS "Authenticated users can read group members" ON core.attraction_group_members;

-- Create a new policy that allows reading all group members
CREATE POLICY "Authenticated users can read all group members" 
  ON core.attraction_group_members FOR SELECT TO authenticated USING (true);

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
WHERE tablename = 'attraction_group_members' 
  AND schemaname = 'core';

-- Test the fix by checking if we can now see all group members
SELECT 
    agm.attraction_id,
    agm.group_id,
    agm.group_role,
    a.name as attraction_name,
    ag.name as group_name,
    ag.created_by
FROM core.attraction_group_members agm
JOIN core.attractions a ON agm.attraction_id = a.id
JOIN core.attraction_groups ag ON agm.group_id = ag.id
LIMIT 10;
