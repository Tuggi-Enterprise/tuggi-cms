# Hotfix: OSM @id expression indexes on `local_osm.db`

## What was broken

The PBF importer (`osm-local-data-service.ts`) read OSM `@id` / `@type` from the
wrong place — `feature['@id']` at the top level instead of
`feature.properties['@id']` where `osmium export --format=geojsonseq` actually
puts it.

Result on every existing `data/local_osm.db`:

- 100% of `pois.osm_type` rows are `'unknown'`
- `pois.osm_id` is a random hash (e.g. `hbr7ca6pq`), not the real OSM ID
- The native index `idx_pois_osm(osm_type, osm_id)` is unusable for lookups
- `LocalOSMFetcher.fetchElementById` falls back to
  `tags_json LIKE '%"@id":N%'` — a full-table scan
- On Trigger Point generation (Step 4 of the migration pipeline) this
  manifested as **100–300 s per POI** (300 s when the fallback also had to
  scan `streets` and `buildings` — 19 M rows).

## What changed in code

| File | Change |
|------|--------|
| [`lib/services/osm-local-data-service.ts`](../lib/services/osm-local-data-service.ts) | Importer reads `@id` / `@type` from `feature.properties` (with top-level fallback). Features without a real OSM id are skipped instead of getting a random hash. **Affects future imports only.** |
| [`lib/services/trigger-points-google/services/local-osm-fetcher.ts`](../lib/services/trigger-points-google/services/local-osm-fetcher.ts) | Strategy 2 now uses `json_extract(tags_json, '$."@id"') = ?` instead of `LIKE`. With the expression indexes created below, the query is O(log N) instead of full scan. |
| [`scripts/hotfix-osm-id-index.ts`](../scripts/hotfix-osm-id-index.ts) | Portable, idempotent script that adds three expression indexes to an existing `local_osm.db`. |

## What every machine running the migration pipeline must do

**Fresh PBF imports**: `scripts/manage-osm.ts --import-pbf <file>` runs this
hotfix automatically at the end of the import, alongside the R-tree and
GeoNames hotfixes. Nothing manual to do.

**Existing DBs built before this commit**, run once manually:

```bash
git pull

# Optional: confirm the bug is present and the hotfix is needed.
npx tsx scripts/hotfix-osm-id-index.ts --dry-run

# Apply. Creates 3 expression indexes + ANALYZE. Idempotent — safe to re-run.
# Takes ~30–40 min total (most of it on `buildings`, ~19 M rows).
npx tsx scripts/hotfix-osm-id-index.ts
```

The script:

1. Reports DB size and row counts for `pois` / `streets` / `buildings`
2. Detects whether the DB is in the broken state (samples one row)
3. Creates `idx_pois_realosmid`, `idx_streets_realosmid`,
   `idx_buildings_realosmid` over `json_extract(tags_json, '$."@id"')`
4. Runs `ANALYZE` so the query planner picks the new indexes
5. Runs a smoke test (`EXPLAIN QUERY PLAN` + a timed lookup)

Flags: `--db <path>`, `--dry-run`, `--skip-analyze`, `--help`.

### Validating the hotfix worked

After the script finishes, the smoke test should print something like:

```
🔬 Smoke test
   pois @id=167008935: 1ms  (✅ index used)
```

For a real end-to-end check, run a small batch and compare Step 4 timings
against the per-POI log lines:

```bash
npx tsx scripts/migrate-pois-batch.ts --state California --limit 5
```

Step 4 (Trigger Points) should now take **single-digit seconds per POI**
instead of 100–300 s.

## When this hotfix becomes unnecessary

Once a PBF is re-imported with the corrected `osm-local-data-service.ts`, the
`osm_id` / `osm_type` columns will contain real OSM IDs and the native
`idx_pois_osm` index will work. At that point the three `*_realosmid` indexes
are redundant and can be dropped:

```sql
DROP INDEX IF EXISTS idx_pois_realosmid;
DROP INDEX IF EXISTS idx_streets_realosmid;
DROP INDEX IF EXISTS idx_buildings_realosmid;
```

Keeping them around is harmless (they just take disk space), so dropping is
optional.
