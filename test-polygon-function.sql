-- Test script for pois_in_polygon function
-- This script tests if the function is working correctly

-- First, let's check if the function exists
SELECT 
  routine_name, 
  routine_type, 
  data_type 
FROM information_schema.routines 
WHERE routine_schema = 'core' 
  AND routine_name = 'pois_in_polygon';

-- Test the function with a simple polygon
SELECT * FROM core.pois_in_polygon('POLYGON((2.1521 41.3686, 2.1542 41.3694, 2.1551 41.3679, 2.1532 41.3671, 2.1521 41.3686))');

-- Check if we have any coordinates in the database
SELECT COUNT(*) as total_coordinates FROM core.attraction_coordinate;

-- Check if we have any attractions
SELECT COUNT(*) as total_attractions FROM core.attractions;

-- Check if we have any group tables
SELECT COUNT(*) as total_groups FROM core.attraction_groups;
SELECT COUNT(*) as total_group_members FROM core.attraction_group_members;

-- Test a simple spatial query
SELECT 
  ac.attraction_id,
  ac.latitude,
  ac.longitude
FROM core.attraction_coordinate ac
WHERE ST_Intersects(
  ST_SetSRID(ST_MakePoint(ac.longitude, ac.latitude), 4326),
  ST_GeomFromText('POLYGON((2.1521 41.3686, 2.1542 41.3694, 2.1551 41.3679, 2.1532 41.3671, 2.1521 41.3686))', 4326)
)
LIMIT 5;
