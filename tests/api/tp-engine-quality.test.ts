import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { StreetAnalyzer } from '../../lib/services/trigger-points-google/analyzers/street-analyzer'
import { CoreTriggerPointPredictor } from '../../lib/services/trigger-points-google/core/trigger-point-predictor'
import { calculateDistance } from '../../lib/services/trigger-points-google/utils/calculations'
import type { GeographicContext, StreetData } from '../../lib/services/trigger-points-google/types/interfaces'

// Auditoria do motor de TP, 2026-09-27, fatia A. Fixture: Praça XV / Rio de Janeiro.
const POI_PIN = { lat: -22.9030, lng: -43.1740 }
const context = { urbanDensity: { level: 'dense' } } as unknown as GeographicContext

function street(type: string, coordinates: Array<{ lat: number; lng: number }>, extra: Partial<StreetData> = {}): StreetData {
  return { id: `way/${type}`, type, coordinates, accessibility: 'public', confidence: 0.8, ...extra }
}

// Superseded by decision 1C (docs/arquitetura/cms/motor-de-tp.md, "Barca e trilho voltam como
// caminho de observador", #786): the defect was the TP on the line's 1st vertex (the terminal),
// fixed below and by INV-E7b, not the ferry. The ferry is an observer path again (INV-E7a).
describe('BR-AUDIO-010, INV-E7a — the ferry route is an observer path again (1C, #786)', () => {
  it('ferry and primary are accepted; a ferry in a tunnel would not be', () => {
    const analyzer = new StreetAnalyzer()
    const line = [POI_PIN, { lat: -22.8950, lng: -43.1250 }]
    assert.equal(analyzer.isStreetAccessiblePublic(street('ferry', line), context), true)
    assert.equal(analyzer.isStreetAccessiblePublic(street('primary', line), context), true)
    assert.equal(analyzer.isStreetAccessiblePublic(street('ferry', line, { tags: { tunnel: 'yes' } } as any), context), false)
  })
})

describe('BR-AUDIO-010 — TP de fallback nasce no ponto da rua mais perto do POI, não no 1º vértice', () => {
  it('rua longa com 1º vértice a ~9 km: o TP fica a poucos metros do pino', () => {
    const predictor = new CoreTriggerPointPredictor() as any
    // 1º vértice em Niterói; a rua passa a ~20 m do pino no meio do caminho.
    const far = { lat: -22.8950, lng: -43.1000 }
    const s = street('primary', [far, { lat: -22.9032, lng: -43.1740 }, { lat: -22.9040, lng: -43.1900 }])
    const [tp] = predictor.createTPFromStreet(s, POI_PIN, context, undefined)
    assert.ok(calculateDistance(tp.location, POI_PIN) < 50, `TP a ${calculateDistance(tp.location, POI_PIN)} m do pino`)
  })

  it('usa fullCoordinates quando coordinates foi colapsado', () => {
    const predictor = new CoreTriggerPointPredictor() as any
    const far = { lat: -22.8950, lng: -43.1000 }
    const s = street('primary', [far], { fullCoordinates: [far, { lat: -22.9031, lng: -43.1745 }, { lat: -22.9040, lng: -43.1900 }] })
    const [tp] = predictor.createTPFromStreet(s, POI_PIN, context, undefined)
    assert.ok(calculateDistance(tp.location, POI_PIN) < 80)
  })
})

describe('BR-AUDIO-010 — osm_id só identifica o elemento junto com o tipo', () => {
  // Fixture: node 123 e way 123 são elementos diferentes no OSM.
  async function fetcherWith(rows: { pois?: any[]; streets?: any[]; buildings?: any[] }) {
    const { default: Database } = await import('better-sqlite3')
    const { LocalOSMFetcher } = await import('../../lib/services/trigger-points-google/services/local-osm-fetcher')
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE pois (id INTEGER PRIMARY KEY, osm_id TEXT, osm_type TEXT, geometry_json TEXT, tags_json TEXT);
             CREATE TABLE streets (id INTEGER PRIMARY KEY, geometry_json TEXT, tags_json TEXT);
             CREATE TABLE buildings (id INTEGER PRIMARY KEY, geometry_json TEXT, tags_json TEXT);`)
    for (const [table, list] of Object.entries(rows)) {
      for (const r of list ?? []) {
        const cols = Object.keys(r)
        db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => r[c]))
      }
    }
    const fetcher = Object.create(LocalOSMFetcher.prototype)
    fetcher.regions = [{ name: 'test', covers: () => true, db, rtree: { pois: false, streets: false, buildings: false } }]
    return fetcher as Pick<ReturnType<typeof LocalOSMFetcher.getInstance>, "fetchElementById">
  }
  const point = JSON.stringify([{ lat: -22.903, lon: -43.174 }, { lat: -22.9031, lon: -43.1741 }])

  it('pedido de way 123 não devolve o node 123 (coluna osm_id)', async () => {
    const f = await fetcherWith({ pois: [{ osm_id: '123', osm_type: 'node', geometry_json: point, tags_json: '{"name":"Outro"}' }] })
    assert.equal(f.fetchElementById('way', '123'), null)
  })

  it('pedido de way 123 não devolve o node 123 (tags_json "@id")', async () => {
    const f = await fetcherWith({ streets: [{ geometry_json: point, tags_json: '{"@type":"node","@id":123}' }] })
    assert.equal(f.fetchElementById('way', '123'), null)
  })

  it('way 123 com o tipo certo é achado', async () => {
    const f = await fetcherWith({ buildings: [{ geometry_json: point, tags_json: '{"@type":"way","@id":123,"name":"Paço"}' }] })
    assert.equal(f.fetchElementById('way', '123')?.elements.length, 1)
  })
})

describe('BR-AUDIO-010 — polígono curado implausível é recusado', () => {
  it('pino fora e borda a >500 m: implausível; pino dentro ou perto da borda: plausível', async () => {
    const { isCuratedBoundaryImplausible } = await import('../../lib/services/trigger-points-google/utils/osm-validation')
    const square = (c: { lat: number; lng: number }, d: number) => [
      { lat: c.lat - d, lng: c.lng - d }, { lat: c.lat - d, lng: c.lng + d },
      { lat: c.lat + d, lng: c.lng + d }, { lat: c.lat + d, lng: c.lng - d },
    ]
    const farCenter = { lat: POI_PIN.lat + 0.02, lng: POI_PIN.lng } // ~2,2 km ao norte
    assert.equal(isCuratedBoundaryImplausible(POI_PIN, square(farCenter, 0.001)), true)
    const nearCenter = { lat: POI_PIN.lat + 0.005, lng: POI_PIN.lng } // ~550 m
    assert.equal(isCuratedBoundaryImplausible(POI_PIN, square(nearCenter, 0.001)), false)
    // Parque grande: centróide longe, mas o pino está dentro.
    assert.equal(isCuratedBoundaryImplausible(POI_PIN, square(farCenter, 0.03)), false)
  })
})

describe('BR-AUDIO-010 — teto de sanidade da distância TP↔POI (valor provisório)', () => {
  it('sem borda mede ao pino; com borda mede à borda', async () => {
    const { partitionByPoiReach, UNCLASSIFIED_MAX_TP_DISTANCE_M } = await import('../../lib/services/trigger-points-google/utils/validation')
    assert.equal(UNCLASSIFIED_MAX_TP_DISTANCE_M, 300)
    const at = (m: number) => ({ lat: POI_PIN.lat + m / 111_000, lng: POI_PIN.lng })
    const noBorder = partitionByPoiReach([at(250), at(350)], p => p, POI_PIN)
    assert.deepEqual(noBorder.kept, [at(250)])
    assert.equal(noBorder.dropped.length, 1)
    // Polígono de 200 m ao norte do pino: um TP a 450 m do pino fica a ~250 m da borda.
    const border = [at(0), { ...at(0), lng: POI_PIN.lng + 0.002 }, { ...at(200), lng: POI_PIN.lng + 0.002 }, at(200)]
    assert.equal(partitionByPoiReach([at(450)], p => p, POI_PIN, border).kept.length, 1)
    assert.equal(partitionByPoiReach([at(550)], p => p, POI_PIN, border).kept.length, 0)
  })

  it('fallback ancora no pino, não no centro do boundary, e descarta TP além do teto', async () => {
    const predictor = new CoreTriggerPointPredictor() as any
    // boundary.center errado a ~1,1 km do pino, com a única rua ao lado dele.
    const wrongCenter = { lat: POI_PIN.lat + 0.01, lng: POI_PIN.lng }
    const s = street('primary', [{ lat: wrongCenter.lat, lng: wrongCenter.lng - 0.0005 }, { lat: wrongCenter.lat, lng: wrongCenter.lng + 0.0005 }])
    const boundary = { center: wrongCenter, streets: [s], buildings: [] }
    const tps = await predictor.generateRecoveryFallbackTriggerPoints({ id: 'x', name: 'Paço Imperial', location: POI_PIN }, context, boundary)
    for (const tp of tps) {
      assert.ok(calculateDistance(tp.location, POI_PIN) <= 300, `TP de fallback a ${calculateDistance(tp.location, POI_PIN).toFixed(0)} m do pino`)
    }
  })
})
