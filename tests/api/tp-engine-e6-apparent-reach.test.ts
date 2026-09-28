import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPARENT_REACH_CEILING_M,
  CLASS_LIMITS,
  RECOGNITION_ANGLE_DEG,
  SANITY_MAX_TP_DISTANCE_M,
  URBAN_LANDMARK_HORIZON_M,
  VisibilityClass,
  maxEdgeDistanceFor,
  sizeReachFarFromM,
} from '@/lib/services/trigger-points-google/config/visibility-class'
import { COARSE_EDGE_TOLERANCE_M, coarseEdgeRing, edgeDistanceFarLaneM, edgeDistanceM, tpReachCapM } from '@/lib/services/trigger-points-google/utils/validation'
import { calculateDistanceToPolygon } from '@/lib/services/trigger-points-google/utils/calculations'
import { OptimalPointCalculator } from '@/lib/services/trigger-points-google/analyzers/point-calculator'
import { buildClassification } from '@/lib/services/trigger-points-google/services/poi-classifier.service'
import { selectSpacedTriggerPoints } from '@/lib/services/trigger-points-google/utils/tp-selection'
import type { TriggerPoint } from '@/lib/services/trigger-points-google/types/interfaces'

// Motor de TP (#772) — E6, alcance pelo tamanho aparente (experimento, #775). Fonte:
// docs/arquitetura/cms/motor-de-tp.md, linha E6. Unidade: funções puras, sem rede e sem banco.

const perDeg = 1 / Math.tan((RECOGNITION_ANGLE_DEG * Math.PI) / 180)

describe('INV-E6, BR-AUDIO-010 — alcance = tamanho / tan(ângulo de reconhecimento), entre o teto da classe e o teto aparente', () => {
  it('busto de 3 m alcança ~86 m (acima do piso de 60 m do point_low)', () => {
    const reach = maxEdgeDistanceFor(VisibilityClass.POINT_LOW, 0, 3)
    assert.equal(reach, 86)
  })

  it('a fórmula é S / tan(2°) ≈ 28,6 × S', () => {
    assert.equal(maxEdgeDistanceFor(VisibilityClass.STRUCTURE, 0, 20), Math.round(20 * perDeg))
    assert.ok(Math.abs(perDeg - 28.6) < 0.1)
  })

  it('piso: objeto pequeno nunca fica abaixo do teto antigo da classe', () => {
    for (const cls of [VisibilityClass.POINT_LOW, VisibilityClass.STRUCTURE, VisibilityClass.AREA, VisibilityClass.LINEAR]) {
      assert.equal(maxEdgeDistanceFor(cls, 0, 0), CLASS_LIMITS[cls].maxEdgeDistanceM, cls)
      assert.equal(maxEdgeDistanceFor(cls, 0, 1), CLASS_LIMITS[cls].maxEdgeDistanceM, cls)
    }
  })

  it('teto: pegada de 13 km (ponte) para em 1.500 m', () => {
    assert.equal(maxEdgeDistanceFor(VisibilityClass.LINEAR, 0, 13_000), APPARENT_REACH_CEILING_M)
    assert.equal(APPARENT_REACH_CEILING_M, 1_500)
  })

  it('landmark_high não muda: horizonte urbano, ou teto de sanidade quando proeminente', () => {
    assert.equal(maxEdgeDistanceFor(VisibilityClass.LANDMARK_HIGH, 0, 400), URBAN_LANDMARK_HORIZON_M)
    assert.equal(maxEdgeDistanceFor(VisibilityClass.LANDMARK_HIGH, 700, 400), SANITY_MAX_TP_DISTANCE_M)
  })

  it('a classificação grava o alcance em maxEdgeDistanceM, e tpReachCapM o lê: S = max(altura, extensão da pegada)', () => {
    const tall = buildClassification(VisibilityClass.STRUCTURE, { heightM: 20, prominenceM: 0, areaM2: 400, extentM: 10 })
    const wide = buildClassification(VisibilityClass.STRUCTURE, { heightM: 10, prominenceM: 0, areaM2: 400, extentM: 30 })
    assert.equal(tpReachCapM(tall), Math.round(20 * perDeg))
    assert.equal(tpReachCapM(wide), Math.round(30 * perDeg))
    assert.equal(tall.searchRadius, tall.maxEdgeDistanceM)
  })
})

describe('INV-E6 / INV-E10, BR-AUDIO-010 — cota longe própria (maxFarTPs), sem tomar vaga de TP perto', () => {
  const C = { lat: -22.9, lng: -43.2 }
  const tp = (id: string, distance: number, dLat: number, type = 'residential', quality = 0.5, dLng = 0): TriggerPoint => ({
    id, location: { lat: C.lat + dLat, lng: C.lng + dLng }, radius: 30, distance, quality,
    expectedBearing: 0, street: { type } as any,
  } as any)
  const pointLow = () => buildClassification(VisibilityClass.POINT_LOW, { heightM: 10, prominenceM: 0, areaM2: 100 })

  it('as quatro classes têm 2 vagas longe; landmark_high fica como estava', () => {
    for (const cls of [VisibilityClass.POINT_LOW, VisibilityClass.STRUCTURE, VisibilityClass.AREA, VisibilityClass.LINEAR]) {
      assert.equal(CLASS_LIMITS[cls].maxFarTPs, 2, cls)
      assert.equal(sizeReachFarFromM(cls), CLASS_LIMITS[cls].maxEdgeDistanceM, cls)
    }
    assert.equal(CLASS_LIMITS[VisibilityClass.LANDMARK_HIGH].maxFarTPs, 28)
    assert.equal(sizeReachFarFromM(VisibilityClass.LANDMARK_HIGH), null)
  })

  it('point_low com 4 perto e 3 longe fica com os 4 perto E 2 longe', () => {
    const near = [0, 1, 2, 3].map(i => tp(`n${i}`, 20 + i, i * 0.001))
    const far = [0, 1, 2].map(i => tp(`f${i}`, 250, 0.01 + i * 0.001, 'primary'))
    const out = selectSpacedTriggerPoints([...far, ...near], pointLow(), C)
    assert.deepEqual(out.filter(t => t.distance <= 60).map(t => t.id).sort(), ['n0', 'n1', 'n2', 'n3'])
    assert.equal(out.filter(t => t.distance > 60).length, 2)
  })

  it('longe não preenche vaga de perto: 1 perto + 5 longe = 1 + 2', () => {
    const far = [0, 1, 2, 3, 4].map(i => tp(`f${i}`, 200, 0.01 + i * 0.001, 'primary'))
    const out = selectSpacedTriggerPoints([...far, tp('n0', 20, 0)], pointLow(), C)
    assert.equal(out.length, 3)
    assert.ok(out.some(t => t.id === 'n0'))
  })

  it('o longe vai primeiro ao setor sem TP, depois ao caminho que ninguém usa (a barca), não ao de maior qualidade', () => {
    const near = tp('n0', 20, 0.0003)
    const sameSectorStreet = tp('A', 300, 0.003, 'residential', 0.9)
    const otherSector = tp('B', 300, -0.003, 'primary', 0.5)
    const sameSectorFerry = tp('C', 450, 0.0045, 'ferry', 0.3, 0.0005)
    const out = selectSpacedTriggerPoints([sameSectorStreet, otherSector, sameSectorFerry, near], pointLow(), C)
    assert.deepEqual(out.filter(t => t.distance > 60).map(t => t.id).sort(), ['B', 'C'])
  })

  it('#786: a rua perto no setor não cobre quem vai embarcado — o VLT fica, e a barca não toma o lugar dele (Museu do Amanhã)', () => {
    const near = tp('n0', 20, 0.0003)
    const tram = tp('T', 150, 0.0014, 'railway_tram', 0.5)
    const ferry = tp('F', 150, -0.001, 'ferry', 0.8, 0.001)
    const orla = tp('P', 150, -0.0015, 'pedestrian', 0.9)
    const out = selectSpacedTriggerPoints([orla, ferry, tram, near], pointLow(), C)
    assert.deepEqual(out.filter(t => t.distance > 60).map(t => t.id).sort(), ['F', 'T'])
  })

  it('area: o setor do longe é o setor de perímetro (INV-E10d), não o de 45° do centroide (Ilha do Fundão)', () => {
    const M_LAT = 110_540, M_LNG = 111_320 * Math.cos((C.lat * Math.PI) / 180)
    const polar = (deg: number, m: number) => ({ lat: C.lat + (m * Math.cos((deg * Math.PI) / 180)) / M_LAT, lng: C.lng + (m * Math.sin((deg * Math.PI) / 180)) / M_LNG })
    const ring = Array.from({ length: 361 }, (_, i) => polar(i % 360, 500))
    const at = (id: string, deg: number, out: number, type: string, quality: number) => ({ ...tp(id, out, 0, type, quality), location: polar(deg, 500 + out) })
    const area = buildClassification(VisibilityClass.AREA, { heightM: 0, prominenceM: 0, areaM2: 785_000, extentM: 1000 })
    const near = at('n0', 0, 20, 'primary', 0.9)
    const besideNear = at('W', 5, 150, 'motorway', 1) // mesmo trecho da borda do TP perto
    const gap = at('X', 30, 150, 'motorway', 0.9) // mesmo setor de 45°, outro trecho da borda
    const y = at('Y', 200, 150, 'motorway', 0.5)
    const z = at('Z', 260, 150, 'motorway', 0.4)
    const out = selectSpacedTriggerPoints([besideNear, gap, y, z, near], area, C, undefined, ring)
    assert.deepEqual(out.filter(t => t.distance > 100).map(t => t.id).sort(), ['X', 'Y'])
  })
})

describe('INV-E6, BR-AUDIO-010 — além do teto da classe só via de turista, medida na borda simplificada', () => {
  const M_LAT = 110_540
  const M_LNG = 111_320 * Math.cos((-22.9 * Math.PI) / 180)
  const C = { lat: -22.9, lng: -43.2 }
  const at = (n: number, e: number) => ({ lat: C.lat + n / M_LAT, lng: C.lng + e / M_LNG })
  // 1.000 vértices num círculo de 500 m: o Fundão tem 1.005 (#772)
  const circle = Array.from({ length: 1000 }, (_, i) => at(500 * Math.sin((2 * Math.PI * i) / 1000), 500 * Math.cos((2 * Math.PI * i) / 1000)))
  const ring = [...circle, circle[0]]
  const area = buildClassification(VisibilityClass.AREA, { heightM: 0, prominenceM: 0, areaM2: 785_000, extentM: 1000 })

  it('a borda simplificada tem bem menos vértices e nenhum vértice real a mais de COARSE_EDGE_TOLERANCE_M dela', () => {
    const coarse = coarseEdgeRing(ring)
    assert.ok(coarse.length < ring.length / 5, `${coarse.length} vértices`)
    for (const p of ring) assert.ok(calculateDistanceToPolygon(p, coarse) <= COARSE_EDGE_TOLERANCE_M + 0.5)
  })

  it('perto do teto da classe a distância é a exata; longe, dentro da tolerância', () => {
    const b = { center: C, coordinates: ring, classification: area }
    const near = at(540, 0)
    const far = at(1300, 0)
    assert.equal(edgeDistanceFarLaneM(near, b), edgeDistanceM(near, b))
    assert.ok(Math.abs(edgeDistanceFarLaneM(far, b) - edgeDistanceM(far, b)) <= COARSE_EDGE_TOLERANCE_M)
  })

  it('landmark_high é sempre medido na borda real', () => {
    const lm = buildClassification(VisibilityClass.LANDMARK_HIGH, { heightM: 100, prominenceM: 0, areaM2: 785_000 })
    const b = { center: C, coordinates: ring, classification: lm }
    const far = at(1300, 0)
    assert.equal(edgeDistanceFarLaneM(far, b), edgeDistanceM(far, b))
  })

  it('o leque anda uma rua residencial só até o teto da classe; uma avenida, até o alcance pelo tamanho', async () => {
    const b = { center: C, coordinates: ring, classification: area, visibilityFan: { polygons: [[C]], maxDistanceM: 1500 } } as any
    const street = (id: string, type: string) => ({ id, name: id, type, coordinates: [at(530, -2000), at(530, 2000)] })
    const calc = new OptimalPointCalculator() as any
    const reach = tpReachCapM(area)
    const res = await calc.calculateFanWalkStrategy([street('res', 'residential')], { id: 'x', name: 'x', location: C }, b, {}, area, reach)
    const ave = await calc.calculateFanWalkStrategy([street('ave', 'primary')], { id: 'x', name: 'x', location: C }, b, {}, area, reach)
    assert.ok(res.length > 0 && res.every((c: any) => c.distance <= CLASS_LIMITS[VisibilityClass.AREA].maxEdgeDistanceM))
    assert.ok(ave.some((c: any) => c.distance > CLASS_LIMITS[VisibilityClass.AREA].maxEdgeDistanceM))
  })
})
