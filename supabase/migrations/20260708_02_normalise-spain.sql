-- ============================================================
-- BATCH 26 — Spain: normalize country ISO code + community
--            spelling variants
-- NOTE: PIP (point-in-polygon) uses coordinates, not state field.
--       These fixes improve DB data quality and search consistency.
-- ============================================================

-- 1. Normalize ISO code → full name
UPDATE core.attractions SET country = 'Spain'
  WHERE trim(country) IN ('ES', 'es');

-- 2. Normalize autonomous community spelling variants
--    (keeping community-level granularity; PIP handles province mapping)
UPDATE core.attractions SET state = 'Andalucía'
  WHERE country = 'Spain'
    AND lower(trim(state)) IN ('andalusia', 'andalucia');

UPDATE core.attractions SET state = 'Aragón'
  WHERE country = 'Spain'
    AND lower(trim(state)) IN ('aragon');

UPDATE core.attractions SET state = 'Asturias'
  WHERE country = 'Spain'
    AND lower(trim(state)) IN ('asturias / asturies', 'principado de asturias');

UPDATE core.attractions SET state = 'Illes Balears'
  WHERE country = 'Spain'
    AND lower(trim(state)) IN ('balearic islands', 'islas baleares', 'baleares',
                               'illes balears');

UPDATE core.attractions SET state = 'País Vasco'
  WHERE country = 'Spain'
    AND lower(trim(state)) IN ('basque country', 'euskadi', 'pais vasco');

UPDATE core.attractions SET state = 'Castilla y León'
  WHERE country = 'Spain'
    AND lower(trim(state)) IN ('castille and león', 'castile and leon',
                               'castilla y leon', 'castille and leon',
                               'castile y leon');

UPDATE core.attractions SET state = 'Castilla-La Mancha'
  WHERE country = 'Spain'
    AND lower(trim(state)) IN ('castille-la mancha', 'castile-la mancha',
                               'castilla la mancha');

UPDATE core.attractions SET state = 'Catalunya'
  WHERE country = 'Spain'
    AND lower(trim(state)) IN ('catalonia', 'cataluña', 'catalonya');

UPDATE core.attractions SET state = 'Comunitat Valenciana'
  WHERE country = 'Spain'
    AND lower(trim(state)) IN ('valencia', 'valencian community',
                               'comunidad valenciana', 'community of valencia');

UPDATE core.attractions SET state = 'Navarra'
  WHERE country = 'Spain'
    AND lower(trim(state)) IN ('navarre', 'comunidad foral de navarra',
                               'nafarroa');

UPDATE core.attractions SET state = 'Murcia'
  WHERE country = 'Spain'
    AND lower(trim(state)) IN ('región de murcia', 'region de murcia',
                               'murcia region');

UPDATE core.attractions SET state = 'La Rioja'
  WHERE country = 'Spain'
    AND lower(trim(state)) IN ('rioja', 'la rioja');

-- Verify
SELECT state, count(*) FROM core.attractions
 WHERE country = 'Spain'
 GROUP BY state ORDER BY count DESC LIMIT 30;
