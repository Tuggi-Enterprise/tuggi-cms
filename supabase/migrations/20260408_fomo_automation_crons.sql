-- Migration: FOMO System Automation (Cron Jobs)
-- Date: 2026-04-07
-- Purpose: Automate stats refresh and push notification orchestration via pg_cron.

-- 1. EXTENSIONS
-- The following extensions are usually already enabled in Supabase, but we ensure it.
CREATE EXTENSION IF NOT EXISTS pg_cron;
-- We need pg_net or http to call the Edge Function from SQL. Tuggi uses 'http' extension 
-- in city-correction-monitor, so we stay consistent.
CREATE EXTENSION IF NOT EXISTS http;

-- 2. ORCHESTRATOR TRIGGER FUNCTION
-- This allows pg_cron to call our Edge Function securely
CREATE OR REPLACE FUNCTION drive.trigger_fomo_orchestrator()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response text;
  v_url text;
  v_key text;
BEGIN
  -- Get settings from Supabase environment (assuming standard naming in this project)
  BEGIN
    v_url := current_setting('app.settings.supabase_url');
    v_key := current_setting('app.settings.supabase_service_role_key');
  EXCEPTION WHEN OTHERS THEN
    -- Fallback: Use anon if service_role is not available / set
    v_key := current_setting('app.settings.supabase_anon_key');
  END;

  IF v_url IS NULL OR v_key IS NULL THEN
     RAISE WARNING 'Supabase URL or Key not found in DB settings. Skipping FOMO trigger.';
     RETURN;
  END IF;

  -- Call the Edge Function
  -- We use a POST request with the Authorization header
  BEGIN
    SELECT content INTO response
    FROM http((
      'POST',
      v_url || '/functions/v1/daily-gamification-orchestrator',
      ARRAY[
        http_header('Authorization', 'Bearer ' || v_key),
        http_header('Content-Type', 'application/json')
      ],
      'application/json',
      '{}'
    ));
    RAISE NOTICE 'FOMO Orchestrator response: %', response;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to call FOMO Orchestrator: %', SQLERRM;
  END;
END;
$$;

-- 3. SCHEDULING

-- A. Stats Refresh (Every day at 01:30 UTC)
-- Runs the heavy spatial calculation once a day for the previous day.
-- We run it slightly before the first potential local 7 AM delivery window (depending on UTC offset).
SELECT cron.schedule(
  'fomo-daily-stats-refresh',
  '30 1 * * *', 
  'SELECT drive.refresh_daily_fomo_stats();'
);

-- B. Hourly Orchestrator (At minute 0 of every hour)
-- Checks if it is 07:00 AM (local time) for any candidates and sends the push.
SELECT cron.schedule(
  'fomo-hourly-push-orchestrator',
  '0 * * * *',
  'SELECT drive.trigger_fomo_orchestrator();'
);

-- 4. PERMISSIONS
GRANT EXECUTE ON FUNCTION drive.trigger_fomo_orchestrator() TO service_role;
GRANT EXECUTE ON FUNCTION drive.trigger_fomo_orchestrator() TO postgres;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT USAGE ON SCHEMA cron TO service_role;
