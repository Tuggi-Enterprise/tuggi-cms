# Hotfix: GeoNames offline reverse-geocoder

Third hotfix in the local-OSM-DB series, after
[HOTFIX-osm-id-index.md](HOTFIX-osm-id-index.md) and
[HOTFIX-osm-rtree.md](HOTFIX-osm-rtree.md). Independent — apply any order, or
just this one.

## What was slow / failing

The homolog enrichment service (`HomologEnrichmentService.enrichPOI`) called
Nominatim public for every POI to fill `city` / `state` / `country`. Public
Nominatim enforces a hard **1 req/sec per IP** TOS limit. Once the batch
driver was parallelized (concurrency > 1, or multiple processes), the
pipeline started getting HTTP 429 back from Nominatim and POIs failed
enrichment.

## What this hotfix does

Adds an **offline reverse geocoder** backed by the [GeoNames `cities500`
dataset](https://download.geonames.org/export/dump/) (~25 MB, CC-BY 4.0,
~233k cities worldwide with population > 500), plus the admin1 and country
code tables. Imports them into `local_osm.db` and builds an R-tree spatial
index over the cities.

`HomologEnrichmentService` then resolves city/state/country in three local
stages **before** touching any external API:

1. **`addr:*` tags on the POI itself** (cheapest, exact when present). Reads
   `addr:city`, `addr:state`, `addr:country` straight from the POI's
   `tags_json` in the local OSM DB. About 3 % of POIs ship with these.
2. **GeoNames nearest-city lookup** by `lat`/`lng`. R-tree-bounded to the
   nearest 100 km, then haversine to pick the truly nearest city. Joined
   with `geonames_admin1` and `geonames_countries` for canonical state and
   country names.
3. **Merged**: when tags only give part of the answer (e.g. tag has city but
   no state), GeoNames fills in the rest.

Only when **all three** local stages return null (oceans, true wilderness,
GeoNames not imported on this machine) does it fall back to the existing
Nominatim → Photon chain.

Measured: Horseshoe Meadow (the rural California natural feature that
triggered the 429 investigation) now resolves to "Lone Pine, California,
United States" in **0 ms** — no external call, no rate limit.

## What changed in code

| File | Change |
|------|--------|
| [`scripts/hotfix-geonames-import.ts`](../scripts/hotfix-geonames-import.ts) | One-off downloader + importer. Idempotent. Adds three tables (`geonames_cities`, `geonames_admin1`, `geonames_countries`) + one R-tree (`geonames_cities_rtree`) to `local_osm.db`. ~30 MB on disk, ~15 s to run. |
| [`lib/services/local-reverse-geocoder.ts`](../lib/services/local-reverse-geocoder.ts) | New singleton `LocalReverseGeocoder` with `extractFromTags`, `reverseGeocodeFromGeoNames`, and combined `reverseGeocode` (does both). Auto-detects whether GeoNames is imported; falls back gracefully to tags-only on machines without the hotfix. |
| [`lib/services/poi-processing/homolog-enrichment.service.ts`](../lib/services/poi-processing/homolog-enrichment.service.ts) | New Stage 0 (`tryLocalReverseGeocode`) runs before Nominatim. Existing chain unchanged. `EnrichmentMethod` type widened: `local_osm_tags` / `geonames_offline` / `local_mixed` join the existing `osm_lookup` / `reverse_geocoding`. |

## What every machine must do

```bash
git pull

# Optional: see what's already in the DB
npx tsx scripts/hotfix-geonames-import.ts --dry-run

# Apply (~15 s — downloads ~25 MB and imports 233k cities + admin tables)
npx tsx scripts/hotfix-geonames-import.ts
```

Requires `curl` and `unzip` on PATH (standard on macOS and Linux).

Flags: `--db <path>`, `--dry-run`, `--keep-temp`, `--help`.

The script:

1. Verifies `curl` and `unzip` are available
2. Reports counts of `geonames_cities` / `geonames_admin1` / `geonames_countries` already present
3. For each table that's empty: downloads the source file from GeoNames,
   parses the TSV, inserts rows. INSERT OR REPLACE keeps it idempotent.
4. Runs `ANALYZE` on the three tables
5. Smoke-tests three coordinates: San Francisco, São Paulo, and Horseshoe
   Meadow (the rural-CA test case). Prints the resolved city + distance.

### Validating the hotfix worked

Right after the import:

```
🌍 [LocalReverseGeocoder] GeoNames offline reverse-geocoder ready
```

On the next `migrate-pois-batch` run, the per-POI enrichment log changes
from this:

```
🔍 Trying OSM ID lookup: way814459335
⚠️ OSM ID lookup failed, falling back to reverse geocoding
📍 Using reverse geocoding (no /lookup result) for: 36.4486, -118.1736
```

to this:

```
🌍 Local reverse geocode (geonames): Lone Pine, California, United States (20.1 km from POI)
```

No external HTTP, no 429s.

## Attribution

GeoNames data is licensed under **CC-BY 4.0**
([creativecommons.org/licenses/by/4.0](https://creativecommons.org/licenses/by/4.0/)).
Any user-facing surface (the CMS dashboards, the mobile app, public docs)
that displays this data must credit:

> "GeoNames (geonames.org)"

This is one short line in a footer or about page. The dataset itself is
free to use, modify, and redistribute under the license terms.

## Trade-offs vs Nominatim

| Field | GeoNames | Nominatim |
|---|---|---|
| `city` | ✅ nearest city >500 pop | ✅ exact admin assignment |
| `state` / `admin1` | ✅ via admin1 table | ✅ |
| `country` | ✅ via country table | ✅ |
| `postcode` | ❌ not in cities500 | ✅ |
| `street_name` / `road` | ❌ | ✅ |
| `house_number` | ❌ | ✅ |
| `neighborhood` / `suburb` | ❌ | ✅ |
| Rate limit | ✅ none | 1 req/sec public, self-host for none |
| Latency | < 1 ms (R-tree) | ~500 ms – 1.5 s |

For the migration pipeline's `city` / `state` / `country` enrichment goals,
GeoNames is sufficient on its own. For POIs that need richer fields
(`postcode`, `street_name`), the existing Nominatim chain still runs as a
fallback when local fields are missing — so nothing regresses.

For rural points without a city within 100 km, `LocalReverseGeocoder`
returns `null` and the existing fallback kicks in.
