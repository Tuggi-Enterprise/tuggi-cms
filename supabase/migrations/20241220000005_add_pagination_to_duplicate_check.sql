-- ===========================================
-- MIGRAÇÃO: ADICIONAR PAGINAÇÃO À VERIFICAÇÃO DE DUPLICATAS
-- ===========================================
-- Data: 2024-12-20
-- Descrição: Adiciona paginação para contornar limite de 1000 registros do Supabase

-- Função para verificar duplicatas com paginação por estado
CREATE OR REPLACE FUNCTION core.check_duplicate_pois_paginated(
    target_state text DEFAULT NULL,
    page_limit integer DEFAULT 1000,
    page_offset integer DEFAULT 0
)
RETURNS TABLE (
    nome_normalizado text,
    cidade text,
    estado text,
    total_pois integer,
    menor_distancia_metros double precision,
    ids_dos_pois uuid[],
    nomes_dos_pois text[],
    latitudes double precision[],
    longitudes double precision[],
    datas_criacao timestamp with time zone[],
    status_aprovacao boolean[],
    avaliacoes numeric[],
    google_place_ids text[],
    todas_distancias_metros double precision[],
    nivel_proximidade text,
    sugestao_acao text
) AS $$
BEGIN
    RETURN QUERY
    WITH poi_with_coords AS (
        SELECT DISTINCT ON (a.id)
            a.id,
            a.name,
            a.city,
            a.state,
            a.category,
            a.approved,
            a.created_at,
            a.updated_at,
            a.google_place_id,
            a.rating,
            a.user_ratings_total,
            ac.latitude,
            ac.longitude,
            -- Normalizar nome para comparação
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
        WHERE 
            (target_state IS NULL OR a.state = target_state)
            AND a.state IN ('SP', 'RJ', 'MG')
            AND a.name IS NOT NULL 
            AND a.name != ''
            AND ac.latitude IS NOT NULL 
            AND ac.longitude IS NOT NULL
        ORDER BY a.id, ac.created_at
        LIMIT page_limit OFFSET page_offset
    ),

    duplicate_groups AS (
        SELECT 
            normalized_name,
            city,
            state,
            COUNT(*) as poi_count,
            ARRAY_AGG(id ORDER BY created_at) as poi_ids,
            ARRAY_AGG(name ORDER BY created_at) as poi_names,
            ARRAY_AGG(latitude ORDER BY created_at) as latitudes,
            ARRAY_AGG(longitude ORDER BY created_at) as longitudes,
            ARRAY_AGG(created_at ORDER BY created_at) as created_dates,
            ARRAY_AGG(approved ORDER BY created_at) as approved_status,
            ARRAY_AGG(rating ORDER BY created_at) as ratings,
            ARRAY_AGG(google_place_id ORDER BY created_at) as google_place_ids
        FROM poi_with_coords
        GROUP BY normalized_name, city, state
        HAVING COUNT(*) > 1
    ),

    distance_analysis AS (
        SELECT 
            dg.*,
            (
                SELECT MIN(core.calculate_distance_km(
                    dg.latitudes[i], dg.longitudes[i],
                    dg.latitudes[j], dg.longitudes[j]
                ) * 1000)
                FROM generate_series(1, array_length(dg.poi_ids, 1)) i,
                     generate_series(1, array_length(dg.poi_ids, 1)) j
                WHERE i < j
            ) as min_distance_meters
        FROM duplicate_groups dg
    )

    SELECT 
        da.normalized_name,
        da.city,
        da.state,
        da.poi_count::integer,
        da.min_distance_meters,
        da.poi_ids,
        da.poi_names,
        da.latitudes,
        da.longitudes,
        da.created_dates,
        da.approved_status,
        da.ratings,
        da.google_place_ids,
        ARRAY[]::double precision[] as todas_distancias_metros,
        CASE 
            WHEN da.min_distance_meters < 10 THEN 'MUITO_PRÓXIMO'
            WHEN da.min_distance_meters < 50 THEN 'PRÓXIMO'
            WHEN da.min_distance_meters < 100 THEN 'RAZOAVELMENTE_PRÓXIMO'
            ELSE 'DISTANTE'
        END as nivel_proximidade,
        CASE 
            WHEN da.min_distance_meters < 10 AND da.poi_count = 2 THEN 'POSSÍVEL_DUPLICATA_EXATA'
            WHEN da.min_distance_meters < 50 AND da.poi_count = 2 THEN 'POSSÍVEL_DUPLICATA'
            WHEN da.min_distance_meters < 100 AND da.poi_count > 2 THEN 'MÚLTIPLAS_DUPLICATAS'
            ELSE 'REVISAR_MANUALMENTE'
        END as sugestao_acao
    FROM distance_analysis da
    WHERE da.min_distance_meters < 100
    ORDER BY 
        da.min_distance_meters ASC,
        da.poi_count DESC,
        da.city,
        da.normalized_name;
END;
$$ LANGUAGE plpgsql;

-- Função para obter contagem total de POIs por estado para cálculo de páginas
CREATE OR REPLACE FUNCTION core.get_pois_count_by_state(target_state text DEFAULT NULL)
RETURNS TABLE (
    estado text,
    total_pois bigint
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.state,
        COUNT(DISTINCT a.id) as total_pois
    FROM core.attractions a
    INNER JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
    WHERE 
        (target_state IS NULL OR a.state = target_state)
        AND a.state IN ('SP', 'RJ', 'MG')
        AND a.name IS NOT NULL 
        AND a.name != ''
        AND ac.latitude IS NOT NULL 
        AND ac.longitude IS NOT NULL
    GROUP BY a.state
    ORDER BY total_pois DESC;
END;
$$ LANGUAGE plpgsql;

-- Conceder permissões
GRANT EXECUTE ON FUNCTION core.check_duplicate_pois_paginated(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION core.check_duplicate_pois_paginated(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION core.get_pois_count_by_state(text) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_pois_count_by_state(text) TO service_role;

-- Corrigir função de estatísticas também (problema de tipos persistente)
DROP FUNCTION IF EXISTS core.get_duplicate_pois_stats();

CREATE OR REPLACE FUNCTION core.get_duplicate_pois_stats()
RETURNS TABLE (
    estado text,
    total_grupos_duplicatas bigint,
    total_pois_envolvidos bigint,
    distancia_media_metros numeric,
    menor_distancia_encontrada numeric,
    maior_distancia_encontrada numeric
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
        AVG(da.min_distance_meters)::numeric as distancia_media_metros,
        MIN(da.min_distance_meters)::numeric as menor_distancia_encontrada,
        MAX(da.min_distance_meters)::numeric as maior_distancia_encontrada
    FROM distance_analysis da
    GROUP BY da.state
    ORDER BY total_grupos_duplicatas DESC;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION core.get_duplicate_pois_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_duplicate_pois_stats() TO service_role;

-- Comentários
COMMENT ON FUNCTION core.check_duplicate_pois_paginated(text, integer, integer) IS 'Verifica POIs duplicados com paginação para contornar limite de 1000 registros';
COMMENT ON FUNCTION core.get_pois_count_by_state(text) IS 'Retorna contagem de POIs por estado para cálculo de paginação';
COMMENT ON FUNCTION core.get_duplicate_pois_stats() IS 'Retorna estatísticas resumidas de POIs duplicados por estado - corrigida para usar tipos corretos';
