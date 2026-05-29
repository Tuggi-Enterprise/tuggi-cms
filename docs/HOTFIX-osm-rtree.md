# Hotfix: R-tree spatial indexes on `local_osm.db`

This is the second of two hotfixes for the local OSM database. The first one
([HOTFIX-osm-id-index.md](HOTFIX-osm-id-index.md)) fixed lookup-by-OSM-ID; this
one fixes lookup-by-bbox. They are independent — you can apply either order, or
just one.

## What was slow

`LocalOSMFetcher.queryStreets` and `queryBuildings` both run a 4-D bbox query:

```sql
WHERE min_lat <= ? AND max_lat >= ?
  AND min_lng <= ? AND max_lng >= ?
```

The legacy b-tree index `idx_buildings_bbox(min_lat, max_lat, min_lng, max_lng)`
can only use its leading column (`min_lat <= ?`) as a true range index. SQLite
then has to evaluate the other three predicates row-by-row across every
candidate matched on `min_lat`. On the 19 M `buildings` table this means
scanning hundreds of thousands of rows even for a 150 m bbox.

Measured on a 21 GB `local_osm.db`:

| Query (150 m bbox) | Rows returned | b-tree time | R-tree time |
|--------------------|--------------:|------------:|------------:|
| `queryStreets`     |  100          |       3.6 s |     <10 ms  |
| `queryBuildings`   |   65          |      15.5 s |     <10 ms  |

`fetchAsOverpassData` calls these three times per POI during Trigger Point
generation, so the b-tree path ends up costing ~30–50 s per POI.

## What changed in code

| File | Change |
|------|--------|
| [`scripts/hotfix-osm-rtree-index.ts`](../scripts/hotfix-osm-rtree-index.ts) | Portable, idempotent script that creates the three R-tree virtual tables (`pois_rtree`, `streets_rtree`, `buildings_rtree`). |
| [`lib/services/trigger-points-google/services/local-osm-fetcher.ts`](../lib/services/trigger-points-google/services/local-osm-fetcher.ts) | At startup, probes for each `*_rtree` table. `queryStreets` / `queryBuildings` then `JOIN` through the R-tree when present and fall back to the b-tree path when not — so machines without the hotfix keep working unchanged. |

The PBF importer is unaffected — the R-tree is built once from the existing
`min_lat`/`max_lat`/`min_lng`/`max_lng` columns and stays in sync naturally
because those columns are already populated correctly on every import.

## What every machine running the migration pipeline must do

```bash
git pull

# Optional: confirm what's present and what would be built.
npx tsx scripts/hotfix-osm-rtree-index.ts --dry-run

# Apply. Idempotent — partial state from a previous interrupted run is
# detected and rebuilt automatically. Safe to re-run.
# Takes ~25–50 min total (most of it on `buildings`, ~19 M rows).
npx tsx scripts/hotfix-osm-rtree-index.ts
```

Flags:

- `--db <path>` — point at a non-default `local_osm.db`
- `--dry-run` — inspect counts and existing R-tree state, do nothing
- `--only pois|streets|buildings` — build a single one (e.g. `--only buildings`
  to do the slow one first)
- `--help`

The script:

1. Verifies the SQLite build has the R-tree module compiled in (it does, in
   `better-sqlite3`; the probe is defensive)
2. Reports source-table row count vs. R-tree row count for each table
3. Skips R-trees that are already complete; drops + rebuilds any that are
   partial; creates from scratch any that are missing
4. Runs a smoke test for each table: runs the same bbox query against both the
   b-tree and the R-tree paths, prints both times and the speedup, and asserts
   the row counts match

### Validating the hotfix worked

The smoke test should print something like:

```
🔬 Smoke test (bbox 150m around 34.184, -118.581 — Animal Science)
   pois      :   42ms (b-tree) → 1ms (R-tree)  ✅ 42× faster, 2 rows
   streets   : 3654ms (b-tree) → 1ms (R-tree)  ✅ 3654× faster, 100 rows
   buildings :15498ms (b-tree) → 4ms (R-tree)  ✅ 3874× faster, 65 rows
```

For a real end-to-end check, run a small batch and look at the per-POI step
breakdown — the "Overpass-compatible response" lines should be sub-second:

```bash
npx tsx scripts/migrate-pois-batch.ts --state California --limit 5
```

## When this hotfix becomes unnecessary

R-tree is the canonical SQLite way to do spatial bbox queries; it stays
relevant regardless of how the source tables are populated. No reason to drop
it later. If you ever rebuild `local_osm.db` from scratch the script can be
re-run on the new DB and is idempotent.
