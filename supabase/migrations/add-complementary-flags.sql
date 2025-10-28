-- Add complementary flags columns for *=yes tags
-- FOCUSED ON TOURISM-RELEVANT FLAGS ONLY
-- These columns will store boolean flags for easy filtering

-- 🎯 CORE TOURISM FLAGS (most important for tourist guidance)
ALTER TABLE geojson_features ADD COLUMN is_historic BOOLEAN DEFAULT 0;           -- historic=yes (47 cases)
ALTER TABLE geojson_features ADD COLUMN is_touristic BOOLEAN DEFAULT 0;           -- tourism=yes (15 cases)

-- 🚂 TRANSPORTATION FLAGS (important for tourist mobility)
ALTER TABLE geojson_features ADD COLUMN has_train BOOLEAN DEFAULT 0;             -- train=yes (486 cases)
ALTER TABLE geojson_features ADD COLUMN has_ferry BOOLEAN DEFAULT 0;             -- ferry=yes (99 cases)
ALTER TABLE geojson_features ADD COLUMN has_bus BOOLEAN DEFAULT 0;                -- bus=yes (109 cases)

-- ♿ ACCESSIBILITY FLAGS (crucial for inclusive tourism)
ALTER TABLE geojson_features ADD COLUMN has_wheelchair_access BOOLEAN DEFAULT 0; -- wheelchair=yes (606 cases)

-- 🌊 NATURE/LEISURE FLAGS (attractive for tourists)
ALTER TABLE geojson_features ADD COLUMN has_water BOOLEAN DEFAULT 0;             -- water=yes (10 cases)
ALTER TABLE geojson_features ADD COLUMN has_fishing BOOLEAN DEFAULT 0;           -- fishing=yes (28 cases)
ALTER TABLE geojson_features ADD COLUMN has_playground BOOLEAN DEFAULT 0;        -- playground=yes (122 cases)

-- 🏛️ CULTURAL FLAGS (heritage and cultural sites)
ALTER TABLE geojson_features ADD COLUMN is_building BOOLEAN DEFAULT 0;            -- building=yes (573 cases) - for historic buildings
ALTER TABLE geojson_features ADD COLUMN has_ruins BOOLEAN DEFAULT 0;               -- ruins=yes (4 cases)

-- Create indexes for fast filtering on tourism-relevant flags
CREATE INDEX idx_geojson_features_is_historic ON geojson_features(is_historic);
CREATE INDEX idx_geojson_features_is_touristic ON geojson_features(is_touristic);
CREATE INDEX idx_geojson_features_has_wheelchair_access ON geojson_features(has_wheelchair_access);
CREATE INDEX idx_geojson_features_has_train ON geojson_features(has_train);
CREATE INDEX idx_geojson_features_has_ferry ON geojson_features(has_ferry);
CREATE INDEX idx_geojson_features_has_water ON geojson_features(has_water);
