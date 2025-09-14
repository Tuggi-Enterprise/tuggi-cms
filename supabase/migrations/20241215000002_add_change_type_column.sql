-- Add change_type column to poi_name_validations table
-- This migration adds the new column without conflicting with existing RLS policies

-- Add the change_type column
ALTER TABLE core.poi_name_validations 
ADD COLUMN IF NOT EXISTS change_type text CHECK (change_type IN ('none', 'prefix_added', 'complementary_info_added', 'full_name_change', 'core_preserved'));

-- Add comment for documentation
COMMENT ON COLUMN core.poi_name_validations.change_type IS 'Type of change made to the POI name: none, prefix_added, complementary_info_added, full_name_change, or core_preserved';
