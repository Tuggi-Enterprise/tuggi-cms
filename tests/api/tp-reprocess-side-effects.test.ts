import { before, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'

// Auditoria do motor de TP, 2026-09-27, fatia A, item 5: reprocessar TP não aprova POI
// e não carimba `access: 'both'`. Cliente Supabase falso grava o que seria escrito.
const writes: Array<{ op: string; args: unknown[] }> = []

function fakeClient(): any {
  const handler: ProxyHandler<any> = {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve({ data: null, error: null, count: 0 })
      return (...args: unknown[]) => {
        if (prop === 'update' || prop === 'insert' || prop === 'upsert' || prop === 'rpc' || prop === 'delete') {
          writes.push({ op: String(prop), args })
        }
        return new Proxy({}, handler)
      }
    },
  }
  return new Proxy({}, handler)
}

let PoiMigrationPipeline: any
let MigrationService: any
let TriggerPointSavingService: any
let CoreTriggerPointPredictor: any

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabase: () => fakeClient(),
      getSupabaseService: () => fakeClient(),
      getSupabaseClient: () => fakeClient(),
      getSupabaseRouteHandler: () => fakeClient(),
      getSupabaseServerComponent: () => fakeClient(),
      SupabaseClientManager: { getInstance: () => ({ getClientComponent: fakeClient, getServiceClient: fakeClient }) },
    },
  })
  ;({ PoiMigrationPipeline } = await import('@/lib/services/poi-migration-pipeline'))
  ;({ MigrationService } = await import('@/lib/services/migration-service'))
  ;({ TriggerPointSavingService } = await import('@/lib/services/trigger-point-saving'))
  ;({ CoreTriggerPointPredictor } = await import('@/lib/services/trigger-points-google/core/trigger-point-predictor'))
})

const PIN = { lat: -22.903, lng: -43.174 }

function stubEngine(saved: unknown[][]) {
  MigrationService.loadPOIWithCoordinates = async () => ({
    success: true,
    data: { poi: { id: 'poi-1', name: 'Paço Imperial', city: 'Rio de Janeiro', state: 'RJ' }, coordinate: { latitude: PIN.lat, longitude: PIN.lng } },
  })
  CoreTriggerPointPredictor.prototype.predictTriggerPointsComplete = async () => ({
    triggerPoints: [
      { location: { lat: PIN.lat + 0.0002, lng: PIN.lng }, radius: 30, type: 'primary', confidence: 0.9, generationMethod: 'visibility_fan' },
      { location: { lat: PIN.lat + 0.02, lng: PIN.lng }, radius: 30, type: 'primary', confidence: 0.9, generationMethod: 'fallback_recovery' },
    ],
    boundary: { source: 'osm' },
  })
  TriggerPointSavingService.saveTriggerPoints = async (_id: string, tps: unknown[]) => {
    saved.push(tps)
    return { saved: tps.length, errors: [] }
  }
}

describe('BR-AUDIO-010 — reprocessar TP (reprocess_triggers_core) não tem efeito colateral no POI', () => {
  it('não aprova o POI, mesmo com auto_approve_if_satisfactory e confiança alta', async () => {
    writes.length = 0
    const saved: unknown[][] = []
    stubEngine(saved)
    const result = await PoiMigrationPipeline.executePipeline('poi-1', { mode: 'reprocess_triggers_core', auto_approve_if_satisfactory: true })
    assert.equal(result.success, true)
    const approvals = writes.filter(w => w.op === 'update' && JSON.stringify(w.args).includes('"approved":true'))
    assert.deepEqual(approvals, [])
  })

  it('não carimba access=both, e o TP além do teto não chega ao save', async () => {
    const saved: unknown[][] = []
    stubEngine(saved)
    await PoiMigrationPipeline.executePipeline('poi-1', { mode: 'reprocess_triggers_core' })
    assert.equal(saved.length, 1)
    assert.equal(saved[0].length, 1, 'o TP a ~2,2 km do pino tem que ficar fora')
    assert.equal((saved[0][0] as any).access, undefined)
  })

  it('prepareTriggerPointForDB sem access deixa a chave fora (default do banco é car)', () => {
    const row = TriggerPointSavingService.prepareTriggerPointForDB({ attraction_id: 'poi-1', lat: PIN.lat, lng: PIN.lng, type: 'primary' })
    assert.equal('access' in row, false)
  })
})
