/**
 * BR-POI-010 (operator, 2026-10-06): a municipal POI's border (`osm_admin`) leaves the database
 * right after its TPs are saved. Stored, it makes the app play the city audio to whoever is inside
 * the concelho, every 10 minutes. It still has to be there WHILE the TPs are inserted:
 * `core.tg_reject_tp_beyond_distance_cap` measures each TP to the stored border, and a large
 * concelho has TPs past 15 km from the pin. Order: border → TPs → clear.
 *
 * The next run, with no stored border, re-detects it from the seat (`municipalityBoundary`).
 *
 * Run with: npm run test:api
 */

import { before, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

type LatLng = { lat: number; lng: number }

/** Calls the pipeline makes, in order: the border write, the TP save, the border clear. */
let log: string[] = []
let coordinateRow: Record<string, any> = {}
let storedGeojson: unknown = null
let clearFails = false

const fakeClient: any = {
  schema: () => ({
    rpc: async (name: string) => {
      if (name === 'update_boundary_geometry') { log.push('write_border'); return { data: null, error: null } }
      if (name === 'get_boundary_geometry') return { data: storedGeojson, error: null }
      return { data: null, error: null }
    },
    from: () => ({
      update: (patch: Record<string, any>) => ({
        eq: async () => {
          if (clearFails) return { error: { message: 'boom' } }
          log.push('clear_border')
          Object.assign(coordinateRow, patch)
          return { error: null }
        },
      }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: coordinateRow, error: null }) }) }),
    }),
  }),
}

const PIN: LatLng = { lat: 41.8, lng: -7.8 }
const square = (halfDeg: number): LatLng[] => [
  { lat: PIN.lat - halfDeg, lng: PIN.lng - halfDeg }, { lat: PIN.lat - halfDeg, lng: PIN.lng + halfDeg },
  { lat: PIN.lat + halfDeg, lng: PIN.lng + halfDeg }, { lat: PIN.lat + halfDeg, lng: PIN.lng - halfDeg },
]
const MUNICIPAL = { source: 'osm_admin', type: 'polygon', coordinates: square(0.1), adminParts: [square(0.1)], curated: false }
const tp = (lat: number, lng: number) => ({ id: 't1', location: { lat, lng }, radius: 150, type: 'entry', confidence: 0.9, generationMethod: 'admin_border' })

let Pipeline: any
let saving: any
let predictor: any
let BoundaryDetector: any
let saveOutcome: 'ok' | 'fail' = 'ok'
let prediction: any

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
  ;({ PoiMigrationPipeline: Pipeline } = await import('@/lib/services/poi-migration-pipeline'))
  const { MigrationService } = await import('@/lib/services/migration-service')
  MigrationService.loadPOIWithCoordinates = async (id: string) => ({
    success: true,
    data: { poi: { id, name: 'Montalegre', city: 'Montalegre', osm_id: 1, osm_type: 'node' }, coordinate: { latitude: PIN.lat, longitude: PIN.lng } },
  })
  ;({ TriggerPointSavingService: saving } = await import('@/lib/services/trigger-point-saving'))
  saving.saveTriggerPoints = async (_id: string, rows: any[]) => {
    log.push('save_tps')
    return saveOutcome === 'ok' ? { saved: rows.length, skipped: 0, errors: [] } : { saved: 0, skipped: 0, errors: ['cap trigger refused'] }
  }
  ;({ CoreTriggerPointPredictor: predictor } = await import('@/lib/services/trigger-points-google/core/trigger-point-predictor'))
  predictor.prototype.predictTriggerPointsComplete = async () => prediction
  ;({ BoundaryDetector } = await import('@/lib/services/trigger-points-google/core/boundary-detector'))
})

beforeEach(() => {
  log = []
  coordinateRow = { boundary_source: 'osm_admin', boundary_geometry: 'wkb', latitude: PIN.lat, longitude: PIN.lng }
  storedGeojson = null
  clearFails = false
  saveOutcome = 'ok'
})

describe('BR-POI-010 — the municipal border is cleared after its TPs are saved', () => {
  it('osm_admin: border written, TPs saved, then every boundary_* column cleared — in that order', async () => {
    prediction = { triggerPoints: [tp(PIN.lat + 0.05, PIN.lng)], boundary: MUNICIPAL }
    const r = await Pipeline.executeTriggerPointsStep('a1')
    assert.equal(r.success, true, r.error)
    assert.deepEqual(log, ['write_border', 'save_tps', 'clear_border'])
    assert.equal(coordinateRow.boundary_geometry, null)
    assert.equal(coordinateRow.boundary_source, null)
    assert.equal(coordinateRow.latitude, PIN.lat, 'the pin stays')
    assert.equal(r.data.boundary_cleared, true)
  })

  it('a stored osm_admin border (curated, not rewritten) is cleared too after the TPs', async () => {
    prediction = { triggerPoints: [tp(PIN.lat + 0.05, PIN.lng)], boundary: { ...MUNICIPAL, curated: true } }
    const r = await Pipeline.executeTriggerPointsStep('a1')
    assert.equal(r.success, true, r.error)
    assert.deepEqual(log, ['save_tps', 'clear_border'])
  })

  it('any other border source is kept', async () => {
    const normal = { source: 'osm_way', type: 'polygon', coordinates: square(0.0005), curated: false }
    prediction = { triggerPoints: [{ ...tp(PIN.lat + 0.0015, PIN.lng), generationMethod: 'local_osm' }], boundary: normal }
    const r = await Pipeline.executeTriggerPointsStep('a1')
    assert.equal(r.success, true, r.error)
    assert.deepEqual(log, ['write_border', 'save_tps'])
    assert.equal(coordinateRow.boundary_source, 'osm_admin', 'row untouched')
    assert.equal(r.data.boundary_cleared, undefined)
  })

  it('TP save fails: the border is not cleared', async () => {
    saveOutcome = 'fail'
    prediction = { triggerPoints: [tp(PIN.lat + 0.05, PIN.lng)], boundary: MUNICIPAL }
    const r = await Pipeline.executeTriggerPointsStep('a1')
    assert.equal(r.success, false)
    assert.deepEqual(log, ['write_border', 'save_tps'])
    assert.equal(coordinateRow.boundary_geometry, 'wkb')
  })

  it('clear fails: the step still succeeds (TPs kept) and the error is traced', async () => {
    clearFails = true
    prediction = { triggerPoints: [tp(PIN.lat + 0.05, PIN.lng)], boundary: MUNICIPAL }
    const r = await Pipeline.executeTriggerPointsStep('a1')
    assert.equal(r.success, true, r.error)
    assert.equal(r.data.boundary_cleared, false)
    assert.equal(r.data.boundary_clear_error, 'boom')
  })
})

describe('BR-POI-010 — with no stored border, the engine re-detects the municipality from the seat', () => {
  const SEAT = { ...MUNICIPAL, id: 'r1' }
  let original: any
  before(() => { original = BoundaryDetector.prototype.municipalityBoundary })
  beforeEach(() => { BoundaryDetector.prototype.municipalityBoundary = async () => SEAT })
  const restore = () => { BoundaryDetector.prototype.municipalityBoundary = original }
  const poi = { id: 'a1', name: 'Montalegre', location: PIN, osm_type: 'node', osm_id: 1, type: 'point_of_interest' }

  it('adminBoundaryOf: nothing stored → the seat border', async () => {
    coordinateRow = { boundary_source: null, latitude: PIN.lat, longitude: PIN.lng }
    assert.equal(await new BoundaryDetector().adminBoundaryOf(poi), SEAT)
  })

  it('detectBoundary: nothing stored → the seat border, not curated, so the pipeline writes it again', async () => {
    coordinateRow = { boundary_source: null, latitude: PIN.lat, longitude: PIN.lng }
    const r = await new BoundaryDetector().detectBoundary(poi)
    restore()
    assert.equal(r.success, true)
    assert.equal(r.data, SEAT)
    assert.equal(r.data.curated, false)
  })
})
