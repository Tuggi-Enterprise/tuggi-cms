import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  VisibilityClass,
  fanHorizonM,
  maxEdgeDistanceFor,
  LANDMARK_MIN_PROMINENCE_M,
} from '@/lib/services/trigger-points-google/config/visibility-class'
import { applyTpPostConditions, dropUnfireable } from '@/lib/services/trigger-points-google/utils/tp-selection'
import { distanceFromPoiM } from '@/lib/services/trigger-points-google/utils/validation'
import { isPointInPolygon } from '@/lib/services/trigger-points-google/utils/calculations'
import type { TriggerPoint } from '@/lib/services/trigger-points-google/types/interfaces'

// Motor de TP (#772), premissas P2/P4/P8 e INV-E11 — camada "propriedade/metamórfica":
// a mesma checagem sobre várias entradas, sem depender de coordenada exata.

const PIN = { lat: -22.9030, lng: -43.1740 }

function square(center: { lat: number; lng: number }, halfSideDeg = 0.0006) {
  const d = halfSideDeg
  return [
    { lat: center.lat - d, lng: center.lng - d }, { lat: center.lat - d, lng: center.lng + d },
    { lat: center.lat + d, lng: center.lng + d }, { lat: center.lat + d, lng: center.lng - d },
  ]
}

function tp(over: Partial<TriggerPoint> & { location: TriggerPoint['location'] }): TriggerPoint {
  return {
    id: 'tp', radius: 20, expectedBearing: 0, bearingThreshold: 45, type: 'primary',
    priority: 5, confidence: 0.8, quality: 0.8, street: undefined as any, distance: 0,
    generationMethod: 'local_osm', ...over,
  }
}

describe('P2, BR-AUDIO-010 — mover o pino dentro da borda não muda o conjunto de TPs', () => {
  it('applyTpPostConditions com o mesmo boundary e pinos diferentes (todos dentro dele) mantém kept/dropped', () => {
    const boundary = square(PIN, 0.001) // ~220 m de lado
    const tps = [
      tp({ id: 'edge-near', location: { lat: PIN.lat + 0.0015, lng: PIN.lng } }), // fora, perto
      tp({ id: 'far', location: { lat: PIN.lat + 0.02, lng: PIN.lng } }), // além do alcance
      tp({ id: 'inside', location: PIN }), // dentro da borda
    ]
    const pinsInsideBoundary = [
      PIN,
      { lat: PIN.lat + 0.0003, lng: PIN.lng - 0.0002 },
      { lat: PIN.lat - 0.0004, lng: PIN.lng + 0.0003 },
    ]
    const results = pinsInsideBoundary.map(pin =>
      applyTpPostConditions(tps, pin, { coordinates: boundary, classification: { maxEdgeDistanceM: 300 } })
    )
    const signature = (r: ReturnType<typeof applyTpPostConditions>) => ({
      kept: r.kept.map(t => t.id).sort(),
      dropped: r.dropped.map(d => `${d.tp.id}:${d.reason}`).sort(),
    })
    const [first, ...rest] = results.map(signature)
    for (const s of rest) assert.deepEqual(s, first, 'a distância é medida à borda (INV-E6), não ao pino — mover o pino dentro dela não pode mudar o corte')
  })
})

describe('P4/P8, BR-POI-009, BR-AUDIO-010 — aumentar a altura do POI nunca reduz o alcance', () => {
  it('fanHorizonM é não-decrescente em effectiveHeightM, para toda combinação de classe/proeminência', () => {
    const heights = [0, 5, 10, 30, 60, 100, 300, 800, 1500]
    for (const cls of [undefined, VisibilityClass.LANDMARK_HIGH, VisibilityClass.STRUCTURE, VisibilityClass.POINT_LOW]) {
      for (const prominenceM of [0, 50, LANDMARK_MIN_PROMINENCE_M, 500]) {
        let prev = -Infinity
        for (const effectiveHeightM of heights) {
          const h = fanHorizonM({ cls, effectiveHeightM, prominenceM })
          assert.ok(h >= prev, `cls=${cls} prominenceM=${prominenceM}: horizonte caiu de ${prev} para ${h} ao subir a altura para ${effectiveHeightM}m`)
          prev = h
        }
      }
    }
  })

  it('maxEdgeDistanceFor é não-decrescente em prominenceM, para toda classe', () => {
    const prominences = [0, 50, LANDMARK_MIN_PROMINENCE_M - 1, LANDMARK_MIN_PROMINENCE_M, LANDMARK_MIN_PROMINENCE_M + 1, 5_000]
    for (const cls of Object.values(VisibilityClass)) {
      let prev = -Infinity
      for (const prominenceM of prominences) {
        const d = maxEdgeDistanceFor(cls, prominenceM)
        assert.ok(d >= prev, `${cls}: alcance caiu de ${prev} para ${d} ao subir a proeminência para ${prominenceM}m`)
        prev = d
      }
    }
  })
})

describe('INV-E11, BR-AUDIO-010 — nenhum TP mantido viola uma pós-condição', () => {
  it('sobre um lote misto (dentro/fora do alcance, mão única a favor/contra, dentro/fora da borda), todo `kept` está limpo nas três frentes', () => {
    const boundary = square(PIN, 0.0004) // ~90 m de lado
    const onewayEastForward = { coordinates: [{ lat: PIN.lat, lng: PIN.lng - 0.01 }, { lat: PIN.lat, lng: PIN.lng + 0.01 }], tags: { oneway: 'yes' } } as any
    const bidi = { coordinates: [{ lat: PIN.lat, lng: PIN.lng - 0.01 }, { lat: PIN.lat, lng: PIN.lng + 0.01 }] } as any

    const batch: TriggerPoint[] = [
      tp({ id: 'ok-near', location: { lat: PIN.lat + 0.001, lng: PIN.lng }, street: bidi, expectedBearing: 180 }),
      tp({ id: 'ok-oneway-front', location: { lat: PIN.lat + 0.0009, lng: PIN.lng }, street: onewayEastForward, expectedBearing: 90 }),
      tp({ id: 'bad-far', location: { lat: PIN.lat + 0.05, lng: PIN.lng }, street: bidi, expectedBearing: 180 }),
      tp({ id: 'bad-oneway-back', location: { lat: PIN.lat + 0.0009, lng: PIN.lng }, street: onewayEastForward, expectedBearing: 270 }),
      tp({ id: 'bad-inside', location: PIN, street: bidi, expectedBearing: 0 }),
    ]
    const classification = { group: VisibilityClass.STRUCTURE, maxEdgeDistanceM: 300 }
    const { kept, reachCapM } = applyTpPostConditions(batch, PIN, { coordinates: boundary, classification })

    assert.ok(kept.length > 0 && kept.length < batch.length, 'a fixture tem que gerar mantidos E descartados, senão a propriedade não é exercida')
    for (const t of kept) {
      const distM = distanceFromPoiM(t.location, PIN, boundary)
      assert.ok(distM <= reachCapM, `${t.id}: ${distM}m excede o teto de ${reachCapM}m (INV-E6)`)
      assert.deepEqual(dropUnfireable([t]), [t], `${t.id}: não pode disparar em nenhum sentido legal (INV-E9)`)
      assert.equal(isPointInPolygon(t.location, boundary), false, `${t.id}: está dentro da borda (INV-E11)`)
    }
  })
})
