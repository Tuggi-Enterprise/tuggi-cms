-- Migration Metrics RPC
-- Calculates migration volume and average processing time (filtering out inactivity gaps > 10m)

CREATE OR REPLACE FUNCTION core.dashboard_migration_metrics()
RETURNS JSONB
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
BEGIN
    WITH OrderedAttractions AS (
        SELECT 
            created_at,
            LAG(created_at) OVER (ORDER BY created_at ASC) as prev_created_at
        FROM core.attractions
    ),
    TimeDiffs AS (
        SELECT 
            created_at,
            TO_CHAR(created_at, 'YYYY-MM') as month_str,
            EXTRACT(EPOCH FROM (created_at - prev_created_at)) as diff_seconds
        FROM OrderedAttractions
        WHERE prev_created_at IS NOT NULL
    ),
    MonthlyStats AS (
        SELECT 
            month_str as month,
            COUNT(*) as volume,
            ROUND(AVG(diff_seconds) FILTER (WHERE diff_seconds > 0 AND diff_seconds < 600)::NUMERIC, 2) as avg_seconds
        FROM TimeDiffs
        GROUP BY month_str
        ORDER BY month_str ASC
    ),
    OverallStats AS (
        SELECT 
            ROUND(AVG(diff_seconds) FILTER (WHERE diff_seconds > 0 AND diff_seconds < 600)::NUMERIC, 2) as overall_avg
        FROM TimeDiffs
    ),
    RecentStats AS (
        SELECT 
            ROUND(AVG(diff_seconds) FILTER (WHERE diff_seconds > 0 AND diff_seconds < 600)::NUMERIC, 2) as recent_avg,
            COUNT(*) FILTER (WHERE diff_seconds > 0 AND diff_seconds < 600) as recent_volume
        FROM TimeDiffs
        WHERE created_at >= NOW() - INTERVAL '6 hours'
    )
    SELECT jsonb_build_object(
        'monthly', COALESCE((SELECT jsonb_agg(row_to_json(m)) FROM MonthlyStats m), '[]'::jsonb),
        'overall_avg_seconds', COALESCE((SELECT overall_avg FROM OverallStats), 0),
        'recent_avg_seconds', COALESCE((SELECT recent_avg FROM RecentStats), 0),
        'recent_volume', COALESCE((SELECT recent_volume FROM RecentStats), 0)
    ) INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;
