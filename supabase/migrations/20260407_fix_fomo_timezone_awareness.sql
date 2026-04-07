-- Migration: Fix FOMO Timezone Awareness
-- Date: 2026-04-07
-- Purpose: Ensure daily summaries are calculated using the user's local date based on their timezone, and not UTC.

CREATE OR REPLACE FUNCTION drive.refresh_daily_fomo_stats(p_target_date DATE DEFAULT (CURRENT_DATE - 1))
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO drive.daily_user_fomo_stats (
        user_id, summary_date, heard_count, missed_count, language, nickname, timezone, updated_at
    )
    SELECT 
        p.id as user_id,
        p_target_date as summary_date,
        COALESCE(sub.heard_count, 0) as heard_count,
        COALESCE(sub.missed_count, 0) as missed_count,
        p.language,
        COALESCE(p.nickname, 'Viajante') as nickname,
        p.timezone,
        NOW()
    FROM drive.profiles p
    JOIN (
        WITH daily_trail AS (
            -- Calculate trail line and confirm local date for each user
            SELECT 
                rt.user_id, 
                ST_Simplify(ST_MakeLine(ST_SetSRID(ST_MakePoint(rt.longitude, rt.latitude), 4326) ORDER BY rt.timestamp), 0.001) as trail_line
            FROM drive.route_trail rt
            JOIN drive.profiles pr ON pr.id = rt.user_id
            -- CRITICAL FIX: Cast UTC timestamp to User's Local Date
            WHERE (rt.timestamp AT TIME ZONE COALESCE(pr.timezone, 'UTC'))::date = p_target_date
            GROUP BY rt.user_id
        ),
        heard_per_user AS (
            SELECT 
                pv.user_id, 
                COUNT(DISTINCT pv.poi_id) as cnt
            FROM drive.poi_visits pv
            JOIN drive.profiles pr ON pr.id = pv.user_id
            WHERE (pv.visit_timestamp AT TIME ZONE COALESCE(pr.timezone, 'UTC'))::date = p_target_date
            GROUP BY pv.user_id
        ),
        missed_per_user AS (
            -- Find attractive points within 1km of the daily trail that were NOT visited
            SELECT dt.user_id, COUNT(DISTINCT a.id) as cnt
            FROM daily_trail dt
            JOIN drive.profiles pr ON pr.id = dt.user_id
            JOIN core.attraction_coordinate ac ON ST_DWithin(dt.trail_line::geography, ST_SetSRID(ST_MakePoint(ac.longitude, ac.latitude), 4326)::geography, 1000)
            JOIN core.attractions a ON a.id = ac.attraction_id
            LEFT JOIN drive.poi_visits pv ON pv.poi_id = a.id AND pv.user_id = dt.user_id AND (pv.visit_timestamp AT TIME ZONE COALESCE(pr.timezone, 'UTC'))::date = p_target_date
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
    WHERE p.push_denied = false
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

GRANT EXECUTE ON FUNCTION drive.refresh_daily_fomo_stats(DATE) TO service_role;
