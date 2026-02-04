-- Migration: Add Route Characteristics
-- Purpose: Add descriptive fields for route experience, drivability, and logistics
-- Date: 2026-02-04
-- Schema: core

-- ============================================
-- 1. ADD CHARACTERISTIC COLUMNS
-- ============================================

-- Accessibility (enum-like)
ALTER TABLE core.custom_routes 
ADD COLUMN IF NOT EXISTS accessibility TEXT DEFAULT 'unknown'
CHECK (accessibility IN ('accessible', 'partial', 'not_accessible', 'unknown'));

-- Drivability (enum-like)
ALTER TABLE core.custom_routes 
ADD COLUMN IF NOT EXISTS drivability TEXT DEFAULT 'unknown'
CHECK (drivability IN ('easy', 'moderate', 'demanding', 'unknown'));

-- Scenic Profile (multi-select array)
ALTER TABLE core.custom_routes 
ADD COLUMN IF NOT EXISTS scenic_profile TEXT[] DEFAULT '{}';

-- Best Time (multi-select array)
ALTER TABLE core.custom_routes 
ADD COLUMN IF NOT EXISTS best_time TEXT[] DEFAULT '{}';

-- Road Conditions (multi-select array)
ALTER TABLE core.custom_routes 
ADD COLUMN IF NOT EXISTS road_conditions TEXT[] DEFAULT '{}';

-- Resources (JSONB for stateful resources)
ALTER TABLE core.custom_routes 
ADD COLUMN IF NOT EXISTS resources JSONB DEFAULT '{}';

-- Photogenic Rating (enum-like)
ALTER TABLE core.custom_routes 
ADD COLUMN IF NOT EXISTS photogenic_rating TEXT DEFAULT 'unknown'
CHECK (photogenic_rating IN ('low', 'medium', 'high', 'unknown'));

-- Stops Count (manual input, calculated from waypoints initially)
ALTER TABLE core.custom_routes 
ADD COLUMN IF NOT EXISTS stops_count INTEGER DEFAULT 0;

-- ============================================
-- 2. ADD INDEXES FOR FILTERING
-- ============================================
CREATE INDEX IF NOT EXISTS idx_route_accessibility ON core.custom_routes(accessibility);
CREATE INDEX IF NOT EXISTS idx_route_drivability ON core.custom_routes(drivability);
CREATE INDEX IF NOT EXISTS idx_route_photogenic ON core.custom_routes(photogenic_rating);

-- GIN indexes for array columns (for @> contains queries)
CREATE INDEX IF NOT EXISTS idx_route_scenic_profile ON core.custom_routes USING GIN(scenic_profile);
CREATE INDEX IF NOT EXISTS idx_route_best_time ON core.custom_routes USING GIN(best_time);
CREATE INDEX IF NOT EXISTS idx_route_road_conditions ON core.custom_routes USING GIN(road_conditions);

-- ============================================
-- 3. COMMENTS FOR DOCUMENTATION
-- ============================================
COMMENT ON COLUMN core.custom_routes.accessibility IS 'Wheelchair/mobility accessibility: accessible, partial, not_accessible, unknown';
COMMENT ON COLUMN core.custom_routes.drivability IS 'Driving difficulty: easy, moderate, demanding, unknown';
COMMENT ON COLUMN core.custom_routes.scenic_profile IS 'Array of scenic tags: panoramic, historical, nature, urban, rural';
COMMENT ON COLUMN core.custom_routes.best_time IS 'Array of best times: morning, afternoon, night, sunset';
COMMENT ON COLUMN core.custom_routes.road_conditions IS 'Array of road conditions: paved, dirt, steep, curves';
COMMENT ON COLUMN core.custom_routes.resources IS 'JSONB of resource availability: { parking: yes|partial|no|unknown, restrooms: ..., rest_areas: ... }';
COMMENT ON COLUMN core.custom_routes.photogenic_rating IS 'Photography potential: low, medium, high, unknown';
COMMENT ON COLUMN core.custom_routes.stops_count IS 'Number of tourist stops along the route';
