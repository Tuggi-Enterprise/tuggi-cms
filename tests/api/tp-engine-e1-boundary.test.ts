/**
 * E1 — borda (docs/arquitetura/cms/motor-de-tp.md, INV-E1a/b/c; BR-AUDIO-010).
 *
 * Unidade, com dado literal: a escolha do elemento que contém o pino (INV-E1c), o círculo
 * desenhado marcado `synthetic` em qualquer caminho (INV-E1b), e a borda sintética gravada que
 * volta do banco lida como sintética. As formas imitam os quatro casos medidos na onda -h:
 * Maracanã/Manguinhos (nó de bairro), Pão de Açúcar (rocha com buraco no cume), Monumento
 * Árvore de Natal (polígono grande perto) e Busto Mazzini (círculo com source=osm).
 */
import { describe, it, mock, before } from 'node:test'
import assert from 'node:assert/strict'

type LatLng = { lat: number; lng: number }
const PIN: LatLng = { lat: -22.95, lng: -43.15 }
const M_LAT = 1 / 111_320
const M_LNG = 1 / (111_320 * Math.cos((PIN.lat * Math.PI) / 180))

/** Closed square ring of `half` metres around `c`, in Overpass shape ({lat, lon}). */
function square(half: number, c: LatLng = PIN) {
  const pts = [[-1, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]]
  return pts.map(([a, b]) => ({ lat: c.lat + a * half * M_LAT, lon: c.lng + b * half * M_LNG }))
}

let choice: typeof import('../../lib/services/trigger-points-google/utils/boundary-choice')
let dbRow: { geojson: unknown; boundary_source: string | null }

before(async () => {
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabase: () => ({
        schema: () => ({
          rpc: async () => ({ data: dbRow.geojson, error: null }),
          from: () => ({
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { boundary_source: dbRow.boundary_source }, error: null }) }),
            }),
          }),
        }),
      }),
    },
  })
  choice = await import('../../lib/services/trigger-points-google/utils/boundary-choice')
})

describe('INV-E1c — o elemento que contém o pino precisa ser do tipo do POI (BR-AUDIO-010)', () => {
  it('place/bairro não é borda de POI que não é lugar; é borda de POI com categoria de lugar', () => {
    const suburb = { type: 'relation', id: 1, tags: { place: 'suburb' }, geometry: square(800) }
    const stadiumPoi = choice.chooseContainingBoundary(PIN, { category: 'point_of_interest', tags: {} }, [suburb])
    assert.equal(stadiumPoi.chosen, undefined)
    assert.match(stadiumPoi.rejected[0].reason, /not a place/)
    const neighbourhoodPoi = choice.chooseContainingBoundary(PIN, { category: 'neighborhood', tags: {} }, [suburb])
    assert.equal(neighbourhoodPoi.chosen?.element.id, 1)
  })

  it('limite administrativo nunca vira borda de atração', () => {
    const city = { type: 'relation', id: 2, tags: { boundary: 'administrative', admin_level: '8' }, geometry: square(5000) }
    const r = choice.chooseContainingBoundary(PIN, { category: null, tags: { tourism: 'museum' } }, [city])
    assert.equal(r.chosen, undefined)
    assert.equal(r.rejected.length, 1)
  })

  it('pico toma o relevo natural=* que contém o cume, nunca o parque do topo; multipolígono lido pelo anel externo', () => {
    // bare_rock com buraco (vegetação) no cume: outer 400 m, inner 60 m, anéis em sequência como no banco local.
    const rock = { type: 'relation', id: 3, tags: { natural: 'bare_rock' }, geometry: [...square(400), ...square(60)] }
    const summitPark = { type: 'relation', id: 4, tags: { leisure: 'park' }, geometry: square(50) }
    const r = choice.chooseContainingBoundary(PIN, { tags: { natural: 'peak' } }, [summitPark, rock])
    assert.equal(r.chosen?.element.id, 3)
    assert.ok(r.chosen!.areaM2 > 600_000, `anel externo, não o buraco: ${r.chosen!.areaM2} m²`)
    assert.ok(r.rejected.some(x => x.element === 'relation/4' && /natural/.test(x.reason)))
  })

  it('busto, estátua ou monumento não herda polígono de área nem polígono grande (motivo no rastro)', () => {
    const school = { type: 'way', id: 5, tags: { amenity: 'school' }, geometry: square(120) } // ~57.600 m²
    const square_ = { type: 'way', id: 6, tags: { leisure: 'park' }, geometry: square(30) }
    const pedestal = { type: 'way', id: 7, tags: { building: 'yes', amenity: 'place_of_worship' }, geometry: square(4) }
    const bust = { tourism: 'artwork', artwork_type: 'sculpture' }
    const noFit = choice.chooseContainingBoundary(PIN, { tags: bust }, [school, square_])
    assert.equal(noFit.chosen, undefined)
    assert.ok(noFit.rejected.some(x => x.element === 'way/5' && new RegExp(`${choice.POINT_FEATURE_MAX_AREA_M2}`).test(x.reason)))
    assert.ok(noFit.rejected.some(x => x.element === 'way/6' && /area polygon/.test(x.reason)))
    const monument = choice.chooseContainingBoundary(PIN, { tags: { class: 'man_made', type: 'monument' } }, [school, pedestal])
    assert.equal(monument.chosen?.element.id, 7)
  })

  it('só conta o que contém o pino; via fechada não é área; vence o menor polígono que serve', () => {
    const roundabout = { type: 'way', id: 8, tags: { highway: 'primary' }, geometry: square(20) }
    const nearby = { type: 'way', id: 9, tags: { leisure: 'park' }, geometry: square(40, { lat: PIN.lat + 300 * M_LAT, lng: PIN.lng }) }
    const plaza = { type: 'way', id: 10, tags: { leisure: 'park' }, geometry: square(40) }
    const district = { type: 'way', id: 11, tags: { landuse: 'residential' }, geometry: square(400) }
    const r = choice.chooseContainingBoundary(PIN, { tags: {} }, [roundabout, nearby, district, plaza])
    assert.equal(r.chosen?.element.id, 10)
    assert.deepEqual(r.rejected, [])
  })

  it('splitRings separa os anéis gravados em sequência; um anel só volta inteiro', () => {
    const pts = [...square(10), ...square(5)].map(p => ({ lat: p.lat, lng: p.lon }))
    assert.deepEqual(choice.splitRings(pts).map(r => r.length), [5, 5])
    assert.equal(choice.splitRings(pts.slice(0, 5)).length, 1)
  })
})

describe('INV-E1b — círculo desenhado sai source=synthetic em qualquer caminho (BR-AUDIO-010)', () => {
  it('nó OSM (círculo de 10 m) sai synthetic, com source=synthetic, e a busca por área vem antes dele', async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const d = new BoundaryDetector() as any
    const circle = Array.from({ length: 16 }, (_, i) => ({
      lat: PIN.lat + 10 * M_LAT * Math.cos((i / 16) * 2 * Math.PI),
      lng: PIN.lng + 10 * M_LNG * Math.sin((i / 16) * 2 * Math.PI),
    }))
    const calls: string[] = []
    d.detectOSMBoundaryByID = async () => { calls.push('id'); return { success: true, data: { coordinates: circle, synthetic: true, source: 'osm', osmTags: { tourism: 'artwork' } } } }
    d.detectContainingBoundary = async () => { calls.push('contains'); return { success: false } }
    d.detectOSMBoundary = async () => { calls.push('name'); return { success: false } }
    d.withClassification = async (b: unknown) => b
    const r = await d.detectBoundary({ id: 'x', name: 'x', osm_id: 1, osm_type: 'node', location: PIN })
    assert.deepEqual(calls, ['id', 'contains'], 'com id de nó, a busca por nome não roda')
    assert.equal(r.data.source, 'synthetic')
    assert.equal(r.data.synthetic, true)
  })

  it('círculo vindo da busca por nome (ponto do Nominatim) também sai synthetic', async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const d = new BoundaryDetector() as any
    const circle50 = Array.from({ length: 17 }, (_, i) => ({
      lat: PIN.lat + 50 * M_LAT * Math.cos(((i % 16) / 16) * 2 * Math.PI),
      lng: PIN.lng + 50 * M_LNG * Math.sin(((i % 16) / 16) * 2 * Math.PI),
    }))
    d.detectContainingBoundary = async () => ({ success: false })
    d.detectOSMBoundary = async () => ({ success: true, data: { coordinates: circle50, source: 'osm' } })
    d.withClassification = async (b: unknown) => b
    const r = await d.detectBoundary({ id: 'x', name: 'x', location: PIN })
    assert.equal(r.data.source, 'synthetic')
    assert.equal(r.data.synthetic, true)
  })

  it('borda sintética gravada volta do banco como sintética, não como fonte; manual segue manual', async () => {
    const { BoundaryDetector } = await import('../../lib/services/trigger-points-google/core/boundary-detector')
    const ring = Array.from({ length: 17 }, (_, i) => [
      PIN.lng + 10 * M_LNG * Math.sin(((i % 16) / 16) * 2 * Math.PI),
      PIN.lat + 10 * M_LAT * Math.cos(((i % 16) / 16) * 2 * Math.PI),
    ])
    dbRow = { geojson: { type: 'Polygon', coordinates: [ring] }, boundary_source: 'osm' }
    const saved = await new BoundaryDetector().fetchBoundaryFromDatabase('x')
    assert.equal(saved.data?.source, 'synthetic')
    assert.equal(saved.data?.synthetic, true)
    dbRow = { geojson: { type: 'Polygon', coordinates: [ring] }, boundary_source: 'manual' }
    const manual = await new BoundaryDetector().fetchBoundaryFromDatabase('x')
    assert.equal(manual.data?.source, 'manual')
  })
})
