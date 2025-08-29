-- Add only the confidence system columns to trigger points table
-- Simple script to avoid view conflicts

-- ===========================================
-- ADD NEW COLUMNS FOR CONFIDENCE SYSTEM
-- ===========================================

-- Add confidence score field (0.0 to 1.0)
ALTER TABLE core.attraction_trigger_points 
ADD COLUMN IF NOT EXISTS confidence_score real 
CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0);

-- Add automatic status based on confidence score
ALTER TABLE core.attraction_trigger_points 
ADD COLUMN IF NOT EXISTS auto_status text 
CHECK (auto_status IN ('approved', 'review', 'rejected'));

-- Add manual override for status
ALTER TABLE core.attraction_trigger_points 
ADD COLUMN IF NOT EXISTS manual_status text 
CHECK (manual_status IN ('approved', 'review', 'rejected', 'pending'));

-- Add final status (computed from auto + manual)
ALTER TABLE core.attraction_trigger_points 
ADD COLUMN IF NOT EXISTS final_status text 
CHECK (final_status IN ('approved', 'review', 'rejected', 'pending'));

-- Add score breakdown for debugging
ALTER TABLE core.attraction_trigger_points 
ADD COLUMN IF NOT EXISTS score_factors jsonb;

-- Add generation metadata
ALTER TABLE core.attraction_trigger_points 
ADD COLUMN IF NOT EXISTS generation_method text;

-- Add validation notes
ALTER TABLE core.attraction_trigger_points 
ADD COLUMN IF NOT EXISTS validation_notes text;

-- ===========================================
-- CREATE FUNCTION TO CALCULATE AUTO STATUS
-- ===========================================

CREATE OR REPLACE FUNCTION core.calculate_auto_status(confidence real)
RETURNS text AS $$
BEGIN
  IF confidence IS NULL THEN
    RETURN 'pending';
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
-- CREATE FUNCTION TO CALCULATE FINAL STATUS
-- ===========================================

CREATE OR REPLACE FUNCTION core.calculate_final_status(auto_status text, manual_status text)
RETURNS text AS $$
BEGIN
  -- Manual override takes precedence
  IF manual_status IS NOT NULL AND manual_status != 'pending' THEN
    RETURN manual_status;
  ELSE
    RETURN COALESCE(auto_status, 'pending');
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ===========================================
-- CREATE TRIGGER TO AUTO-UPDATE STATUS
-- ===========================================

CREATE OR REPLACE FUNCTION core.update_trigger_point_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate auto status from confidence score
  NEW.auto_status = core.calculate_auto_status(NEW.confidence_score);
  
  -- Calculate final status
  NEW.final_status = core.calculate_final_status(NEW.auto_status, NEW.manual_status);
  
  -- Set default radius to 20m if not specified
  IF NEW.radius_meters IS NULL THEN
    NEW.radius_meters = 20;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for automatic status calculation
DROP TRIGGER IF EXISTS trigger_update_status ON core.attraction_trigger_points;
CREATE TRIGGER trigger_update_status
    BEFORE INSERT OR UPDATE ON core.attraction_trigger_points
    FOR EACH ROW EXECUTE FUNCTION core.update_trigger_point_status();

-- ===========================================
-- CREATE INDEXES FOR NEW COLUMNS
-- ===========================================

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_trigger_points_auto_status 
ON core.attraction_trigger_points(auto_status);

CREATE INDEX IF NOT EXISTS idx_trigger_points_final_status 
ON core.attraction_trigger_points(final_status);

-- Index for confidence score queries
CREATE INDEX IF NOT EXISTS idx_trigger_points_confidence 
ON core.attraction_trigger_points(confidence_score);

-- Composite index for approved TPs
CREATE INDEX IF NOT EXISTS idx_trigger_points_approved_active 
ON core.attraction_trigger_points(attraction_id, final_status, is_active) 
WHERE final_status = 'approved' AND is_active = true;

-- ===========================================
-- ADD COLUMN COMMENTS
-- ===========================================

COMMENT ON COLUMN core.attraction_trigger_points.confidence_score IS 'AI-calculated confidence score (0.0-1.0) for trigger point quality';
COMMENT ON COLUMN core.attraction_trigger_points.auto_status IS 'Automatic status based on confidence: approved (>=75%), review (50-74%), rejected (<50%)';
COMMENT ON COLUMN core.attraction_trigger_points.manual_status IS 'Manual override status set by human reviewer';
COMMENT ON COLUMN core.attraction_trigger_points.final_status IS 'Final computed status (manual takes precedence over auto)';
COMMENT ON COLUMN core.attraction_trigger_points.score_factors IS 'JSON breakdown of factors contributing to confidence score';
COMMENT ON COLUMN core.attraction_trigger_points.generation_method IS 'Method used to generate this TP (osm_nominatim, fallback_street_analysis, etc.)';
COMMENT ON COLUMN core.attraction_trigger_points.validation_notes IS 'Human-readable notes about TP validation and quality';

-- ===========================================
-- GRANT PERMISSIONS
-- ===========================================

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION core.calculate_auto_status(real) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.calculate_final_status(text, text) TO authenticated, service_role;

SELECT 'Confidence system columns added successfully!' as status;
