-- Migration para prevenir coordenadas duplicadas usando UNIQUE constraint
-- Criada em: 2025-01-06
-- Abordagem mais performática: UNIQUE constraint em vez de triggers

-- 1. Primeiro, verificar se há duplicatas existentes e limpar
DO $$
DECLARE
  duplicate_count integer;
BEGIN
  -- Verificar se há duplicatas
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT attraction_id, COUNT(*) as coord_count
    FROM core.attraction_coordinate
    GROUP BY attraction_id
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_count > 0 THEN
    RAISE NOTICE 'Encontradas % POIs com coordenadas duplicadas. Limpando...', duplicate_count;
    
    -- Limpar duplicatas mantendo apenas a primeira (mais antiga)
    WITH duplicates_to_remove AS (
      SELECT 
        id,
        ROW_NUMBER() OVER (
          PARTITION BY attraction_id 
          ORDER BY created_at ASC
        ) as row_num
      FROM core.attraction_coordinate
    )
    DELETE FROM core.attraction_coordinate
    WHERE id IN (
      SELECT id 
      FROM duplicates_to_remove 
      WHERE row_num > 1
    );
    
    RAISE NOTICE 'Duplicatas removidas com sucesso.';
  ELSE
    RAISE NOTICE 'Nenhuma duplicata encontrada.';
  END IF;
END $$;

-- 2. Criar índice único para performance
-- Este índice também serve como constraint UNIQUE
CREATE UNIQUE INDEX IF NOT EXISTS idx_attraction_coordinate_unique_attraction_id 
ON core.attraction_coordinate (attraction_id);

-- 3. Adicionar constraint UNIQUE explícita (redundante mas clara)
-- Isso garante que não haverá attraction_id duplicado
ALTER TABLE core.attraction_coordinate 
ADD CONSTRAINT attraction_coordinate_unique_attraction_id 
UNIQUE (attraction_id);

-- 4. Função segura para inserir/atualizar coordenadas
CREATE OR REPLACE FUNCTION core.upsert_coordinate(
  p_attraction_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_show_in_map boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  coordinate_id uuid;
BEGIN
  -- Tentar inserir nova coordenada
  INSERT INTO core.attraction_coordinate (
    attraction_id,
    latitude,
    longitude,
    show_in_map
  ) VALUES (
    p_attraction_id,
    p_latitude,
    p_longitude,
    p_show_in_map
  ) RETURNING id INTO coordinate_id;
  
  RETURN coordinate_id;
  
EXCEPTION
  WHEN unique_violation THEN
    -- Se já existe, atualizar a coordenada existente
    UPDATE core.attraction_coordinate
    SET 
      latitude = p_latitude,
      longitude = p_longitude,
      show_in_map = p_show_in_map,
      updated_at = now()
    WHERE attraction_id = p_attraction_id
    RETURNING id INTO coordinate_id;
    
    RETURN coordinate_id;
END;
$$;

-- 5. Função para verificar se POI tem coordenada (rápida)
CREATE OR REPLACE FUNCTION core.has_coordinate(
  p_attraction_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM core.attraction_coordinate 
    WHERE attraction_id = p_attraction_id
  );
END;
$$;

-- 6. Função para obter coordenada de um POI
CREATE OR REPLACE FUNCTION core.get_coordinate(
  p_attraction_id uuid
)
RETURNS TABLE (
  id uuid,
  latitude double precision,
  longitude double precision,
  show_in_map boolean,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ac.id,
    ac.latitude,
    ac.longitude,
    ac.show_in_map,
    ac.created_at,
    ac.updated_at
  FROM core.attraction_coordinate ac
  WHERE ac.attraction_id = p_attraction_id;
END;
$$;

-- 7. Comentários para documentação
COMMENT ON INDEX idx_attraction_coordinate_unique_attraction_id IS 'Índice único que garante apenas uma coordenada por POI';
COMMENT ON CONSTRAINT attraction_coordinate_unique_attraction_id ON core.attraction_coordinate IS 'Constraint que impede attraction_id duplicado';
COMMENT ON FUNCTION core.upsert_coordinate(uuid, double precision, double precision, boolean) IS 'Insere nova coordenada ou atualiza existente (UPSERT)';
COMMENT ON FUNCTION core.has_coordinate(uuid) IS 'Verifica rapidamente se POI tem coordenada';
COMMENT ON FUNCTION core.get_coordinate(uuid) IS 'Retorna coordenada de um POI';

-- 8. Estatísticas da migração
DO $$
DECLARE
  total_coordinates integer;
  unique_pois integer;
BEGIN
  SELECT COUNT(*) INTO total_coordinates FROM core.attraction_coordinate;
  SELECT COUNT(DISTINCT attraction_id) INTO unique_pois FROM core.attraction_coordinate;
  
  RAISE NOTICE 'Migração concluída:';
  RAISE NOTICE '  Total de coordenadas: %', total_coordinates;
  RAISE NOTICE '  POIs únicos: %', unique_pois;
  RAISE NOTICE '  Constraint UNIQUE aplicada com sucesso!';
END $$;
