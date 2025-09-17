-- ===========================================
-- MIGRAÇÃO: CORREÇÃO FINAL DOS TIPOS DE ESTATÍSTICAS
-- ===========================================
-- Data: 2024-12-20
-- Descrição: Correção definitiva dos tipos para compatibilidade com PostgREST

-- Dropar completamente a função problemática
DROP FUNCTION IF EXISTS core.get_duplicate_pois_stats() CASCADE;

-- Recriar com tipos que sabemos que funcionam (baseado no erro)
-- O erro indica que a coluna 3 (distancia_media_metros) espera bigint, não numeric
CREATE OR REPLACE FUNCTION core.get_duplicate_pois_stats()
RETURNS TABLE (
    estado text,
    total_grupos_duplicatas bigint,
    total_pois_envolvidos bigint,
    distancia_media_metros bigint,
    menor_distancia_encontrada bigint,
    maior_distancia_encontrada bigint
) AS $$
BEGIN
    RETURN QUERY
    WITH poi_with_coords AS (
        SELECT DISTINCT ON (a.id)
            a.id,
            a.name,
            a.city,
            a.state,
            ac.latitude,
            ac.longitude,
            LOWER(TRIM(REGEXP_REPLACE(
                REGEXP_REPLACE(
                    REGEXP_REPLACE(
                        REGEXP_REPLACE(
                            REGEXP_REPLACE(a.name, '[áàâãä]', 'a', 'g'),
                            '[éèêë]', 'e', 'g'
                        ),
                        '[íìîï]', 'i', 'g'
                    ),
                    '[óòôõö]', 'o', 'g'
                ),
                '[úùûü]', 'u', 'g'
            ))) as normalized_name
        FROM core.attractions a
        INNER JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
        WHERE a.state IN ('SP', 'RJ', 'MG')
        AND a.name IS NOT NULL 
        AND a.name != ''
        AND ac.latitude IS NOT NULL 
        AND ac.longitude IS NOT NULL
        ORDER BY a.id, ac.created_at
    ),

    duplicate_groups AS (
        SELECT 
            normalized_name,
            city,
            state,
            COUNT(*) as poi_count,
            ARRAY_AGG(latitude) as latitudes,
            ARRAY_AGG(longitude) as longitudes
        FROM poi_with_coords
        GROUP BY normalized_name, city, state
        HAVING COUNT(*) > 1
    ),

    distance_analysis AS (
        SELECT 
            dg.state,
            dg.poi_count,
            (
                SELECT MIN(core.calculate_distance_km(
                    dg.latitudes[i], dg.longitudes[i],
                    dg.latitudes[j], dg.longitudes[j]
                ) * 1000)
                FROM generate_series(1, array_length(dg.latitudes, 1)) i,
                     generate_series(1, array_length(dg.latitudes, 1)) j
                WHERE i < j
            ) as min_distance_meters
        FROM duplicate_groups dg
        WHERE (
            SELECT MIN(core.calculate_distance_km(
                dg.latitudes[i], dg.longitudes[i],
                dg.latitudes[j], dg.longitudes[j]
            ) * 1000)
            FROM generate_series(1, array_length(dg.latitudes, 1)) i,
                 generate_series(1, array_length(dg.latitudes, 1)) j
            WHERE i < j
        ) < 100
    )

    SELECT 
        da.state,
        COUNT(*) as total_grupos_duplicatas,
        SUM(da.poi_count) as total_pois_envolvidos,
        ROUND(AVG(da.min_distance_meters))::bigint as distancia_media_metros,
        ROUND(MIN(da.min_distance_meters))::bigint as menor_distancia_encontrada,
        ROUND(MAX(da.min_distance_meters))::bigint as maior_distancia_encontrada
    FROM distance_analysis da
    GROUP BY da.state
    ORDER BY total_grupos_duplicatas DESC;
END;
$$ LANGUAGE plpgsql;

-- Conceder permissões
GRANT EXECUTE ON FUNCTION core.get_duplicate_pois_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_duplicate_pois_stats() TO service_role;

-- Comentário
COMMENT ON FUNCTION core.get_duplicate_pois_stats() IS 'Retorna estatísticas resumidas de POIs duplicados por estado - tipos bigint para compatibilidade com PostgREST';
