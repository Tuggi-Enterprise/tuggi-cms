-- Barcelona: collapse district/neighborhood values in attractions.city into the municipality.
--
-- Nominatim reverse geocoding returned `suburb`/`quarter` for Barcelona, so 2.048 POIs inside the
-- municipal boundary carry a district or neighborhood in `city` ("Fort Pienc", "Barri Gòtic",
-- "el Baix Guinardó") instead of "Barcelona". Any CMS filter, count or event-to-venue join keyed
-- on the city string is wrong for those rows, and the Open Data BCN agenda ships
-- addresses_town = "Barcelona", so imported events would never match their host POI.
--
-- The authority here is the OSM municipal polygon (core.city_boundaries osm_id -347950,
-- admin_level 8), not a geocoding API. Verified before writing: all 2.796 POIs inside it are
-- inside NO other admin_level 8 boundary, so there is no border ambiguity to resolve.
--
-- The previous value is not discarded: it moves to `neighborhood` when that column is empty, and
-- the audit trail in `city_correction_audit` makes the change reversible row by row. The audit
-- shape mirrors lib/services/poi-processing/city-correction.service.ts so both writers agree.
--
-- Rollback:
--   UPDATE core.attractions SET city = city_correction_audit ->> 'original_city',
--                               neighborhood = NULLIF(city_correction_audit ->> 'original_neighborhood', ''),
--                               city_correction_audit = NULL
--   WHERE city_correction_audit ->> 'source' = 'city_boundaries_polygon:-347950';

BEGIN;

WITH inside AS (
  SELECT a.id, a.city AS original_city, a.neighborhood AS original_neighborhood
  FROM core.attractions a
  JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  JOIN core.city_boundaries b ON b.osm_id = -347950
  WHERE ST_Intersects(ac.location_geography::geometry, b.geom)
    AND a.city IS DISTINCT FROM 'Barcelona'
)
UPDATE core.attractions a
SET city = 'Barcelona',
    -- keep the district/neighborhood we are about to overwrite, unless one is already recorded
    neighborhood = COALESCE(a.neighborhood, i.original_city),
    state = COALESCE(a.state, 'Catalunya'),
    city_correction_audit = jsonb_build_object(
      'original_city', i.original_city,
      'original_neighborhood', i.original_neighborhood,
      'corrected_city', 'Barcelona',
      'confidence', 1.0,
      'source', 'city_boundaries_polygon:-347950',
      'corrected_at', now(),
      'auto_corrected', true
    ),
    updated_at = now()
FROM inside i
WHERE a.id = i.id;

COMMIT;

-- Verification — expected: 2.796 rows, 1 distinct city ("Barcelona"), 273 at priority_level 1.
--   SELECT count(*) AS total,
--          count(DISTINCT a.city) AS distinct_cities,
--          count(*) FILTER (WHERE a.priority_level = 1) AS p1
--   FROM core.attractions a
--   JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
--   JOIN core.city_boundaries b ON b.osm_id = -347950
--   WHERE ST_Intersects(ac.location_geography::geometry, b.geom);
