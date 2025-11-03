-- Script para analisar duplicados na tabela homolog.pois
-- Executar este script no Supabase SQL Editor para entender o problema

-- 1. Verificar se a função create_poi_with_uuid existe
SELECT 
    routine_name,
    routine_type,
    routine_definition
FROM information_schema.routines
WHERE routine_schema = 'homolog'
AND routine_name LIKE '%poi%uuid%';

-- 2. Verificar se a constraint UNIQUE existe em uuid_id
SELECT 
    constraint_name,
    constraint_type,
    table_name
FROM information_schema.table_constraints
WHERE table_schema = 'homolog'
AND table_name = 'pois'
AND constraint_type = 'UNIQUE';

-- 3. Verificar quantos registros têm uuid_id NULL
SELECT 
    COUNT(*) as total_pois,
    COUNT(uuid_id) as pois_with_uuid,
    COUNT(*) - COUNT(uuid_id) as pois_without_uuid
FROM homolog.pois;

-- 4. Verificar se há uuid_id duplicados (violação da constraint)
SELECT 
    uuid_id,
    COUNT(*) as duplicate_count
FROM homolog.pois
WHERE uuid_id IS NOT NULL
GROUP BY uuid_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 20;

-- 5. Analisar os exemplos específicos mencionados
SELECT 
    uuid_id,
    name,
    city,
    state,
    osm_id,
    osm_type,
    lat,
    lon,
    created_at,
    source_file
FROM homolog.pois
WHERE name ILIKE '%Aeroporto de São Paulo%Congonhas%'
   OR name ILIKE '%Universidade Estadual de Campinas%'
ORDER BY name, created_at;

-- 6. Verificar POIs com mesmo nome mas UUIDs diferentes
SELECT 
    name,
    city,
    state,
    COUNT(DISTINCT uuid_id) as uuid_count,
    COUNT(*) as total_records,
    STRING_AGG(DISTINCT uuid_id::TEXT, ', ') as uuid_ids,
    STRING_AGG(DISTINCT source_file, ', ') as source_files
FROM homolog.pois
WHERE name IS NOT NULL
GROUP BY name, city, state
HAVING COUNT(*) > 1
ORDER BY total_records DESC
LIMIT 20;

-- 7. Verificar POIs com mesmo osm_id mas UUIDs diferentes
SELECT 
    osm_id,
    osm_type,
    COUNT(DISTINCT uuid_id) as uuid_count,
    COUNT(*) as total_records,
    STRING_AGG(DISTINCT uuid_id::TEXT, ', ') as uuid_ids,
    STRING_AGG(DISTINCT name, ' | ') as names
FROM homolog.pois
WHERE osm_id IS NOT NULL
GROUP BY osm_id, osm_type
HAVING COUNT(*) > 1
ORDER BY total_records DESC
LIMIT 20;

-- 8. Verificar como o UUID está sendo gerado para os exemplos
SELECT 
    p.uuid_id,
    p.name,
    p.city,
    p.state,
    p.osm_id,
    p.osm_type,
    p.lat,
    p.lon,
    homolog.generate_poi_uuid(
        p.osm_id,
        p.osm_type,
        p.name,
        p.lat,
        p.lon
    ) as calculated_uuid,
    CASE 
        WHEN p.uuid_id = homolog.generate_poi_uuid(p.osm_id, p.osm_type, p.name, p.lat, p.lon)
        THEN 'OK'
        ELSE 'MISMATCH'
    END as uuid_match
FROM homolog.pois p
WHERE name ILIKE '%Aeroporto de São Paulo%Congonhas%'
   OR name ILIKE '%Universidade Estadual de Campinas%'
ORDER BY name, created_at;

-- 9. Verificar se há registros com UUIDs NULL que deveriam ter UUID
SELECT 
    COUNT(*) as pois_with_null_uuid,
    COUNT(DISTINCT CONCAT(COALESCE(osm_id::TEXT, 'NULL'), ':', COALESCE(osm_type, 'NULL'), ':', COALESCE(name, 'NULL'), ':', lat::TEXT, ':', lon::TEXT)) as unique_combinations
FROM homolog.pois
WHERE uuid_id IS NULL;

-- 10. Análise detalhada dos duplicados: verificar diferenças entre registros duplicados
WITH duplicates AS (
    SELECT 
        name,
        city,
        state,
        COUNT(*) as total
    FROM homolog.pois
    WHERE name IS NOT NULL
    GROUP BY name, city, state
    HAVING COUNT(*) > 1
)
SELECT 
    p.uuid_id,
    p.name,
    p.city,
    p.state,
    p.osm_id,
    p.osm_type,
    p.lat,
    p.lon,
    p.uuid_id,
    p.source_file,
    p.created_at,
    p.updated_at,
    -- Verificar se o UUID calculado é diferente
    CASE 
        WHEN p.uuid_id IS NULL THEN 'NULL UUID'
        WHEN p.uuid_id != homolog.generate_poi_uuid(p.osm_id, p.osm_type, p.name, p.lat, p.lon)
        THEN 'UUID MISMATCH'
        ELSE 'UUID OK'
    END as uuid_status
FROM homolog.pois p
INNER JOIN duplicates d ON p.name = d.name AND p.city = d.city AND p.state = d.state
WHERE p.name ILIKE '%Aeroporto%Congonhas%' 
   OR p.name ILIKE '%Universidade Estadual de Campinas%'
ORDER BY p.name, p.created_at;

-- 11. Verificar se há diferenças sutis nos dados que causam UUIDs diferentes
SELECT 
    name,
    city,
    state,
    COUNT(DISTINCT osm_id) as distinct_osm_ids,
    COUNT(DISTINCT osm_type) as distinct_osm_types,
    COUNT(DISTINCT ROUND(lat::numeric, 6)) as distinct_lats,
    COUNT(DISTINCT ROUND(lon::numeric, 6)) as distinct_lons,
    COUNT(DISTINCT uuid_id) as distinct_uuids,
    COUNT(*) as total_records,
    STRING_AGG(DISTINCT osm_id::TEXT, ', ') as osm_ids,
    STRING_AGG(DISTINCT uuid_id::TEXT, ', ') as uuid_ids
FROM homolog.pois
WHERE name ILIKE '%Aeroporto%Congonhas%' 
   OR name ILIKE '%Universidade Estadual de Campinas%'
GROUP BY name, city, state
ORDER BY total_records DESC;

-- 12. Verificar se a função create_poi_with_uuid está sendo chamada corretamente
-- Esta query verifica se há algum padrão nos dados que indique problema na função
SELECT 
    'Total POIs' as metric,
    COUNT(*)::TEXT as value
FROM homolog.pois
UNION ALL
SELECT 
    'POIs com UUID NULL' as metric,
    COUNT(*)::TEXT as value
FROM homolog.pois
WHERE uuid_id IS NULL
UNION ALL
SELECT 
    'UUIDs duplicados' as metric,
    COUNT(*)::TEXT as value
FROM (
    SELECT uuid_id
    FROM homolog.pois
    WHERE uuid_id IS NOT NULL
    GROUP BY uuid_id
    HAVING COUNT(*) > 1
) duplicates
UNION ALL
SELECT 
    'POIs com mesmo nome/cidade/estado mas UUIDs diferentes' as metric,
    COUNT(*)::TEXT as value
FROM (
    SELECT name, city, state
    FROM homolog.pois
    WHERE name IS NOT NULL
    GROUP BY name, city, state
    HAVING COUNT(DISTINCT uuid_id) > 1
) name_duplicates;

-- 13. Verificar se há problema com valores NULL em campos usados para gerar UUID
SELECT 
    'osm_id NULL' as field,
    COUNT(*) as count
FROM homolog.pois
WHERE osm_id IS NULL
UNION ALL
SELECT 
    'osm_type NULL' as field,
    COUNT(*) as count
FROM homolog.pois
WHERE osm_type IS NULL
UNION ALL
SELECT 
    'name NULL' as field,
    COUNT(*) as count
FROM homolog.pois
WHERE name IS NULL
UNION ALL
SELECT 
    'lat NULL' as field,
    COUNT(*) as count
FROM homolog.pois
WHERE lat IS NULL
UNION ALL
SELECT 
    'lon NULL' as field,
    COUNT(*) as count
FROM homolog.pois
WHERE lon IS NULL;

