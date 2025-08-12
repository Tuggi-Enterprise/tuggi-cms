-- Add Museu Histórico do Instituto Butantan to Pico do Jaraguá group
INSERT INTO core.attraction_group_members (
    attraction_id,
    group_id,
    group_role,
    created_at,
    updated_at
) VALUES (
    '5e8a946f-b271-46ca-9c16-1bbb55e4f0aa', -- Museu Histórico do Instituto Butantan
    '64581613-7711-45f3-ae59-8897f5f5a5f1', -- Pico do Jaraguá group
    'member', -- or 'main' if this should be the main POI of the group
    NOW(),
    NOW()
);

-- Verify the insertion
SELECT 
    agm.attraction_id,
    agm.group_id,
    agm.group_role,
    a.name as attraction_name,
    ag.name as group_name
FROM core.attraction_group_members agm
JOIN core.attractions a ON agm.attraction_id = a.id
JOIN core.attraction_groups ag ON agm.group_id = ag.id
WHERE agm.group_id = '64581613-7711-45f3-ae59-8897f5f5a5f1';
