-- Migration: Gamification FOMO Push Logic
-- Date: 2026-04-01
-- Purpose: Implementation of a cached, timezone-aware push notification system for daily summaries.

-- 1. Create Cache Table for Daily Stats
CREATE TABLE IF NOT EXISTS drive.daily_user_fomo_stats (
    user_id UUID NOT NULL REFERENCES drive.profiles(id) ON DELETE CASCADE,
    summary_date DATE NOT NULL,
    heard_count INTEGER DEFAULT 0,
    missed_count INTEGER DEFAULT 0,
    language TEXT,
    nickname TEXT,
    timezone TEXT,
    notified_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_fomo_stats_summary_date ON drive.daily_user_fomo_stats(summary_date);
CREATE INDEX IF NOT EXISTS idx_fomo_stats_notified ON drive.daily_user_fomo_stats(notified_at) WHERE notified_at IS NULL;

-- 2. Function to calculate and refresh the FOMO cache
-- This can be run every 6 hours to keep the cache ready for all timezones
CREATE OR REPLACE FUNCTION drive.refresh_daily_fomo_stats(p_target_date DATE DEFAULT (CURRENT_DATE - 1))
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Insert or Update stats for users who had trips on the target date
    INSERT INTO drive.daily_user_fomo_stats (
        user_id, 
        summary_date, 
        heard_count, 
        missed_count, 
        language, 
        nickname, 
        timezone,
        updated_at
    )
    SELECT 
        p.id as user_id,
        p_target_date as summary_date,
        -- Total Heard: Count distinct POIs visited on this specific day
        COALESCE(sub.heard_count, 0) as heard_count,
        -- Total Missed: Complex spatial calc simplified for cache
        -- For a truly robust missed count, we'd iterate sessions, 
        -- but here we use a simplified daily unique missed POI count within 1km of any trail point
        COALESCE(sub.missed_count, 0) as missed_count,
        p.language,
        COALESCE(p.nickname, 'Viajante') as nickname,
        p.timezone,
        NOW()
    FROM drive.profiles p
    JOIN (
        -- Aggregate stats per user for the target date
        -- We calculate this by identifying all trip sessions that started on that date
        WITH daily_sessions AS (
            SELECT DISTINCT trip_session_id
            FROM drive.route_trail
            WHERE timestamp::date = p_target_date
        ),
        daily_trail AS (
            SELECT user_id, ST_Simplify(ST_MakeLine(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) ORDER BY timestamp), 0.001) as trail_line
            FROM drive.route_trail
            WHERE timestamp::date = p_target_date
            GROUP BY user_id
        ),
        heard_per_user AS (
            SELECT user_id, COUNT(DISTINCT poi_id) as cnt
            FROM drive.poi_visits
            WHERE visit_timestamp::date = p_target_date
            GROUP BY user_id
        ),
        missed_per_user AS (
            -- This is the heavy part, hence why we cache it
            -- Find attractive points within 1km of the daily trail that were NOT visited
            SELECT dt.user_id, COUNT(DISTINCT a.id) as cnt
            FROM daily_trail dt
            JOIN core.attractions a ON ST_DWithin(dt.trail_line::geography, ST_SetSRID(ST_MakePoint(ac.longitude, ac.latitude), 4326)::geography, 1000)
            JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
            LEFT JOIN drive.poi_visits pv ON pv.poi_id = a.id AND pv.user_id = dt.user_id AND pv.visit_timestamp::date = p_target_date
            WHERE pv.poi_id IS NULL
            GROUP BY dt.user_id
        )
        SELECT 
            dt.user_id,
            COALESCE(h.cnt, 0) as heard_count,
            COALESCE(m.cnt, 0) as missed_count
        FROM daily_trail dt
        LEFT JOIN heard_per_user h ON h.user_id = dt.user_id
        LEFT JOIN missed_per_user m ON m.user_id = dt.user_id
    ) sub ON sub.user_id = p.id
    WHERE p.push_denied = false -- Don't even cache if push is denied
    ON CONFLICT (user_id, summary_date) 
    DO UPDATE SET 
        heard_count = EXCLUDED.heard_count,
        missed_count = EXCLUDED.missed_count,
        language = EXCLUDED.language,
        nickname = EXCLUDED.nickname,
        timezone = EXCLUDED.timezone,
        updated_at = NOW();
END;
$$;

-- 3. Function for the Orchestrator to find candidates
-- Finds users whose local time is between 07:00 and 08:00 AM
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
        AND s.missed_count > 0 -- Only focus on FOMO
        AND p.push_denied = false
        -- Local time check: hour is 07 based on timezone
        -- Handle timezone strings like 'America/Sao_Paulo'
        AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE COALESCE(p.timezone, 'UTC'))) = 7;
END;
$$;

-- 4. Security (RLS)
ALTER TABLE drive.daily_user_fomo_stats ENABLE ROW LEVEL SECURITY;

-- Policy: service_role has full access (for Edge Functions and Cron Jobs)
CREATE POLICY "service_role_full_access" ON drive.daily_user_fomo_stats
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Policy: Admin in core.cms_users can view all stats
CREATE POLICY "admin_view_all_stats" ON drive.daily_user_fomo_stats
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM core.cms_users 
            WHERE email = auth.jwt() ->> 'email' AND role = 'admin' AND is_active = true
        )
    );

-- Policy: Users can view their own daily stats
CREATE POLICY "users_view_own_stats" ON drive.daily_user_fomo_stats
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- Permissions
GRANT ALL ON drive.daily_user_fomo_stats TO service_role;
GRANT SELECT ON drive.daily_user_fomo_stats TO authenticated;
