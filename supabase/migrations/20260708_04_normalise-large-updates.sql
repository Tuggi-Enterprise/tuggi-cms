-- ============================================================
-- BATCH 28 — Large updates that timeout via PostgREST API.
-- Run directly in the Supabase Dashboard SQL Editor.
-- These require a full table scan and need longer timeout.
-- ============================================================

-- ---- Canada ----
UPDATE core.attractions SET state = 'Québec'
  WHERE country = 'Canada'
    AND state IN ('Quebec', 'QC', 'PQ', 'Quebec Province');

-- ---- Spain: community name normalization ----
UPDATE core.attractions SET state = 'Andalucía'
  WHERE country = 'Spain'
    AND state IN ('Andalusia', 'Andalucia');

UPDATE core.attractions SET state = 'Aragón'
  WHERE country = 'Spain'
    AND state = 'Aragon';

UPDATE core.attractions SET state = 'Illes Balears'
  WHERE country = 'Spain'
    AND state IN ('Balearic Islands', 'Islas Baleares', 'Baleares');

UPDATE core.attractions SET state = 'País Vasco'
  WHERE country = 'Spain'
    AND state IN ('Basque Country', 'Euskadi', 'Pais Vasco');

UPDATE core.attractions SET state = 'Castilla y León'
  WHERE country = 'Spain'
    AND state IN ('Castille and León', 'Castile and Leon', 'Castilla y Leon',
                  'Castille and Leon', 'Castile y leon');

UPDATE core.attractions SET state = 'Castilla-La Mancha'
  WHERE country = 'Spain'
    AND state IN ('Castille-La Mancha', 'Castile-La Mancha',
                  'Castilla la mancha', 'Castilla La Mancha');

UPDATE core.attractions SET state = 'Catalunya'
  WHERE country = 'Spain'
    AND state IN ('Catalonia', 'Cataluña', 'Catalonya');

UPDATE core.attractions SET state = 'Comunitat Valenciana'
  WHERE country = 'Spain'
    AND state IN ('Valencia', 'Valencian Community',
                  'Comunidad Valenciana', 'Community of Valencia');

UPDATE core.attractions SET state = 'Navarra'
  WHERE country = 'Spain'
    AND state IN ('Navarre', 'Comunidad Foral de Navarra');

-- ---- France ----
UPDATE core.attractions SET country = 'France'
  WHERE trim(country) IN ('FR', 'fr');

UPDATE core.attractions SET state = 'Nouvelle-Aquitaine'
  WHERE country = 'France'
    AND state IN ('New Aquitaine', 'Nouvelle Aquitaine');

UPDATE core.attractions SET state = 'Auvergne-Rhône-Alpes'
  WHERE country = 'France'
    AND state IN ('Rhône-Alpes', 'Auvergne');

UPDATE core.attractions SET state = 'Bretagne'
  WHERE country = 'France'
    AND state IN ('Brittany');

UPDATE core.attractions SET state = 'Normandie'
  WHERE country = 'France'
    AND state IN ('Normandy', 'Haute-Normandie', 'Basse-Normandie');

UPDATE core.attractions SET state = 'Bourgogne-Franche-Comté'
  WHERE country = 'France'
    AND state IN ('Bourgogne', 'Franche-Comté', 'Burgundy');

UPDATE core.attractions SET state = 'Corse'
  WHERE country = 'France'
    AND state IN ('Corsica');

UPDATE core.attractions SET state = 'Centre-Val de Loire'
  WHERE country = 'France'
    AND state IN ('Centre');

-- Verify
SELECT 'Canada' as country, state, count(*)
  FROM core.attractions WHERE country = 'Canada' GROUP BY state ORDER BY count DESC LIMIT 15;

SELECT 'Spain' as country, state, count(*)
  FROM core.attractions WHERE country = 'Spain' GROUP BY state ORDER BY count DESC LIMIT 20;
