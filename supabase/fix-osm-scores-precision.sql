-- Script para corrigir a precisão dos campos de score OSM
-- Altera os campos de numeric(3,2) para numeric(5,2) para permitir valores 0-100

-- ============================================================================
-- CORREÇÃO DA PRECISÃO DOS CAMPOS DE SCORE
-- ============================================================================

-- Verificar se os campos existem e alterar a precisão
DO $$
BEGIN
    -- Alterar osm_data_quality_score se existir
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'core' 
        AND table_name = 'attractions' 
        AND column_name = 'osm_data_quality_score'
        AND data_type = 'numeric'
        AND numeric_precision = 3
    ) THEN
        ALTER TABLE core.attractions 
        ALTER COLUMN osm_data_quality_score TYPE numeric(5,2);
        
        RAISE NOTICE 'Campo osm_data_quality_score alterado para numeric(5,2)';
    END IF;

    -- Alterar pov_quality_score se existir
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'core' 
        AND table_name = 'attractions' 
        AND column_name = 'pov_quality_score'
        AND data_type = 'numeric'
        AND numeric_precision = 3
    ) THEN
        ALTER TABLE core.attractions 
        ALTER COLUMN pov_quality_score TYPE numeric(5,2);
        
        RAISE NOTICE 'Campo pov_quality_score alterado para numeric(5,2)';
    END IF;

    -- Alterar visibility_score se existir
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'core' 
        AND table_name = 'attractions' 
        AND column_name = 'visibility_score'
        AND data_type = 'numeric'
        AND numeric_precision = 3
    ) THEN
        ALTER TABLE core.attractions 
        ALTER COLUMN visibility_score TYPE numeric(5,2);
        
        RAISE NOTICE 'Campo visibility_score alterado para numeric(5,2)';
    END IF;

    -- Alterar accessibility_score se existir
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'core' 
        AND table_name = 'attractions' 
        AND column_name = 'accessibility_score'
        AND data_type = 'numeric'
        AND numeric_precision = 3
    ) THEN
        ALTER TABLE core.attractions 
        ALTER COLUMN accessibility_score TYPE numeric(5,2);
        
        RAISE NOTICE 'Campo accessibility_score alterado para numeric(5,2)';
    END IF;

    -- Alterar photogenic_score se existir
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'core' 
        AND table_name = 'attractions' 
        AND column_name = 'photogenic_score'
        AND data_type = 'numeric'
        AND numeric_precision = 3
    ) THEN
        ALTER TABLE core.attractions 
        ALTER COLUMN photogenic_score TYPE numeric(5,2);
        
        RAISE NOTICE 'Campo photogenic_score alterado para numeric(5,2)';
    END IF;

END $$;

-- ============================================================================
-- ATUALIZAR CONSTRAINTS DE CHECK
-- ============================================================================

-- Remover constraints antigas se existirem
DO $$
BEGIN
    -- Remover constraints de osm_data_quality_score
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name LIKE '%osm_data_quality_score%'
    ) THEN
        ALTER TABLE core.attractions 
        DROP CONSTRAINT IF EXISTS attractions_osm_data_quality_score_check;
    END IF;

    -- Remover constraints de pov_quality_score
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name LIKE '%pov_quality_score%'
    ) THEN
        ALTER TABLE core.attractions 
        DROP CONSTRAINT IF EXISTS attractions_pov_quality_score_check;
    END IF;

    -- Remover constraints de visibility_score
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name LIKE '%visibility_score%'
    ) THEN
        ALTER TABLE core.attractions 
        DROP CONSTRAINT IF EXISTS attractions_visibility_score_check;
    END IF;

    -- Remover constraints de accessibility_score
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name LIKE '%accessibility_score%'
    ) THEN
        ALTER TABLE core.attractions 
        DROP CONSTRAINT IF EXISTS attractions_accessibility_score_check;
    END IF;

    -- Remover constraints de photogenic_score
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name LIKE '%photogenic_score%'
    ) THEN
        ALTER TABLE core.attractions 
        DROP CONSTRAINT IF EXISTS attractions_photogenic_score_check;
    END IF;

END $$;

-- Adicionar novas constraints com range correto (0-100)
DO $$
BEGIN
    -- Adicionar constraint para osm_data_quality_score se não existir
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name = 'attractions_osm_data_quality_score_check'
    ) THEN
        ALTER TABLE core.attractions 
        ADD CONSTRAINT attractions_osm_data_quality_score_check 
        CHECK (osm_data_quality_score >= 0 AND osm_data_quality_score <= 100);
    END IF;

    -- Adicionar constraint para pov_quality_score se não existir
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name = 'attractions_pov_quality_score_check'
    ) THEN
        ALTER TABLE core.attractions 
        ADD CONSTRAINT attractions_pov_quality_score_check 
        CHECK (pov_quality_score >= 0 AND pov_quality_score <= 100);
    END IF;

    -- Adicionar constraint para visibility_score se não existir
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name = 'attractions_visibility_score_check'
    ) THEN
        ALTER TABLE core.attractions 
        ADD CONSTRAINT attractions_visibility_score_check 
        CHECK (visibility_score >= 0 AND visibility_score <= 100);
    END IF;

    -- Adicionar constraint para accessibility_score se não existir
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name = 'attractions_accessibility_score_check'
    ) THEN
        ALTER TABLE core.attractions 
        ADD CONSTRAINT attractions_accessibility_score_check 
        CHECK (accessibility_score >= 0 AND accessibility_score <= 100);
    END IF;

    -- Adicionar constraint para photogenic_score se não existir
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_name = 'attractions_photogenic_score_check'
    ) THEN
        ALTER TABLE core.attractions 
        ADD CONSTRAINT attractions_photogenic_score_check 
        CHECK (photogenic_score >= 0 AND photogenic_score <= 100);
    END IF;

END $$;

-- ============================================================================
-- VERIFICAÇÃO FINAL
-- ============================================================================

-- Verificar a estrutura dos campos após a correção
SELECT 
    column_name,
    data_type,
    numeric_precision,
    numeric_scale,
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'core' 
AND table_name = 'attractions' 
AND column_name IN (
    'osm_data_quality_score',
    'pov_quality_score', 
    'visibility_score',
    'accessibility_score',
    'photogenic_score'
)
ORDER BY column_name;

-- Verificar constraints
SELECT 
    constraint_name,
    check_clause
FROM information_schema.check_constraints 
WHERE constraint_name LIKE '%score%'
ORDER BY constraint_name;

-- ============================================================================
-- RESUMO DAS ALTERAÇÕES
-- ============================================================================

/*
ALTERAÇÕES REALIZADAS:
1. Alterado osm_data_quality_score de numeric(3,2) para numeric(5,2)
2. Alterado pov_quality_score de numeric(3,2) para numeric(5,2)
3. Alterado visibility_score de numeric(3,2) para numeric(5,2)
4. Alterado accessibility_score de numeric(3,2) para numeric(5,2)
5. Alterado photogenic_score de numeric(3,2) para numeric(5,2)
6. Atualizado constraints de CHECK para permitir valores 0-100

BENEFÍCIOS:
- Permite scores de 0-100 (em vez de 0-9.99)
- Mantém precisão de 2 casas decimais
- Compatível com a lógica da API de enriquecimento OSM
- Evita erros de overflow numérico
*/
