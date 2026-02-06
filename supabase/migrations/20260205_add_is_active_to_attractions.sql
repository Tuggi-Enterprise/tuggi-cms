-- Migration: Add is_active column to core.attractions
-- Created: 2026-02-05
-- Purpose: Allow deactivating POIs so they don't appear in the app

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Update existing records to be active by default (already handled by DEFAULT true, but good to be explicit)
UPDATE core.attractions SET is_active = true WHERE is_active IS NULL;

-- Index for better performance when filtering active POIs in the app
CREATE INDEX IF NOT EXISTS idx_attractions_is_active ON core.attractions(is_active) WHERE is_active = true;

-- Update the search RPC to include is_active (if needed, but usually we filter in the query)
-- For now, we'll just add the column and use it in the frontend.
