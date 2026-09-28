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

describe('BR-AUDIO-010 / INV-E11 — dry-run do motor de TP mede sem gravar, pela mesma pós-condição da gravação', () => {
  it('gera e mede, e não escreve nada no banco (nem TP, nem aprovação, nem fila)', async () => {
    writes.length = 0
    const saved: unknown[][] = []
    stubEngine(saved)
    const { dryRunPoi, summarizePoi } = await import('@/lib/services/tp-dry-run')
    const result = await dryRunPoi('poi-1')
    assert.equal(result.error, null)
    assert.deepEqual(saved, [], 'saveTriggerPoints não pode ser chamado')
    const nonReadWrites = writes.filter(w => !(w.op === 'rpc' && w.args[0] === 'get_boundary_geometry'))
    assert.deepEqual(nonReadWrites, [])
    const summary = summarizePoi(result)
    assert.equal(summary.generated.count, 1, 'o dry-run corta como a gravação corta')
    assert.equal(summary.generated.dropped.beyond_reach, 1)
    const far = result.rows.find((r: any) => r.source === 'generated' && r.generation_method === 'fallback_recovery')
    assert.equal(far?.drop_reason, 'beyond_reach')
  })

  it('INV-E11: dry-run e gravação produzem o mesmo conjunto de TPs para o mesmo POI', async () => {
    const { VisibilityClass } = await import('@/lib/services/trigger-points-google/config/visibility-class')
    const d = 0.0003 // ~33 m
    const square = [
      { lat: PIN.lat - d, lng: PIN.lng - d }, { lat: PIN.lat - d, lng: PIN.lng + d },
      { lat: PIN.lat + d, lng: PIN.lng + d }, { lat: PIN.lat + d, lng: PIN.lng - d },
    ]
    const tp = (id: string, dLat: number) => ({ id, location: { lat: PIN.lat + dLat, lng: PIN.lng }, radius: 30, type: 'primary', confidence: 0.9, generationMethod: id })
    const saved: unknown[][] = []
    stubEngine(saved)
    CoreTriggerPointPredictor.prototype.predictTriggerPointsComplete = async () => ({
      triggerPoints: [tp('front', d + 0.0003), tp('inside', 0), tp('far', d + 0.01)],
      boundary: { source: 'osm', coordinates: square, center: PIN, classification: { group: VisibilityClass.STRUCTURE, maxEdgeDistanceM: 150 } },
    })
    await PoiMigrationPipeline.executePipeline('poi-1', { mode: 'reprocess_triggers_core' })
    const { dryRunPoi } = await import('@/lib/services/tp-dry-run')
    const result = await dryRunPoi('poi-1')
    const key = (p: { lat: number; lng: number }) => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`
    const savedSet = (saved[0] as any[]).map(key).sort()
    const dryKept = result.rows.filter((r: any) => r.source === 'generated' && !r.drop_reason).map(key).sort()
    assert.deepEqual(dryKept, savedSet)
    assert.equal(savedSet.length, 1)
    const reasons = Object.fromEntries(result.rows.filter((r: any) => r.source === 'generated').map((r: any) => [r.generation_method, r.drop_reason]))
    assert.deepEqual(reasons, { front: '', inside: 'inside_poi', far: 'beyond_reach' })
  })

  it('CSV: coluna drop_reason e campo com vírgula entre aspas', async () => {
    const { toCsvLines, DRY_RUN_CSV_COLUMNS, measureTriggerPoints } = await import('@/lib/services/tp-dry-run')
    assert.equal(DRY_RUN_CSV_COLUMNS[DRY_RUN_CSV_COLUMNS.length - 1], 'drop_reason')
    const rows = measureTriggerPoints({
      attractionId: 'poi-1', poiName: 'Praia, Recreio', pin: PIN, boundarySource: 'osm', source: 'generated',
      tps: [{ lat: PIN.lat, lng: PIN.lng, type: 'primary', generation_method: 'x', radius_m: 20, bearing: 0, drop_reason: 'inside_poi' }],
    })
    const [line] = toCsvLines(rows)
    assert.ok(line.includes('"Praia, Recreio"'), line)
    assert.ok(line.endsWith(',inside_poi'), line)
  })

  it('mede distância ao pino e à borda por TP', async () => {
    const { measureTriggerPoints } = await import('@/lib/services/tp-dry-run')
    const border = [
      { lat: PIN.lat, lng: PIN.lng }, { lat: PIN.lat, lng: PIN.lng + 0.001 },
      { lat: PIN.lat + 0.001, lng: PIN.lng + 0.001 }, { lat: PIN.lat + 0.001, lng: PIN.lng },
    ]
    const [row] = measureTriggerPoints({
      attractionId: 'poi-1', poiName: 'Paço Imperial', pin: PIN, boundaryCoords: border, boundarySource: 'osm', source: 'current',
      tps: [{ lat: PIN.lat + 0.004, lng: PIN.lng + 0.0005, type: 'primary', generation_method: 'fallback_recovery', radius_m: 20, bearing: 180 }],
    })
    assert.ok(Math.abs(row.dist_to_pin_m - 446) < 10, `pino: ${row.dist_to_pin_m}`)
    assert.ok(Math.abs((row.dist_to_boundary_m ?? 0) - 333) < 10, `borda: ${row.dist_to_boundary_m}`)
    assert.equal(row.beyond_cap, true)
    assert.equal(row.generation_method, 'fallback_recovery')
  })
})
