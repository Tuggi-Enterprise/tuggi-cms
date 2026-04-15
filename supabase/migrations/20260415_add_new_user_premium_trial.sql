-- Migration: Add automatic 1-day premium trial for new users
-- Date: 2026-04-15
-- Description: Every new user created in drive.profiles gets a premium trial until 23:59:59 of the next day.

-- 1. Create the trial application function
CREATE OR REPLACE FUNCTION drive.apply_new_user_premium_trial()
RETURNS TRIGGER AS $$
DECLARE
  v_premium_tier_id UUID;
  v_free_tier_id UUID := '984a7cd3-c937-4218-842a-9c5fdf824f25';
  v_title TEXT;
  v_body TEXT;
BEGIN
  -- 1. Search for the Premium tier ID
  SELECT id INTO v_premium_tier_id 
  FROM drive.subscription_tiers 
  WHERE (name ILIKE '%premium%' OR display_name ILIKE '%premium%')
    AND id != v_free_tier_id
    AND is_active = true
  ORDER BY created_at ASC 
  LIMIT 1;

  -- Fallback: if no tier specifically named 'premium' is found, take the first active non-free tier
  IF v_premium_tier_id IS NULL THEN
    SELECT id INTO v_premium_tier_id
    FROM drive.subscription_tiers
    WHERE id != v_free_tier_id
      AND is_active = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- 2. Apply the trial if a premium tier was identified
  IF v_premium_tier_id IS NOT NULL THEN
    NEW.subscription_tier_id := v_premium_tier_id;
    NEW.subscription_start_date := NOW();
    -- Expiration: Next day at 23:59:59
    NEW.subscription_end_date := (CURRENT_DATE + INTERVAL '1 day') + TIME '23:59:59';
    NEW.subscription_provider := 'system_trial';

    -- 3. Prepare welcome push notification (wrapped in exception handler to NEVER block user creation)
    BEGIN
      v_title := CASE 
        WHEN NEW.language = 'en' THEN 'You''ve got 1 day of Premium! '
        WHEN NEW.language = 'es' THEN '¡Has ganado 1 día de Premium! '
        ELSE 'Você ganhou 1 dia de Premium! '
      END;

      v_body := CASE 
        WHEN NEW.language = 'en' THEN 'Enjoy 24h of full access to explore all our histories.'
        WHEN NEW.language = 'es' THEN 'Disfruta de 24h de acceso completo para explorar todas nuestras histórias.'
        ELSE 'Aproveite 24h de acesso liberado para explorar ao seu redor.'
      END;

      -- Insert into scheduled_notifications for the cron to pick up
      INSERT INTO core.scheduled_notifications (
        type, title, body, user_ids, scheduled_for, status, data
      ) VALUES (
        'user', 
        v_title, 
        v_body, 
        ARRAY[NEW.id], 
        NOW(), 
        'scheduled',
        jsonb_build_object('type', 'premium_trial_welcome', 'target', 'subscription')
      );
    EXCEPTION WHEN OTHERS THEN
      -- Log the error but NEVER block user creation
      RAISE WARNING '[trial-trigger] Push notification insert failed for user %: % (SQLSTATE: %)', 
        NEW.id, SQLERRM, SQLSTATE;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create the Trigger
-- We use BEFORE INSERT so we can modify the NEW record directly without an extra UPDATE
DROP TRIGGER IF EXISTS tr_on_user_created_premium_trial ON drive.profiles;
CREATE TRIGGER tr_on_user_created_premium_trial
BEFORE INSERT ON drive.profiles
FOR EACH ROW
EXECUTE FUNCTION drive.apply_new_user_premium_trial();

-- 3. Ensure function runs with elevated privileges to insert into core schema
ALTER FUNCTION drive.apply_new_user_premium_trial() SECURITY DEFINER;
