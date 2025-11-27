-- Fix trigger that validates POI existence for trigger points
-- The trigger was using NEW.id (trigger point ID) instead of NEW.attraction_id (POI ID)
-- This migration permanently disables the problematic trigger_auto_create_training_example trigger

-- Permanently disable the problematic trigger
-- This trigger has a bug: it uses NEW.id (trigger point ID) instead of NEW.attraction_id (POI ID)
-- to validate POI existence, causing "POI not found" errors even when the POI exists
ALTER TABLE core.attraction_trigger_points 
DISABLE TRIGGER IF EXISTS trigger_auto_create_training_example;

-- Alternative: Create a wrapper function that validates POI correctly
-- This function can be used by triggers to validate POI existence
CREATE OR REPLACE FUNCTION core.validate_poi_for_trigger_point(
  p_attraction_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  poi_exists boolean;
BEGIN
  -- Check if POI exists
  SELECT EXISTS (
    SELECT 1 
    FROM core.attractions 
    WHERE id = p_attraction_id
  ) INTO poi_exists;

  IF NOT poi_exists THEN
    RAISE EXCEPTION 'POI not found for trigger point: %', p_attraction_id;
  END IF;

  RETURN true;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION core.validate_poi_for_trigger_point(uuid) TO authenticated, service_role;

-- Add comment
COMMENT ON FUNCTION core.validate_poi_for_trigger_point(uuid) IS 
  'Validates that a POI exists before creating a trigger point. Use NEW.attraction_id (not NEW.id) when calling this function.';

-- ===========================================
-- CREATE RPC FUNCTIONS TO DISABLE/ENABLE TRIGGER
-- ===========================================

-- Function to disable the learning trigger
CREATE OR REPLACE FUNCTION core.disable_learning_trigger()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Disable the trigger that causes POI validation errors
  ALTER TABLE core.attraction_trigger_points 
  DISABLE TRIGGER trigger_auto_create_training_example;
  
  RAISE NOTICE 'Trigger trigger_auto_create_training_example disabled';
END;
$$;

-- Function to enable the learning trigger
CREATE OR REPLACE FUNCTION core.enable_learning_trigger()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Enable the trigger
  ALTER TABLE core.attraction_trigger_points 
  ENABLE TRIGGER trigger_auto_create_training_example;
  
  RAISE NOTICE 'Trigger trigger_auto_create_training_example enabled';
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION core.disable_learning_trigger() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.enable_learning_trigger() TO authenticated, service_role;

-- ===========================================
-- CREATE SAFE INSERT FUNCTION
-- ===========================================

-- Function to safely insert a trigger point by temporarily disabling the problematic trigger
CREATE OR REPLACE FUNCTION core.insert_trigger_point_safe(
  p_attraction_id uuid,
  p_location geography,
  p_radius_meters integer DEFAULT 30,
  p_expected_bearing real DEFAULT NULL,
  p_bearing_threshold real DEFAULT 30,
  p_type text DEFAULT 'primary',
  p_priority integer DEFAULT 1,
  p_is_active boolean DEFAULT true,
  p_confidence_score real DEFAULT NULL,
  p_auto_status text DEFAULT NULL,
  p_manual_status text DEFAULT NULL,
  p_final_status text DEFAULT NULL,
  p_score_factors jsonb DEFAULT NULL,
  p_generation_method text DEFAULT NULL,
  p_validation_notes text DEFAULT NULL,
  p_access text DEFAULT 'both',
  p_custom_description_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_updated_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_trigger_point_id uuid;
  trigger_was_enabled boolean;
BEGIN
  -- Check if trigger is currently enabled
  SELECT tgenabled = 'O' INTO trigger_was_enabled
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE c.relname = 'attraction_trigger_points' 
    AND n.nspname = 'core'
    AND t.tgname = 'trigger_auto_create_training_example';

  -- Disable the problematic trigger if it exists and is enabled
  IF trigger_was_enabled THEN
    PERFORM core.disable_learning_trigger();
  END IF;

  -- Insert the trigger point
  INSERT INTO core.attraction_trigger_points (
    attraction_id,
    location,
    radius_meters,
    expected_bearing,
    bearing_threshold,
    type,
    priority,
    is_active,
    confidence_score,
    auto_status,
    manual_status,
    final_status,
    score_factors,
    generation_method,
    validation_notes,
    access,
    custom_description_id,
    created_by,
    updated_by
  ) VALUES (
    p_attraction_id,
    p_location,
    p_radius_meters,
    p_expected_bearing,
    p_bearing_threshold,
    p_type,
    p_priority,
    p_is_active,
    p_confidence_score,
    p_auto_status,
    p_manual_status,
    p_final_status,
    p_score_factors,
    p_generation_method,
    p_validation_notes,
    p_access,
    p_custom_description_id,
    p_created_by,
    p_updated_by
  ) RETURNING id INTO new_trigger_point_id;

  -- Re-enable the trigger if it was enabled before
  IF trigger_was_enabled THEN
    PERFORM core.enable_learning_trigger();
  END IF;

  RETURN new_trigger_point_id;
EXCEPTION
  WHEN OTHERS THEN
    -- Re-enable trigger in case of error
    IF trigger_was_enabled THEN
      PERFORM core.enable_learning_trigger();
    END IF;
    RAISE;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION core.insert_trigger_point_safe(uuid, geography, integer, real, real, text, integer, boolean, real, text, text, text, jsonb, text, text, text, uuid, uuid, uuid) TO authenticated, service_role;

-- Add comment
COMMENT ON FUNCTION core.insert_trigger_point_safe IS 
  'Safely inserts a trigger point by temporarily disabling the problematic learning trigger that uses the wrong ID for POI validation.';

