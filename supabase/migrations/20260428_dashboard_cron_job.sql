-- Migration: Setup Cron Job for Dashboard Refresh
-- Description: Schedules the materialized views to refresh automatically every 6 horas.
-- NOTE: The "pg_cron" extension MUST be enabled in Supabase (Database -> Extensions -> pg_cron).

-- 1. Unschedule the job if it already exists (to avoid duplicates if you run this twice)
DO $$
BEGIN
  -- Check if cron schema exists before attempting to unschedule
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'cron') THEN
    PERFORM cron.unschedule('refresh-dashboard-rankings');
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Ignore errors if table doesn't exist yet
END $$;

-- 2. Schedule the new job
-- '0 */6 * * *' means "At minute 0 past every 6th hour."
-- Example: 00:00, 06:00, 12:00, 18:00
SELECT cron.schedule(
  'refresh-dashboard-rankings',               -- Job Name
  '0 */6 * * *',                              -- Cron Schedule (A cada 6 horas)
  'SELECT core.refresh_inventory_rankings();' -- Command to execute
);
