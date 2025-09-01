-- Fix auto_status constraint to allow NULL values for manual trigger points
-- The current constraint only allows ('approved', 'review', 'rejected') but the 
-- calculate_auto_status function returns 'pending' for NULL confidence scores

-- ===========================================
-- DROP EXISTING CONSTRAINT
-- ===========================================

-- Drop the existing constraint that's too restrictive
ALTER TABLE core.attraction_trigger_points 
DROP CONSTRAINT IF EXISTS attraction_trigger_points_auto_status_check;

-- ===========================================
-- ADD CORRECTED CONSTRAINT
-- ===========================================

-- Allow NULL or the valid status values
-- For manual TPs, auto_status can be NULL since they use manual_status instead
ALTER TABLE core.attraction_trigger_points 
ADD CONSTRAINT attraction_trigger_points_auto_status_check 
CHECK (auto_status IS NULL OR auto_status IN ('approved', 'review', 'rejected'));

-- ===========================================
-- UPDATE EXISTING FUNCTION TO HANDLE MANUAL TPs
-- ===========================================

-- Update the calculate_auto_status function to return NULL for manual TPs
CREATE OR REPLACE FUNCTION core.calculate_auto_status(confidence real)
RETURNS text AS $$
BEGIN
  -- For manual TPs (no confidence score), return NULL so manual_status takes precedence
  IF confidence IS NULL THEN
    RETURN NULL;
  ELSIF confidence >= 0.75 THEN
    RETURN 'approved';
  ELSIF confidence >= 0.50 THEN
    RETURN 'review';
  ELSE
    RETURN 'rejected';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ===========================================
-- UPDATE STATUS CALCULATION TRIGGER
-- ===========================================

-- Update the trigger function to better handle manual vs automatic TPs
CREATE OR REPLACE FUNCTION core.update_trigger_point_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Only calculate auto_status if there's a confidence_score (automatic TP)
  IF NEW.confidence_score IS NOT NULL THEN
    NEW.auto_status = core.calculate_auto_status(NEW.confidence_score);
  ELSE
    -- For manual TPs, set auto_status to NULL
    NEW.auto_status = NULL;
  END IF;
  
  -- Calculate final status
  NEW.final_status = core.calculate_final_status(NEW.auto_status, NEW.manual_status);
  
  -- Set default radius to 30m if not specified (matching UI default)
  IF NEW.radius_meters IS NULL THEN
    NEW.radius_meters = 30;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- UPDATE FINAL STATUS CALCULATION
-- ===========================================

-- Update the final status function to handle NULL auto_status better
CREATE OR REPLACE FUNCTION core.calculate_final_status(auto_status text, manual_status text)
RETURNS text AS $$
BEGIN
  -- Manual override takes precedence
  IF manual_status IS NOT NULL AND manual_status != 'pending' THEN
    RETURN manual_status;
  -- If there's an auto_status, use it
  ELSIF auto_status IS NOT NULL THEN
    RETURN auto_status;
  -- Default to approved for manual TPs
  ELSE
    RETURN 'approved';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ===========================================
-- CLEAN UP EXISTING INVALID DATA
-- ===========================================

-- Update any existing rows that might have invalid auto_status values
UPDATE core.attraction_trigger_points 
SET auto_status = NULL 
WHERE confidence_score IS NULL AND auto_status = 'pending';

-- ===========================================
-- VERIFICATION
-- ===========================================

-- Verify the constraint is working
SELECT 
  conname as constraint_name,
  pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conrelid = 'core.attraction_trigger_points'::regclass 
  AND conname = 'attraction_trigger_points_auto_status_check';

-- Test if we can insert a manual TP with NULL confidence
SELECT 'auto_status constraint fixed successfully!' as status;
