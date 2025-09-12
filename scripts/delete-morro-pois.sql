-- ===========================================
-- SCRIPT PARA EXCLUIR POIs QUE COMEÇAM COM "MORRO"
-- ===========================================
-- Este script exclui todos os POIs da tabela core.attractions
-- cujos nomes começam com a palavra "morro" (case insensitive)

-- ===========================================
-- 1. VERIFICAÇÃO PRÉVIA - CONTAR REGISTROS
-- ===========================================

-- Contar quantos POIs começam com "morro" (case insensitive)
SELECT 
    COUNT(*) as total_pois_morro,
    'POIs que começam com "morro" (case insensitive)' as descricao
FROM core.attractions 
WHERE LOWER(attraction_name) LIKE 'morro%';

-- Mostrar alguns exemplos dos POIs que serão excluídos
SELECT 
    id,
    attraction_name,
    city,
    country,
    created_at
FROM core.attractions 
WHERE LOWER(attraction_name) LIKE 'morro%'
ORDER BY attraction_name
LIMIT 10;

-- Verificar especificamente POIs que começam com "Morro" (M maiúsculo)
SELECT 
    COUNT(*) as total_pois_Morro,
    'POIs que começam com "Morro" (M maiúsculo)' as descricao
FROM core.attractions 
WHERE attraction_name LIKE 'Morro%';

-- Mostrar exemplos de POIs que começam com "Morro" (M maiúsculo)
SELECT 
    id,
    attraction_name,
    city,
    country,
    created_at
FROM core.attractions 
WHERE attraction_name LIKE 'Morro%'
ORDER BY attraction_name
LIMIT 10;

-- ===========================================
-- 2. EXCLUSÃO DOS POIs
-- ===========================================

-- ATENÇÃO: Esta operação é IRREVERSÍVEL!
-- Descomente a linha abaixo apenas após confirmar que os dados estão corretos

-- DELETE FROM core.attractions 
-- WHERE LOWER(attraction_name) LIKE 'morro%';

-- ===========================================
-- 3. VERIFICAÇÃO PÓS-EXCLUSÃO (opcional)
-- ===========================================

-- Verificar se ainda existem POIs com "morro" no nome
-- SELECT COUNT(*) as remaining_pois_morro
-- FROM core.attractions 
-- WHERE LOWER(attraction_name) LIKE 'morro%';

-- ===========================================
-- 4. INFORMAÇÕES ADICIONAIS
-- ===========================================

-- Mostrar estatísticas gerais da tabela
SELECT 
    COUNT(*) as total_pois,
    COUNT(CASE WHEN LOWER(attraction_name) LIKE 'morro%' THEN 1 END) as pois_morro,
    COUNT(CASE WHEN LOWER(attraction_name) LIKE 'morro%' THEN 1 END) * 100.0 / COUNT(*) as percentual_morro
FROM core.attractions;

-- ===========================================
-- INSTRUÇÕES DE USO:
-- ===========================================
-- 1. Execute primeiro as consultas de verificação (seções 1 e 4)
-- 2. Revise os resultados para confirmar que são os POIs corretos
-- 3. Descomente a linha DELETE na seção 2
-- 4. Execute o script novamente para fazer a exclusão
-- 5. Execute a verificação pós-exclusão (seção 3) para confirmar
