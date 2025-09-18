-- Function to get group memberships bypassing RLS
-- This function uses SECURITY DEFINER to bypass RLS policies
CREATE OR REPLACE FUNCTION core.get_group_memberships()
RETURNS TABLE(
  attraction_id uuid,
  group_id uuid,
  group_role varchar(20),
  group_name text
) AS $$
BEGIN
  RETURN QUERY
    SELECT 
      agm.attraction_id,
      agm.group_id,
      agm.group_role,
      ag.name as group_name
    FROM core.attraction_group_members agm
    JOIN core.attraction_groups ag ON agm.group_id = ag.id
    ORDER BY ag.name, agm.group_role;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION core.get_group_memberships() TO authenticated;
