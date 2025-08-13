-- Check total count of attractions
SELECT COUNT(*) as total_attractions FROM core.attractions;

-- Check count by approval status
SELECT 
    approved,
    COUNT(*) as count
FROM core.attractions 
GROUP BY approved;

-- Check count by country
SELECT 
    country,
    COUNT(*) as count
FROM core.attractions 
GROUP BY country
ORDER BY count DESC;

-- Check recent deletions (if any)
SELECT 
    COUNT(*) as total_attractions,
    MIN(created_at) as oldest_created,
    MAX(created_at) as newest_created
FROM core.attractions;

-- Check if there are any attractions with NULL values that might be filtered out
SELECT 
    COUNT(*) as null_name_count
FROM core.attractions 
WHERE name IS NULL OR name = '';

-- Check attractions created in the last 24 hours
SELECT 
    COUNT(*) as recent_attractions
FROM core.attractions 
WHERE created_at >= NOW() - INTERVAL '24 hours';
