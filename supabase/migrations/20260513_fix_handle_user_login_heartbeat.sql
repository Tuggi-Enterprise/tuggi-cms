-- Migration: drive.handle_user_login_heartbeat — fix missing field updates
-- Date: 2026-05-13
--
-- Context: The previous version of this RPC only updated a subset of the
-- device-info fields it received. `last_app_version`, `last_platform`,
-- `last_device_model`, `language`, `latitude`, `longitude` were all sent by
-- the client but never written, leading to stale/missing values in the
-- dashboard and an unreliable source of truth for which app version each
-- user is actually running.
--
-- Additionally, `login_count` was being incremented on every call (every
-- app open). The product intent is "active days", not "open count" — so we
-- now increment only on a calendar-day transition vs `last_sign_in_at`.
--
-- IP is captured server-side via the PostgREST `x-forwarded-for` header
-- (with `inet_client_addr()` as fallback) rather than trusting the client.
--
-- Signature unchanged (`RETURNS void`) — no client changes required.

CREATE OR REPLACE FUNCTION drive.handle_user_login_heartbeat(
  p_user_id UUID,
  p_device_info JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = drive, public, extensions
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_last_sign_in TIMESTAMPTZ;
  v_is_new_day BOOLEAN;
  v_client_ip TEXT;
BEGIN
  v_client_ip := COALESCE(
    NULLIF(split_part(
      current_setting('request.headers', true)::jsonb->>'x-forwarded-for',
      ',', 1
    ), ''),
    inet_client_addr()::text
  );

  SELECT last_sign_in_at INTO v_last_sign_in
  FROM drive.profiles
  WHERE id = p_user_id;

  v_is_new_day := v_last_sign_in IS NULL
    OR v_last_sign_in::date < v_now::date;

  UPDATE drive.profiles
  SET
    last_sign_in_at   = v_now,
    updated_at        = v_now,
    login_count       = CASE
                          WHEN v_is_new_day THEN COALESCE(login_count, 0) + 1
                          ELSE login_count
                        END,
    last_app_version  = COALESCE(NULLIF(p_device_info->>'app_version', ''),    last_app_version),
    last_platform     = COALESCE(NULLIF(p_device_info->>'platform', ''),       last_platform),
    last_device_model = COALESCE(NULLIF(p_device_info->>'device_model', ''),   last_device_model),
    language          = COALESCE(NULLIF(p_device_info->>'language', ''),       language),
    timezone          = COALESCE(NULLIF(p_device_info->>'timezone', ''),       timezone),
    latitude          = COALESCE((p_device_info->>'latitude')::double precision,  latitude),
    longitude         = COALESCE((p_device_info->>'longitude')::double precision, longitude),
    push_denied       = COALESCE((p_device_info->>'push_denied')::boolean,        push_denied),
    ip_address        = COALESCE(v_client_ip, ip_address),
    onboarding_completed = COALESCE(
      (p_device_info->>'onboarding_completed')::boolean,
      onboarding_completed
    )
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION drive.handle_user_login_heartbeat(UUID, JSONB)
  TO authenticated, service_role;
