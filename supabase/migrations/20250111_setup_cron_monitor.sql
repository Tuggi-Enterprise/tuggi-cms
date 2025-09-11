-- Enable the pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a function to call the monitor Edge Function
CREATE OR REPLACE FUNCTION trigger_city_correction_monitor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response text;
BEGIN
  -- Call the Edge Function
  SELECT content INTO response
  FROM http((
    'POST',
    current_setting('app.settings.supabase_url') || '/functions/v1/city-correction-monitor',
    ARRAY[
      http_header('Authorization', 'Bearer ' || current_setting('app.settings.supabase_anon_key')),
      http_header('Content-Type', 'application/json')
    ],
    'application/json',
    '{}'
  ));
  
  -- Log the response
  RAISE NOTICE 'Monitor response: %', response;
END;
$$;

-- Schedule the cron job to run every 5 minutes
SELECT cron.schedule(
  'city-correction-monitor',
  '*/5 * * * *', -- Every 5 minutes
  'SELECT trigger_city_correction_monitor();'
);

-- Grant necessary permissions
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT EXECUTE ON FUNCTION trigger_city_correction_monitor() TO postgres;
