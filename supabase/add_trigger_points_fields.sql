-- Add trigger points generation metadata fields to core.attractions table
-- These fields will store information generated during trigger points creation

-- POI Height Information
ALTER TABLE core.attractions ADD COLUMN IF NOT EXISTS poi_height real;
ALTER TABLE core.attractions ADD COLUMN IF NOT EXISTS height_confidence real;

-- Urban Density Analysis
ALTER TABLE core.attractions ADD COLUMN IF NOT EXISTS urban_density text;

-- Boundary Detection Results
ALTER TABLE core.attractions ADD COLUMN IF NOT EXISTS boundary_source text;
ALTER TABLE core.attractions ADD COLUMN IF NOT EXISTS boundary_confidence real;
ALTER TABLE core.attractions ADD COLUMN IF NOT EXISTS boundary_area_m2 real;

-- Trigger Points Generation Strategy
ALTER TABLE core.attractions ADD COLUMN IF NOT EXISTS generation_strategy text;
ALTER TABLE core.attractions ADD COLUMN IF NOT EXISTS generation_range real;

-- Metadata and Timestamps
ALTER TABLE core.attractions ADD COLUMN IF NOT EXISTS last_tp_generation_at timestamp without time zone;
ALTER TABLE core.attractions ADD COLUMN IF NOT EXISTS tp_generation_metadata jsonb;

-- Add constraints for data validation
ALTER TABLE core.attractions ADD CONSTRAINT chk_poi_height_positive 
  CHECK (poi_height IS NULL OR poi_height >= 0);

ALTER TABLE core.attractions ADD CONSTRAINT chk_height_confidence_range 
  CHECK (height_confidence IS NULL OR (height_confidence >= 0 AND height_confidence <= 1));

ALTER TABLE core.attractions ADD CONSTRAINT chk_urban_density_values 
  CHECK (urban_density IS NULL OR urban_density IN ('very_dense', 'dense', 'medium', 'low', 'rural'));

ALTER TABLE core.attractions ADD CONSTRAINT chk_boundary_confidence_range 
  CHECK (boundary_confidence IS NULL OR (boundary_confidence >= 0 AND boundary_confidence <= 1));

ALTER TABLE core.attractions ADD CONSTRAINT chk_boundary_area_positive 
  CHECK (boundary_area_m2 IS NULL OR boundary_area_m2 >= 0);

ALTER TABLE core.attractions ADD CONSTRAINT chk_generation_strategy_values 
  CHECK (generation_strategy IS NULL OR generation_strategy IN ('circular', 'boundary_offset'));

ALTER TABLE core.attractions ADD CONSTRAINT chk_generation_range_positive 
  CHECK (generation_range IS NULL OR generation_range > 0);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_attractions_urban_density 
  ON core.attractions (urban_density) 
  WHERE urban_density IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attractions_generation_strategy 
  ON core.attractions (generation_strategy) 
  WHERE generation_strategy IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attractions_last_tp_generation 
  ON core.attractions (last_tp_generation_at) 
  WHERE last_tp_generation_at IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN core.attractions.poi_height IS 'Detected height of the POI in meters';
COMMENT ON COLUMN core.attractions.height_confidence IS 'Confidence score (0-1) for the height detection';
COMMENT ON COLUMN core.attractions.urban_density IS 'Urban density classification of the POI area';
COMMENT ON COLUMN core.attractions.boundary_source IS 'Source of the boundary detection (osm_nominatim, estimated, etc.)';
COMMENT ON COLUMN core.attractions.boundary_confidence IS 'Confidence score (0-1) for the boundary detection';
COMMENT ON COLUMN core.attractions.boundary_area_m2 IS 'Area of the detected boundary in square meters';
COMMENT ON COLUMN core.attractions.generation_strategy IS 'Strategy used for trigger points generation';
COMMENT ON COLUMN core.attractions.generation_range IS 'Range used for trigger points generation in meters';
COMMENT ON COLUMN core.attractions.last_tp_generation_at IS 'Timestamp of the last trigger points generation';
COMMENT ON COLUMN core.attractions.tp_generation_metadata IS 'JSON metadata from trigger points generation process';
