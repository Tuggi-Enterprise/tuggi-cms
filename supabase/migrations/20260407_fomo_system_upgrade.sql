-- Migration: FOMO System Upgrade (Consolidated V2)
-- Date: 2026-04-07
-- Purpose: Ensure timezone awareness in daily stats calculation and implement push notification retry logic with expanded delivery window.

-- 1. ESTRUTURA: Coluna de tentativas
ALTER TABLE drive.daily_user_fomo_stats 
ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0;

-- 2. REFRESH STATS: Cálculo diário respeitando o Timezone do usuário
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
            SELECT 
                rt.user_id, 
                ST_Simplify(ST_MakeLine(ST_SetSRID(ST_MakePoint(rt.longitude, rt.latitude), 4326) ORDER BY rt.timestamp), 0.001) as trail_line
            FROM drive.route_trail rt
            JOIN drive.profiles pr ON pr.id = rt.user_id
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

-- 3. CANDIDATES: Janela de envio expandida (07:00-22:00) e limite de 5 tentativas
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
        s.summary_date = (CURRENT_DATE - 1)
        AND s.notified_at IS NULL
        AND s.attempt_count < 5
        AND (s.missed_count > 0 OR s.heard_count > 0)
        AND p.push_denied = false
        AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE COALESCE(p.timezone, 'UTC'))) >= 7
        AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE COALESCE(p.timezone, 'UTC'))) <= 22;
END;
$$;

-- 4. UTILS: Incrementar contador de tentativas
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

-- Permissions
GRANT EXECUTE ON FUNCTION drive.refresh_daily_fomo_stats(DATE) TO service_role;
GRANT EXECUTE ON FUNCTION drive.get_morning_push_candidates() TO service_role;
GRANT EXECUTE ON FUNCTION drive.increment_fomo_attempt(UUID, DATE) TO service_role;
