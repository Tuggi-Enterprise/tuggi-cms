-- Migration para análise de coordenadas duplicadas
-- Criada em: 2025-01-06

-- Função para obter POIs com múltiplas coordenadas
CREATE OR REPLACE FUNCTION core.get_pois_with_multiple_coordinates()
RETURNS TABLE (
  attraction_id uuid,
  attraction_name text,
  city text,
  country text,
  coordinate_count bigint,
  coordinate_ids uuid[],
  coordinates jsonb[]
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id as attraction_id,
    a.name as attraction_name,
    a.city,
    a.country,
    COUNT(ac.id) as coordinate_count,
    ARRAY_AGG(ac.id) as coordinate_ids,
    ARRAY_AGG(
      jsonb_build_object(
        'id', ac.id,
        'latitude', ac.latitude,
        'longitude', ac.longitude,
        'created_at', ac.created_at,
        'show_in_map', ac.show_in_map
      )
    ) as coordinates
  FROM core.attractions a
  JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
  GROUP BY a.id, a.name, a.city, a.country
  HAVING COUNT(ac.id) > 1
  ORDER BY coordinate_count DESC, a.name;
END;
$$;

-- Função para validar se um POI ficará sem coordenadas após remoção
CREATE OR REPLACE FUNCTION core.validate_poi_coordinates_after_removal(
  p_attraction_id uuid,
  p_coordinates_to_remove uuid[]
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  total_coordinates integer;
  coordinates_to_remove_count integer;
BEGIN
  -- Contar total de coordenadas do POI
  SELECT COUNT(*) INTO total_coordinates
  FROM core.attraction_coordinate
  WHERE attraction_id = p_attraction_id;
  
  -- Contar quantas coordenadas serão removidas
  SELECT COUNT(*) INTO coordinates_to_remove_count
  FROM core.attraction_coordinate
  WHERE attraction_id = p_attraction_id
  AND id = ANY(p_coordinates_to_remove);
  
  -- Retornar true se o POI terá pelo menos 1 coordenada restante
  RETURN (total_coordinates - coordinates_to_remove_count) >= 1;
END;
$$;

-- Função para obter estatísticas de coordenadas
CREATE OR REPLACE FUNCTION core.get_coordinate_statistics()
RETURNS TABLE (
  total_coordinates bigint,
  total_attractions bigint,
  attractions_with_multiple_coordinates bigint,
  total_duplicate_coordinates bigint
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT 
      COUNT(ac.id) as total_coords,
      COUNT(DISTINCT ac.attraction_id) as total_attractions,
      COUNT(DISTINCT CASE WHEN coord_count.coordinate_count > 1 THEN ac.attraction_id END) as attractions_with_multiple
    FROM core.attraction_coordinate ac
    LEFT JOIN (
      SELECT attraction_id, COUNT(*) as coordinate_count
      FROM core.attraction_coordinate
      GROUP BY attraction_id
    ) coord_count ON ac.attraction_id = coord_count.attraction_id
  )
  SELECT 
    stats.total_coords,
    stats.total_attractions,
    stats.attractions_with_multiple,
    (stats.total_coords - stats.total_attractions) as total_duplicate_coordinates
  FROM stats;
END;
$$;

-- Tabela de backup para coordenadas (caso seja necessário)
CREATE TABLE IF NOT EXISTS core.attraction_coordinate_backup (
  id uuid PRIMARY KEY,
  attraction_id uuid NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  show_in_map boolean,
  backup_created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT attraction_coordinate_backup_attraction_id_fkey 
    FOREIGN KEY (attraction_id) REFERENCES core.attractions (id) ON DELETE CASCADE
);

-- Índice para performance
CREATE INDEX IF NOT EXISTS idx_attraction_coordinate_backup_attraction_id 
ON core.attraction_coordinate_backup (attraction_id);

-- Comentários para documentação
COMMENT ON FUNCTION core.get_pois_with_multiple_coordinates() IS 'Retorna POIs que possuem múltiplas coordenadas com detalhes completos';
COMMENT ON FUNCTION core.validate_poi_coordinates_after_removal(uuid, uuid[]) IS 'Valida se um POI ficará sem coordenadas após remoção de coordenadas específicas';
COMMENT ON FUNCTION core.get_coordinate_statistics() IS 'Retorna estatísticas gerais sobre coordenadas no sistema';
COMMENT ON TABLE core.attraction_coordinate_backup IS 'Tabela de backup para coordenadas removidas durante limpeza de duplicatas';

