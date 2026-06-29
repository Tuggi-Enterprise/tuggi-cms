-- ============================================================
-- BATCH 25 — Normalise ISO-2 country codes still in DB
-- GB → United Kingdom, IE → Ireland
-- (These arrived from OSM addr:country tags)
-- ============================================================

SELECT country, count(*) FROM core.attractions
 WHERE lower(trim(country)) IN ('gb','ie','uk','england','scotland','wales','northern ireland')
 GROUP BY country ORDER BY count DESC;

-- GB → United Kingdom
UPDATE core.attractions SET country = 'United Kingdom'
  WHERE lower(trim(country)) IN ('gb','uk','great britain','england','scotland','wales','northern ireland');

-- IE → Ireland
UPDATE core.attractions SET country = 'Ireland'
  WHERE lower(trim(country)) IN ('ie');

SELECT country, count(*) FROM core.attractions
 WHERE country IN ('United Kingdom','Ireland')
 GROUP BY country ORDER BY count DESC;
