-- ============================================================
-- BATCH 22 — Canada: expand province abbreviations,
--            fix Inuktitut Nunavut prefix, drop US abbrevs
-- NOTE: Run AFTER batch25 (country ISO normalisation)
-- ============================================================

SELECT state, count(*) FROM core.attractions
 WHERE country = 'Canada'
 GROUP BY state ORDER BY count DESC LIMIT 40;

-- Expand 2-letter abbreviations
UPDATE core.attractions SET state = 'Ontario'
  WHERE country = 'Canada' AND trim(state) = 'ON';

UPDATE core.attractions SET state = 'Québec'
  WHERE country = 'Canada' AND trim(state) IN ('QC','PQ','Quebec','Quebec Province');

UPDATE core.attractions SET state = 'British Columbia'
  WHERE country = 'Canada' AND trim(state) IN ('BC','British Columbia Province');

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
  WHERE country = 'Canada' AND trim(state) IN ('NL','NF','Newfoundland');

UPDATE core.attractions SET state = 'Prince Edward Island'
  WHERE country = 'Canada' AND trim(state) IN ('PE','PEI');

UPDATE core.attractions SET state = 'Northwest Territories'
  WHERE country = 'Canada' AND trim(state) = 'NT';

UPDATE core.attractions SET state = 'Yukon'
  WHERE country = 'Canada' AND trim(state) IN ('YT','YK');

UPDATE core.attractions SET state = 'Nunavut'
  WHERE country = 'Canada' AND trim(state) = 'NU';

-- Fix Inuktitut syllabics prefix: "ᓄᓇᕗᑦ Nunavut" → "Nunavut"
UPDATE core.attractions SET state = 'Nunavut'
  WHERE country = 'Canada' AND state LIKE '%Nunavut%' AND state != 'Nunavut';

-- Drop US state abbreviations filed under Canada (bad data)
UPDATE core.attractions SET state = NULL
  WHERE country = 'Canada'
    AND trim(state) ~ '^[A-Z]{2}$'
    AND trim(state) NOT IN ('ON','QC','BC','AB','MB','SK','NS','NB','NL','PE','NT','YT','NU');

SELECT state, count(*) FROM core.attractions
 WHERE country = 'Canada'
 GROUP BY state ORDER BY count DESC LIMIT 20;
