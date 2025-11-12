-- Migration: Add fields from homolog.coordinates to core.attraction_coordinate
-- Created: 2025-01-29
-- Purpose: Prepare core.attraction_coordinate schema for migration from homolog.coordinates

-- ============================================================================
-- 1. ADICIONAR CAMPOS FALTANTES
-- ============================================================================

ALTER TABLE core.attraction_coordinate 
ADD COLUMN IF NOT EXISTS elevation_m integer,
ADD COLUMN IF NOT EXISTS boundary_type text,
ADD COLUMN IF NOT EXISTS boundary_source text,
ADD COLUMN IF NOT EXISTS boundary_confidence numeric(3,2),
ADD COLUMN IF NOT EXISTS boundary_area_m2 numeric(12,2),
ADD COLUMN IF NOT EXISTS boundary_centroid_lat numeric(10,8),
ADD COLUMN IF NOT EXISTS boundary_centroid_lng numeric(11,8),
ADD COLUMN IF NOT EXISTS boundary_geometry geography,
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now(),
ADD COLUMN IF NOT EXISTS show_in_map boolean DEFAULT true;

-- ============================================================================
-- 2. CONSTRAINTS
-- ============================================================================

-- Constraint para elevation_m (drop if exists first)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_elevation_range' 
        AND conrelid = 'core.attraction_coordinate'::regclass
    ) THEN
        ALTER TABLE core.attraction_coordinate DROP CONSTRAINT chk_elevation_range;
    END IF;
END $$;

ALTER TABLE core.attraction_coordinate 
ADD CONSTRAINT chk_elevation_range 
CHECK (elevation_m IS NULL OR (elevation_m >= -500 AND elevation_m <= 10000));

-- Constraint para boundary_confidence (drop if exists first)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_boundary_confidence_range' 
        AND conrelid = 'core.attraction_coordinate'::regclass
    ) THEN
        ALTER TABLE core.attraction_coordinate DROP CONSTRAINT chk_boundary_confidence_range;
    END IF;
END $$;

ALTER TABLE core.attraction_coordinate 
ADD CONSTRAINT chk_boundary_confidence_range 
CHECK (boundary_confidence IS NULL OR (boundary_confidence >= 0 AND boundary_confidence <= 1));

-- Constraint para boundary_area_m2 (drop if exists first)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_boundary_area_positive' 
        AND conrelid = 'core.attraction_coordinate'::regclass
    ) THEN
        ALTER TABLE core.attraction_coordinate DROP CONSTRAINT chk_boundary_area_positive;
    END IF;
END $$;

ALTER TABLE core.attraction_coordinate 
ADD CONSTRAINT chk_boundary_area_positive 
CHECK (boundary_area_m2 IS NULL OR boundary_area_m2 > 0);

-- ============================================================================
-- 3. ÍNDICES PARA PERFORMANCE
-- ============================================================================

-- Índice espacial para boundary_geometry (crítico para queries geográficas)
CREATE INDEX IF NOT EXISTS idx_attraction_coordinate_boundary_geometry 
ON core.attraction_coordinate USING GIST (boundary_geometry) 
WHERE boundary_geometry IS NOT NULL;

-- Índices para boundary metadata
CREATE INDEX IF NOT EXISTS idx_attraction_coordinate_boundary_type 
ON core.attraction_coordinate(boundary_type) 
WHERE boundary_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attraction_coordinate_boundary_source 
ON core.attraction_coordinate(boundary_source) 
WHERE boundary_source IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attraction_coordinate_boundary_confidence 
ON core.attraction_coordinate(boundary_confidence) 
WHERE boundary_confidence IS NOT NULL;

-- Índice composto para queries comuns
CREATE INDEX IF NOT EXISTS idx_attraction_coordinate_boundary_metadata 
ON core.attraction_coordinate(boundary_type, boundary_source, boundary_confidence) 
WHERE boundary_type IS NOT NULL;

-- ============================================================================
-- 4. TRIGGER PARA updated_at
-- ============================================================================

-- Criar função para atualizar updated_at (se não existir)
CREATE OR REPLACE FUNCTION core.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger (se não existir)
DROP TRIGGER IF EXISTS handle_updated_at ON core.attraction_coordinate;
CREATE TRIGGER handle_updated_at
  BEFORE UPDATE ON core.attraction_coordinate
  FOR EACH ROW
  EXECUTE FUNCTION core.handle_updated_at();

-- ============================================================================
-- 5. COMENTÁRIOS
-- ============================================================================

COMMENT ON COLUMN core.attraction_coordinate.elevation_m IS 'Elevation in meters above sea level';
COMMENT ON COLUMN core.attraction_coordinate.boundary_geometry IS 'GEOGRAPHY polygon representing POI boundary - used for trigger points generation';
COMMENT ON COLUMN core.attraction_coordinate.boundary_type IS 'Type of boundary: polygon, circle, point';
COMMENT ON COLUMN core.attraction_coordinate.boundary_source IS 'Source of boundary: osm, nominatim, manual, estimated';
COMMENT ON COLUMN core.attraction_coordinate.boundary_confidence IS 'Confidence score of boundary (0-1)';

