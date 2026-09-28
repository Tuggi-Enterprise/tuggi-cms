// #781 — SSOT of the TP engine: one list of trigger-point types (mirror of the DB CHECK)
// and one building-height ruler (INV-E3).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TRIGGER_POINT_DB_TYPES } from '../../lib/services/trigger-points-google/types/interfaces'
import {
  BUILDING_LEVEL_HEIGHT_M, heightFromTags, LANDMARK_MIN_PROMINENCE_M, SANITY_MAX_TP_DISTANCE_M, VisibilityClass, maxEdgeDistanceFor,
} from '../../lib/services/trigger-points-google/config/visibility-class'
import { OSMDataFetcher } from '../../lib/services/trigger-points-google/services/osm-data-fetcher'

const MIGRATIONS = join(process.cwd(), 'supabase/migrations')

/** Values of the last `ADD CONSTRAINT attraction_trigger_points_type_check CHECK (type IN (...))` in the repo. */
function typesInLatestCheck(): string[] {
  let last: string | null = null
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    const re = /ADD\s+CONSTRAINT\s+attraction_trigger_points_type_check\s+CHECK\s*\(\s*type\s+IN\s*\(([^)]*)\)/gi
    for (const m of sql.matchAll(re)) last = m[1]
  }
  assert.ok(last, 'attraction_trigger_points_type_check not found in supabase/migrations')
  return [...last.matchAll(/'([^']+)'/g)].map(m => m[1])
}

describe('#781 TP engine SSOT', () => {
  it('TRIGGER_POINT_DB_TYPES matches the CHECK of core.attraction_trigger_points.type', () => {
    assert.deepEqual([...TRIGGER_POINT_DB_TYPES].sort(), typesInLatestCheck().sort())
  })

  it('INV-E3: OSMDataFetcher measures building height with heightFromTags, not its own floor ruler', () => {
    const fetcher = new OSMDataFetcher() as unknown as { extractBuildingHeight(tags: unknown): number }
    for (const tags of [{ height: '12 m' }, { 'building:height': '9' }, { 'building:levels': '4' }]) {
      assert.equal(fetcher.extractBuildingHeight(tags), heightFromTags(tags)!.heightM)
    }
    assert.equal(fetcher.extractBuildingHeight({ 'building:levels': '4' }), 4 * BUILDING_LEVEL_HEIGHT_M)
  })

  it('#777: one "elevated terrain" threshold — LANDMARK_MIN_PROMINENCE_M decides, no literal elsewhere in the engine', () => {
    const T = LANDMARK_MIN_PROMINENCE_M
    assert.equal(maxEdgeDistanceFor(VisibilityClass.LANDMARK_HIGH, T), SANITY_MAX_TP_DISTANCE_M)
    assert.notEqual(maxEdgeDistanceFor(VisibilityClass.LANDMARK_HIGH, T - 1), SANITY_MAX_TP_DISTANCE_M)
    const engine = join(process.cwd(), 'lib/services/trigger-points-google')
    const literal = /(elevationDiff|[pP]rominence\w*|aboveNeighborhood|finalDiff)\s*[<>]=?\s*\d{2,}|isElevated/
    for (const file of readdirSync(engine, { recursive: true }) as string[]) {
      if (!file.endsWith('.ts')) continue
      assert.doesNotMatch(readFileSync(join(engine, file), 'utf8'), literal, file)
    }
  })
})
