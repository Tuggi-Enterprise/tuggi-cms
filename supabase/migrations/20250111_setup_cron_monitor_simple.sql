-- Enable the pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a simple function to call the monitor Edge Function
CREATE OR REPLACE FUNCTION trigger_city_correction_monitor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response text;
  supabase_url text := 'https://tysnkzmljlmmqpbotkxv.supabase.co';
  supabase_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5c25rem1samxtbXFwYm90a3h2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA0MjUxNDksImV4cCI6MjA1NjAwMTE0OX0.uFKA-EZe7iFSHbiCVPMZHy0lsk6yOzEHoVMYHMYmda4';
BEGIN
  -- Call the Edge Function
  SELECT content INTO response
  FROM http((
    'POST',
    supabase_url || '/functions/v1/city-correction-monitor',
    ARRAY[
      http_header('Authorization', 'Bearer ' || supabase_anon_key),
      http_header('Content-Type', 'application/json')
    ],
    'application/json',
    '{}'
  ));
  
  -- Log the response
  RAISE NOTICE 'Monitor response: %', response;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Monitor error: %', SQLERRM;
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
