-- Test script to check if group data exists for the specific POI
-- Replace 'POI_ID_HERE' with the actual ID of "Museu Histórico do Instituto Butantan"

-- First, let's find the POI by name
SELECT id, name, city, country 
FROM core.attractions 
WHERE name ILIKE '%Museu Histórico do Instituto Butantan%'
OR name ILIKE '%Butantan%';

-- Check if there are any group memberships
SELECT 
  agm.attraction_id,
  agm.group_id,
  agm.group_role,
  ag.name as group_name,
  a.name as poi_name
FROM core.attraction_group_members agm
JOIN core.attraction_groups ag ON agm.group_id = ag.id
JOIN core.attractions a ON agm.attraction_id = a.id
ORDER BY ag.name, agm.group_role;

-- Check all groups
SELECT 
  ag.id,
  ag.name,
  ag.created_by,
  ag.created_at,
  COUNT(agm.attraction_id) as member_count
FROM core.attraction_groups ag
LEFT JOIN core.attraction_group_members agm ON ag.id = agm.group_id
GROUP BY ag.id, ag.name, ag.created_by, ag.created_at
ORDER BY ag.created_at DESC;

-- Check if there are any group memberships at all
SELECT COUNT(*) as total_group_memberships FROM core.attraction_group_members;

-- Check if there are any groups at all
SELECT COUNT(*) as total_groups FROM core.attraction_groups;
