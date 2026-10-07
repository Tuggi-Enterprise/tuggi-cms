/**
 * POI migration pipeline: the homolog row is deleted only after the whole pipeline succeeded.
 *
 * Regression 2026-10-06 (146 concelhos of Portugal): MigrationService.migratePOI deleted the
 * homolog row right after copying to core. When Step 4 (trigger points) then failed, the
 * pipeline rolled core back and `updateProcessingStatus('failed')` wrote into a row that no
 * longer existed, so the POI vanished from both schemas (Horta, Vila do Porto, Santa Cruz da
 * Graciosa, Porto Santo). Operator decision, same day: delete from homolog at the end; on
 * failure keep the row as `failed`, with the error, and roll core back.
 *
 * The Supabase client is an in-memory fake holding homolog.pois, homolog.coordinates and the
 * core tables, so the assertions read the end state instead of the call sequence.
 *
 * Run with: npm run test:api
 */

import { before, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

type Row = Record<string, any>
const tables: Record<string, Row[]> = {}
/** `schema.table.op` → error message the fake returns for that write. */
let failures: Record<string, string> = {}

const t = (name: string): Row[] => (tables[name] ??= [])

/** Rows with attraction_id cascade when core.attractions goes, as the real FKs do. */
const CORE_CHILDREN = ['core.attraction_coordinate', 'core.attraction_trigger_points']

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: any
  let limit: number | undefined
  let returning = false

  const run = (): { data: any; error: any } => {
    const failure = op !== 'select' ? failures[`${table}.${op}`] : undefined
    if (failure) return { data: null, error: { message: failure, code: 'XX000' } }
    const rows = t(table)
    const match = (r: Row) => filters.every(f => f(r))
    if (op === 'insert') {
      const inserted = (Array.isArray(payload) ? payload : [payload]).map(r => ({ ...r }))
      rows.push(...inserted)
      return { data: returning ? inserted : null, error: null }
    }
    if (op === 'update') {
      const hit = rows.filter(match)
      hit.forEach(r => Object.assign(r, payload))
      return { data: returning ? hit : null, error: null }
    }
    if (op === 'delete') {
      const gone = rows.filter(match)
      tables[table] = rows.filter(r => !match(r))
      if (table === 'core.attractions') {
        const ids = new Set(gone.map(r => r.id))
        for (const child of CORE_CHILDREN) tables[child] = t(child).filter(r => !ids.has(r.attraction_id))
      }
      return { data: null, error: null }
    }
    const found = rows.filter(match)
    return { data: limit === undefined ? found : found.slice(0, limit), error: null }
  }

  const builder: any = {
    select: () => { returning = true; return builder },
    insert: (rows: any) => { op = 'insert'; payload = rows; return builder },
    update: (patch: Row) => { op = 'update'; payload = patch; return builder },
    delete: () => { op = 'delete'; return builder },
    eq: (col: string, v: any) => { filters.push(r => r[col] === v); return builder },
    in: (col: string, vs: any[]) => { filters.push(r => vs.includes(r[col])); return builder },
    is: (col: string, v: any) => { filters.push(r => (r[col] ?? null) === v); return builder },
    order: () => builder,
    limit: (n: number) => { limit = n; return builder },
    single: async () => {
      const { data, error } = run()
      if (error) return { data: null, error }
      const rows = Array.isArray(data) ? data : []
      return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `expected 1 row, got ${rows.length}` } }
    },
    maybeSingle: async () => {
      const { data, error } = run()
      if (error) return { data: null, error }
      return { data: Array.isArray(data) ? data[0] ?? null : null, error: null }
    },
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
      try { resolve(run()) } catch (e) { reject(e) }
    },
  }
  return builder
}

const fakeClient: any = {
  schema: (s: string) => ({ from: (name: string) => query(`${s}.${name}`), rpc: async () => ({ data: null, error: null }) }),
  from: (name: string) => query(`public.${name}`),
  rpc: async () => ({ data: null, error: null }),
}

const POI = '11111111-1111-1111-1111-111111111111'

function seedHomolog() {
  for (const k of Object.keys(tables)) delete tables[k]
  t('homolog.pois').push({
    uuid_id: POI, name: 'Horta', city: 'Horta', state: 'Açores', country: 'Portugal',
    osm_id: null, osm_type: null, processing_status: 'pending', migration_attempts: 0,
  })
  t('homolog.coordinates').push({ poi_uuid_id: POI, latitude: 38.5363, longitude: -28.6315 })
}

let PoiMigrationPipeline: any
let MigrationService: any
let originalTriggerPointsStep: any

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabase: () => fakeClient,
      getSupabaseService: () => fakeClient,
      getSupabaseClient: () => fakeClient,
      getSupabaseRouteHandler: () => fakeClient,
      getSupabaseServerComponent: () => fakeClient,
      SupabaseClientManager: { getInstance: () => ({ getClientComponent: () => fakeClient, getServiceClient: () => fakeClient }) },
    },
  })
  ;({ PoiMigrationPipeline } = await import('@/lib/services/poi-migration-pipeline'))
  ;({ MigrationService } = await import('@/lib/services/migration-service'))
  const { HomologEnrichmentService } = await import('@/lib/services/poi-processing/homolog-enrichment.service')
  HomologEnrichmentService.enrichPOI = async ({ uuid_id }) => ({ success: true, uuid_id, message: 'stub' })
  originalTriggerPointsStep = PoiMigrationPipeline.executeTriggerPointsStep
})

beforeEach(() => {
  seedHomolog()
  failures = {}
  PoiMigrationPipeline.executeTriggerPointsStep = originalTriggerPointsStep
})

/** Step 4 stand-in: saves one confident TP, or fails like the island concelhos did. */
function stubTriggerPoints(outcome: 'ok' | 'fail') {
  PoiMigrationPipeline.executeTriggerPointsStep = async (attraction_id: string) => {
    if (outcome === 'fail') {
      return { step: 'trigger_points', success: false, error: 'No trigger points generated', processing_time: 0 }
    }
    t('core.attraction_trigger_points').push({ id: 'tp-1', attraction_id, confidence_score: 0.9, is_active: true })
    return { step: 'trigger_points', success: true, data: { trigger_points_saved: 1 }, processing_time: 0 }
  }
}

const homologRow = () => t('homolog.pois').find(r => r.uuid_id === POI)
const coreRow = () => t('core.attractions').find(r => r.id === POI)

describe('POI migration: homolog row is deleted only at the end of a successful pipeline', () => {
  it('migratePOI copies to core and leaves the homolog row in place', async () => {
    const result = await MigrationService.migratePOI(POI)
    assert.equal(result.success, true, result.error)
    assert.ok(coreRow(), 'core.attractions must have the POI')
    assert.ok(homologRow(), 'homolog.pois must still have the POI')
    assert.equal(t('homolog.coordinates').length, 1)
  })

  it('success: POI approved in core, homolog row and coordinates deleted at the end', async () => {
    stubTriggerPoints('ok')
    const result = await PoiMigrationPipeline.executePipeline(POI)
    assert.equal(result.success, true, result.error)
    assert.equal(coreRow()?.approved, true)
    assert.equal(homologRow(), undefined)
    assert.equal(t('homolog.coordinates').length, 0)
    const names = result.steps.map((s: any) => s.step)
    assert.equal(names[names.length - 1], 'delete_from_homolog', `steps: ${names.join(' → ')}`)
    assert.ok(names.indexOf('trigger_points') < names.indexOf('delete_from_homolog'))
  })

  it('Step 4 failure: homolog row kept as failed with the error, core rolled back', async () => {
    stubTriggerPoints('fail')
    const result = await PoiMigrationPipeline.executePipeline(POI)
    assert.equal(result.success, false)
    assert.equal(coreRow(), undefined, 'core must not keep a half-migrated POI')
    assert.equal(t('core.attraction_coordinate').length, 0)
    const row = homologRow()
    assert.ok(row, 'homolog row must survive the failure')
    assert.equal(row.processing_status, 'failed')
    assert.match(row.migration_error, /No trigger points generated/)
    assert.equal(row.migration_attempts, 1)
    assert.equal(t('homolog.coordinates').length, 1)
  })

  it('copy failure (core coordinate insert): homolog row kept as failed, core without the POI', async () => {
    failures['core.attraction_coordinate.insert'] = 'boom'
    stubTriggerPoints('ok')
    const result = await PoiMigrationPipeline.executePipeline(POI)
    assert.equal(result.success, false)
    assert.equal(coreRow(), undefined)
    const row = homologRow()
    assert.ok(row)
    assert.equal(row.processing_status, 'failed')
    assert.match(row.migration_error, /boom/)
  })

  it('a failed POI reprocesses cleanly: second run migrates and then deletes the homolog row', async () => {
    stubTriggerPoints('fail')
    await PoiMigrationPipeline.executePipeline(POI)
    assert.equal(homologRow()?.processing_status, 'failed')

    stubTriggerPoints('ok')
    const retry = await PoiMigrationPipeline.executePipeline(POI)
    assert.equal(retry.success, true, retry.error)
    assert.equal(coreRow()?.approved, true)
    assert.equal(t('core.attractions').length, 1, 'no leftover from the first attempt')
    assert.equal(homologRow(), undefined)
  })

  it('migration_only also deletes the homolog row only after the copy succeeded', async () => {
    const result = await PoiMigrationPipeline.executePipeline(POI, { mode: 'migration_only' })
    assert.equal(result.success, true, result.error)
    assert.ok(coreRow())
    assert.equal(homologRow(), undefined)
  })
})
