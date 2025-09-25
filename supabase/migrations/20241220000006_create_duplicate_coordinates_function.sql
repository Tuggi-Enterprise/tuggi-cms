-- ===========================================
-- MIGRAÇÃO: FUNÇÃO PARA VERIFICAR COORDENADAS DUPLICADAS
-- ===========================================
-- Data: 2024-12-20
-- Descrição: Cria função para identificar POIs com múltiplas coordenadas

-- Função para obter POIs com múltiplas coordenadas
CREATE OR REPLACE FUNCTION core.get_duplicate_coordinates()
RETURNS TABLE (
    attraction_id uuid,
    name text,
    city text,
    country text,
    coordinate_count bigint,
    coordinates jsonb
) AS $$
BEGIN
    RETURN QUERY
    WITH coordinate_counts AS (
        SELECT 
            ac.attraction_id,
            COUNT(*) as coord_count,
            JSONB_AGG(
                JSONB_BUILD_OBJECT(
                    'id', ac.id,
                    'latitude', ac.latitude,
                    'longitude', ac.longitude,
                    'created_at', ac.created_at
                ) ORDER BY ac.created_at
            ) as coord_data
        FROM core.attraction_coordinate ac
        GROUP BY ac.attraction_id
        HAVING COUNT(*) > 1
    )
    SELECT 
        cc.attraction_id,
        a.name,
        a.city,
        a.country,
        cc.coord_count,
        cc.coord_data
    FROM coordinate_counts cc
    INNER JOIN core.attractions a ON cc.attraction_id = a.id
    ORDER BY cc.coord_count DESC, a.name;
END;
$$ LANGUAGE plpgsql;

-- Função para obter estatísticas de coordenadas duplicadas
CREATE OR REPLACE FUNCTION core.get_duplicate_coordinates_stats()
RETURNS TABLE (
    total_pois_with_duplicates bigint,
    total_duplicate_coordinates bigint,
    max_coordinates_per_poi bigint,
    avg_coordinates_per_poi numeric
) AS $$
BEGIN
    RETURN QUERY
    WITH coordinate_counts AS (
        SELECT 
            ac.attraction_id,
            COUNT(*) as coord_count
        FROM core.attraction_coordinate ac
        GROUP BY ac.attraction_id
        HAVING COUNT(*) > 1
    )
    SELECT 
        COUNT(*) as total_pois_with_duplicates,
        SUM(coord_count) as total_duplicate_coordinates,
        MAX(coord_count) as max_coordinates_per_poi,
        ROUND(AVG(coord_count), 2) as avg_coordinates_per_poi
    FROM coordinate_counts;
END;
$$ LANGUAGE plpgsql;

-- Função para verificar coordenadas muito próximas (possíveis duplicatas reais)
CREATE OR REPLACE FUNCTION core.get_close_coordinates(distance_threshold_meters double precision DEFAULT 10.0)
RETURNS TABLE (
    attraction_id uuid,
    name text,
    city text,
    country text,
    coordinate_pairs jsonb,
    min_distance_meters double precision
) AS $$
BEGIN
    RETURN QUERY
    WITH poi_coordinates AS (
        SELECT 
            ac.attraction_id,
            a.name,
            a.city,
            a.country,
            ac.id as coord_id,
            ac.latitude,
            ac.longitude,
            ac.created_at
        FROM core.attraction_coordinate ac
        INNER JOIN core.attractions a ON ac.attraction_id = a.id
    ),
    coordinate_pairs AS (
        SELECT 
            pc1.attraction_id,
            pc1.name,
            pc1.city,
            pc1.country,
            JSONB_BUILD_OBJECT(
                'coord1', JSONB_BUILD_OBJECT(
                    'id', pc1.coord_id,
                    'latitude', pc1.latitude,
                    'longitude', pc1.longitude,
                    'created_at', pc1.created_at
                ),
                'coord2', JSONB_BUILD_OBJECT(
                    'id', pc2.coord_id,
                    'latitude', pc2.latitude,
                    'longitude', pc2.longitude,
                    'created_at', pc2.created_at
                )
            ) as coord_pairs,
            core.calculate_distance_km(pc1.latitude, pc1.longitude, pc2.latitude, pc2.longitude) * 1000 as distance_meters
        FROM poi_coordinates pc1
        INNER JOIN poi_coordinates pc2 ON pc1.attraction_id = pc2.attraction_id
        WHERE pc1.coord_id < pc2.coord_id
    )
    SELECT 
        cp.attraction_id,
        cp.name,
        cp.city,
        cp.country,
        cp.coord_pairs,
        cp.distance_meters
    FROM coordinate_pairs cp
    WHERE cp.distance_meters < distance_threshold_meters
    ORDER BY cp.distance_meters ASC;
END;
$$ LANGUAGE plpgsql;

-- Comentários das funções
COMMENT ON FUNCTION core.get_duplicate_coordinates() IS 'Identifica POIs com múltiplas coordenadas na tabela attraction_coordinate';
COMMENT ON FUNCTION core.get_duplicate_coordinates_stats() IS 'Retorna estatísticas de POIs com coordenadas duplicadas';
COMMENT ON FUNCTION core.get_close_coordinates(double precision) IS 'Identifica coordenadas muito próximas (possíveis duplicatas reais) dentro de um raio especificado';
