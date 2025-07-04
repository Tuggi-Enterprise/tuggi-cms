-- Check and fix trigger points table setup
-- Run this to ensure your manually created table has all required columns

-- ===========================================
-- CHECK EXISTING COLUMNS
-- ===========================================

SELECT 
    column_name,
    data_type,
    column_default,
    is_nullable,
    character_maximum_length
FROM information_schema.columns 
WHERE table_schema = 'core' 
AND table_name = 'attraction_trigger_points'
ORDER BY ordinal_position;

-- ===========================================
-- ADD MISSING COLUMNS IF NEEDED
-- ===========================================

-- Check if is_active column exists and add if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'core' 
        AND table_name = 'attraction_trigger_points' 
        AND column_name = 'is_active'
    ) THEN
        ALTER TABLE core.attraction_trigger_points ADD COLUMN is_active boolean DEFAULT true;
        COMMENT ON COLUMN core.attraction_trigger_points.is_active IS 'Whether the trigger point is active and should be used';
    END IF;
END $$;

-- ===========================================
-- VERIFY COLUMN TYPES AND CONSTRAINTS
-- ===========================================

-- Check if location column is properly typed as geography
DO $$
BEGIN
    -- Fix location column type if needed
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'core' 
        AND table_name = 'attraction_trigger_points' 
        AND column_name = 'location'
        AND data_type != 'USER-DEFINED'
    ) THEN
        ALTER TABLE core.attraction_trigger_points 
        ALTER COLUMN location TYPE geography(Point, 4326);
    END IF;
END $$;

-- ===========================================
-- ADD MISSING CONSTRAINTS
-- ===========================================

-- Add check constraints if they don't exist
DO $$
BEGIN
    -- Radius constraint
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_schema = 'core' 
        AND constraint_name = 'attraction_trigger_points_radius_meters_check'
    ) THEN
        ALTER TABLE core.attraction_trigger_points 
        ADD CONSTRAINT attraction_trigger_points_radius_meters_check 
        CHECK (radius_meters > 0);
    END IF;
    
    -- Bearing constraint
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_schema = 'core' 
        AND constraint_name = 'attraction_trigger_points_expected_bearing_check'
    ) THEN
        ALTER TABLE core.attraction_trigger_points 
        ADD CONSTRAINT attraction_trigger_points_expected_bearing_check 
        CHECK (expected_bearing >= 0 AND expected_bearing <= 360);
    END IF;
    
    -- Bearing threshold constraint
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_schema = 'core' 
        AND constraint_name = 'attraction_trigger_points_bearing_threshold_check'
    ) THEN
        ALTER TABLE core.attraction_trigger_points 
        ADD CONSTRAINT attraction_trigger_points_bearing_threshold_check 
        CHECK (bearing_threshold >= 0 AND bearing_threshold <= 180);
    END IF;
    
    -- Type constraint
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_schema = 'core' 
        AND constraint_name = 'attraction_trigger_points_type_check'
    ) THEN
        ALTER TABLE core.attraction_trigger_points 
        ADD CONSTRAINT attraction_trigger_points_type_check 
        CHECK (type IN ('primary', 'fallback', 'entry', 'exit', 'approach', 'custom'));
    END IF;
    
    -- Priority constraint
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints 
        WHERE constraint_schema = 'core' 
        AND constraint_name = 'attraction_trigger_points_priority_check'
    ) THEN
        ALTER TABLE core.attraction_trigger_points 
        ADD CONSTRAINT attraction_trigger_points_priority_check 
        CHECK (priority >= 1);
    END IF;
END $$;

-- ===========================================
-- FINAL VERIFICATION
-- ===========================================

-- Display final table structure
SELECT 
    'Final table structure:' as info,
    column_name,
    data_type,
    column_default,
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'core' 
AND table_name = 'attraction_trigger_points'
ORDER BY ordinal_position;

-- Count constraints
SELECT 
    'Constraints:' as info,
    constraint_name,
    constraint_type
FROM information_schema.table_constraints 
WHERE table_schema = 'core' 
AND table_name = 'attraction_trigger_points'
ORDER BY constraint_type, constraint_name; 