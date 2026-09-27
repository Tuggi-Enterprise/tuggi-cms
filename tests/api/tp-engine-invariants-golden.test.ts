import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'

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

// As 11 linhas da tabela "Conjunto de referência". Manguinhos fica de fora (a calibrar).
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
  { poi: 'Pico do Irmão Menor', id: POI_ID.picoDoIrmaoMenor, city: CITY }, // TPs na orla do Leblon e de Ipanema — sem contagem fixa
  { poi: 'Morro do Patronato', id: POI_ID.morroDoPatronato, city: CITY, countRange: [1, Infinity] },
  { poi: 'Maracanã', id: POI_ID.maracana, city: CITY, noneInsideBoundary: true },
  { poi: 'Praia do Recreio dos Bandeirantes', id: POI_ID.praiaDoRecreio, city: CITY },
  { poi: 'Sala de Leitura da Cidade das Artes', id: POI_ID.cidadeDasArtes, city: CITY, noneInsideBoundary: true },
  { poi: 'Museu do Amanhã', id: POI_ID.museuDoAmanha, city: CITY },
  { poi: 'Busto Prof. Mazzini Bueno', id: POI_ID.bustoMazziniBueno, city: CITY, countRange: [1, 4], maxDistToBoundaryM: 60, noneInsideBoundary: true },
  { poi: 'Igreja Nossa Senhora de Fátima', id: POI_ID.igrejaFatima, city: CITY },
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
        const sectors = new Set(far.map(r => sectorOf(r.bearing ?? 0)))
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
  { poi: 'Morro do Patronato', id: POI_ID.morroDoPatronato, expectedOneOf: ['landmark_high', 'structure'] },
  // "não point_low" (tabela): a borda de hoje é o nó de bairro, não o polígono do estádio (E1) —
  // a classe em si já não é point_low (sai `area`), então esta asserção específica passa.
  { poi: 'Maracanã', id: POI_ID.maracana, forbidden: ['point_low'] },
  { poi: 'Praia do Recreio dos Bandeirantes', id: POI_ID.praiaDoRecreio, expectedOneOf: ['area', 'linear'] },
  {
    poi: 'Sala de Leitura da Cidade das Artes', id: POI_ID.cidadeDasArtes,
    todoCause: 'INV-E2 não existe (poi-classifier só sobe altura do hospedeiro, não borda/classe — motor-de-tp.md E2); classe esperada é a do prédio Cidade das Artes, hoje sai landmark_high do próprio POI',
  },
  { poi: 'Museu do Amanhã', id: POI_ID.museuDoAmanha, expectedOneOf: ['structure', 'landmark_high'] },
  { poi: 'Busto Prof. Mazzini Bueno', id: POI_ID.bustoMazziniBueno, expectedOneOf: ['point_low'] },
  { poi: 'Igreja Nossa Senhora de Fátima', id: POI_ID.igrejaFatima, expectedOneOf: ['point_low', 'structure'] },
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
  {
    poi: 'Cristo Redentor', id: POI_ID.cristoRedentor, zone: 'botafogo', label: 'Botafogo',
    todoCause: 'INV-E10a: seleção do landmark_high ainda prioriza proximidade sobre cobertura de célula nesta build (fix/tp-engine-quality-e); TPs se amontoam do lado da Lagoa e nenhum cobre o setor de Botafogo',
  },
  {
    poi: 'Cristo Redentor', id: POI_ID.cristoRedentor, zone: 'copacabana', label: 'Copacabana',
    todoCause: 'INV-E10a: idem — nenhum TP cobre o setor de Copacabana nesta build',
  },
  { poi: 'Pão de Açúcar', id: POI_ID.paoDeAcucar, zone: 'urca', label: 'Urca' },
  {
    // Achado desta rodada: o card previa vermelho no Aterro, não aqui — só a medição por zona
    // revelou que é Botafogo que está descoberto hoje, não o Aterro (linha abaixo). Os TPs mais
    // próximos (Av. Infante Dom Henrique) ficam ~450 m a leste da zona de Botafogo, já na faixa
    // costeira que separa Botafogo de Urca.
    poi: 'Pão de Açúcar', id: POI_ID.paoDeAcucar, zone: 'botafogo', label: 'Botafogo',
    todoCause: 'INV-E10a/E7c: os TPs mais próximos de Botafogo (Av. Infante Dom Henrique) ficam ~450m a leste da zona, ainda na faixa costeira — nenhum cobre o setor de Botafogo nesta build (fix/tp-engine-quality-e)',
  },
  // Passa hoje, mas só via um TP a 0.2 m da Av. Infante Dom Henrique (trunk) — ver a asserção
  // de via rápida abaixo, que reprova exatamente este TP. A zona está coberta; a qualidade não.
  { poi: 'Pão de Açúcar', id: POI_ID.paoDeAcucar, zone: 'aterroDoFlamengo', label: 'Aterro do Flamengo' },
  {
    poi: 'Pico do Irmão Menor', id: POI_ID.picoDoIrmaoMenor, zone: 'orlaDoLeblon', label: 'orla do Leblon',
    todoCause: 'INV-E7c/E10a: os candidatos "far" do landmark_high não alcançam a orla do Leblon nesta build (fix/tp-engine-quality-e)',
  },
  {
    poi: 'Pico do Irmão Menor', id: POI_ID.picoDoIrmaoMenor, zone: 'orlaDeIpanema', label: 'orla de Ipanema',
    todoCause: 'INV-E7c/E10a: idem — nenhum TP alcança a orla de Ipanema nesta build',
  },
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
// Maracanã: a borda de hoje é o nó de bairro, não o polígono do estádio (E1, dívida registrada
// em motor-de-tp.md). "TPs em pelo menos 2 lados" vira: pelo menos 2 TPs e pelo menos 2 setores
// de 45° distintos entre os TPs mantidos.
// ============================================================================================
describe('Maracanã: cobertura de pelo menos 2 lados (dívida E1, #772)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  const cause = 'E1 (boundary-detector#detectBoundary): a borda resolvida é o nó de bairro "Maracanã", não o polígono do estádio (docs/arquitetura/cms/motor-de-tp.md, dívida "borda sintética/polígono errado") — o motor gera 1 TP colado ao pino'

  it('Maracanã: pelo menos 2 TPs mantidos', { todo: cause }, async () => {
    const result = await getResult(POI_ID.maracana)
    assert.equal(result.error, null)
    const kept = keptOf(result)
    assert.ok(kept.length >= 2, `Maracanã: ${kept.length} TP(s) mantido(s), esperado >= 2`)
  })

  it('Maracanã: pelo menos 2 setores de 45° distintos (2 lados)', { todo: cause }, async () => {
    const result = await getResult(POI_ID.maracana)
    assert.equal(result.error, null)
    const kept = keptOf(result)
    const sectors = new Set(kept.map(r => sectorOf(r.bearing ?? 0)))
    assert.ok(sectors.size >= 2, `Maracanã: TPs cobrem ${sectors.size} setor(es), esperado >= 2`)
  })
})

// ============================================================================================
// Asserção negativa: nenhum TP de `landmark_high` sobre via `motorway`/`trunk`. `E7` (via,
// trilho ou água) não exclui hoje `motorway`/`trunk` de `MOTORIZED_ROAD_TYPES`
// (street-analyzer.ts#ACCESSIBLE_ROUTE_TYPES) — um TP num turista não pode ficar plantado no
// canteiro de uma via expressa. Medido por distância real ao segmento mais próximo (não pela
// tag do candidato), contra `data/local_osm.db`.
// ============================================================================================
const ON_MOTORWAY_TRUNK_TOLERANCE_M = 15
const MOTORWAY_TRUNK_TYPES = ['motorway', 'trunk', 'motorway_link', 'trunk_link']

function distanceToSegmentM(p: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const cos = Math.cos((p.lat * Math.PI) / 180)
  const toXY = (q: { lat: number; lng: number }) => ({ x: (q.lng - p.lng) * 111_320 * cos, y: (q.lat - p.lat) * 110_540 })
  const A = toXY(a), B = toXY(b)
  const abx = B.x - A.x, aby = B.y - A.y
  const len2 = abx * abx + aby * aby
  let t = len2 === 0 ? 0 : (-A.x * abx + -A.y * aby) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = A.x + t * abx, cy = A.y + t * aby
  return Math.hypot(cx, cy)
}

function nearestMotorwayTrunk(db: InstanceType<typeof Database>, lat: number, lng: number): { distM: number; name: string | null } {
  const pad = 0.01 // ~1.1km, generoso o bastante pra pegar o segmento mais próximo sem varrer o país
  const placeholders = MOTORWAY_TRUNK_TYPES.map(() => '?').join(',')
  const rows = db
    .prepare(`select name, geometry_json from streets where type in (${placeholders}) and min_lat <= ? and max_lat >= ? and min_lng <= ? and max_lng >= ?`)
    .all(...MOTORWAY_TRUNK_TYPES, lat + pad, lat - pad, lng + pad, lng - pad) as Array<{ name: string | null; geometry_json: string }>
  let best = { distM: Infinity, name: null as string | null }
  for (const row of rows) {
    const pts = JSON.parse(row.geometry_json) as Array<{ lat: number; lng: number }>
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distanceToSegmentM({ lat, lng }, pts[i], pts[i + 1])
      if (d < best.distM) best = { distM: d, name: row.name }
    }
  }
  return best
}

describe('Nenhum TP de landmark_high sobre motorway/trunk (E7, #772)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  let db: InstanceType<typeof Database> | null = null
  const getDb = () => (db ??= new Database(LOCAL_OSM_DB, { readonly: true }))
  after(() => db?.close())

  const LANDMARK_HIGH_POIS = [
    { poi: 'Cristo Redentor', id: POI_ID.cristoRedentor, todoCause: 'MOTORIZED_ROAD_TYPES inclui motorway/trunk em ACCESSIBLE_ROUTE_TYPES (street-analyzer.ts); TPs caem sobre a Av. Vital Brasil e a Av. Borges de Medeiros' },
    { poi: 'Pão de Açúcar', id: POI_ID.paoDeAcucar, todoCause: 'idem — TPs caem sobre a Ponte Rio-Niterói e a Av. Infante Dom Henrique' },
    { poi: 'Pico do Irmão Menor', id: POI_ID.picoDoIrmaoMenor, todoCause: 'idem — TP cai sobre o Elevado do Joá' },
    { poi: 'Morro do Patronato', id: POI_ID.morroDoPatronato, todoCause: 'idem — TP cai sobre a Rodovia Governador Mário Covas' },
  ]

  for (const { poi, id, todoCause } of LANDMARK_HIGH_POIS) {
    it(`${poi}: nenhum TP mantido a menos de ${ON_MOTORWAY_TRUNK_TOLERANCE_M}m de motorway/trunk`, { todo: todoCause }, async () => {
      const result = await getResult(id)
      assert.equal(result.error, null)
      const kept = keptOf(result)
      for (const r of kept) {
        const { distM, name } = nearestMotorwayTrunk(getDb(), r.lat, r.lng)
        assert.ok(
          distM > ON_MOTORWAY_TRUNK_TOLERANCE_M,
          `${poi}: TP (${r.lat},${r.lng}) a ${distM.toFixed(1)}m de "${name}" (motorway/trunk), esperado > ${ON_MOTORWAY_TRUNK_TOLERANCE_M}m`
        )
      }
    })
  }
})
