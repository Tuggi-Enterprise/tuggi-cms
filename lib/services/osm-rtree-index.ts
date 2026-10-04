/**
 * R-tree spatial index of a local OSM region database (`scripts/hotfix-osm-rtree-index.ts`).
 *
 * The R-tree maps a source rowid to its bbox. `OSMLocalDataService#importGeoJSONSeq` writes
 * with `INSERT OR REPLACE`, which deletes the old row and inserts it under a NEW rowid: a
 * re-import over the same area keeps the row count and leaves the R-tree pointing at rows that
 * no longer exist, so streets vanish without an error (L9, #833). Current = same count AND same
 * highest rowid; anything else is rebuilt.
 */
import type Database from 'better-sqlite3'

export type OsmTable = 'pois' | 'streets' | 'buildings'

export interface RtreeState {
  srcCount: number
  srcMaxRowid: number | null
  /** null when the R-tree table does not exist */
  rtCount: number | null
  rtMaxRowid: number | null
}

export function rtreeName(table: OsmTable): string {
  return `${table}_rtree`
}

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name))
}

export function rtreeState(db: Database.Database, table: OsmTable): RtreeState {
  const rtree = rtreeName(table)
  const src = db.prepare(`SELECT COUNT(*) AS c, MAX(rowid) AS m FROM ${table}`).get() as { c: number; m: number | null }
  if (!tableExists(db, rtree)) return { srcCount: src.c, srcMaxRowid: src.m, rtCount: null, rtMaxRowid: null }
  const rtCount = (db.prepare(`SELECT COUNT(*) AS c FROM ${rtree}`).get() as { c: number }).c
  // `<rtree>_rowid` is the R-tree's own rowid table: MAX there is an index seek, not a scan.
  const maxFrom = tableExists(db, `${rtree}_rowid`) ? `${rtree}_rowid` : rtree
  const rtMax = (db.prepare(`SELECT MAX(rowid) AS m FROM ${maxFrom}`).get() as { m: number | null }).m
  return { srcCount: src.c, srcMaxRowid: src.m, rtCount, rtMaxRowid: rtMax }
}

export function rtreeIsCurrent(s: RtreeState): boolean {
  return s.srcCount > 0 && s.rtCount === s.srcCount && s.rtMaxRowid === s.srcMaxRowid
}

/** Drops and rebuilds the R-tree of `table` from its bbox columns; returns the rows indexed. */
export function rebuildRtree(db: Database.Database, table: OsmTable): number {
  const rtree = rtreeName(table)
  db.transaction(() => {
    db.exec(`DROP TABLE IF EXISTS ${rtree}`)
    db.exec(`CREATE VIRTUAL TABLE ${rtree} USING rtree(rowid, min_lat, max_lat, min_lng, max_lng)`)
    // Single INSERT under a transaction — far faster than batched INSERTs for R-tree.
    db.exec(`
      INSERT INTO ${rtree} (rowid, min_lat, max_lat, min_lng, max_lng)
      SELECT rowid, min_lat, max_lat, min_lng, max_lng
      FROM ${table}
      WHERE min_lat IS NOT NULL AND max_lat IS NOT NULL
        AND min_lng IS NOT NULL AND max_lng IS NOT NULL
    `)
  })()
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${rtree}`).get() as { c: number }).c
}
