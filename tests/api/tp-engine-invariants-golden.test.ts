import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Motor de TP (#772) — camada "conjunto de referência" (golden) da estratégia de teste.
// Fonte: docs/arquitetura/cms/motor-de-tp.md, tabela "Conjunto de referência". Roda o motor
// em dry-run (sem gravar) contra o local_osm.db e compara PROPRIEDADE, nunca coordenada exata:
// zona nomeada (bbox), classe esperada, distância em faixa, contagem, "nenhum dentro da borda".
//
// Calibrado uma vez pelo operador olhando o mapa (2026-09-27, #779). Depois disso, barra
// regressão — não recalibre o esperado para o teste passar; se o alvo mudou, isso é decisão
// do Tech Lead (docs/arquitetura/cms/motor-de-tp.md).
//
// 2026-09-27 (test/tp-golden-zones): a asserção antiga de "N setores a mais de 1 km" não sabia
// ONDE os TPs caíam, e o golden não conferia a classe. Esta revisão soma zonas nomeadas (a
// coluna "Esperado" nomeia lugares) e a classe por POI, citando `{ todo }` onde a `-e` diverge —
// sem enfraquecer a asserção.

const LOCAL_OSM_DB = join(process.cwd(), 'data', 'local_osm.db')
const HAS_LOCAL_OSM = existsSync(LOCAL_OSM_DB)
const HAS_SUPABASE_ENV = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY))
const CAN_RUN = HAS_LOCAL_OSM && HAS_SUPABASE_ENV
const SKIP_REASON = !HAS_LOCAL_OSM
  ? `local_osm.db ausente em ${LOCAL_OSM_DB} — golden do motor de TP pulado (INV-E1..E11 sem cobertura de regressão nesta rodada)`
  : 'credenciais Supabase ausentes no ambiente — golden precisa resolver o POI pelo nome (core.attractions)'

/** id em core.attractions — o nome não é único (há várias "Nossa Senhora de Fátima") nem igual ao do banco */
const POI_ID = {
  cristoRedentor: 'ae3a6d91-feef-46f7-aae2-a34c3db12c04',
  paoDeAcucar: '5f16ab45-6923-5184-8ee7-0c5d4c0e4be4',
  picoDoIrmaoMenor: '064f0acf-0673-5cef-ad71-11e0c4693164',
  morroDoPatronato: '03673109-74ec-5a7d-ae44-a0ca58eec4b8',
  maracana: 'ad1fd646-07f5-5576-b571-dca112dab834',
  praiaDoRecreio: '176522ba-08e2-529b-8413-943ab6c91767',
  cidadeDasArtes: '0004411f-b2b3-4d8c-9074-461e066d7976',
  museuDoAmanha: '3d4a364e-6d47-5aab-aa23-6b1a122be84b',
  bustoMazziniBueno: '11959605-51aa-50ba-97ed-52ceac770755',
  igrejaFatima: '0a2f51c0-5aec-5cc2-b50f-075849c1fe28',
  manguinhos: '0e9ce786-18bf-5ad1-9047-7274dfdef163',
  // Niterói, no osm_id and no tags: the border must not be the Praça do Radio Amador (#772)
  arvoreDeNatal: '09778cda-2a33-4469-b6bd-7cca2726049c',
  // water all around, the only bridge a military `service` way: every candidate died in reach (#772)
  ilhaDasCobras: '0fffc071-fb34-5e23-a553-97f0797ff2cd',
  // relation 2339171, 72 k m², `area`: streets on four sides within 60 m, 3 TPs (#772)
  estadioNiltonSantos: '96a4d109-8f9f-5b05-97d9-6b643bc39a75',
  // `area`: ~1 km of Av. Borges de Medeiros (west side) without a TP (#772)
  lagoaRodrigoDeFreitas: '6fa9bdc9-b92f-5107-8d20-40021dc3f2ed',
  // way/70601800: its one TP sat on the Navy's private dock (access=private) (#772)
  ilhaFiscal: 'bb5e4bf8-8903-5044-ac0a-30e2754050e1',
  // relief landmarks over the Tijuca forest: #784 swapped their city TPs for forest roads
  miranteVistaParaACidade: 'cf6e7661-d145-5635-bbc6-63604817b871',
  picoDaCarioca: '47b2f61d-a73a-5a4c-8b73-414a7de49ae0',
} as const

const CITY = 'Rio de Janeiro'

// ---- dry-run com cache por POI: as quatro camadas de teste abaixo (classe, zona, estrutura,
// via rápida) rodam o motor uma vez só por POI e reusam o resultado. ----
type DryRunResult = Awaited<ReturnType<typeof import('@/lib/services/tp-dry-run').dryRunPoi>>
let dryRunPoiFn: typeof import('@/lib/services/tp-dry-run').dryRunPoi | null = null
const resultCache = new Map<string, Promise<DryRunResult>>()
function getResult(id: string): Promise<DryRunResult> {
  let p = resultCache.get(id)
  if (!p) {
    p = (async () => {
      if (!dryRunPoiFn) ({ dryRunPoi: dryRunPoiFn } = await import('@/lib/services/tp-dry-run'))
      return dryRunPoiFn!(id)
    })()
    resultCache.set(id, p)
  }
  return p
}
function keptOf(result: DryRunResult) {
  return result.rows.filter(r => r.source === 'generated' && !r.drop_reason)
}
/** Classe do POI (E5), lida do rastro — `visibility-class#visibilityClassRule` grava `${classe} (${regra})` */
function classOf(result: DryRunResult): string {
  const row = result.trace.find(r => r.rule === 'visibility-class#visibilityClassRule')
  return row?.value.split(' ')[0] ?? 'unknown'
}

function sectorOf(bearingDeg: number): number {
  return Math.floor((((bearingDeg % 360) + 360) % 360) / 45)
}
/** Bearing from `a` to `b`. Coverage around a POI is where the TP stands seen from the pin — not
 *  `r.bearing`, which is the TP's `expected_bearing`, the direction of travel (#786). */
function bearingFrom(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r)
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r)
  return (Math.atan2(y, x) / r + 360) % 360
}
/** 45° sector of a kept TP seen from the POI pin */
function positionSector(result: DryRunResult, r: { lat: number; lng: number }): number {
  assert.ok(result.pin, 'dry-run without the pin')
  return sectorOf(bearingFrom(result.pin!, r))
}

// ============================================================================================
// Zonas nomeadas — coordenadas extraídas de `data/local_osm.db` em 2026-09-27 (mesmo arquivo
// que o golden usa), não digitadas de memória: centróide de `pois` com `place=suburb` para
// bairro, bbox real de `streets`/`pois` (leisure=park) para avenida e parque. Cada zona traz a
// fonte no comentário. Margem de ~0.3-1 km ao redor da fonte para cobrir a extensão real do
// lugar, sem virar bbox tão largo que deixe de discriminar nada.
// ============================================================================================
type BBox = { latMin: number; latMax: number; lngMin: number; lngMax: number }
const inZone = (lat: number, lng: number, z: BBox): boolean =>
  lat >= z.latMin && lat <= z.latMax && lng >= z.lngMin && lng <= z.lngMax

const ZONES: Record<string, BBox> = {
  // pois.place='suburb' "Copacabana": -22.971974,-43.1842997
  copacabana: { latMin: -22.990, latMax: -22.963, lngMin: -43.203, lngMax: -43.176 },
  // pois.place='suburb' "Botafogo": -22.9515096,-43.1862969
  botafogo: { latMin: -22.963, latMax: -22.940, lngMin: -43.197, lngMax: -43.175 },
  // pois.place='suburb' "Lagoa": -22.9624658,-43.2024884
  lagoa: { latMin: -22.980, latMax: -22.955, lngMin: -43.218, lngMax: -43.192 },
  // pois.place='suburb' "Humaitá" -22.9546413,-43.2004797 + "Jardim Botânico" -22.9636362,-43.2233457, zona combinada (o texto do card as trata como uma)
  humaitaJardimBotanico: { latMin: -22.975, latMax: -22.948, lngMin: -43.235, lngMax: -43.192 },
  // pois.place='suburb' "Urca": -22.954074,-43.1679727, alargada a leste até a Praia Vermelha
  urca: { latMin: -22.962, latMax: -22.943, lngMin: -43.180, lngMax: -43.150 },
  // pois leisure='park' "Aterro do Flamengo": bbox real -22.9442718/-22.9104742, -43.1786017/-43.1672332
  aterroDoFlamengo: { latMin: -22.946, latMax: -22.908, lngMin: -43.181, lngMax: -43.165 },
  // pois.place='suburb' "Leme": -22.961704,-43.1669042
  leme: { latMin: -22.972, latMax: -22.958, lngMin: -43.175, lngMax: -43.163 },
  // streets "Avenida Delfim Moreira" (orla do Leblon) no Rio: bbox real -22.9886/-22.9861, -43.2279/-43.2153
  orlaDoLeblon: { latMin: -22.992, latMax: -22.983, lngMin: -43.230, lngMax: -43.213 },
  // streets "Avenida Vieira Souto" (orla de Ipanema) no Rio: bbox real -22.9879/-22.9860, -43.2154/-43.1946
  orlaDeIpanema: { latMin: -22.991, latMax: -22.983, lngMin: -43.217, lngMax: -43.193 },
  // streets "Avenida das Américas", segmento junto à Cidade das Artes: bbox real -23.0013/-22.9964, -43.3896/-43.3365
  avenidaDasAmericas: { latMin: -23.004, latMax: -22.994, lngMin: -43.392, lngMax: -43.334 },
  // streets "Avenida Ayrton Senna", segmento junto à Cidade das Artes: bbox real -23.0107/-22.9777, -43.3691/-43.3629
  avenidaAyrtonSenna: { latMin: -23.013, latMax: -22.975, lngMin: -43.372, lngMax: -43.360 },
}

// The rows of the "Conjunto de referência" table. Manguinhos is still to calibrate, but "no TP
// inside the border" holds for every POI of every class (BR-AUDIO-009/013: inside the border the
// boundary fires, so a TP only exists outside it).
type Check = {
  poi: string
  id: string
  city: string
  /** TPs "generated" mantidos (sem drop_reason) têm que existir nesta faixa de contagem */
  countRange?: [number, number]
  /** ao menos N setores de 45° distintos, entre os TPs a mais de farDistM da borda */
  farSectors?: { minDistM: number; atLeast: number }
  /** nenhum TP mantido pode estar dentro da borda (drop_reason nunca é inside_poi teria cortado; aqui conferimos que o corte realmente aconteceu quando aplicável) */
  noneInsideBoundary?: boolean
  /** todo TP mantido fica a no máximo este tanto da borda */
  maxDistToBoundaryM?: number
}

const GOLDEN: Check[] = [
  { poi: 'Cristo Redentor', id: POI_ID.cristoRedentor, city: CITY, farSectors: { minDistM: 1_000, atLeast: 3 }, noneInsideBoundary: true },
  { poi: 'Pão de Açúcar', id: POI_ID.paoDeAcucar, city: CITY, farSectors: { minDistM: 1_000, atLeast: 3 }, noneInsideBoundary: true },
  { poi: 'Pico do Irmão Menor', id: POI_ID.picoDoIrmaoMenor, city: CITY, noneInsideBoundary: true }, // TPs na orla do Leblon e de Ipanema — sem contagem fixa
  { poi: 'Morro do Patronato', id: POI_ID.morroDoPatronato, city: CITY, countRange: [1, Infinity], noneInsideBoundary: true },
  { poi: 'Maracanã', id: POI_ID.maracana, city: CITY, noneInsideBoundary: true },
  { poi: 'Praia do Recreio dos Bandeirantes', id: POI_ID.praiaDoRecreio, city: CITY, noneInsideBoundary: true },
  { poi: 'Sala de Leitura da Cidade das Artes', id: POI_ID.cidadeDasArtes, city: CITY, noneInsideBoundary: true },
  { poi: 'Museu do Amanhã', id: POI_ID.museuDoAmanha, city: CITY, noneInsideBoundary: true },
  { poi: 'Busto Prof. Mazzini Bueno', id: POI_ID.bustoMazziniBueno, city: CITY, countRange: [1, 4], maxDistToBoundaryM: 60, noneInsideBoundary: true },
  { poi: 'Igreja Nossa Senhora de Fátima', id: POI_ID.igrejaFatima, city: CITY, noneInsideBoundary: true },
  { poi: 'Manguinhos', id: POI_ID.manguinhos, city: CITY, noneInsideBoundary: true },
  { poi: 'Monumento Árvore de Natal', id: POI_ID.arvoreDeNatal, city: 'Niterói', countRange: [1, 4], noneInsideBoundary: true },
]

describe('Conjunto de referência do motor de TP (golden, #772/#779)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  for (const check of GOLDEN) {
    it(`${check.poi}: propriedades do lote gerado batem com o calibrado`, async () => {
      const result = await getResult(check.id)
      assert.equal(result.error, null, `dry-run falhou para ${check.poi}: ${result.error}`)

      const kept = keptOf(result)

      if (check.countRange) {
        const [min, max] = check.countRange
        assert.ok(kept.length >= min && kept.length <= max, `${check.poi}: ${kept.length} TPs, esperado [${min}, ${max}]`)
      }
      if (check.maxDistToBoundaryM != null) {
        for (const r of kept) {
          const d = r.dist_to_boundary_m ?? r.dist_to_pin_m
          assert.ok(d <= check.maxDistToBoundaryM!, `${check.poi}: TP a ${d}m da borda excede o máximo de ${check.maxDistToBoundaryM}m`)
        }
      }
      if (check.noneInsideBoundary) {
        for (const r of kept) {
          assert.ok((r.dist_to_boundary_m ?? 1) > 0, `${check.poi}: TP mantido com distância 0 à borda — parece estar dentro`)
        }
      }
      if (check.farSectors) {
        const far = kept.filter(r => (r.dist_to_boundary_m ?? r.dist_to_pin_m) > check.farSectors!.minDistM)
        const sectors = new Set(far.map(r => positionSector(result, r)))
        assert.ok(
          sectors.size >= check.farSectors!.atLeast,
          `${check.poi}: TPs a mais de ${check.farSectors!.minDistM}m cobrem ${sectors.size} setor(es), esperado >= ${check.farSectors!.atLeast}`
        )
      }
    })
  }

  it('Manguinhos (bairro): a calibrar — sem esperado definido ainda', { skip: 'a calibrar (docs/arquitetura/cms/motor-de-tp.md)' }, () => {
    assert.fail('calibrar quando o operador definir o esperado para este POI')
  })
})

// ============================================================================================
// Classe esperada por POI (tabela "Conjunto de referência", coluna "Classe esperada"). Lida do
// rastro E5 (`visibility-class#visibilityClassRule`), nunca do nome do POI (P3).
// ============================================================================================
type ClassCheck =
  | { poi: string; id: string; expectedOneOf: string[] }
  | { poi: string; id: string; forbidden: string[] }
  | { poi: string; id: string; todoCause: string }

const CLASS_CHECKS: ClassCheck[] = [
  { poi: 'Cristo Redentor', id: POI_ID.cristoRedentor, expectedOneOf: ['landmark_high'] },
  { poi: 'Pão de Açúcar', id: POI_ID.paoDeAcucar, expectedOneOf: ['landmark_high'] },
  { poi: 'Pico do Irmão Menor', id: POI_ID.picoDoIrmaoMenor, expectedOneOf: ['landmark_high'] },
  // Relief without both prominences is not landmark_high (91 m city / 77 m local < 100). No mapped
  // polygon carries its name, and the unnamed scrub under the pin is land cover, not the hill: the
  // border is the slope measured on the DEM (`elevation-service#reliefFootprint`), ~300 k m², so
  // `area` (Tech Lead, 2026-09-27: ~260 k m², TPs on the streets around; BR-AUDIO-010, #772).
  { poi: 'Morro do Patronato', id: POI_ID.morroDoPatronato, expectedOneOf: ['area'] },
  // "não point_low" (tabela): a borda de hoje é o nó de bairro, não o polígono do estádio (E1) —
  // a classe em si já não é point_low (sai `area`), então esta asserção específica passa.
  { poi: 'Maracanã', id: POI_ID.maracana, forbidden: ['point_low'] },
  { poi: 'Praia do Recreio dos Bandeirantes', id: POI_ID.praiaDoRecreio, expectedOneOf: ['area', 'linear'] },
  {
    poi: 'Sala de Leitura da Cidade das Artes', id: POI_ID.cidadeDasArtes,
    todoCause: 'INV-E2 não existe (poi-classifier só sobe altura do hospedeiro, não borda/classe — motor-de-tp.md E2); classe esperada é a do prédio Cidade das Artes, hoje sai landmark_high do próprio POI',
  },
  // No measured height (OSM has neither `height` nor `building:levels`): the 15 m came from
  // `tourism=museum` in the height-by-type table, which left the engine (operator, 2026-09-27).
  // With the measured building layer (#783, INV-E3) it reads 13.1 m over 100% of the footprint:
  // structure, as the reference table in motor-de-tp.md asks (BR-AUDIO-010, #772).
  { poi: 'Museu do Amanhã', id: POI_ID.museuDoAmanha, expectedOneOf: ['structure', 'landmark_high'] },
  { poi: 'Busto Prof. Mazzini Bueno', id: POI_ID.bustoMazziniBueno, expectedOneOf: ['point_low'] },
  { poi: 'Igreja Nossa Senhora de Fátima', id: POI_ID.igrejaFatima, expectedOneOf: ['point_low', 'structure'] },
  { poi: 'Monumento Árvore de Natal', id: POI_ID.arvoreDeNatal, expectedOneOf: ['point_low'] },
]

describe('Classe esperada por POI (INV-E5, #772/#779)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  for (const check of CLASS_CHECKS) {
    if ('todoCause' in check) {
      it(`${check.poi}: classe esperada é a do hospedeiro`, { todo: check.todoCause }, async () => {
        const result = await getResult(check.id)
        assert.equal(result.error, null)
        assert.fail('calibrar quando INV-E2 existir (docs/arquitetura/cms/motor-de-tp.md)')
      })
      continue
    }
    it(`${check.poi}: classe bate com a tabela`, async () => {
      const result = await getResult(check.id)
      assert.equal(result.error, null, `dry-run falhou para ${check.poi}: ${result.error}`)
      const cls = classOf(result)
      if ('expectedOneOf' in check) {
        assert.ok(check.expectedOneOf.includes(cls), `${check.poi}: classe ${cls}, esperado uma de [${check.expectedOneOf.join(', ')}]`)
      } else {
        assert.ok(!check.forbidden.includes(cls), `${check.poi}: classe ${cls} está na lista proibida [${check.forbidden.join(', ')}]`)
      }
    })
  }
})

// ============================================================================================
// Zonas nomeadas (coluna "Esperado" da tabela) — "pelo menos 1 TP dentro da zona X". Achado
// visual de 2026-09-27 (#779): o Cristo sem TP em Botafogo/Copacabana, o Irmão Menor sem TP na
// orla do Leblon/Ipanema. `noneRequired` marca as pontas ainda vermelhas nesta build (`-e`).
// ============================================================================================
type ZoneCheck = { poi: string; id: string; zone: keyof typeof ZONES; label: string; todoCause?: string }

const ZONE_CHECKS: ZoneCheck[] = [
  { poi: 'Cristo Redentor', id: POI_ID.cristoRedentor, zone: 'lagoa', label: 'Lagoa' },
  { poi: 'Cristo Redentor', id: POI_ID.cristoRedentor, zone: 'botafogo', label: 'Botafogo' },
  { poi: 'Cristo Redentor', id: POI_ID.cristoRedentor, zone: 'copacabana', label: 'Copacabana' },
  { poi: 'Pão de Açúcar', id: POI_ID.paoDeAcucar, zone: 'urca', label: 'Urca' },
  { poi: 'Pão de Açúcar', id: POI_ID.paoDeAcucar, zone: 'botafogo', label: 'Botafogo' },
  // Covered by a TP on the Av. Infante Dom Henrique (trunk): valid, the app is used driving (BR-POI-008).
  { poi: 'Pão de Açúcar', id: POI_ID.paoDeAcucar, zone: 'aterroDoFlamengo', label: 'Aterro do Flamengo' },
  { poi: 'Pico do Irmão Menor', id: POI_ID.picoDoIrmaoMenor, zone: 'orlaDoLeblon', label: 'orla do Leblon' },
  { poi: 'Pico do Irmão Menor', id: POI_ID.picoDoIrmaoMenor, zone: 'orlaDeIpanema', label: 'orla de Ipanema' },
  { poi: 'Sala de Leitura da Cidade das Artes', id: POI_ID.cidadeDasArtes, zone: 'avenidaDasAmericas', label: 'Av. das Américas' },
  { poi: 'Sala de Leitura da Cidade das Artes', id: POI_ID.cidadeDasArtes, zone: 'avenidaAyrtonSenna', label: 'Av. Ayrton Senna' },
]

describe('Zonas nomeadas do conjunto de referência (INV-E7c/E10a, #772/#779)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  for (const check of ZONE_CHECKS) {
    const title = `${check.poi}: pelo menos 1 TP em ${check.label}`
    const body = async () => {
      const result = await getResult(check.id)
      assert.equal(result.error, null, `dry-run falhou para ${check.poi}: ${result.error}`)
      const kept = keptOf(result)
      const box = ZONES[check.zone]
      const hit = kept.some(r => inZone(r.lat, r.lng, box))
      assert.ok(hit, `${check.poi}: nenhum TP mantido cai em ${check.label} (${JSON.stringify(box)})`)
    }
    if (check.todoCause) it(title, { todo: check.todoCause }, body)
    else it(title, body)
  }
})

// ============================================================================================
// Maracanã: the POI osm_id is the neighbourhood relation (1.82 km²); the stadium carries the name
// as `short_name`, is smaller, and is the border (INV-E1a/c, #786). "TPs on at least 2 sides"
// reads: at least 2 TPs and at least 2 distinct 45° sectors, by where they stand seen from the pin.
// ============================================================================================
describe('Maracanã: coverage of at least 2 sides (INV-E1c, #772)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  it('Maracanã: the border is the stadium, not the neighbourhood (INV-E1a, INV-E1c, #786)', async () => {
    const result = await getResult(POI_ID.maracana)
    assert.equal(result.error, null)
    assert.ok(result.edge && result.edge.length >= 4, 'no real edge')
    const { calculatePolygonAreaInM2 } = await import('@/lib/services/trigger-points-google/utils/calculations')
    const areaM2 = calculatePolygonAreaInM2(result.edge!)
    assert.ok(areaM2 < 150_000, `Maracanã: border of ${Math.round(areaM2)} m², the stadium is ~91,000 m²`)
  })

  it('Maracanã: at least 2 kept TPs', async () => {
    const result = await getResult(POI_ID.maracana)
    assert.equal(result.error, null)
    const kept = keptOf(result)
    assert.ok(kept.length >= 2, `Maracanã: ${kept.length} TP(s) mantido(s), esperado >= 2`)
  })

  it('Maracanã: at least 2 distinct 45° sectors (2 sides)', async () => {
    const result = await getResult(POI_ID.maracana)
    assert.equal(result.error, null)
    const kept = keptOf(result)
    const sectors = new Set(kept.map(r => positionSector(result, r)))
    assert.ok(sectors.size >= 2, `Maracanã: TPs cobrem ${sectors.size} setor(es), esperado >= 2`)
  })
})

// ============================================================================================
// Negative assertion (INV-E10a, workspace commit 0a656ec): in a `landmark_high`, no TP on
// `track`/`path`/`service` when its cell had a candidate on a better street. `trunk`, `motorway`
// and bridge are NOT demoted — the app is used driving (BR-POI-008). Read from the E10 trace
// (`tp-selection#selectSpacedTriggerPoints`: `cell sS/rR; tier N <type>; won|lost ...`), with the
// type classified here, not by the tier the engine prints. A better candidate that lost on
// spacing does not count: spacing is physical, not preference.
// ============================================================================================
const NOBODY_TRAVELS = new Set(['track', 'path', 'service'])

describe('No landmark_high TP on track/path/service when the cell had a better street (INV-E10a, BR-POI-008, #772)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  const LANDMARK_HIGH_POIS = [
    { poi: 'Cristo Redentor', id: POI_ID.cristoRedentor },
    { poi: 'Pão de Açúcar', id: POI_ID.paoDeAcucar },
    { poi: 'Pico do Irmão Menor', id: POI_ID.picoDoIrmaoMenor },
  ]

  for (const { poi, id } of LANDMARK_HIGH_POIS) {
    it(`${poi}: TP on track/path/service only where the cell had no better street`, async () => {
      const result = await getResult(id)
      assert.equal(result.error, null)
      const rows = result.trace
        .filter(r => r.stage === 'E10' && r.rule === 'tp-selection#selectSpacedTriggerPoints')
        .map(r => ({ r, m: /cell (s\d+\/r\d+); tier \d \S+ ?/.exec(r.value), type: /cell s\d+\/r\d+; tier \d (\S+);/.exec(r.value)?.[1] ?? '?' }))
        .filter(x => x.m)
      assert.ok(rows.length > 0, `${poi}: no E10 cell trace — is the class still landmark_high?`)
      const byCell = new Map<string, typeof rows>()
      for (const x of rows) {
        const cell = x.m![1]
        ;(byCell.get(cell) ?? byCell.set(cell, []).get(cell)!).push(x)
      }
      for (const [cell, xs] of byCell) {
        const keptBad = xs.filter(x => x.r.decision === 'kept' && NOBODY_TRAVELS.has(x.type))
        if (!keptBad.length) continue
        const keptBetter = xs.some(x => x.r.decision === 'kept' && !NOBODY_TRAVELS.has(x.type) && x.type !== '?')
        const betterLeftOut = xs.filter(x => x.r.decision === 'dropped' && !NOBODY_TRAVELS.has(x.type) && x.type !== '?' && !/lost: spacing/.test(x.r.value))
        assert.ok(
          keptBetter || betterLeftOut.length === 0,
          `${poi}: cell ${cell} kept ${keptBad.map(x => `${x.type} ${x.r.candidate}`).join(', ')} and left out ${betterLeftOut.map(x => `${x.type} ${x.r.candidate}`).join(', ')}`
        )
      }
    })
  }
})

// ============================================================================================
// Every kept TP sits on a way (BR-AUDIO-010: the TP is where the tourist passes). "On a way" =
// a `highway=*`, `railway=*`, `aerialway=*` or `route=ferry` line of `data/local_osm.db` within
// ON_WAY_MAX_M. The aerialway is the Pão de Açúcar cable car: the tourist rides it.
// `track`/`path` count: demoting them is E10's job (INV-E10a), not this one's. Operator report
// 2026-09-27: TPs of the Cristo and of the Irmão Menor looked like forest on the satellite tile.
// ============================================================================================
const ON_WAY_MAX_M = 30

describe('Every kept TP sits on a way (BR-AUDIO-010, #772)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  let nearestWayM: ((p: { lat: number; lng: number }) => { m: number; way: string }) | null = null
  async function nearest(p: { lat: number; lng: number }) {
    if (!nearestWayM) {
      const { default: Database } = await import('better-sqlite3')
      const { calculateDistanceToLineSegment } = await import('@/lib/services/trigger-points-google/utils/calculations')
      const db = new Database(LOCAL_OSM_DB, { readonly: true })
      const q = db.prepare(`SELECT s.geometry_json g, s.tags_json t FROM streets s JOIN streets_rtree r ON r.rowid = s.rowid
        WHERE r.max_lat >= ? AND r.min_lat <= ? AND r.max_lng >= ? AND r.min_lng <= ?`)
      const E = 0.0005 // ~50 m, wider than ON_WAY_MAX_M
      nearestWayM = (at) => {
        let best = { m: Infinity, way: 'none' }
        for (const row of q.all(at.lat - E, at.lat + E, at.lng - E, at.lng + E) as Array<{ g: string; t: string | null }>) {
          const tags = JSON.parse(row.t ?? '{}') as Record<string, string>
          const kind = tags.highway ?? tags.railway ?? tags.aerialway ?? (tags.route === 'ferry' ? 'ferry' : undefined)
          const pts = JSON.parse(row.g) as Array<{ lat: number; lng: number }>
          if (!kind || pts.length < 2) continue
          for (let i = 1; i < pts.length; i++) {
            const m = calculateDistanceToLineSegment(at, pts[i - 1], pts[i])
            if (m < best.m) best = { m, way: `${kind} ${tags['@id']}` }
          }
        }
        return best
      }
    }
    return nearestWayM(p)
  }

  for (const check of GOLDEN) {
    it(`${check.poi}: every kept TP within ${ON_WAY_MAX_M} m of a way`, async () => {
      const result = await getResult(check.id)
      assert.equal(result.error, null, `dry-run failed for ${check.poi}: ${result.error}`)
      const off: string[] = []
      for (const r of keptOf(result)) {
        const w = await nearest(r)
        if (w.m > ON_WAY_MAX_M) off.push(`${r.lat.toFixed(6)},${r.lng.toFixed(6)} nearest ${w.way} at ${Math.round(w.m)} m`)
      }
      assert.deepEqual(off, [], `${check.poi}: TP off any way`)
    })
  }
})

// ============================================================================================
// point_low next to a car street keeps a TP on it (BR-POI-008: the app is used driving;
// BR-AUDIO-010). Read from the E10 trace of the non-landmark branch
// (`tp-selection#selectSpacedTriggerPoints`: `edge N m; <highway>; won|lost ...`). Árvore de Natal
// kept only the sidewalk at 12 m while Av. Quintino Bocaiúva sat at 24–41 m (#772).
// ============================================================================================
const NOT_A_CAR_STREET = new Set(['footway', 'path', 'pedestrian', 'steps', 'track', 'service', 'cycleway', '?'])

describe('point_low keeps a TP on the car street when one is in reach (BR-POI-008, BR-AUDIO-010, #772)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  it('Monumento Árvore de Natal: at least one kept TP on a car street', async () => {
    const result = await getResult(POI_ID.arvoreDeNatal)
    assert.equal(result.error, null)
    assert.equal(classOf(result), 'point_low')
    const rows = result.trace
      .filter(r => r.stage === 'E10' && r.rule === 'tp-selection#selectSpacedTriggerPoints')
      .map(r => ({ decision: r.decision, type: /^edge \d+ m; (\S+);/.exec(r.value)?.[1] ?? '?' }))
    assert.ok(rows.some(r => !NOT_A_CAR_STREET.has(r.type)), 'no car-street candidate in reach — fixture changed?')
    assert.ok(rows.some(r => r.decision === 'kept' && !NOT_A_CAR_STREET.has(r.type)),
      `kept: ${rows.filter(r => r.decision === 'kept').map(r => r.type).join(', ')}`)
  })
})

// ============================================================================================
// INV-E11b: a POI with a real border never ends with 0 TPs. Ilha das Cobras (way/70601832,
// 349,662 m², `area`, reach 60 m) went 12 → 0: the nearest public street is ~120 m off the edge.
// ============================================================================================
describe('A POI with a border leaves with at least one TP outside it (INV-E11b, BR-AUDIO-010, #772)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  it('Ilha das Cobras: ≥ 1 kept TP, all of them outside the border', async () => {
    const result = await getResult(POI_ID.ilhaDasCobras)
    assert.equal(result.error, null)
    const kept = keptOf(result)
    assert.ok(kept.length >= 1, 'no TP kept')
    for (const r of kept) assert.ok((r.dist_to_boundary_m ?? 0) >= 1, `TP at ${r.dist_to_boundary_m} m from the edge`)
  })
})

// ============================================================================================
// INV-E10d: in `area`/`linear`, every perimeter sector (`tp-selection#perimeterSectors`,
// PERIMETER_SECTOR_M of edge) with a public way within the class reach, outside the border, has
// a kept TP. The way is read from `data/local_osm.db` here, not from the engine: accessible type
// (`street-analyzer#ACCESSIBLE_ROUTE_TYPES`), public (`isPublicWay`), not a tunnel. The reach
// is the class one (60 m) — not widened to pass (Tech Lead, 2026-09-27).
// ============================================================================================
describe('Every perimeter sector with a way in reach has a TP (INV-E10d, BR-AUDIO-010, #772)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  const COVERED = [
    { poi: 'Estádio Nilton Santos', id: POI_ID.estadioNiltonSantos },
    { poi: 'Lagoa Rodrigo de Freitas', id: POI_ID.lagoaRodrigoDeFreitas },
  ]
  for (const { poi, id } of COVERED) {
    it(`${poi}: no bare sector with a public way in reach`, async () => {
      const result = await getResult(id)
      assert.equal(result.error, null)
      const edge = result.edge
      assert.ok(edge && edge.length >= 4, `${poi}: no real edge — did E1 change?`)
      const { default: Database } = await import('better-sqlite3')
      const calc = await import('@/lib/services/trigger-points-google/utils/calculations')
      const { perimeterSectors } = await import('@/lib/services/trigger-points-google/utils/tp-selection')
      const { isPublicWay } = await import('@/lib/services/trigger-points-google/config/visibility-class')
      const { ACCESSIBLE_ROUTE_TYPES } = await import('@/lib/services/trigger-points-google/analyzers/street-analyzer')
      const { tpReachCapM } = await import('@/lib/services/trigger-points-google/utils/validation')
      const { CLASS_LIMITS } = await import('@/lib/services/trigger-points-google/config/visibility-class')
      const reachM = tpReachCapM({ maxEdgeDistanceM: CLASS_LIMITS[classOf(result) as keyof typeof CLASS_LIMITS]?.maxEdgeDistanceM })
      const db = new Database(LOCAL_OSM_DB, { readonly: true })
      const q = db.prepare(`SELECT s.type t, s.geometry_json g, s.tags_json j FROM streets s JOIN streets_rtree r ON r.rowid = s.rowid
        WHERE r.max_lat >= ? AND r.min_lat <= ? AND r.max_lng >= ? AND r.min_lng <= ?`)
      const E = reachM / 100_000
      const { count, sectorOf } = perimeterSectors(edge!)
      const withWay = new Set<number>()
      for (let i = 0; i < edge!.length - 1; i++) {
        const seg = calc.calculateDistance(edge![i], edge![i + 1])
        for (let d = 0; d <= seg; d += 10) {
          const t = seg ? d / seg : 0
          const at = { lat: edge![i].lat + t * (edge![i + 1].lat - edge![i].lat), lng: edge![i].lng + t * (edge![i + 1].lng - edge![i].lng) }
          const k = sectorOf(at)
          if (withWay.has(k)) continue
          for (const row of q.all(at.lat - E, at.lat + E, at.lng - E, at.lng + E) as Array<{ t: string; g: string; j: string | null }>) {
            const tags = JSON.parse(row.j ?? '{}') as Record<string, string>
            if (!ACCESSIBLE_ROUTE_TYPES.has(row.t) || !isPublicWay(tags) || tags.tunnel === 'yes' || tags.covered === 'yes') continue
            const pts = JSON.parse(row.g) as Array<{ lat: number; lng: number }>
            const hit = pts.slice(1).some((p, n) => {
              const foot = calc.closestPointOnSegment(at, pts[n], p).point
              return calc.calculateDistance(at, foot) <= reachM && !calc.isPointInPolygon(foot, edge!)
            })
            if (hit) { withWay.add(k); break }
          }
        }
      }
      const withTp = new Set(keptOf(result).map(r => sectorOf(r)))
      const bare = [...withWay].filter(k => !withTp.has(k)).sort((a, b) => a - b)
      assert.ok(withWay.size > 0, `${poi}: no sector with a way — fixture changed?`)
      assert.deepEqual(bare, [], `${poi}: ${bare.length}/${count} sectors with a way in ${reachM} m and no TP (${withTp.size} covered)`)
    })
  }
})

// ============================================================================================
// INV-E7a: no TP on a way closed to the public. Ilha Fiscal's one TP is read against the Doca 11
// de Junho (access=private, the Navy's dock from the Ilha das Cobras): it stands on the dock's
// tip node, which the untagged footway to the Ilha Fiscal ferry terminal shares (#772).
// ============================================================================================
describe('No TP on a way closed to the public (INV-E7a, BR-AUDIO-010, #772)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  it('Ilha Fiscal: ≥ 1 kept TP, none of them nearest to a closed way', async () => {
    const result = await getResult(POI_ID.ilhaFiscal)
    assert.equal(result.error, null)
    const kept = keptOf(result)
    assert.ok(kept.length >= 1, 'no TP kept')
    const { default: Database } = await import('better-sqlite3')
    const calc = await import('@/lib/services/trigger-points-google/utils/calculations')
    const { isPublicWay } = await import('@/lib/services/trigger-points-google/config/visibility-class')
    const db = new Database(LOCAL_OSM_DB, { readonly: true })
    const q = db.prepare(`SELECT s.geometry_json g, s.tags_json j FROM streets s JOIN streets_rtree r ON r.rowid = s.rowid
      WHERE r.max_lat >= ? AND r.min_lat <= ? AND r.max_lng >= ? AND r.min_lng <= ?`)
    for (const r of kept) {
      // nearest open way vs nearest closed way: a TP on a node both share (the dock tip where the
      // Ilha Fiscal ferry lands) stands on the open one
      const best = { open: Infinity, closed: Infinity }
      for (const row of q.all(r.lat - 0.0005, r.lat + 0.0005, r.lng - 0.0005, r.lng + 0.0005) as Array<{ g: string; j: string | null }>) {
        const tags = JSON.parse(row.j ?? '{}') as Record<string, string>
        if (!tags.highway) continue
        const pts = JSON.parse(row.g) as Array<{ lat: number; lng: number }>
        for (let i = 1; i < pts.length; i++) {
          const m = calc.calculateDistanceToLineSegment(r, pts[i - 1], pts[i])
          const k = isPublicWay(tags) ? 'open' : 'closed'
          best[k] = Math.min(best[k], m)
        }
      }
      assert.ok(best.open <= best.closed + 1, `TP ${r.lat.toFixed(6)},${r.lng.toFixed(6)} sits on a closed way (open ${Math.round(best.open)} m, closed ${Math.round(best.closed)} m)`)
    }
  })
})

// ============================================================================================
// A relief landmark is heard from the city around it and far away, not from the forest on its
// own slope (INV-E8b, INV-E10a, BR-AUDIO-010, #784). Measured on the 36-POI sample over the state
// the operator approved on the map (`7e4e5c4a`) and the regression (`23421dc2`), per POI:
// TPs beyond 2 km of the pin / 45° sectors (seen from the pin) they cover / TPs within 1 km.
//   Mirante Vista para a Cidade  approved 20 / 6 / 3   regression 16 / 8 / 6
//   Pico da Carioca              approved 24 / 6 / 0   regression 20 / 6 / 2
// The bounds keep a margin under the approved state and fail the regression.
// ============================================================================================
describe('A relief landmark keeps its TPs in the city, around it and far (INV-E8b, INV-E10a, BR-AUDIO-010, #784)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  // `pin`: the POI pin in core.attractions, the one `dist_to_pin_m` is measured from
  const CASES = [
    { poi: 'Mirante Vista para a Cidade', id: POI_ID.miranteVistaParaACidade, pin: { lat: -22.943099, lng: -43.2851209 }, farAtLeast: 18, farSectorsAtLeast: 5, nearAtMost: 4 },
    { poi: 'Pico da Carioca', id: POI_ID.picoDaCarioca, pin: { lat: -22.9515968, lng: -43.2378746 }, farAtLeast: 21, farSectorsAtLeast: 5, nearAtMost: 1 },
  ]
  for (const c of CASES) {
    it(`${c.poi}: >= ${c.farAtLeast} TPs beyond 2 km over >= ${c.farSectorsAtLeast} sectors, <= ${c.nearAtMost} within 1 km`, async () => {
      const result = await getResult(c.id)
      assert.equal(result.error, null, `dry-run failed for ${c.poi}: ${result.error}`)
      const kept = keptOf(result)
      const far = kept.filter(r => r.dist_to_pin_m > 2_000)
      const farSectors = new Set(far.map(r => sectorOf(bearingFrom(c.pin, r))))
      const near = kept.filter(r => r.dist_to_pin_m < 1_000)
      assert.ok(far.length >= c.farAtLeast, `${c.poi}: ${far.length} TPs beyond 2 km, expected >= ${c.farAtLeast}`)
      assert.ok(farSectors.size >= c.farSectorsAtLeast, `${c.poi}: TPs beyond 2 km cover ${farSectors.size} sectors, expected >= ${c.farSectorsAtLeast}`)
      assert.ok(near.length <= c.nearAtMost, `${c.poi}: ${near.length} TPs within 1 km, expected <= ${c.nearAtMost}`)
    })
  }
})

// ============================================================================================
// The train and the ferry are observer paths (INV-E7a, INV-E10a, BR-AUDIO-010, #786). The
// operator on the Estádio Nilton Santos: "tem visão da avenida, da ponte e da linha de trem";
// the reference table: the Pão de Açúcar also on the ferry. Read from the E10 trace (the street
// type of the winner), kept only if E11 kept the same point.
// ============================================================================================
describe('A landmark keeps a TP on the train or the ferry line in sight (INV-E7a, INV-E10a, BR-AUDIO-010, #786)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  const CASES = [
    { poi: 'Estádio Nilton Santos', id: POI_ID.estadioNiltonSantos, way: /tier 0 railway_(rail|light_rail|subway|tram); won/ },
    { poi: 'Pão de Açúcar', id: POI_ID.paoDeAcucar, way: /tier 0 ferry; won/ },
  ]
  for (const c of CASES) {
    it(`${c.poi}: at least 1 kept TP on the line`, async () => {
      const result = await getResult(c.id)
      assert.equal(result.error, null, `dry-run failed for ${c.poi}: ${result.error}`)
      const kept = new Set(keptOf(result).map(r => `${r.lat.toFixed(6)},${r.lng.toFixed(6)}`))
      const onLine = result.trace.filter(t => t.stage === 'E10' && c.way.test(t.value) && kept.has(t.candidate))
      assert.ok(onLine.length >= 1, `${c.poi}: no kept TP on the line`)
    })
  }
})
