-- Create POI Name Validation System Tables
-- This migration creates the necessary database structure for the POI name validation system

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create poi_validation_batches table
CREATE TABLE IF NOT EXISTS core.poi_validation_batches (
  -- Primary key
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Batch metadata
  batch_name text,
  total_pois integer NOT NULL,
  processed_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  success_count integer DEFAULT 0,
  
  -- Processing status
  status text CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
  priority text CHECK (priority IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
  
  -- Timing
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  estimated_completion_time timestamp with time zone,
  
  -- Configuration
  batch_size integer DEFAULT 50,
  gemini_model_used text NOT NULL,
  rate_limit_config jsonb,
  
  -- Results
  processing_stats jsonb,
  error_log jsonb,
  
  -- Metadata
  created_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create poi_name_validations table
CREATE TABLE IF NOT EXISTS core.poi_name_validations (
  -- Primary key
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign key to attractions table
  attraction_id uuid NOT NULL REFERENCES core.attractions(id) ON DELETE CASCADE,
  
  -- Current POI data (snapshot at validation time)
  current_name text NOT NULL,
  current_category text,
  current_address text,
  current_coordinates point,
  current_city text,
  current_state text,
  current_country text,
  current_osm_tags jsonb,
  
  -- Validation results
  is_accurate boolean NOT NULL,
  confidence_score integer NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  suggested_name text,
  reasoning text NOT NULL,
  name_issues text[] DEFAULT '{}',
  improvement_suggestions text[] DEFAULT '{}',
  
  -- POI Classification and Contextual Descriptors
  poi_type text,
  change_type text CHECK (change_type IN ('none', 'prefix_added', 'complementary_info_added', 'full_name_change', 'core_preserved')),
  classification_confidence integer CHECK (classification_confidence >= 0 AND classification_confidence <= 100),
  descriptors_added text[] DEFAULT '{}',
  evidence_found boolean DEFAULT false,
  evidence_source text,
  
  -- Review workflow
  requires_manual_review boolean DEFAULT false,
  review_priority text CHECK (review_priority IN ('low', 'medium', 'high', 'critical')),
  approved boolean DEFAULT false,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamp with time zone,
  rejection_reason text,
  reviewer_notes text,
  
  -- Automatic change tracking
  auto_approved boolean DEFAULT false,
  auto_approved_at timestamp with time zone,
  name_changed boolean DEFAULT false,
  old_name text,
  new_name_applied text,
  
  -- Processing metadata
  processed_at timestamp with time zone DEFAULT now(),
  gemini_model_used text NOT NULL,
  processing_time_ms integer NOT NULL,
  api_tokens_used integer,
  retry_count integer DEFAULT 0,
  batch_id uuid REFERENCES core.poi_validation_batches(id),
  
  -- Constraints
  CONSTRAINT poi_name_validations_attraction_id_key UNIQUE (attraction_id),
  CONSTRAINT poi_name_validations_confidence_check CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_poi_name_validations_attraction_id ON core.poi_name_validations(attraction_id);
CREATE INDEX IF NOT EXISTS idx_poi_name_validations_confidence ON core.poi_name_validations(confidence_score);
CREATE INDEX IF NOT EXISTS idx_poi_name_validations_review ON core.poi_name_validations(requires_manual_review, review_priority);
CREATE INDEX IF NOT EXISTS idx_poi_name_validations_processed ON core.poi_name_validations(processed_at);
CREATE INDEX IF NOT EXISTS idx_poi_name_validations_approved ON core.poi_name_validations(approved);
CREATE INDEX IF NOT EXISTS idx_poi_name_validations_batch ON core.poi_name_validations(batch_id);
CREATE INDEX IF NOT EXISTS idx_poi_name_validations_name_gin ON core.poi_name_validations USING gin(current_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_poi_name_validations_osm_tags_gin ON core.poi_name_validations USING gin (current_osm_tags);
CREATE INDEX IF NOT EXISTS idx_poi_name_validations_poi_type ON core.poi_name_validations(poi_type);
CREATE INDEX IF NOT EXISTS idx_poi_name_validations_evidence ON core.poi_name_validations(evidence_found);

-- Create batch processing indexes
CREATE INDEX IF NOT EXISTS idx_poi_validation_batches_status ON core.poi_validation_batches(status);
CREATE INDEX IF NOT EXISTS idx_poi_validation_batches_created ON core.poi_validation_batches(created_at);
CREATE INDEX IF NOT EXISTS idx_poi_validation_batches_priority ON core.poi_validation_batches(priority);

-- Create validation statistics view
CREATE OR REPLACE VIEW core.poi_validation_stats AS
SELECT 
  -- Basic counts
  COUNT(*) as total_validations,
  COUNT(*) FILTER (WHERE is_accurate = true) as accurate_names,
  COUNT(*) FILTER (WHERE is_accurate = false) as inaccurate_names,
  COUNT(*) FILTER (WHERE requires_manual_review = true) as pending_review,
  COUNT(*) FILTER (WHERE approved = true) as approved_changes,
  COUNT(*) FILTER (WHERE auto_approved = true) as auto_approved_changes,
  COUNT(*) FILTER (WHERE name_changed = true) as names_changed,
  
  -- POI Classification statistics
  COUNT(*) FILTER (WHERE poi_type IS NOT NULL) as classified_pois,
  COUNT(*) FILTER (WHERE array_length(descriptors_added, 1) > 0) as pois_with_descriptors,
  COUNT(*) FILTER (WHERE evidence_found = true) as pois_with_evidence,
  COUNT(*) FILTER (WHERE evidence_found = false) as pois_without_evidence,
  AVG(classification_confidence) as avg_classification_confidence,
  
  -- Confidence statistics
  AVG(confidence_score) as avg_confidence_score,
  MIN(confidence_score) as min_confidence_score,
  MAX(confidence_score) as max_confidence_score,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY confidence_score) as median_confidence_score,
  
  -- Confidence distribution
  COUNT(*) FILTER (WHERE confidence_score >= 90) as high_confidence,
  COUNT(*) FILTER (WHERE confidence_score BETWEEN 70 AND 89) as medium_confidence,
  COUNT(*) FILTER (WHERE confidence_score < 70) as low_confidence,
  
  -- Processing statistics
  AVG(processing_time_ms) as avg_processing_time_ms,
  SUM(processing_time_ms) as total_processing_time_ms,
  AVG(api_tokens_used) as avg_api_tokens_used,
  SUM(api_tokens_used) as total_api_tokens_used,
  
  -- Review statistics
  COUNT(*) FILTER (WHERE review_priority = 'critical') as critical_reviews,
  COUNT(*) FILTER (WHERE review_priority = 'high') as high_priority_reviews,
  COUNT(*) FILTER (WHERE review_priority = 'medium') as medium_priority_reviews,
  COUNT(*) FILTER (WHERE review_priority = 'low') as low_priority_reviews,
  
  -- Timing
  MIN(processed_at) as first_validation,
  MAX(processed_at) as last_validation,
  
  -- POI type distribution
  COUNT(*) FILTER (WHERE poi_type = 'placa') as placa_count,
  COUNT(*) FILTER (WHERE poi_type = 'estatua') as estatua_count,
  COUNT(*) FILTER (WHERE poi_type = 'pico') as pico_count,
  COUNT(*) FILTER (WHERE poi_type = 'mirante') as mirante_count,
  COUNT(*) FILTER (WHERE poi_type = 'igreja') as igreja_count,
  COUNT(*) FILTER (WHERE poi_type = 'parque') as parque_count,
  COUNT(*) FILTER (WHERE poi_type NOT IN ('placa', 'estatua', 'pico', 'mirante', 'igreja', 'parque')) as other_types_count
FROM core.poi_name_validations;

-- Create POI type distribution view
CREATE OR REPLACE VIEW core.poi_type_distribution AS
SELECT 
  poi_type,
  COUNT(*) as count,
  AVG(confidence_score) as avg_confidence,
  AVG(classification_confidence) as avg_classification_confidence,
  COUNT(*) FILTER (WHERE auto_approved = true) as auto_approved_count,
  COUNT(*) FILTER (WHERE evidence_found = true) as evidence_found_count,
  COUNT(*) FILTER (WHERE array_length(descriptors_added, 1) > 0) as with_descriptors_count,
  ROUND((COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()), 2) as percentage
FROM core.poi_name_validations
WHERE poi_type IS NOT NULL
GROUP BY poi_type
ORDER BY count DESC;

-- Create review queue view for manual review interface
CREATE OR REPLACE VIEW core.poi_review_queue AS
SELECT 
  v.id,
  v.attraction_id,
  v.current_name,
  v.suggested_name,
  v.confidence_score,
  v.poi_type,
  v.reasoning,
  v.name_issues,
  v.descriptors_added,
  v.evidence_found,
  v.evidence_source,
  v.review_priority,
  v.processed_at,
  a.city,
  a.state,
  a.country,
  a.category,
  a.formatted_address,
  a.osm_tags,
  -- Priority scoring for sorting
  CASE 
    WHEN v.review_priority = 'critical' THEN 4
    WHEN v.review_priority = 'high' THEN 3
    WHEN v.review_priority = 'medium' THEN 2
    ELSE 1
  END as priority_score
FROM core.poi_name_validations v
JOIN core.attractions a ON v.attraction_id = a.id
WHERE v.requires_manual_review = true 
  AND v.approved = false
ORDER BY priority_score DESC, v.confidence_score ASC, v.processed_at ASC;

-- Add RLS policies
ALTER TABLE core.poi_name_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.poi_validation_batches ENABLE ROW LEVEL SECURITY;

-- Policy for reading validation results (authenticated users)
CREATE POLICY "Users can read poi validations" ON core.poi_name_validations
  FOR SELECT USING (auth.role() = 'authenticated');

-- Policy for inserting validation results (service role only)
CREATE POLICY "Service role can insert poi validations" ON core.poi_name_validations
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Policy for updating validation results (authenticated users for reviews)
CREATE POLICY "Users can update poi validations for review" ON core.poi_name_validations
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Policy for batch operations (service role only)
CREATE POLICY "Service role can manage batches" ON core.poi_validation_batches
  FOR ALL USING (auth.role() = 'service_role');

-- Add triggers for updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_poi_validation_batches_updated_at 
    BEFORE UPDATE ON core.poi_validation_batches 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add function to get validation progress
CREATE OR REPLACE FUNCTION core.get_validation_progress()
RETURNS jsonb AS $$
DECLARE
  total_pois integer;
  processed_pois integer;
  auto_approved integer;
  manual_review integer;
  failed integer;
  avg_confidence numeric;
  result jsonb;
BEGIN
  -- Get total POI count
  SELECT COUNT(*) INTO total_pois FROM core.attractions;
  
  -- Get processed count and stats
  SELECT 
    COUNT(*),
    COUNT(*) FILTER (WHERE auto_approved = true),
    COUNT(*) FILTER (WHERE requires_manual_review = true),
    COUNT(*) FILTER (WHERE reasoning LIKE '%validation_error%'),
    AVG(confidence_score)
  INTO processed_pois, auto_approved, manual_review, failed, avg_confidence
  FROM core.poi_name_validations;
  
  -- Build result
  result := jsonb_build_object(
    'total_pois', total_pois,
    'processed', processed_pois,
    'remaining', total_pois - processed_pois,
    'percentage', ROUND((processed_pois * 100.0 / NULLIF(total_pois, 0)), 2),
    'auto_approved', auto_approved,
    'manual_review', manual_review,
    'failed', failed,
    'avg_confidence', ROUND(avg_confidence, 2)
  );
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add function to get POI type statistics
CREATE OR REPLACE FUNCTION core.get_poi_type_stats()
RETURNS TABLE (
  poi_type text,
  count bigint,
  avg_confidence numeric,
  avg_classification_confidence numeric,
  auto_approved_count bigint,
  evidence_found_count bigint,
  percentage numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.poi_type,
    COUNT(*) as count,
    ROUND(AVG(v.confidence_score), 2) as avg_confidence,
    ROUND(AVG(v.classification_confidence), 2) as avg_classification_confidence,
    COUNT(*) FILTER (WHERE v.auto_approved = true) as auto_approved_count,
    COUNT(*) FILTER (WHERE v.evidence_found = true) as evidence_found_count,
    ROUND((COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()), 2) as percentage
  FROM core.poi_name_validations v
  WHERE v.poi_type IS NOT NULL
  GROUP BY v.poi_type
  ORDER BY count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT SELECT ON core.poi_validation_stats TO authenticated;
GRANT SELECT ON core.poi_type_distribution TO authenticated;
GRANT SELECT ON core.poi_review_queue TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_validation_progress() TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_poi_type_stats() TO authenticated;

-- Add comments for documentation
COMMENT ON TABLE core.poi_name_validations IS 'Stores POI name validation results from Gemini AI analysis';
COMMENT ON TABLE core.poi_validation_batches IS 'Tracks batch processing jobs for POI validation';
COMMENT ON VIEW core.poi_validation_stats IS 'Aggregated statistics for POI name validation results';
COMMENT ON VIEW core.poi_type_distribution IS 'Distribution of POI types and their validation metrics';
COMMENT ON VIEW core.poi_review_queue IS 'Queue of POIs requiring manual review, sorted by priority';
COMMENT ON FUNCTION core.get_validation_progress() IS 'Returns current validation progress statistics';
COMMENT ON FUNCTION core.get_poi_type_stats() IS 'Returns POI type distribution with validation metrics';
