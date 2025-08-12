-- Test specific group with ID 64581613-7711-45f3-ae59-8897f5f5a5f1

-- Check the group details
SELECT 
  id,
  name,
  created_by,
  created_at,
  updated_at
FROM core.attraction_groups 
WHERE id = '64581613-7711-45f3-ae59-8897f5f5a5f1';

-- Check all members of this group
SELECT 
  agm.attraction_id,
  agm.group_id,
  agm.group_role,
  a.name as poi_name,
  a.city,
  a.country
FROM core.attraction_group_members agm
JOIN core.attractions a ON agm.attraction_id = a.id
WHERE agm.group_id = '64581613-7711-45f3-ae59-8897f5f5a5f1'
ORDER BY agm.group_role, a.name;

-- Check if the specific POI is in this group
SELECT 
  agm.attraction_id,
  agm.group_id,
  agm.group_role,
  a.name as poi_name
FROM core.attraction_group_members agm
JOIN core.attractions a ON agm.attraction_id = a.id
WHERE agm.group_id = '64581613-7711-45f3-ae59-8897f5f5a5f1'
AND a.name ILIKE '%Museu Histórico do Instituto Butantan%';

-- Test the function we created
SELECT * FROM core.get_group_memberships()
WHERE group_id = '64581613-7711-45f3-ae59-8897f5f5a5f1';
