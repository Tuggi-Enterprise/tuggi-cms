-- Add city correction progress tracking table
-- This table stores progress information for batch processing jobs

CREATE TABLE IF NOT EXISTS core.city_correction_progress (
  progress_key text PRIMARY KEY,
  progress_data jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_city_correction_progress_updated_at 
ON core.city_correction_progress (updated_at);

-- Add comment explaining the progress structure
COMMENT ON TABLE core.city_correction_progress IS 
'Stores progress information for city correction batch processing jobs.
progress_data structure:
{
  "total_pois": 100,
  "processed": 45,
  "corrections_applied": 12,
  "manual_review_needed": 8,
  "errors": 2,
  "current_poi": "POI Name",
  "status": "processing",
  "started_at": "2024-01-01T10:00:00Z",
  "estimated_completion": "2024-01-01T12:00:00Z"
}';

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON core.city_correction_progress TO authenticated;
GRANT SELECT ON core.city_correction_progress TO anon;
