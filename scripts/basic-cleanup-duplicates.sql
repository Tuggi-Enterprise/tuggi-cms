-- Script de limpeza básico de coordenadas duplicadas
-- Gerado em: 2025-10-06T14:57:34.080Z
-- Baseado em análise de 34701 coordenadas

-- IMPORTANTE: Este é um script básico. Use o script completo para limpeza segura!

-- 1. Identificar POIs com múltiplas coordenadas
CREATE TEMP TABLE pois_with_duplicates AS
SELECT 
  attraction_id,
  COUNT(*) as coordinate_count,
  ARRAY_AGG(id ORDER BY created_at DESC) as coordinate_ids
FROM core.attraction_coordinate
GROUP BY attraction_id
HAVING COUNT(*) > 1;

-- 2. Para cada POI, manter apenas a coordenada mais recente
-- (Este script deve ser executado com cuidado e validação prévia)

-- Exemplo de remoção (NÃO EXECUTAR SEM VALIDAÇÃO):
-- DELETE FROM core.attraction_coordinate 
-- WHERE id IN (
--   SELECT unnest(coordinate_ids[2:]) 
--   FROM pois_with_duplicates
-- );

-- 3. Verificar resultado
SELECT 
  'POIs ainda com múltiplas coordenadas' as status,
  COUNT(*) as count
FROM (
  SELECT attraction_id 
  FROM core.attraction_coordinate 
  GROUP BY attraction_id 
  HAVING COUNT(*) > 1
) remaining_duplicates;
