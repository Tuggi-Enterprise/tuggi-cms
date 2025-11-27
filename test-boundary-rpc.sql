-- ============================================
-- TESTE: Verificar se a função existe
-- ============================================

-- 1. Verificar se a função existe no schema core
SELECT 
  routine_schema,
  routine_name,
  routine_type,
  data_type
FROM information_schema.routines
WHERE routine_schema = 'core' 
  AND routine_name = 'update_boundary_geometry';

-- 2. Ver os parâmetros da função
SELECT 
  parameter_name,
  data_type,
  parameter_mode,
  ordinal_position
FROM information_schema.parameters
WHERE specific_schema = 'core' 
  AND specific_name LIKE '%update_boundary_geometry%'
ORDER BY ordinal_position;

-- 3. Teste prático com dados do POI criado
-- POI ID: 120d43ba-18c9-4ac3-8464-c75752b32fb8

-- Primeiro, verificar se o coordinate existe
SELECT 
  id,
  attraction_id,
  latitude,
  longitude,
  boundary_geometry,
  boundary_type
FROM core.attraction_coordinate
WHERE attraction_id = '120d43ba-18c9-4ac3-8464-c75752b32fb8';

-- 4. Testar a função com dados reais
-- Boundary do frontend (4 pontos de exemplo)
SELECT core.update_boundary_geometry(
  p_attraction_id := '120d43ba-18c9-4ac3-8464-c75752b32fb8'::uuid,
  p_geojson := '{
    "type": "Polygon",
    "coordinates": [[
      [-46.60446088867186, -23.464669628246526],
      [-46.60446088867186, -23.463669628246526],
      [-46.60346088867186, -23.463669628246526],
      [-46.60346088867186, -23.464669628246526],
      [-46.60446088867186, -23.464669628246526]
    ]]
  }',
  p_boundary_type := 'manual',
  p_boundary_source := 'manual_drawing',
  p_boundary_confidence := 1.0,
  p_boundary_area_m2 := 12345.67,
  p_boundary_centroid_lat := -23.464169628246526,
  p_boundary_centroid_lng := -46.60396088867186
);

-- 5. Verificar se o boundary foi salvo
SELECT 
  id,
  attraction_id,
  boundary_type,
  boundary_source,
  boundary_confidence,
  boundary_area_m2,
  boundary_centroid_lat,
  boundary_centroid_lng,
  ST_AsGeoJSON(boundary_geometry::geometry) as boundary_geojson
FROM core.attraction_coordinate
WHERE attraction_id = '120d43ba-18c9-4ac3-8464-c75752b32fb8';

