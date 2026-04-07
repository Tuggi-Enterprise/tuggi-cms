-- Migration: Add Push Retry Logic for FOMO Notifications
-- Date: 2026-04-07
-- Purpose: Add attempt count and a wider window (07:00-22:00) with a limit of 5 retries.

-- 1. Add attempt_count column
ALTER TABLE drive.daily_user_fomo_stats 
ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0;

-- 2. Update the RPC to search for candidates in a wider window (07:00-22:00)
-- and with attempt_count < 5.
CREATE OR REPLACE FUNCTION drive.get_morning_push_candidates()
RETURNS TABLE (
    user_id UUID,
    nickname TEXT,
    language TEXT,
    heard_count INTEGER,
    missed_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.user_id,
        s.nickname,
        s.language,
        s.heard_count,
        s.missed_count
    FROM drive.daily_user_fomo_stats s
    JOIN drive.profiles p ON p.id = s.user_id
    WHERE 
        -- Analysis for "Yesterday"
        s.summary_date = (CURRENT_DATE - 1)
        AND s.notified_at IS NULL
        AND s.attempt_count < 5
        AND (s.missed_count > 0 OR s.heard_count > 0)
        AND p.push_denied = false
        -- Local time check: hour is between 07 and 22 based on timezone
        AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE COALESCE(p.timezone, 'UTC'))) >= 7
        AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE COALESCE(p.timezone, 'UTC'))) <= 22;
END;
$$;

GRANT EXECUTE ON FUNCTION drive.get_morning_push_candidates() TO service_role;

-- 3. Function to increment attempt count
CREATE OR REPLACE FUNCTION drive.increment_fomo_attempt(p_user_id UUID, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE drive.daily_user_fomo_stats
    SET attempt_count = attempt_count + 1,
        updated_at = NOW()
    WHERE user_id = p_user_id AND summary_date = p_date;
END;
$$;

GRANT EXECUTE ON FUNCTION drive.increment_fomo_attempt(UUID, DATE) TO service_role;
