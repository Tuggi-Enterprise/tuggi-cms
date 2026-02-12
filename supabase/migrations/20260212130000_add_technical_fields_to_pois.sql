-- Adicionando colunas de metadados técnicos (V21 Elite Filter Sync)
ALTER TABLE homolog.pois 
ADD COLUMN IF NOT EXISTS elevation numeric(8, 2),
ADD COLUMN IF NOT EXISTS building_levels integer,
ADD COLUMN IF NOT EXISTS denomination text;

-- Comentários para documentação
COMMENT ON COLUMN homolog.pois.elevation IS 'Altitude do ponto em relação ao nível do mar (tag OSM: ele)';
COMMENT ON COLUMN homolog.pois.building_levels IS 'Número de andares da estrutura (tag OSM: building:levels)';
COMMENT ON COLUMN homolog.pois.denomination IS 'Denominação religiosa específica (ex: catholic, lutheran, etc - tag OSM: denomination)';

-- Criando índices para performance nestas novas colunas
CREATE INDEX IF NOT EXISTS idx_pois_elevation ON homolog.pois (elevation) WHERE elevation IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pois_denomination ON homolog.pois (denomination) WHERE denomination IS NOT NULL;
