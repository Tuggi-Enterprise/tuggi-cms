-- ===========================================
-- MIGRAÇÃO: PREVENÇÃO DE COORDENADAS DUPLICADAS
-- ===========================================
-- Data: 2024-12-20
-- Descrição: Adiciona constraint para prevenir múltiplas coordenadas por POI

-- ATENÇÃO: Esta migração pode falhar se já existirem coordenadas duplicadas
-- Execute primeiro o script de limpeza: cleanup-duplicate-coordinates.ts

-- Verificar se existem coordenadas duplicadas antes de aplicar a constraint
DO $$
DECLARE
    duplicate_count INTEGER;
BEGIN
    -- Contar POIs com múltiplas coordenadas
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT attraction_id
        FROM core.attraction_coordinate
        GROUP BY attraction_id
        HAVING COUNT(*) > 1
    ) duplicates;
    
    -- Se existirem duplicatas, mostrar aviso
    IF duplicate_count > 0 THEN
        RAISE WARNING 'ATENÇÃO: Existem % POIs com múltiplas coordenadas. Execute o script de limpeza primeiro!', duplicate_count;
        RAISE EXCEPTION 'Migração cancelada devido a coordenadas duplicadas existentes';
    END IF;
    
    RAISE NOTICE 'Verificação OK: Nenhuma coordenada duplicada encontrada';
END $$;

-- Adicionar constraint única para prevenir múltiplas coordenadas por POI
ALTER TABLE core.attraction_coordinate 
ADD CONSTRAINT unique_attraction_coordinate 
UNIQUE (attraction_id);

-- Adicionar comentário explicativo
COMMENT ON CONSTRAINT unique_attraction_coordinate ON core.attraction_coordinate 
IS 'Previne que um POI tenha múltiplas coordenadas. Cada atração deve ter apenas uma localização.';

-- Criar índice para melhorar performance (se não existir)
CREATE INDEX IF NOT EXISTS idx_attraction_coordinate_attraction_id 
ON core.attraction_coordinate (attraction_id);

-- Função para validar coordenadas antes de inserção
CREATE OR REPLACE FUNCTION core.validate_single_coordinate()
RETURNS TRIGGER AS $$
BEGIN
    -- Verificar se já existe uma coordenada para esta atração
    IF EXISTS (
        SELECT 1 
        FROM core.attraction_coordinate 
        WHERE attraction_id = NEW.attraction_id 
        AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) THEN
        RAISE EXCEPTION 'POI % já possui uma coordenada. Use UPDATE para modificar a localização existente.', NEW.attraction_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger para validação adicional
DROP TRIGGER IF EXISTS trigger_validate_single_coordinate ON core.attraction_coordinate;
CREATE TRIGGER trigger_validate_single_coordinate
    BEFORE INSERT OR UPDATE ON core.attraction_coordinate
    FOR EACH ROW
    EXECUTE FUNCTION core.validate_single_coordinate();

-- Comentários das funções
COMMENT ON FUNCTION core.validate_single_coordinate() IS 'Valida que cada POI tenha apenas uma coordenada';
COMMENT ON TRIGGER trigger_validate_single_coordinate ON core.attraction_coordinate IS 'Trigger que previne inserção de coordenadas duplicadas';

-- Migração concluída com sucesso
-- Constraint única, índice, função e trigger criados para prevenir coordenadas duplicadas