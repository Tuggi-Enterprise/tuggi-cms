-- Migration Metrics - Materialized Performance Optimization
-- This implementation uses a Materialized View to avoid heavy LAG operations on every dashboard load.

-- 1. Create the Materialized View for monthly aggregations
CREATE MATERIALIZED VIEW IF NOT EXISTS core.mv_migration_monthly_stats AS
WITH TimeDiffs AS (
    SELECT 
        created_at,
        TO_CHAR(created_at, 'YYYY-MM') as month_str,
        EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (ORDER BY created_at ASC))) as diff_seconds
    FROM core.attractions
)
SELECT 
    month_str as month,
    COUNT(*) as volume,
    ROUND(AVG(diff_seconds) FILTER (WHERE diff_seconds > 0 AND diff_seconds < 600)::NUMERIC, 2) as avg_seconds
FROM TimeDiffs
WHERE month_str IS NOT NULL
GROUP BY month_str
ORDER BY month_str ASC
WITH DATA;

-- 2. Unique index to allow CONCURRENT refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_migration_monthly_stats_month ON core.mv_migration_monthly_stats (month);

-- 3. Refresh function (can be called by cron or after batch migrations)
CREATE OR REPLACE FUNCTION core.refresh_migration_metrics()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY core.mv_migration_monthly_stats;
END;
$$;

-- 4. Updated RPC to consume from Materialized View
CREATE OR REPLACE FUNCTION core.dashboard_migration_metrics()
RETURNS JSONB
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    -- Overall average still needs a scan but it's just an AVG over the view or we can pre-calculate
    -- For maximum speed, we use the view for monthly and live query only for very recent data
    
    SELECT jsonb_build_object(
        'monthly', COALESCE((SELECT jsonb_agg(row_to_json(m)) FROM (SELECT * FROM core.mv_migration_monthly_stats ORDER BY month ASC) m), '[]'::jsonb),
        'overall_avg_seconds', COALESCE((SELECT ROUND(AVG(avg_seconds), 2) FROM core.mv_migration_monthly_stats WHERE avg_seconds > 0), 0),
        'recent_avg_seconds', COALESCE(
            (SELECT ROUND(AVG(diff_seconds) FILTER (WHERE diff_seconds > 0 AND diff_seconds < 600)::NUMERIC, 2) 
             FROM (
                SELECT EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (ORDER BY created_at ASC))) as diff_seconds
                FROM core.attractions 
                WHERE created_at >= NOW() - INTERVAL '6 hours'
             ) ts
            ), 0),
        'recent_volume', COALESCE((SELECT COUNT(*) FROM core.attractions WHERE created_at >= NOW() - INTERVAL '6 hours'), 0)
    ) INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;


