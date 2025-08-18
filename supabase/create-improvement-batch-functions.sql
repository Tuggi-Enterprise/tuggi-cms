-- Functions for description improvement batch processing
-- These functions extend the existing batch processing system

-- Function to create a batch job for description improvements
CREATE OR REPLACE FUNCTION core.create_improvement_batch_job(
  p_job_type TEXT,
  p_params JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  job_id UUID;
  user_email TEXT;
BEGIN
  -- Get user email from JWT
  user_email := auth.jwt() ->> 'email';
  
  -- Create the batch job
  INSERT INTO core.batch_processing_jobs (
    user_email,
    batch_size,
    total_items,
    status,
    created_at
  ) VALUES (
    user_email,
    (p_params->>'limit')::INTEGER,
    0, -- Will be updated when we know the total
    'running',
    NOW()
  ) RETURNING id INTO job_id;
  
  -- Store job type and params in a separate table or as metadata
  -- For now, we'll use the existing structure and add metadata later if needed
  
  RETURN job_id;
END;
$$;

-- Function to update batch progress with more detailed information
CREATE OR REPLACE FUNCTION core.update_improvement_batch_progress(
  p_job_id UUID,
  p_status TEXT DEFAULT NULL,
  p_progress_message TEXT DEFAULT NULL,
  p_total_items INTEGER DEFAULT NULL,
  p_processed_items INTEGER DEFAULT NULL,
  p_successful_items INTEGER DEFAULT NULL,
  p_failed_items INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE core.batch_processing_jobs 
  SET 
    total_items = COALESCE(p_total_items, total_items),
    processed_items = COALESCE(p_processed_items, processed_items),
    failed_items = COALESCE(p_failed_items, failed_items),
    status = COALESCE(p_status, status),
    completed_at = CASE 
      WHEN p_status IN ('completed', 'failed', 'cancelled') THEN NOW()
      ELSE completed_at
    END
  WHERE id = p_job_id;
END;
$$;

-- Function to add an item to a batch job with metadata
CREATE OR REPLACE FUNCTION core.add_improvement_batch_item(
  p_job_id UUID,
  p_item_type TEXT,
  p_item_id UUID,
  p_status TEXT DEFAULT 'pending',
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  item_id UUID;
BEGIN
  INSERT INTO core.batch_processing_items (
    job_id, 
    description_id, 
    status
  ) VALUES (
    p_job_id, 
    p_item_id, 
    p_status
  ) RETURNING id INTO item_id;
  
  RETURN item_id;
END;
$$;

-- Function to update batch item status with result data
CREATE OR REPLACE FUNCTION core.update_improvement_batch_item_status(
  p_item_id UUID,
  p_status TEXT,
  p_result JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE core.batch_processing_items 
  SET 
    status = p_status,
    started_at = CASE WHEN p_status = 'processing' THEN NOW() ELSE started_at END,
    completed_at = CASE WHEN p_status IN ('completed', 'failed') THEN NOW() ELSE completed_at END,
    error_message = CASE WHEN p_status = 'failed' THEN p_result->>'error' ELSE error_message END
  WHERE id = p_item_id;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.create_improvement_batch_job TO authenticated;
GRANT EXECUTE ON FUNCTION core.update_improvement_batch_progress TO authenticated;
GRANT EXECUTE ON FUNCTION core.add_improvement_batch_item TO authenticated;
GRANT EXECUTE ON FUNCTION core.update_improvement_batch_item_status TO authenticated;
