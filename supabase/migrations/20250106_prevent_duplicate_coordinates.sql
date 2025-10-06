-- Migration para prevenir coordenadas duplicadas
-- Criada em: 2025-01-06

-- 1. Função para verificar se um POI já tem coordenada
CREATE OR REPLACE FUNCTION core.check_existing_coordinate(
  p_attraction_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  coordinate_count integer;
BEGIN
  SELECT COUNT(*) INTO coordinate_count
  FROM core.attraction_coordinate
  WHERE attraction_id = p_attraction_id;
  
  RETURN coordinate_count > 0;
END;
$$;

-- 2. Função para obter a coordenada existente de um POI
CREATE OR REPLACE FUNCTION core.get_existing_coordinate(
  p_attraction_id uuid
)
RETURNS TABLE (
  id uuid,
  latitude double precision,
  longitude double precision,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ac.id,
    ac.latitude,
    ac.longitude,
    ac.created_at
  FROM core.attraction_coordinate ac
  WHERE ac.attraction_id = p_attraction_id
  ORDER BY ac.created_at ASC
  LIMIT 1;
END;
$$;

-- 3. Trigger para prevenir inserção de coordenadas duplicadas
CREATE OR REPLACE FUNCTION core.prevent_duplicate_coordinates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  existing_count integer;
BEGIN
  -- Verificar se já existe coordenada para este POI
  SELECT COUNT(*) INTO existing_count
  FROM core.attraction_coordinate
  WHERE attraction_id = NEW.attraction_id;
  
  -- Se já existe, cancelar a inserção e mostrar aviso
  IF existing_count > 0 THEN
    RAISE EXCEPTION 
      'POI % já possui uma coordenada. Use UPDATE para modificar a coordenada existente ou DELETE para remover antes de inserir nova.',
      NEW.attraction_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- 4. Aplicar trigger na tabela attraction_coordinate
DROP TRIGGER IF EXISTS prevent_duplicate_coordinates_trigger ON core.attraction_coordinate;

CREATE TRIGGER prevent_duplicate_coordinates_trigger
  BEFORE INSERT ON core.attraction_coordinate
  FOR EACH ROW
  EXECUTE FUNCTION core.prevent_duplicate_coordinates();

-- 5. Função para inserir coordenada com verificação (API segura)
CREATE OR REPLACE FUNCTION core.insert_coordinate_safe(
  p_attraction_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_show_in_map boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  new_coordinate_id uuid;
  existing_coordinate_id uuid;
BEGIN
  -- Verificar se já existe coordenada
  SELECT id INTO existing_coordinate_id
  FROM core.attraction_coordinate
  WHERE attraction_id = p_attraction_id
  LIMIT 1;
  
  IF existing_coordinate_id IS NOT NULL THEN
    -- Atualizar coordenada existente
    UPDATE core.attraction_coordinate
    SET 
      latitude = p_latitude,
      longitude = p_longitude,
      show_in_map = p_show_in_map,
      updated_at = now()
    WHERE id = existing_coordinate_id;
    
    RETURN existing_coordinate_id;
  ELSE
    -- Inserir nova coordenada
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
    ) RETURNING id INTO new_coordinate_id;
    
    RETURN new_coordinate_id;
  END IF;
END;
$$;

-- 6. Função para limpar duplicatas existentes (executar uma vez)
CREATE OR REPLACE FUNCTION core.cleanup_existing_duplicates()
RETURNS TABLE (
  attraction_id uuid,
  coordinates_removed integer,
  coordinate_kept uuid
)
LANGUAGE plpgsql
AS $$
DECLARE
  poi_record RECORD;
  first_coordinate_id uuid;
  coordinates_to_remove uuid[];
BEGIN
  -- Para cada POI com múltiplas coordenadas
  FOR poi_record IN 
    SELECT attraction_id, COUNT(*) as coord_count
    FROM core.attraction_coordinate
    GROUP BY attraction_id
    HAVING COUNT(*) > 1
  LOOP
    -- Obter ID da primeira coordenada (mais antiga)
    SELECT id INTO first_coordinate_id
    FROM core.attraction_coordinate
    WHERE attraction_id = poi_record.attraction_id
    ORDER BY created_at ASC
    LIMIT 1;
    
    -- Obter IDs das coordenadas para remover
    SELECT ARRAY_AGG(id) INTO coordinates_to_remove
    FROM core.attraction_coordinate
    WHERE attraction_id = poi_record.attraction_id
    AND id != first_coordinate_id;
    
    -- Remover coordenadas duplicadas
    DELETE FROM core.attraction_coordinate
    WHERE id = ANY(coordinates_to_remove);
    
    -- Retornar resultado
    attraction_id := poi_record.attraction_id;
    coordinates_removed := array_length(coordinates_to_remove, 1);
    coordinate_kept := first_coordinate_id;
    
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 7. Comentários para documentação
COMMENT ON FUNCTION core.check_existing_coordinate(uuid) IS 'Verifica se um POI já possui coordenada';
COMMENT ON FUNCTION core.get_existing_coordinate(uuid) IS 'Retorna a primeira coordenada de um POI';
COMMENT ON FUNCTION core.prevent_duplicate_coordinates() IS 'Trigger que impede inserção de coordenadas duplicadas';
COMMENT ON FUNCTION core.insert_coordinate_safe(uuid, double precision, double precision, boolean) IS 'Função segura para inserir/atualizar coordenadas sem duplicatas';
COMMENT ON FUNCTION core.cleanup_existing_duplicates() IS 'Limpa duplicatas existentes mantendo apenas a primeira coordenada de cada POI';

-- 8. Índice para performance na verificação de duplicatas
CREATE INDEX IF NOT EXISTS idx_attraction_coordinate_attraction_id_unique 
ON core.attraction_coordinate (attraction_id) 
WHERE attraction_id IS NOT NULL;

