-- ============================================================
-- BATCH 27 — Canada: fix remaining abbreviations and spelling
--            variants missed by batch22
-- NOTE: Run AFTER batch22 (or standalone if batch22 already ran)
-- ============================================================

-- Fix Quebec → Québec (most common remaining issue)
UPDATE core.attractions SET state = 'Québec'
  WHERE country = 'Canada'
    AND trim(state) IN ('Quebec', 'QC', 'PQ', 'Quebec Province');

-- Fix remaining 2-letter abbreviations
UPDATE core.attractions SET state = 'Ontario'
  WHERE country = 'Canada' AND trim(state) = 'ON';

UPDATE core.attractions SET state = 'Prince Edward Island'
  WHERE country = 'Canada' AND trim(state) IN ('PE', 'PEI');

UPDATE core.attractions SET state = 'British Columbia'
  WHERE country = 'Canada' AND trim(state) = 'BC';

UPDATE core.attractions SET state = 'Alberta'
  WHERE country = 'Canada' AND trim(state) = 'AB';

UPDATE core.attractions SET state = 'Manitoba'
  WHERE country = 'Canada' AND trim(state) = 'MB';

UPDATE core.attractions SET state = 'Saskatchewan'
  WHERE country = 'Canada' AND trim(state) = 'SK';

UPDATE core.attractions SET state = 'Nova Scotia'
  WHERE country = 'Canada' AND trim(state) = 'NS';

UPDATE core.attractions SET state = 'New Brunswick'
  WHERE country = 'Canada' AND trim(state) = 'NB';

UPDATE core.attractions SET state = 'Newfoundland and Labrador'
  WHERE country = 'Canada' AND trim(state) IN ('NL', 'NF', 'Newfoundland');

UPDATE core.attractions SET state = 'Northwest Territories'
  WHERE country = 'Canada' AND trim(state) = 'NT';

UPDATE core.attractions SET state = 'Yukon'
  WHERE country = 'Canada' AND trim(state) IN ('YT', 'YK');

UPDATE core.attractions SET state = 'Nunavut'
  WHERE country = 'Canada' AND trim(state) = 'NU';

-- Clear US state abbreviations filed under Canada (bad data)
UPDATE core.attractions SET state = NULL
  WHERE country = 'Canada'
    AND trim(state) ~ '^[A-Z]{2}$'
    AND trim(state) NOT IN ('ON','QC','BC','AB','MB','SK','NS','NB','NL','PE','NT','YT','NU');

-- Verify
SELECT state, count(*) FROM core.attractions
 WHERE country = 'Canada'
 GROUP BY state ORDER BY count DESC LIMIT 20;
