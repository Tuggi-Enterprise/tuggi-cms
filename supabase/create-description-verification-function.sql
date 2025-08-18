-- ===========================================
-- CREATE DESCRIPTION VERIFICATION FUNCTION
-- ===========================================
-- This function saves verification results to the database

-- Create function to save verification results
CREATE OR REPLACE FUNCTION core.save_description_verification_result(
  p_attraction_id uuid,
  p_description_id uuid,
  p_description_text text,
  p_score numeric,
  p_approved boolean,
  p_detected_dates text[],
  p_verifiable_facts text[],
  p_issues text[],
  p_improvement_suggestion text,
  p_improvement_applied boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_description_hash text;
  v_score_id uuid;
  v_verification_status text;
BEGIN
  -- Generate hash for the description
  v_description_hash := encode(digest(p_description_text, 'sha256'), 'hex');
  
  -- Determine verification status based on approval
  IF p_approved THEN
    v_verification_status := 'verified';
  ELSE
    IF p_score >= 50 THEN
      v_verification_status := 'needs_review';
    ELSE
      v_verification_status := 'rejected';
    END IF;
  END IF;
  
  -- Update the description hash and verification status in attraction_descriptions
  UPDATE core.attraction_descriptions
  SET 
    description_hash = v_description_hash,
    verification_status = v_verification_status,
    verification_score = p_score / 100.0, -- Convert to 0-1 scale
    verification_updated_at = now()
  WHERE id = p_description_id;
  
  -- Insert into description_scores
  INSERT INTO core.description_scores (
    description_id,
    description_hash,
    overall_score,
    factuality_score,
    coherence_score,
    tts_clarity_score,
    rules_score,
    verification_status,
    processed_at
  ) VALUES (
    p_description_id,
    v_description_hash,
    p_score / 100.0, -- Convert to 0-1 scale
    CASE WHEN array_length(p_verifiable_facts, 1) > 0 THEN 0.7 ELSE 0.3 END, -- Estimate factuality based on verifiable facts
    0.8, -- Default coherence score (high for generated content)
    0.9, -- Default TTS clarity score (high for generated content)
    CASE WHEN p_approved THEN 0.9 ELSE 0.5 END, -- Rules score based on approval
    v_verification_status,
    now()
  )
  RETURNING id INTO v_score_id;
  
  -- Insert detected dates as claims
  IF p_detected_dates IS NOT NULL AND array_length(p_detected_dates, 1) > 0 THEN
    INSERT INTO core.description_claims (
      description_id,
      score_id,
      claim_text,
      claim_type,
      status,
      confidence
    )
    SELECT 
      p_description_id,
      v_score_id,
      date_text,
      'year',
      'supported',
      0.8
    FROM unnest(p_detected_dates) AS date_text;
  END IF;
  
  -- Insert verifiable facts as claims
  IF p_verifiable_facts IS NOT NULL AND array_length(p_verifiable_facts, 1) > 0 THEN
    INSERT INTO core.description_claims (
      description_id,
      score_id,
      claim_text,
      claim_type,
      status,
      confidence
    )
    SELECT 
      p_description_id,
      v_score_id,
      fact_text,
      'event',
      'supported',
      0.7
    FROM unnest(p_verifiable_facts) AS fact_text;
  END IF;
  
  -- Update the attraction with the latest verification result
  UPDATE core.attractions
  SET 
    last_verification_score = p_score / 100.0,
    last_verification_status = v_verification_status,
    last_verified_at = now(),
    updated_at = now()
  WHERE id = p_attraction_id;
  
  RETURN v_score_id;
END;
$$;

-- Grant permissions to service_role
GRANT EXECUTE ON FUNCTION core.save_description_verification_result TO service_role;

-- Add column to attractions table if it doesn't exist
DO $$
BEGIN
  BEGIN
    ALTER TABLE core.attractions 
    ADD COLUMN IF NOT EXISTS last_verification_score numeric(3,2),
    ADD COLUMN IF NOT EXISTS last_verification_status text,
    ADD COLUMN IF NOT EXISTS last_verified_at timestamp with time zone;
  EXCEPTION
    WHEN duplicate_column THEN
      RAISE NOTICE 'Columns already exist in attractions table';
  END;
END $$;

-- Create index for verification queries on attractions
CREATE INDEX IF NOT EXISTS idx_attractions_verification 
ON core.attractions(last_verification_status, last_verification_score);

-- Add comment
COMMENT ON FUNCTION core.save_description_verification_result IS 'Saves verification results for a description and updates related tables';

SELECT 'Description verification function created successfully!' as status;
