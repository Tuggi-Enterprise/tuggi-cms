-- Script de investigação: POIs duplicados (mesmo nome na mesma cidade)
-- Objetivo: Identificar POIs que têm o mesmo nome na mesma cidade
-- Regra: N POIs com mesmo nome na mesma cidade = Deixar 1, apagar demais
-- Regra: N POIs com mesmo nome em cidades diferentes = Não apagar nada

-- ============================================================================
-- 1. ESTATÍSTICAS GERAIS
-- ============================================================================

-- Total de POIs na tabela
SELECT 
    'Total de POIs' as metrica,
    COUNT(*)::TEXT as valor
FROM homolog.pois;

-- POIs com nome NULL (não podem ser agrupados por nome)
SELECT 
    'POIs com nome NULL' as metrica,
    COUNT(*)::TEXT as valor
FROM homolog.pois
WHERE name IS NULL;

-- POIs com cidade NULL (não podem ser agrupados por cidade)
SELECT 
    'POIs com cidade NULL' as metrica,
    COUNT(*)::TEXT as valor
FROM homolog.pois
WHERE city IS NULL;

-- ============================================================================
-- 2. IDENTIFICAR DUPLICATAS: MESMO NOME NA MESMA CIDADE
-- ============================================================================

-- Contagem de grupos de duplicatas (nome + cidade)
SELECT 
    'Grupos de duplicatas (nome + cidade)' as metrica,
    COUNT(*)::TEXT as valor
FROM (
    SELECT name, city, COUNT(*) as cnt
    FROM homolog.pois
    WHERE name IS NOT NULL 
      AND city IS NOT NULL
    GROUP BY name, city
    HAVING COUNT(*) > 1
) duplicatas;

-- Total de POIs que são duplicatas (mesmo nome na mesma cidade)
SELECT 
    'Total de POIs duplicados (mesmo nome + cidade)' as metrica,
    SUM(cnt)::TEXT as valor
FROM (
    SELECT name, city, COUNT(*) as cnt
    FROM homolog.pois
    WHERE name IS NOT NULL 
      AND city IS NOT NULL
    GROUP BY name, city
    HAVING COUNT(*) > 1
) duplicatas;

-- Total de POIs que serão mantidos (1 por grupo)
SELECT 
    'POIs que serão mantidos (1 por grupo duplicado)' as metrica,
    COUNT(*)::TEXT as valor
FROM (
    SELECT name, city, COUNT(*) as cnt
    FROM homolog.pois
    WHERE name IS NOT NULL 
      AND city IS NOT NULL
    GROUP BY name, city
    HAVING COUNT(*) > 1
) duplicatas;

-- Total de POIs que serão apagados (duplicatas - 1 por grupo)
SELECT 
    'POIs que serão apagados (duplicatas - 1 por grupo)' as metrica,
    (SUM(cnt) - COUNT(*))::TEXT as valor
FROM (
    SELECT name, city, COUNT(*) as cnt
    FROM homolog.pois
    WHERE name IS NOT NULL 
      AND city IS NOT NULL
    GROUP BY name, city
    HAVING COUNT(*) > 1
) duplicatas;

-- ============================================================================
-- 3. DETALHAMENTO DOS GRUPOS DE DUPLICATAS
-- ============================================================================

-- Top 20 grupos com mais duplicatas
SELECT 
    name,
    city,
    state,
    COUNT(*) as total_duplicatas,
    COUNT(DISTINCT uuid_id) as uuids_diferentes,
    MIN(created_at) as mais_antigo,
    MAX(created_at) as mais_recente,
    STRING_AGG(DISTINCT source_file, ', ' ORDER BY source_file) as arquivos_origem
FROM homolog.pois
WHERE name IS NOT NULL 
  AND city IS NOT NULL
GROUP BY name, city, state
HAVING COUNT(*) > 1
ORDER BY total_duplicatas DESC, name, city
LIMIT 20;

-- ============================================================================
-- 4. ANÁLISE DETALHADA: POIs que serão mantidos vs apagados
-- ============================================================================

-- POIs que serão MANTIDOS (o mais antigo de cada grupo)
WITH duplicatas AS (
    SELECT 
        name,
        city,
        COUNT(*) as total
    FROM homolog.pois
    WHERE name IS NOT NULL 
      AND city IS NOT NULL
    GROUP BY name, city
    HAVING COUNT(*) > 1
),
pois_para_manter AS (
    SELECT 
        p.uuid_id,
        p.name,
        p.city,
        p.state,
        p.osm_id,
        p.osm_type,
        p.lat,
        p.lon,
        p.created_at,
        p.source_file,
        ROW_NUMBER() OVER (
            PARTITION BY p.name, p.city 
            ORDER BY p.created_at ASC, p.uuid_id ASC
        ) as rn
    FROM homolog.pois p
    INNER JOIN duplicatas d ON p.name = d.name AND p.city = d.city
)
SELECT 
    'POIs que serão MANTIDOS' as acao,
    COUNT(*) as total
FROM pois_para_manter
WHERE rn = 1;

-- POIs que serão APAGADOS (todos exceto o mais antigo de cada grupo)
WITH duplicatas AS (
    SELECT 
        name,
        city,
        COUNT(*) as total
    FROM homolog.pois
    WHERE name IS NOT NULL 
      AND city IS NOT NULL
    GROUP BY name, city
    HAVING COUNT(*) > 1
),
pois_para_apagar AS (
    SELECT 
        p.uuid_id,
        p.name,
        p.city,
        p.state,
        p.osm_id,
        p.osm_type,
        p.lat,
        p.lon,
        p.created_at,
        p.source_file,
        ROW_NUMBER() OVER (
            PARTITION BY p.name, p.city 
            ORDER BY p.created_at ASC, p.uuid_id ASC
        ) as rn
    FROM homolog.pois p
    INNER JOIN duplicatas d ON p.name = d.name AND p.city = d.city
)
SELECT 
    'POIs que serão APAGADOS' as acao,
    COUNT(*) as total
FROM pois_para_apagar
WHERE rn > 1;

-- ============================================================================
-- 5. EXEMPLOS DETALHADOS (Top 10 grupos)
-- ============================================================================

-- Detalhes dos POIs nos top 10 grupos de duplicatas
WITH duplicatas AS (
    SELECT 
        name,
        city,
        COUNT(*) as total
    FROM homolog.pois
    WHERE name IS NOT NULL 
      AND city IS NOT NULL
    GROUP BY name, city
    HAVING COUNT(*) > 1
    ORDER BY total DESC
    LIMIT 10
),
pois_detalhados AS (
    SELECT 
        p.uuid_id,
        p.name,
        p.city,
        p.state,
        p.osm_id,
        p.osm_type,
        p.lat,
        p.lon,
        p.created_at,
        p.source_file,
        p.importance,
        ROW_NUMBER() OVER (
            PARTITION BY p.name, p.city 
            ORDER BY p.created_at ASC, p.uuid_id ASC
        ) as rn,
        CASE 
            WHEN ROW_NUMBER() OVER (
                PARTITION BY p.name, p.city 
                ORDER BY p.created_at ASC, p.uuid_id ASC
            ) = 1 THEN 'MANTER'
            ELSE 'APAGAR'
        END as acao
    FROM homolog.pois p
    INNER JOIN duplicatas d ON p.name = d.name AND p.city = d.city
)
SELECT 
    name,
    city,
    state,
    uuid_id,
    osm_id,
    osm_type,
    lat,
    lon,
    created_at,
    source_file,
    importance,
    acao,
    rn as ordem_no_grupo
FROM pois_detalhados
ORDER BY name, city, rn;

-- ============================================================================
-- 6. VERIFICAÇÃO: POIs com mesmo nome em cidades diferentes (NÃO apagar)
-- ============================================================================

-- POIs com mesmo nome mas em cidades diferentes (NÃO são duplicatas)
SELECT 
    'POIs com mesmo nome em cidades diferentes' as metrica,
    COUNT(*)::TEXT as valor
FROM (
    SELECT name, COUNT(DISTINCT city) as cidades_diferentes
    FROM homolog.pois
    WHERE name IS NOT NULL 
      AND city IS NOT NULL
    GROUP BY name
    HAVING COUNT(DISTINCT city) > 1
) nomes_multiplas_cidades;

-- Exemplos de nomes que aparecem em múltiplas cidades
SELECT 
    name,
    COUNT(DISTINCT city) as total_cidades,
    COUNT(*) as total_pois,
    STRING_AGG(DISTINCT city, ', ' ORDER BY city) as cidades
FROM homolog.pois
WHERE name IS NOT NULL 
  AND city IS NOT NULL
GROUP BY name
HAVING COUNT(DISTINCT city) > 1
ORDER BY total_cidades DESC, name
LIMIT 20;

-- ============================================================================
-- 7. VERIFICAÇÃO DE DEPENDÊNCIAS (coordenadas relacionadas)
-- ============================================================================

-- Verificar se há coordenadas relacionadas aos POIs que serão apagados
WITH duplicatas AS (
    SELECT 
        name,
        city,
        COUNT(*) as total
    FROM homolog.pois
    WHERE name IS NOT NULL 
      AND city IS NOT NULL
    GROUP BY name, city
    HAVING COUNT(*) > 1
),
pois_para_apagar AS (
    SELECT 
        p.uuid_id,
        ROW_NUMBER() OVER (
            PARTITION BY p.name, p.city 
            ORDER BY p.created_at ASC, p.uuid_id ASC
        ) as rn
    FROM homolog.pois p
    INNER JOIN duplicatas d ON p.name = d.name AND p.city = d.city
)
SELECT 
    'Coordenadas relacionadas a POIs que serão apagados' as metrica,
    COUNT(*)::TEXT as valor
FROM homolog.coordinates c
INNER JOIN pois_para_apagar p ON c.poi_uuid_id = p.uuid_id
WHERE p.rn > 1;

-- ============================================================================
-- 8. RESUMO FINAL
-- ============================================================================

SELECT 
    '=== RESUMO DA INVESTIGAÇÃO ===' as secao,
    '' as valor
UNION ALL
SELECT 
    'Total de POIs na tabela',
    COUNT(*)::TEXT
FROM homolog.pois
UNION ALL
SELECT 
    'Grupos de duplicatas (nome + cidade)',
    COUNT(*)::TEXT
FROM (
    SELECT name, city, COUNT(*) as cnt
    FROM homolog.pois
    WHERE name IS NOT NULL 
      AND city IS NOT NULL
    GROUP BY name, city
    HAVING COUNT(*) > 1
) duplicatas
UNION ALL
SELECT 
    'Total de POIs duplicados',
    SUM(cnt)::TEXT
FROM (
    SELECT name, city, COUNT(*) as cnt
    FROM homolog.pois
    WHERE name IS NOT NULL 
      AND city IS NOT NULL
    GROUP BY name, city
    HAVING COUNT(*) > 1
) duplicatas
UNION ALL
SELECT 
    'POIs que serão MANTIDOS',
    COUNT(*)::TEXT
FROM (
    SELECT name, city, COUNT(*) as cnt
    FROM homolog.pois
    WHERE name IS NOT NULL 
      AND city IS NOT NULL
    GROUP BY name, city
    HAVING COUNT(*) > 1
) duplicatas
UNION ALL
SELECT 
    'POIs que serão APAGADOS',
    (SUM(cnt) - COUNT(*))::TEXT
FROM (
    SELECT name, city, COUNT(*) as cnt
    FROM homolog.pois
    WHERE name IS NOT NULL 
      AND city IS NOT NULL
    GROUP BY name, city
    HAVING COUNT(*) > 1
) duplicatas;

