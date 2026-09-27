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

describe('BR-AUDIO-010 — TP dispara onde o POI está: a rota de balsa não é via acessível', () => {
  it('ferry é recusado; primary continua aceito', () => {
    const analyzer = new StreetAnalyzer()
    const line = [POI_PIN, { lat: -22.8950, lng: -43.1250 }]
    assert.equal(analyzer.isStreetAccessiblePublic(street('ferry', line), context), false)
    assert.equal(analyzer.isStreetAccessiblePublic(street('primary', line), context), true)
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
    fetcher.db = db
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
  it('pino fora e centróide a >1 km: implausível; pino dentro ou perto: plausível', async () => {
    const { isCuratedBoundaryImplausible } = await import('../../lib/services/trigger-points-google/utils/osm-validation')
    const square = (c: { lat: number; lng: number }, d: number) => [
      { lat: c.lat - d, lng: c.lng - d }, { lat: c.lat - d, lng: c.lng + d },
      { lat: c.lat + d, lng: c.lng + d }, { lat: c.lat + d, lng: c.lng - d },
    ]
    const farCenter = { lat: POI_PIN.lat + 0.02, lng: POI_PIN.lng } // ~2,2 km ao norte
    assert.equal(isCuratedBoundaryImplausible(POI_PIN, square(farCenter, 0.001), farCenter), true)
    const nearCenter = { lat: POI_PIN.lat + 0.005, lng: POI_PIN.lng } // ~550 m
    assert.equal(isCuratedBoundaryImplausible(POI_PIN, square(nearCenter, 0.001), nearCenter), false)
    // Parque grande: centróide longe, mas o pino está dentro.
    assert.equal(isCuratedBoundaryImplausible(POI_PIN, square(farCenter, 0.03), farCenter), false)
  })
})
