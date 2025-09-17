-- ===========================================
-- MIGRAÇÃO: CORREÇÃO DA LÓGICA DE DUPLICATAS
-- ===========================================
-- Data: 2024-12-20
-- Descrição: Corrige a lógica para usar apenas uma coordenada por POI

-- Dropar as funções existentes
DROP FUNCTION IF EXISTS core.check_duplicate_pois();
DROP FUNCTION IF EXISTS core.analyze_duplicate_group(text, text, text);

-- Recriar a função principal com lógica corrigida
CREATE OR REPLACE FUNCTION core.check_duplicate_pois()
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
            -- Normalizar nome para comparação (remover acentos, maiúsculas, espaços extras)
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
        ORDER BY a.id, ac.created_at -- Usar a primeira coordenada criada
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

    -- Calcular distâncias entre POIs do mesmo grupo
    distance_analysis AS (
        SELECT 
            dg.*,
            -- Encontrar a menor distância no grupo
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

    -- Resultado final: apenas grupos com POIs muito próximos (< 100 metros)
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
        ARRAY[]::double precision[] as todas_distancias_metros, -- Simplificado para performance
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
    WHERE da.min_distance_meters < 100 -- Apenas POIs com distância menor que 100 metros
    ORDER BY 
        da.min_distance_meters ASC,
        da.poi_count DESC,
        da.city,
        da.normalized_name;
END;
$$ LANGUAGE plpgsql;

-- Recriar função de análise detalhada
CREATE OR REPLACE FUNCTION core.analyze_duplicate_group(
    input_poi_name text,
    input_city_name text,
    input_state_name text
)
RETURNS TABLE (
    poi_id uuid,
    poi_name text,
    city text,
    state text,
    category text,
    approved boolean,
    created_at timestamp with time zone,
    google_place_id text,
    rating numeric,
    latitude double precision,
    longitude double precision,
    formatted_address text,
    vicinity text,
    website text,
    formatted_phone_number text,
    distance_to_others_meters double precision[]
) AS $$
BEGIN
    RETURN QUERY
    WITH specific_group AS (
        SELECT DISTINCT ON (a.id)
            a.id,
            a.name,
            a.city,
            a.state,
            a.category,
            a.approved,
            a.created_at,
            a.google_place_id,
            a.rating,
            a.formatted_address,
            a.vicinity,
            a.website,
            a.formatted_phone_number,
            ac.latitude,
            ac.longitude
        FROM core.attractions a
        INNER JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
        WHERE LOWER(TRIM(a.name)) = LOWER(TRIM(input_poi_name))
        AND a.city = input_city_name
        AND a.state = input_state_name
        ORDER BY a.id, ac.created_at -- Usar a primeira coordenada criada
    )
    SELECT 
        sg1.id,
        sg1.name,
        sg1.city,
        sg1.state,
        sg1.category,
        sg1.approved,
        sg1.created_at,
        sg1.google_place_id,
        sg1.rating,
        sg1.latitude,
        sg1.longitude,
        sg1.formatted_address,
        sg1.vicinity,
        sg1.website,
        sg1.formatted_phone_number,
        ARRAY(
            SELECT core.calculate_distance_km(sg1.latitude, sg1.longitude, sg2.latitude, sg2.longitude) * 1000
            FROM specific_group sg2
            WHERE sg2.id != sg1.id
        ) as distance_to_others_meters
    FROM specific_group sg1
    ORDER BY sg1.created_at;
END;
$$ LANGUAGE plpgsql;

-- Conceder permissões
GRANT EXECUTE ON FUNCTION core.check_duplicate_pois() TO authenticated;
GRANT EXECUTE ON FUNCTION core.check_duplicate_pois() TO service_role;
GRANT EXECUTE ON FUNCTION core.analyze_duplicate_group(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION core.analyze_duplicate_group(text, text, text) TO service_role;

-- Comentários das funções
COMMENT ON FUNCTION core.check_duplicate_pois() IS 'Identifica POIs duplicados por nome normalizado, cidade e proximidade geográfica (< 100m) nos estados SP, RJ e MG - corrigido para evitar duplicação de coordenadas';
COMMENT ON FUNCTION core.analyze_duplicate_group(text, text, text) IS 'Analisa detalhadamente um grupo específico de POIs duplicados - corrigido para evitar duplicação de coordenadas';
