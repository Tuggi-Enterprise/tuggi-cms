-- Migration: Automate FOMO Push Notification System
-- Date: 2026-04-06
-- Purpose: Setup pg_cron jobs to generate daily stats and trigger the orchestrator hourly.

-- ==============================================================================
-- 0. Ensure Prerequisites (Schema and Settings Table)
-- ==============================================================================
CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.project_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================================================
-- 1. Create Helper to Trigger Daily Orchestrator (Edge Function)
-- ==============================================================================
CREATE OR REPLACE FUNCTION core.trigger_daily_fomo_orchestrator()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- Run as owner to access core.project_settings
AS $$
DECLARE
  v_url text;
  v_key text;
  response_status integer;
  response_content text;
BEGIN
  -- 1.1 Get project URL and service_role_key from the project_settings table
  -- Note: These should be populated in the dashboard/settings
  SELECT value INTO v_url FROM core.project_settings WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM core.project_settings WHERE key = 'service_role_key';
  
  -- If settings are missing, log the notice but do not crash
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'Skipping FOMO trigger: core.project_settings (supabase_url or service_role_key) is missing.';
    RETURN;
  END IF;

  -- 1.2 Construction of the full Edge Function URL
  v_url := rtrim(v_url, '/') || '/functions/v1/daily-gamification-orchestrator';

  -- 1.3 POST request to the Edge Function via http (pg_net or standard supabase setup)
  SELECT status, content INTO response_status, response_content
  FROM http((
    'POST',
    v_url,
    ARRAY[
      http_header('Authorization', 'Bearer ' || v_key),
      http_header('Content-Type', 'application/json')
    ],
    'application/json',
    '{}'
  ));
  
  -- 1.4 Handle failure logging if the EF returns 4xx or 5xx
  IF response_status >= 400 THEN
    RAISE WARNING 'FOMO Orchestrator Job Failed. Status: %, Content: %', response_status, response_content;
  ELSE
    RAISE NOTICE 'FOMO Orchestrator Job Success. Status: %, Content: %', response_status, response_content;
  END IF;
END;
$$;

-- Grant permissions for cron to execute this
GRANT USAGE ON SCHEMA core TO postgres;
GRANT EXECUTE ON FUNCTION core.trigger_daily_fomo_orchestrator() TO postgres;

-- ==============================================================================
-- 2. Cron Job Schedules
-- ==============================================================================

-- 2.1 Calculate FOMO statistics for "Yesterday"
-- Runs daily at 01:05 AM UTC (standard UTC reset cycle)
-- This ensures all yesterday trail/visit logs are finalized before processing.
SELECT cron.schedule(
  'refresh-daily-fomo-stats',  -- Job Name
  '5 1 * * *',                 -- 01:05 AM UTC daily
  'SELECT drive.refresh_daily_fomo_stats();'
);

-- 2.2 Trigger the Hourly Orchestrator Dispatch
-- Runs every hour at the top (minute 0).
-- The Edge Function checks if it matches 07:00 AM local time for any timezone.
SELECT cron.schedule(
  'invoke-daily-fomo-orchestrator', -- Job Name
  '0 * * * *',                      -- Every hour at the top
  'SELECT core.trigger_daily_fomo_orchestrator();'
);

-- ==============================================================================
-- 3. Security (RLS check for settings)
-- ==============================================================================
-- Ensure that project_settings is ready for the cron to use
-- (This effectively acts as a diagnostic log in the migration logs)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM core.project_settings WHERE key = 'service_role_key') THEN
        RAISE NOTICE 'WARNING: service_role_key is missing in core.project_settings. Automation will skip runs until fixed.';
    END IF;
END $$;
