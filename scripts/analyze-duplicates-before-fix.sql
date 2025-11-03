-- Script para analisar duplicados ANTES de executar a correção
-- Execute este script para ver quantos duplicados serão corrigidos

-- 1. Contar quantos grupos de duplicados existem
SELECT 
  'Grupos de duplicados (osm_id + osm_type + name)' as metric,
  COUNT(*)::TEXT as value
FROM (
  SELECT osm_id, osm_type, name, COUNT(*) as cnt
  FROM homolog.pois
  WHERE osm_id IS NOT NULL 
    AND osm_type IS NOT NULL
    AND name IS NOT NULL
  GROUP BY osm_id, osm_type, name
  HAVING COUNT(*) > 1
) duplicates;

-- 2. Contar total de registros duplicados que serão removidos
SELECT 
  'Total de registros duplicados a remover' as metric,
  (SUM(cnt) - COUNT(*))::TEXT as value
FROM (
  SELECT osm_id, osm_type, name, COUNT(*) as cnt
  FROM homolog.pois
  WHERE osm_id IS NOT NULL 
    AND osm_type IS NOT NULL
    AND name IS NOT NULL
  GROUP BY osm_id, osm_type, name
  HAVING COUNT(*) > 1
) duplicates;

-- 3. Mostrar top 20 grupos de duplicados
SELECT 
  osm_id,
  osm_type,
  name,
  COUNT(*) as total_records,
  MIN(created_at) as first_created,
  MAX(created_at) as last_created,
  STRING_AGG(DISTINCT uuid_id::TEXT, ', ' ORDER BY uuid_id::TEXT) as uuid_ids
FROM homolog.pois
WHERE osm_id IS NOT NULL 
  AND osm_type IS NOT NULL
  AND name IS NOT NULL
GROUP BY osm_id, osm_type, name
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC, name
LIMIT 20;

-- 4. Verificar exemplos específicos
SELECT 
  'Aeroporto Congonhas' as example,
  COUNT(*) as total_records,
  COUNT(DISTINCT uuid_id) as unique_uuids,
  COUNT(DISTINCT osm_id) as unique_osm_ids
FROM homolog.pois
WHERE name ILIKE '%Aeroporto%Congonhas%'
  AND osm_id IS NOT NULL;

SELECT 
  'Universidade Estadual de Campinas' as example,
  COUNT(*) as total_records,
  COUNT(DISTINCT uuid_id) as unique_uuids,
  COUNT(DISTINCT osm_id) as unique_osm_ids
FROM homolog.pois
WHERE name ILIKE '%Universidade Estadual de Campinas%'
  AND osm_id IS NOT NULL;

