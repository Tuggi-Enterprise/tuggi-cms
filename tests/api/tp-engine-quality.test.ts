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
