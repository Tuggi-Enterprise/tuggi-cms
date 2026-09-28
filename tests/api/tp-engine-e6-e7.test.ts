import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { streetEdgeReach, tpReachCapM } from '@/lib/services/trigger-points-google/utils/validation'
import { OptimalPointCalculator, sampleFarBySectorAndRing } from '@/lib/services/trigger-points-google/analyzers/point-calculator'
import {
  EDGE_BAND_M,
  FAR_CANDIDATES_PER_CELL,
  VisibilityClass,
} from '@/lib/services/trigger-points-google/config/visibility-class'
import { buildClassification } from '@/lib/services/trigger-points-google/services/poi-classifier.service'

// Motor de TP (#772) — E6 (alcance) e E7 (candidatos). Fonte: docs/arquitetura/cms/motor-de-tp.md.

const PIN = { lat: -22.9, lng: -43.2 }
const M_LAT = 110_540
const M_LNG = 111_320 * Math.cos((PIN.lat * Math.PI) / 180)
const at = (n: number, e: number) => ({ lat: PIN.lat + n / M_LAT, lng: PIN.lng + e / M_LNG })
const square = (h: number) => [at(-h, -h), at(-h, h), at(h, h), at(h, -h)]
const eastWest = (n: number, halfLenM = 2_000) => ({ id: `s${n}`, name: `Rua ${n}`, type: 'residential', coordinates: [at(n, -halfLenM), at(n, halfLenM)] })

describe('INV-E6, BR-AUDIO-010 — um raio só, medido da borda', () => {
  const boundary = { center: PIN, coordinates: square(20) }

  it('a via cujos vértices estão longe mas passa a 20 m da borda está no alcance (a polilinha conta, não o vértice)', () => {
    const r = streetEdgeReach(eastWest(40), boundary, 60)
    assert.equal(r.within, true)
    assert.ok(Math.abs(r.edgeDistanceM! - 20) < 1, `edge ${r.edgeDistanceM}`)
  })

  it('a via a 200 m da borda fica fora do alcance de 60 m', () => {
    assert.equal(streetEdgeReach(eastWest(220), boundary, 60).within, false)
  })

  it('o leque de visibilidade não alarga o filtro: o raio é o de tpReachCapM', () => {
    const cls = buildClassification(VisibilityClass.POINT_LOW, { heightM: 2, prominenceM: 0, areaM2: 1600 })
    const b = { ...boundary, classification: cls, visibilityFan: { polygons: [[PIN]], maxDistanceM: 5_000 } } as any
    const calc = new OptimalPointCalculator() as any
    const kept = calc.filterStreetsByRadius([eastWest(40), eastWest(220)], b, tpReachCapM(cls))
    assert.deepEqual(kept.map((s: any) => s.name), ['Rua 40'])
  })

  it('borda sintética: o alcance é medido do pino, não do círculo desenhado (INV-E1b)', () => {
    const r = streetEdgeReach(eastWest(70), { center: PIN, coordinates: square(50), synthetic: true }, 60)
    assert.equal(r.within, false, 'a 70 m do pino, fora dos 60 m, mesmo a 20 m do círculo')
  })
})

describe('INV-E7b, BR-AUDIO-010 — o candidato perto fica no pé da perpendicular da borda sobre a via', () => {
  it('o 1º candidato de uma via longa é o ponto em frente à borda, não um vértice', async () => {
    const cls = buildClassification(VisibilityClass.POINT_LOW, { heightM: 2, prominenceM: 0, areaM2: 1600 })
    const b = { center: PIN, coordinates: square(20), classification: cls, visibilityFan: { polygons: [[PIN]], maxDistanceM: 60 } } as any
    const calc = new OptimalPointCalculator() as any
    const cands = await calc.calculateFanWalkStrategy([eastWest(40)], { id: 'x', name: 'x', location: PIN }, b, {}, cls)
    const nearest = cands.reduce((a: any, c: any) => (c.distance < a.distance ? c : a))
    assert.ok(Math.abs(nearest.location.lng - PIN.lng) * M_LNG < 21, 'em frente à borda (|leste| ≤ meia largura)')
    assert.ok(Math.abs(nearest.distance - 20) < 1)
  })
})

describe('INV-E7c / INV-E10c, BR-AUDIO-010 — landmark_high gera candidatos longe, distribuídos por setor', () => {
  const cand = (n: number, e: number, quality = 0.5, type = 'primary') => {
    const location = at(n, e)
    return { location, distance: Math.hypot(n, e), quality, expectedBearing: 0, confidence: 0.85, street: { type } as any }
  }

  it('beyond the inner rings each cell keeps at most FAR_CANDIDATES_PER_CELL, tourist streets only; the edge band stays whole', () => {
    const near = Array.from({ length: 10 }, (_, i) => cand(50, i * 5))
    const crowded = Array.from({ length: 40 }, (_, i) => cand(3_000 + i * 400, 10)) // one sector, several rings
    const lanes = Array.from({ length: 10 }, (_, i) => cand(5_000 + i * 400, 300, 0.9, 'residential'))
    const out = sampleFarBySectorAndRing([...near, ...crowded, ...lanes] as any, PIN)
    assert.equal(out.filter(c => c.distance <= EDGE_BAND_M).length, near.length)
    const far = out.filter(c => c.distance > EDGE_BAND_M)
    assert.ok(far.length > FAR_CANDIDATES_PER_CELL, 'different rings are different cells')
    assert.ok(far.length < crowded.length)
    assert.ok(!far.some(c => lanes.includes(c as any)), 'the horizon takes tourist streets only')
    assert.ok(far.filter(c => c.distance > 4_000 && c.distance <= 8_000).length <= FAR_CANDIDATES_PER_CELL)
  })

  it('candidatos longe em oito direções saem nas oito direções', () => {
    const dirs = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4 + 0.1)
    const pool = dirs.flatMap(a => Array.from({ length: 20 }, (_, i) => cand(Math.cos(a) * (2_000 + i * 50), Math.sin(a) * (2_000 + i * 50))))
    const out = sampleFarBySectorAndRing(pool as any, PIN)
    const sectors = new Set(out.map(c => Math.floor(((Math.atan2(
      (c.location.lng - PIN.lng) * M_LNG, (c.location.lat - PIN.lat) * M_LAT) * 180) / Math.PI + 360) % 360 / 45)))
    assert.equal(sectors.size, 8)
  })
})

describe('INV-E6, BR-POI-009 — um POI que é o seu relevo é visto de qualquer via: a orla residencial e a trilha contam no longe', () => {
  // Morro do Vigia (Cabo Frio): área de 54 mil m², 16 m sobre o anel, e além de 60 m só uma terciária a 1,4 km.
  const hill = buildClassification(VisibilityClass.AREA, { heightM: 0, prominenceM: 19, areaM2: 54_000, extentM: 400 })
  const boundary = (reliefProminenceM: number, heightM = 0) =>
    ({ center: PIN, coordinates: [...square(100), square(100)[0]], classification: hill, visibilityFan: { polygons: [[PIN]], maxDistanceM: 1_500 },
      physical: { heightM, reliefProminenceM } }) as any
  const walk = (b: any, type: string) => {
    const street = { ...eastWest(500), type }
    return (new OptimalPointCalculator() as any).calculateFanWalkStrategy([street], { id: 'x', name: 'x', location: PIN }, b, {}, hill, tpReachCapM(hill))
  }
  const farOnes = (cands: any[]) => cands.filter((c: any) => c.distance > 60)

  it('morro de 16 m: a rua residencial e a trilha a 400 m da borda dão candidato', async () => {
    assert.ok(farOnes(await walk(boundary(16), 'residential')).length > 0)
    assert.ok(farOnes(await walk(boundary(16), 'path')).length > 0)
  })

  it('terreno plano, ou estrutura em cima do morro: longe continua só via de turista', async () => {
    assert.equal(farOnes(await walk(boundary(3), 'residential')).length, 0)
    assert.equal(farOnes(await walk(boundary(16, 12), 'residential')).length, 0)
  })

  it('BR-POI-009: 10 m over the 2 km median on a slope is not a relief — far ways stay the tourist ones (Busto Mazzini)', async () => {
    const onSlope = { ...boundary(0), physical: { heightM: 0, localProminenceM: 10, reliefProminenceM: 0 } }
    assert.equal(farOnes(await walk(onSlope, 'footway')).length, 0)
  })
})
