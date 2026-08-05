-- Madrid: collapse district/neighborhood values in attractions.city into the municipality.
--
-- Same defect already fixed for Barcelona in 20260805_01: Nominatim reverse geocoding returned
-- `suburb`/`quarter`, so most POIs inside the municipal boundary carry a barrio in `city`
-- instead of "Madrid". Here it is worse -- 2.551 of 3.075 rows, spread over 155 distinct
-- values: "Palacio", "La Latina", "Las Cortes", "Jeronimos", "Recoletos", "Arguelles".
--
-- The nastiest one is `Ibiza`: a barrio of the Retiro district, so 43 POIs sitting in Madrid
-- are filed under the name of a Balearic island 500 km away. Any city-string filter puts them
-- on the wrong end of the country.
--
-- Authority is the OSM municipal polygon (core.city_boundaries osm_id -5326784, admin_level 8),
-- not a geocoding API -- the API is what produced the mess.
--
-- Unlike Barcelona, ONE point here also falls inside a neighbouring admin_level 8 boundary, so
-- the NOT EXISTS below leaves it alone instead of guessing. Border cases are curation, not a
-- sweep.
--
-- The old value is preserved: it moves to `neighborhood` when that column is empty, and
-- `city_correction_audit` keeps the original for a row-by-row rollback. Audit shape mirrors
-- lib/services/poi-processing/city-correction.service.ts so both writers agree.
--
-- Rollback:
--   UPDATE core.attractions SET city = city_correction_audit ->> 'original_city',
--                               neighborhood = NULLIF(city_correction_audit ->> 'original_neighborhood', ''),
--                               city_correction_audit = NULL
--   WHERE city_correction_audit ->> 'source' = 'city_boundaries_polygon:-5326784';

BEGIN;

WITH inside AS (
  SELECT a.id, a.city AS original_city, a.neighborhood AS original_neighborhood
  FROM core.attractions a
  JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  JOIN core.city_boundaries b ON b.osm_id = -5326784
  WHERE ST_Intersects(ac.location_geography::geometry, b.geom)
    AND a.city IS DISTINCT FROM 'Madrid'
    -- skip anything that also lands in another municipality
    AND NOT EXISTS (
      SELECT 1 FROM core.city_boundaries b2
      WHERE b2.admin_level = '8' AND b2.osm_id <> -5326784
        AND ST_Intersects(ac.location_geography::geometry, b2.geom)
    )
)
UPDATE core.attractions a
SET city = 'Madrid',
    neighborhood = COALESCE(a.neighborhood, i.original_city),
    state = COALESCE(a.state, 'Madrid'),
    city_correction_audit = jsonb_build_object(
      'original_city', i.original_city,
      'original_neighborhood', i.original_neighborhood,
      'corrected_city', 'Madrid',
      'confidence', 1.0,
      'source', 'city_boundaries_polygon:-5326784',
      'corrected_at', now(),
      'auto_corrected', true
    ),
    updated_at = now()
FROM inside i
WHERE a.id = i.id;

COMMIT;

-- Verification -- expected: 3.075 rows, 1 or 2 distinct cities (the border point may keep its
-- own), 271 at priority_level 1.
--   SELECT count(*) AS total,
--          count(DISTINCT a.city) AS distinct_cities,
--          count(*) FILTER (WHERE a.priority_level = 1) AS p1
--   FROM core.attractions a
--   JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
--   JOIN core.city_boundaries b ON b.osm_id = -5326784
--   WHERE ST_Intersects(ac.location_geography::geometry, b.geom);
