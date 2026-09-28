import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  VisibilityClass,
  classifyVisibility,
  visibilityClassRule,
  resolveHeightM,
  fanHorizonM,
  LANDMARK_MIN_PROMINENCE_M,
  BUILDING_LEVEL_HEIGHT_M,
} from '@/lib/services/trigger-points-google/config/visibility-class'
import { tpReachCapM, UNCLASSIFIED_MAX_TP_DISTANCE_M } from '@/lib/services/trigger-points-google/utils/validation'
import { applyTpPostConditions, bestStreetPointOutside, dropInsidePoi, REACH_RESCUE_METHOD } from '@/lib/services/trigger-points-google/utils/tp-selection'
import { measureAndClassify } from '@/lib/services/trigger-points-google/services/poi-classifier.service'
import { ElevationAnalysisService } from '@/lib/services/trigger-points-google/services/elevation-service'
import { LocalOSMFetcher } from '@/lib/services/trigger-points-google/services/local-osm-fetcher'
import type { TriggerPoint } from '@/lib/services/trigger-points-google/types/interfaces'

// Motor de TP (#772), fonte: docs/arquitetura/cms/motor-de-tp.md. Camada "unidade" da
// estratégia de teste — funções puras, dado literal, sem rede e sem banco.

const PIN = { lat: -22.9030, lng: -43.1740 }

function square(halfSideDeg = 0.0003) {
  const d = halfSideDeg
  return [
    { lat: PIN.lat - d, lng: PIN.lng - d }, { lat: PIN.lat - d, lng: PIN.lng + d },
    { lat: PIN.lat + d, lng: PIN.lng + d }, { lat: PIN.lat + d, lng: PIN.lng - d },
  ]
}

function tp(over: Partial<TriggerPoint> & { location: TriggerPoint['location'] }): TriggerPoint {
  return {
    id: 'tp', radius: 20, expectedBearing: 0, bearingThreshold: 45, type: 'primary',
    priority: 5, confidence: 0.8, quality: 0.8, street: undefined as any, distance: 0,
    generationMethod: 'local_osm', ...over,
  }
}

describe('INV-E5b, BR-AUDIO-010 — classifyVisibility: relevo é medido, nunca lido da tag (2026-09-27)', () => {
  it('proeminência 262 m (cidade e local) → landmark_high sem tag nenhuma (Pico Irmão Menor, #779)', () => {
    const cls = classifyVisibility({ heightM: 0, prominenceM: 262, localProminenceM: 262, areaM2: 0 })
    assert.equal(cls, VisibilityClass.LANDMARK_HIGH)
  })

  it('um mirante sem altura, proeminência nem área medidas é point_low — não existe classe por tag de mirante', () => {
    assert.equal(classifyVisibility({ heightM: 0, prominenceM: 0, areaM2: 0 }), VisibilityClass.POINT_LOW)
    assert.equal(Object.values(VisibilityClass).includes('viewpoint' as VisibilityClass), false)
  })
})

describe('INV-E5b, BR-AUDIO-010 — proeminência sobre a cidade E sobre o anel local (#772)', () => {
  it('platô: alto sobre a cidade e plano sobre a vizinhança não é landmark (Igreja de Fátima: 245 m sobre a cidade, ~0 local)', () => {
    const r = visibilityClassRule({ heightM: 0, prominenceM: 245, localProminenceM: 0, areaM2: 400 })
    assert.notEqual(r.cls, VisibilityClass.LANDMARK_HIGH)
  })

  it('pico sobre a cidade e sobre a vizinhança é landmark (Cristo: 713 m e ~600 m)', () => {
    assert.equal(visibilityClassRule({ heightM: 12, prominenceM: 713, localProminenceM: 618, areaM2: 0 }).rule, 'landmark_prominence')
  })

  it('proeminência local desconhecida não faz landmark (INV-E5c)', () => {
    assert.notEqual(visibilityClassRule({ heightM: 0, prominenceM: 300, localProminenceM: null, areaM2: 0 }).cls, VisibilityClass.LANDMARK_HIGH)
  })
})

describe('INV-E5, BR-AUDIO-010 — altura conhecida de estrutura vem antes da forma', () => {
  it('um prédio longo e estreito com 15 m é structure, não linear (Museu do Amanhã)', () => {
    const lng0 = PIN.lng, lat0 = PIN.lat
    const longNarrow = [
      { lat: lat0 - 0.0002, lng: lng0 - 0.002 }, { lat: lat0 - 0.0002, lng: lng0 + 0.002 },
      { lat: lat0 + 0.0002, lng: lng0 + 0.002 }, { lat: lat0 + 0.0002, lng: lng0 - 0.002 },
    ]
    const r = visibilityClassRule({ heightM: 15, prominenceM: 14, localProminenceM: 0, areaM2: 11_000, boundary: longNarrow })
    assert.deepEqual(r, { cls: VisibilityClass.STRUCTURE, rule: 'structure_height' })
  })

  it('a mesma forma sem altura (orla, praia) continua linear', () => {
    const lng0 = PIN.lng, lat0 = PIN.lat
    const longNarrow = [
      { lat: lat0 - 0.0002, lng: lng0 - 0.002 }, { lat: lat0 - 0.0002, lng: lng0 + 0.002 },
      { lat: lat0 + 0.0002, lng: lng0 + 0.002 }, { lat: lat0 + 0.0002, lng: lng0 - 0.002 },
    ]
    assert.equal(visibilityClassRule({ heightM: 0, prominenceM: 0, localProminenceM: 0, areaM2: 11_000, boundary: longNarrow }).cls, VisibilityClass.LINEAR)
  })
})

describe('INV-E5a, BR-AUDIO-010 — classifyVisibility é função pura dos atributos físicos', () => {
  it('duas chamadas com os mesmos atributos físicos e tags de nome/categoria diferentes dão a mesma classe', () => {
    const base = { heightM: 3, prominenceM: 0, areaM2: 500 }
    const a = classifyVisibility({ ...base })
    const b = classifyVisibility({ ...base })
    assert.equal(a, b, 'nome/categoria do POI não é lido pelo classificador (P3)')
  })
})

describe('INV-E6, BR-AUDIO-010 — tpReachCapM: uma régua, sempre limitada pelo teto de sanidade', () => {
  it('sem classificação usa o teto do POI não classificado', () => {
    assert.equal(tpReachCapM(undefined), UNCLASSIFIED_MAX_TP_DISTANCE_M)
    assert.equal(tpReachCapM(null), UNCLASSIFIED_MAX_TP_DISTANCE_M)
  })

  it('com classificação normal, usa maxEdgeDistanceM da classe', () => {
    assert.equal(tpReachCapM({ maxEdgeDistanceM: 5_000 }), 5_000)
  })

  it('maxEdgeDistanceM absurdo é sempre limitado pelo teto de sanidade (15 km)', () => {
    assert.equal(tpReachCapM({ maxEdgeDistanceM: 999_999 }), 15_000)
  })
})

describe('INV-E6, BR-AUDIO-010 — fanHorizonM: alcance medido pela classe e pela proeminência', () => {
  it('landmark_high sem proeminência real fica limitado ao horizonte urbano (2 km)', () => {
    const h = fanHorizonM({ cls: VisibilityClass.LANDMARK_HIGH, effectiveHeightM: 500, prominenceM: 0 })
    assert.equal(h, 2_000)
  })

  it('landmark_high com proeminência real pode alcançar o teto de sanidade (15 km)', () => {
    const h = fanHorizonM({ cls: VisibilityClass.LANDMARK_HIGH, effectiveHeightM: 1_500, prominenceM: LANDMARK_MIN_PROMINENCE_M })
    assert.equal(h, 15_000)
  })

  it('classe baixa/local usa o teto fixo da classe, não a fórmula de altura', () => {
    const h = fanHorizonM({ cls: VisibilityClass.POINT_LOW, effectiveHeightM: 500, prominenceM: 0 })
    assert.equal(h, 60, 'point_low: maxEdgeDistanceM da tabela é 60')
  })
})

describe('INV-E3, BR-AUDIO-010 — resolveHeightM: ordem das fontes de altura', () => {
  it('height real vence tudo', () => {
    const r = resolveHeightM({ height: '45m', 'building:levels': '3' }, 10)
    assert.deepEqual(r, { heightM: 45, source: 'height' })
  })

  it('sem height real, building:levels × BUILDING_LEVEL_HEIGHT_M vence a altura já conhecida', () => {
    const r = resolveHeightM({ 'building:levels': '3' }, 10)
    assert.deepEqual(r, { heightM: 3 * BUILDING_LEVEL_HEIGHT_M, source: 'levels' })
  })

  it('sem height nem levels, a altura medida em outro elemento (hospedeiro) vale', () => {
    assert.deepEqual(resolveHeightM({ building: 'church' }, 8), { heightM: 8, source: 'known' })
  })

  it('não existe altura por tipo: estátua, torre, igreja e monumento sem altura medida saem com 0 e fonte "none" (2026-09-27)', () => {
    for (const tags of [{ memorial: 'statue' }, { man_made: 'tower' }, { historic: 'monument' }, { building: 'church' }]) {
      assert.deepEqual(resolveHeightM(tags), { heightM: 0, source: 'none' }, JSON.stringify(tags))
    }
  })
})

describe('INV-E4c, BR-AUDIO-010 — proeminência quando o DEM está indisponível', () => {
  it('sem elevação do POI (DEM não respondeu), a proeminência sai null, não um 0 silencioso', async () => {
    const groundTop = mock.method(ElevationAnalysisService, 'groundTop', async () => ({ groundM: null, source: 'none', at: null }) as any)
    const cityBase = mock.method(ElevationAnalysisService, 'cityBaseElevation', async () => ({ baseM: 9, source: 'test' }) as any)
    const summits = mock.method(LocalOSMFetcher.prototype, 'fetchSummits', () => [])
    try {
      const { classification, physical } = await measureAndClassify({
        poiData: { id: 'poi-1', name: 'Sem DEM', location: PIN, type: 'attraction', country: 'BR', city: 'Rio de Janeiro' } as any,
        areaM2: 0,
        tags: {},
      })
      assert.equal(physical.prominenceM, null, 'proeminência desconhecida é null')
      assert.equal(classification.metadata.elevationDiff, null, 'esperado: null explícito, não 0')
    } finally {
      groundTop.mock.restore(); cityBase.mock.restore(); summits.mock.restore()
    }
  })
})

describe('INV-E11, BR-AUDIO-010 — post-condições isoladas, uma por motivo', () => {
  it('beyond_reach: TP além do alcance da classe é descartado com o motivo correto', () => {
    const near = tp({ id: 'near', location: { lat: PIN.lat + 0.0002, lng: PIN.lng } })
    const far = tp({ id: 'far', location: { lat: PIN.lat + 0.02, lng: PIN.lng } }) // ~2.2 km
    const { kept, dropped } = applyTpPostConditions([near, far], PIN, { classification: { maxEdgeDistanceM: 300 } })
    assert.deepEqual(kept.map(t => t.id), ['near'])
    assert.deepEqual(dropped, [{ tp: far, reason: 'beyond_reach' }])
  })

  it('INV-E9, BR-POI-009 — mão única do OSM não descarta: TP em via oneway=yes que flui para longe do POI é mantido', () => {
    // Rua de oeste (coords[0]) para leste (coords[1]); expectedBearing 270 põe o POI "atrás" de
    // quem dirige no sentido da via. Pedestre e ciclista não seguem esse sentido, e o oneway do
    // OSM costuma estar velho (operador, 2026-09-28).
    const westEastStreet = { coordinates: [{ lat: PIN.lat, lng: PIN.lng - 0.01 }, { lat: PIN.lat, lng: PIN.lng + 0.01 }], tags: { oneway: 'yes' } } as any
    const back = tp({ id: 'back', location: { lat: PIN.lat + 0.0002, lng: PIN.lng }, street: westEastStreet, expectedBearing: 270 })
    const { kept, dropped } = applyTpPostConditions([back], PIN, { classification: { maxEdgeDistanceM: 300 } })
    assert.deepEqual(kept.map(t => t.id), ['back'])
    assert.deepEqual(dropped, [])
  })

  it('inside_poi: TP dentro da borda é descartado', () => {
    const inside = { location: { lat: PIN.lat, lng: PIN.lng } }
    const outside = { location: { lat: PIN.lat + 0.001, lng: PIN.lng } }
    const kept = dropInsidePoi([inside, outside], { coordinates: square(), classification: { group: VisibilityClass.STRUCTURE } })
    assert.deepEqual(kept, [outside])
  })

  it('classe area — TP dentro da borda também é descartado (INV-E11, decisão de 2026-09-27)', () => {
    const inside = { location: { lat: PIN.lat, lng: PIN.lng } }
    const kept = dropInsidePoi([inside], { coordinates: square(), classification: { group: VisibilityClass.AREA } })
    assert.deepEqual(kept, [])
  })

  it('TP sobre a borda conta como dentro (INV-E11)', () => {
    const onEdge = { location: { lat: PIN.lat - 0.0003, lng: PIN.lng } }
    assert.deepEqual(dropInsidePoi([onEdge], { coordinates: square(), classification: { group: VisibilityClass.STRUCTURE } }), [])
  })

  it('classe linear — TP dentro da borda também é descartado: quem está dentro ouve pelo boundary (BR-AUDIO-009/013)', () => {
    const inside = { location: { lat: PIN.lat, lng: PIN.lng } }
    const kept = dropInsidePoi([inside], { coordinates: square(), classification: { group: VisibilityClass.LINEAR } })
    assert.deepEqual(kept, [])
  })

  it('borda sintética nunca é usada para descartar por "dentro" (INV-E1b: círculo sintético não é o footprint)', () => {
    const inside = { location: { lat: PIN.lat, lng: PIN.lng } }
    const kept = dropInsidePoi([inside], { coordinates: square(), synthetic: true, classification: { group: VisibilityClass.STRUCTURE } })
    assert.deepEqual(kept, [inside], 'com synthetic=true a borda não entra no polígono de corte')
  })
})

describe('INV-E11b, BR-AUDIO-010 — POI com borda nunca termina com 0 TP (Ilha das Cobras, #772)', () => {
  const ring = square() // ~66 m de lado
  const street = (id: string, type: string, lngOffsetDeg: number) => ({
    id, type, name: id, accessibility: 'public', confidence: 1,
    coordinates: [{ lat: PIN.lat - 0.002, lng: PIN.lng + lngOffsetDeg }, { lat: PIN.lat + 0.002, lng: PIN.lng + lngOffsetDeg }],
  })

  it('o ponto escolhido fica fora da borda, na via melhor ranqueada; via que cruza a borda vale só pelo trecho de fora', () => {
    const crossing = street('crossing', 'residential', 0) // atravessa o POI: dentro não conta
    const far = street('far', 'primary', 0.004) // ~410 m
    const best = bestStreetPointOutside([crossing as any, far as any], ring)
    assert.equal(best?.street.id, 'crossing')
    assert.ok(best!.edgeDistanceM >= 1 && best!.edgeDistanceM < 10, `${best!.edgeDistanceM} m`)
    assert.equal(bestStreetPointOutside([street('in', 'residential', 0.0001) as any].map(s => ({ ...s, coordinates: [{ lat: PIN.lat, lng: PIN.lng }, { lat: PIN.lat + 0.0001, lng: PIN.lng }] })), ring), null)
  })

  it('o TP de resgate responde ao teto de sanidade, não ao alcance da classe; um TP comum além do alcance segue descartado', () => {
    const at = { lat: PIN.lat, lng: PIN.lng + 0.003 } // ~270 m da borda
    const rescue = tp({ id: 'rescue', location: at, generationMethod: REACH_RESCUE_METHOD })
    const plain = tp({ id: 'plain', location: at })
    const boundary = { coordinates: ring, classification: { maxEdgeDistanceM: 60 } }
    const { kept, dropped } = applyTpPostConditions([rescue, plain], PIN, boundary)
    assert.deepEqual(kept.map(t => t.id), ['rescue'])
    assert.deepEqual(dropped.map(d => [d.tp.id, d.reason]), [['plain', 'beyond_reach']])
    const inside = tp({ id: 'inside', location: PIN, generationMethod: REACH_RESCUE_METHOD })
    assert.deepEqual(applyTpPostConditions([inside], PIN, boundary).kept, [], 'resgate dentro da borda também cai')
  })
})
