-- Check if Butantan POI is in the group
SELECT 
    agm.attraction_id,
    agm.group_id,
    agm.group_role,
    a.name as attraction_name,
    ag.name as group_name,
    agm.created_at,
    agm.updated_at
FROM core.attraction_group_members agm
JOIN core.attractions a ON agm.attraction_id = a.id
JOIN core.attraction_groups ag ON agm.group_id = ag.id
WHERE agm.attraction_id = '5e8a946f-b271-46ca-9c16-1bbb55e4f0aa'
   OR agm.group_id = '64581613-7711-45f3-ae59-8897f5f5a5f1';

-- Check all members of the Pico do Jaraguá group
SELECT 
    agm.attraction_id,
    agm.group_role,
    a.name as attraction_name
FROM core.attraction_group_members agm
JOIN core.attractions a ON agm.attraction_id = a.id
WHERE agm.group_id = '64581613-7711-45f3-ae59-8897f5f5a5f1';

-- Check if the Butantan POI exists in attractions table
SELECT id, name, city, country 
FROM core.attractions 
WHERE id = '5e8a946f-b271-46ca-9c16-1bbb55e4f0aa';

-- Check if the group exists
SELECT id, name, created_by, created_at 
FROM core.attraction_groups 
WHERE id = '64581613-7711-45f3-ae59-8897f5f5a5f1';
