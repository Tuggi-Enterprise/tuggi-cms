-- Create Notification Logs Table
CREATE TABLE IF NOT EXISTS core.notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL, -- 'user', 'topic', 'broadcast'
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    image_url TEXT,
    user_ids UUID[] DEFAULT '{}',
    topic TEXT,
    status TEXT NOT NULL, -- 'sent', 'failed'
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    error_details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Scheduled Notifications Table
CREATE TABLE IF NOT EXISTS core.scheduled_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    image_url TEXT,
    user_ids UUID[] DEFAULT '{}',
    topic TEXT,
    priority TEXT DEFAULT 'normal',
    ttl INTEGER DEFAULT 3600,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'sent', 'failed'
    processed_at TIMESTAMP WITH TIME ZONE,
    error_details TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Notification Templates Table
CREATE TABLE IF NOT EXISTS core.notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    category TEXT,
    data JSONB DEFAULT '{}'::jsonb,
    image_url TEXT,
    variables TEXT[] DEFAULT '{}', -- List of expected variables like ['userName', 'promoCode']
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_notification_logs_sent_at ON core.notification_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_status_scheduled ON core.scheduled_notifications(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_notification_templates_category ON core.notification_templates(category);

-- RLS Policies (Basic Admin Access)
ALTER TABLE core.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.scheduled_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.notification_templates ENABLE ROW LEVEL SECURITY;

-- Grant permissions to service_role and authenticated users (adjust as needed)
GRANT ALL ON core.notification_logs TO service_role;
GRANT ALL ON core.scheduled_notifications TO service_role;
GRANT ALL ON core.notification_templates TO service_role;

GRANT SELECT ON core.notification_templates TO authenticated;
-- Authenticated users typically shouldn't read logs or scheduled items directly unless they are admins

-- ==============================================================================
-- RPC: Estimate Audience Size
-- ==============================================================================
CREATE OR REPLACE FUNCTION core.estimate_notification_audience(
    p_filters JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_query TEXT;
    v_count BIGINT;
BEGIN
    -- Query focused on users who have at least one active FCM token
    v_query := 'SELECT count(DISTINCT p.id) 
                FROM drive.profiles p 
                JOIN drive.fcm_tokens t ON p.id = t.user_id 
                WHERE t.is_active = true';

    -- Filter by Subscription Tier
    IF p_filters ? 'subscription_tier_id' AND p_filters->>'subscription_tier_id' IS NOT NULL THEN
        v_query := v_query || format(' AND p.subscription_tier_id = %L', (p_filters->>'subscription_tier_id')::uuid);
    END IF;

    -- Filter by Platform (matches the platform recorded in the token or profile)
    IF p_filters ? 'last_platform' AND p_filters->>'last_platform' IS NOT NULL THEN
        v_query := v_query || format(' AND p.last_platform = %L', p_filters->>'last_platform');
    END IF;

    -- Filter by Country
    IF p_filters ? 'country' AND p_filters->>'country' IS NOT NULL THEN
        v_query := v_query || format(' AND p.country = %L', p_filters->>'country');
    END IF;

    -- Filter by Language
    IF p_filters ? 'language' AND p_filters->>'language' IS NOT NULL THEN
        v_query := v_query || format(' AND p.language = %L', p_filters->>'language');
    END IF;

    -- Filter by Driver Type
    IF p_filters ? 'driver_type' AND p_filters->>'driver_type' IS NOT NULL THEN
        v_query := v_query || format(' AND p.driver_type = %L', p_filters->>'driver_type');
    END IF;

    -- Filter by Onboarding Completed
    IF p_filters ? 'onboarding_completed' AND p_filters->>'onboarding_completed' IS NOT NULL THEN
        v_query := v_query || format(' AND p.onboarding_completed = %L', (p_filters->>'onboarding_completed')::boolean);
    END IF;

    -- Filter by Created At (Range)
    IF p_filters ? 'created_after' AND p_filters->>'created_after' IS NOT NULL THEN
        v_query := v_query || format(' AND p.created_at >= %L', (p_filters->>'created_after')::timestamptz);
    END IF;
    IF p_filters ? 'created_before' AND p_filters->>'created_before' IS NOT NULL THEN
        v_query := v_query || format(' AND p.created_at <= %L', (p_filters->>'created_before')::timestamptz);
    END IF;

    -- Last Active (Range)
    IF p_filters ? 'last_active_after' AND p_filters->>'last_active_after' IS NOT NULL THEN
        v_query := v_query || format(' AND p.last_sign_in_at >= %L', (p_filters->>'last_active_after')::timestamptz);
    END IF;

    -- App Version
    IF p_filters ? 'app_version_lt' AND p_filters->>'app_version_lt' IS NOT NULL THEN
        v_query := v_query || format(' AND p.last_app_version < %L', p_filters->>'app_version_lt');
    END IF;

    EXECUTE v_query INTO v_count;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION core.estimate_notification_audience(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION core.estimate_notification_audience(JSONB) TO service_role;

-- Public wrapper for easier RPC access
CREATE OR REPLACE FUNCTION public.estimate_notification_audience(p_filters JSONB)
RETURNS BIGINT AS $$
  SELECT core.estimate_notification_audience(p_filters);
$$ LANGUAGE sql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.estimate_notification_audience(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estimate_notification_audience(JSONB) TO service_role;

-- ==============================================================================
-- CRON JOB CONFIGURATION (Secure)
-- ==============================================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS http;

-- Create a secure function to call the Edge Function
CREATE OR REPLACE FUNCTION core.trigger_process_scheduled_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- Run as owner to access secrets
AS $$
DECLARE
  url text;
  key text;
  response_status integer;
  response_content text;
BEGIN
  -- Construct URL dynamically from system settings
  url := current_setting('app.settings.supabase_url') || '/functions/v1/firebase-push-notification/process-scheduled';
  
  -- Use Service Role Key for privileged access (needed to write to logs/update status)
  key := current_setting('app.settings.service_role_key');

  -- Call the Edge Function
  SELECT status, content INTO response_status, response_content
  FROM http((
    'POST',
    url,
    ARRAY[
      http_header('Authorization', 'Bearer ' || key),
      http_header('Content-Type', 'application/json')
    ],
    'application/json',
    '{}'
  ));
  
  -- Optional: Log errors if request fails (you can check logs in Supabase)
  IF response_status >= 400 THEN
    RAISE WARNING 'Scheduled Notification Job Failed. Status: %, Content: %', response_status, response_content;
  END IF;
END;
$$;

-- Schedule the cron job to run every minute
-- (Checks for pending notifications scheduled for NOW or earlier)
SELECT cron.schedule(
  'process-push-notifications', -- Job Name
  '* * * * *',                  -- Every minute
  'SELECT core.trigger_process_scheduled_notifications();'
);

-- Grant permissions needed for the cron job to execute the function
GRANT USAGE ON SCHEMA core TO postgres;
GRANT EXECUTE ON FUNCTION core.trigger_process_scheduled_notifications() TO postgres;
