import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  VisibilityClass,
  classifyVisibility,
  visibilityClassRule,
  resolveHeightM,
  fanHorizonM,
  LANDMARK_MIN_PROMINENCE_M,
  DEFAULT_HEIGHT_BY_TAG,
  BUILDING_LEVEL_HEIGHT_M,
} from '@/lib/services/trigger-points-google/config/visibility-class'
import { tpReachCapM, UNCLASSIFIED_MAX_TP_DISTANCE_M } from '@/lib/services/trigger-points-google/utils/validation'
import { applyTpPostConditions, dropUnfireable, dropInsidePoi } from '@/lib/services/trigger-points-google/utils/tp-selection'
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

describe('INV-E5b, BR-AUDIO-010 — classifyVisibility: relevo natural vence a tag de mirante', () => {
  it('proeminência 262 m (cidade e local) + natural=peak → landmark_high, mesmo com tourism=viewpoint na mesma tag', () => {
    const cls = classifyVisibility({
      heightM: 0, prominenceM: 262, localProminenceM: 262, areaM2: 0,
      tags: { natural: 'peak', tourism: 'viewpoint' },
    })
    assert.equal(cls, VisibilityClass.LANDMARK_HIGH, 'viewpoint não vence o relevo natural (Pico Irmão Menor, #779)')
  })

  it('tourism=viewpoint sozinho, sem relevo natural e sem altura/proeminência → viewpoint', () => {
    const cls = classifyVisibility({ heightM: 0, prominenceM: 0, areaM2: 0, tags: { tourism: 'viewpoint' } })
    assert.equal(cls, VisibilityClass.VIEWPOINT)
  })

  it('proeminência acima do limiar classifica landmark_high sem tag de relevo (via física, não via nome)', () => {
    const cls = classifyVisibility({ heightM: 0, prominenceM: LANDMARK_MIN_PROMINENCE_M + 1, localProminenceM: LANDMARK_MIN_PROMINENCE_M + 1, areaM2: 0, tags: {} })
    assert.equal(cls, VisibilityClass.LANDMARK_HIGH)
  })
})

describe('INV-E5b, BR-AUDIO-010 — proeminência sobre a cidade E sobre o anel local (#772)', () => {
  it('platô: alto sobre a cidade e plano sobre a vizinhança não é landmark (Igreja de Fátima: 245 m sobre a cidade, ~0 local)', () => {
    const r = visibilityClassRule({ heightM: 0, prominenceM: 245, localProminenceM: 0, areaM2: 400, tags: { building: 'church' } })
    assert.notEqual(r.cls, VisibilityClass.LANDMARK_HIGH)
  })

  it('pico sobre a cidade e sobre a vizinhança é landmark (Cristo: 713 m e ~600 m)', () => {
    assert.equal(visibilityClassRule({ heightM: 12, prominenceM: 713, localProminenceM: 618, areaM2: 0, tags: {} }).rule, 'landmark_prominence')
  })

  it('proeminência local desconhecida não faz landmark (INV-E5c)', () => {
    assert.notEqual(visibilityClassRule({ heightM: 0, prominenceM: 300, localProminenceM: null, areaM2: 0, tags: {} }).cls, VisibilityClass.LANDMARK_HIGH)
  })
})

describe('INV-E5, BR-AUDIO-010 — altura conhecida de estrutura vem antes da forma', () => {
  it('um prédio longo e estreito com 15 m é structure, não linear (Museu do Amanhã)', () => {
    const lng0 = PIN.lng, lat0 = PIN.lat
    const longNarrow = [
      { lat: lat0 - 0.0002, lng: lng0 - 0.002 }, { lat: lat0 - 0.0002, lng: lng0 + 0.002 },
      { lat: lat0 + 0.0002, lng: lng0 + 0.002 }, { lat: lat0 + 0.0002, lng: lng0 - 0.002 },
    ]
    const r = visibilityClassRule({ heightM: 15, prominenceM: 14, localProminenceM: 0, areaM2: 11_000, boundary: longNarrow, tags: { tourism: 'museum' } })
    assert.deepEqual(r, { cls: VisibilityClass.STRUCTURE, rule: 'structure_height' })
  })

  it('a mesma forma sem altura (orla, praia) continua linear', () => {
    const lng0 = PIN.lng, lat0 = PIN.lat
    const longNarrow = [
      { lat: lat0 - 0.0002, lng: lng0 - 0.002 }, { lat: lat0 - 0.0002, lng: lng0 + 0.002 },
      { lat: lat0 + 0.0002, lng: lng0 + 0.002 }, { lat: lat0 + 0.0002, lng: lng0 - 0.002 },
    ]
    assert.equal(visibilityClassRule({ heightM: 0, prominenceM: 0, localProminenceM: 0, areaM2: 11_000, boundary: longNarrow, tags: { natural: 'beach' } }).cls, VisibilityClass.LINEAR)
  })
})

describe('INV-E5a, BR-AUDIO-010 — classifyVisibility é função pura dos atributos físicos', () => {
  it('duas chamadas com os mesmos atributos físicos e tags de nome/categoria diferentes dão a mesma classe', () => {
    const base = { heightM: 3, prominenceM: 0, areaM2: 500 }
    const a = classifyVisibility({ ...base, tags: { name: 'Busto A', category: 'monument' } as any })
    const b = classifyVisibility({ ...base, tags: { name: 'Busto B completamente diferente', category: 'x' } as any })
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

  it('sem height nem levels, a tabela por tag vem antes da altura medida em outro elemento (ordem da spec)', () => {
    const r = resolveHeightM({ building: 'church' }, 8)
    assert.equal(r.source, 'tag_default', 'o vizinho medido não vence a tabela: o Cristo pegava os 24 m de um quiosque (P8)')
  })

  it('sem tag na tabela, a altura medida em outro elemento (hospedeiro) ainda vale', () => {
    assert.deepEqual(resolveHeightM({ amenity: 'tag_que_nao_existe_na_tabela' }, 8), { heightM: 8, source: 'known' })
  })

  it('sem nenhuma das três, cai na tabela por tag — estátua, torre e monumento nunca saem com 0', () => {
    assert.deepEqual(resolveHeightM({ memorial: 'statue' }), { heightM: 6, source: 'tag_default' })
    assert.deepEqual(resolveHeightM({ man_made: 'tower' }), { heightM: 30, source: 'tag_default' })
    assert.deepEqual(resolveHeightM({ historic: 'monument' }), { heightM: 12, source: 'tag_default' })
  })

  it('tag mais específica (valor exato) vence o coringa building=*', () => {
    const r = resolveHeightM({ building: 'church' })
    const exactRow = DEFAULT_HEIGHT_BY_TAG.find(row => row.key === 'building' && row.value === 'church')!
    assert.equal(r.heightM, exactRow.heightM, 'church (25 m) vence o building=* genérico (10 m)')
  })

  it('sem tag nenhuma que bata na tabela, a altura sai 0 e a fonte é "none" (não silenciosa: `source` denuncia)', () => {
    assert.deepEqual(resolveHeightM({ amenity: 'tag_que_nao_existe_na_tabela' }), { heightM: 0, source: 'none' })
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

  it('unfireable: via de mão única cujo sentido deixa o POI atrás do usuário é descartada', () => {
    // Rua indo de oeste (coords[0]) para leste (coords[1]) — forward bearing ~90°.
    const westEastStreet = { coordinates: [{ lat: PIN.lat, lng: PIN.lng - 0.01 }, { lat: PIN.lat, lng: PIN.lng + 0.01 }], tags: { oneway: 'yes' } } as any
    // expectedBearing 270 (POI a oeste do TP): delta com o forward (90°) é 180° → zona "back".
    const back = tp({ id: 'back', location: PIN, street: westEastStreet, expectedBearing: 270 })
    // expectedBearing 90: delta 0° com o forward → zona "front", passa.
    const front = tp({ id: 'front', location: PIN, street: westEastStreet, expectedBearing: 90 })
    const kept = dropUnfireable([back, front])
    assert.deepEqual(kept.map(t => t.id), ['front'])
  })

  it('bidirecional (sem oneway) nunca é descartada por sentido', () => {
    const bidi = { coordinates: [{ lat: PIN.lat, lng: PIN.lng - 0.01 }, { lat: PIN.lat, lng: PIN.lng + 0.01 }] } as any
    const t = tp({ id: 'bidi', location: PIN, street: bidi, expectedBearing: 270 })
    assert.deepEqual(dropUnfireable([t]).map(x => x.id), ['bidi'])
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
