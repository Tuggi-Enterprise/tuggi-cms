-- Drop tables pois and coordinates in homolog schema
-- This will allow reimporting all data with the new UUID generation rules
-- Created: 2025-01-28

-- Step 1: Drop coordinates table first (it has foreign key to pois)
-- CASCADE will automatically drop dependent objects (views, triggers, etc.)
DROP TABLE IF EXISTS homolog.coordinates CASCADE;

-- Step 2: Drop pois table
-- CASCADE will automatically drop dependent objects (views, triggers, functions that depend on it, etc.)
DROP TABLE IF EXISTS homolog.pois CASCADE;

-- Note: The functions homolog.generate_poi_uuid_simple and homolog.create_poi_with_uuid
-- are kept as they will be needed for the reimport
-- The tables will be recreated by running the original migrations in order

COMMENT ON SCHEMA homolog IS 'Schema for homologation environment - tables will be recreated on next import';

