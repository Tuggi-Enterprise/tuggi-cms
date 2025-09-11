-- Update the cron job to run every 2 minutes instead of 5
SELECT cron.unschedule('city-correction-monitor');

SELECT cron.schedule(
  'city-correction-monitor',
  '*/2 * * * *', -- Every 2 minutes (reduced from 5)
  'SELECT trigger_city_correction_monitor();'
);
