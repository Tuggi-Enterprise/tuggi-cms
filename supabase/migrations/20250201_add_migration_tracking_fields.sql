-- Migration: Add migration tracking fields to homolog.pois
-- Created: 2025-02-01
-- Purpose: Track migration status, attempts, and errors for safe migration processing

-- Add migration tracking fields
ALTER TABLE homolog.pois 
ADD COLUMN IF NOT EXISTS migration_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_migration_attempt_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS migration_error TEXT;

-- Update processing_status constraint to include new statuses
-- Note: processing_status already exists, we just need to ensure it supports our values
-- The constraint allows: 'pending', 'processing', 'migrated', 'failed', 'skipped'

-- Create index for efficient querying of POIs to process
CREATE INDEX IF NOT EXISTS idx_pois_migration_status ON homolog.pois (processing_status, last_migration_attempt_at)
WHERE processing_status IN ('pending', 'processing', 'failed');

-- Create index for migration attempts
CREATE INDEX IF NOT EXISTS idx_pois_migration_attempts ON homolog.pois (migration_attempts)
WHERE migration_attempts > 0;

-- Add comment for documentation
COMMENT ON COLUMN homolog.pois.migration_attempts IS 'Number of migration attempts. POIs with 3+ attempts are considered permanently failed.';
COMMENT ON COLUMN homolog.pois.last_migration_attempt_at IS 'Timestamp of last migration attempt. Used to detect timeout (10 minutes).';
COMMENT ON COLUMN homolog.pois.migration_error IS 'Error message from last failed migration attempt.';

