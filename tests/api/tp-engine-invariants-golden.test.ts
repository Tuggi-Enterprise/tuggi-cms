import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// Motor de TP (#772) — camada "conjunto de referência" (golden) da estratégia de teste.
// Fonte: docs/arquitetura/cms/motor-de-tp.md, tabela "Conjunto de referência". Roda o motor
// em dry-run (sem gravar) contra o local_osm.db e compara PROPRIEDADE, nunca coordenada exata:
// setor de bearing (faixa de 45°), distância em faixa, contagem, "nenhum dentro da borda".
//
// Calibrado uma vez pelo operador olhando o mapa (2026-09-27, #779). Depois disso, barra
// regressão — não recalibre o esperado para o teste passar; se o alvo mudou, isso é decisão
// do Tech Lead (docs/arquitetura/cms/motor-de-tp.md).

const LOCAL_OSM_DB = join(process.cwd(), 'data', 'local_osm.db')
const HAS_LOCAL_OSM = existsSync(LOCAL_OSM_DB)
const HAS_SUPABASE_ENV = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY))
const CAN_RUN = HAS_LOCAL_OSM && HAS_SUPABASE_ENV
const SKIP_REASON = !HAS_LOCAL_OSM
  ? `local_osm.db ausente em ${LOCAL_OSM_DB} — golden do motor de TP pulado (INV-E1..E11 sem cobertura de regressão nesta rodada)`
  : 'credenciais Supabase ausentes no ambiente — golden precisa resolver o POI pelo nome (core.attractions)'

type Check = {
  poi: string
  /** id em core.attractions — o nome não é único (há várias "Nossa Senhora de Fátima") nem igual ao do banco */
  id: string
  /** cidade usada para desambiguar o nome (mesmo critério de scripts/_viz-tp.ts) */
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

// As 11 linhas da tabela "Conjunto de referência". Manguinhos fica de fora (a calibrar).
const GOLDEN: Check[] = [
  { poi: 'Cristo Redentor', id: 'ae3a6d91-feef-46f7-aae2-a34c3db12c04', city: 'Rio de Janeiro', farSectors: { minDistM: 1_000, atLeast: 3 }, noneInsideBoundary: true },
  { poi: 'Pão de Açúcar', id: '5f16ab45-6923-5184-8ee7-0c5d4c0e4be4', city: 'Rio de Janeiro', farSectors: { minDistM: 1_000, atLeast: 3 }, noneInsideBoundary: true },
  { poi: 'Pico do Irmão Menor', id: '064f0acf-0673-5cef-ad71-11e0c4693164', city: 'Rio de Janeiro' }, // TPs na orla do Leblon e de Ipanema — sem contagem fixa
  { poi: 'Morro do Patronato', id: '03673109-74ec-5a7d-ae44-a0ca58eec4b8', city: 'Rio de Janeiro', countRange: [1, Infinity] },
  { poi: 'Maracanã', id: 'ad1fd646-07f5-5576-b571-dca112dab834', city: 'Rio de Janeiro', noneInsideBoundary: true },
  { poi: 'Praia do Recreio dos Bandeirantes', id: '176522ba-08e2-529b-8413-943ab6c91767', city: 'Rio de Janeiro' },
  { poi: 'Sala de Leitura da Cidade das Artes', id: '0004411f-b2b3-4d8c-9074-461e066d7976', city: 'Rio de Janeiro', noneInsideBoundary: true },
  { poi: 'Museu do Amanhã', id: '3d4a364e-6d47-5aab-aa23-6b1a122be84b', city: 'Rio de Janeiro' },
  { poi: 'Busto Prof. Mazzini Bueno', id: '11959605-51aa-50ba-97ed-52ceac770755', city: 'Rio de Janeiro', countRange: [1, 4], maxDistToBoundaryM: 60, noneInsideBoundary: true },
  { poi: 'Igreja Nossa Senhora de Fátima', id: '0a2f51c0-5aec-5cc2-b50f-075849c1fe28', city: 'Rio de Janeiro' },
]

function sectorOf(bearingDeg: number): number {
  return Math.floor((((bearingDeg % 360) + 360) % 360) / 45)
}

describe('Conjunto de referência do motor de TP (golden, #772/#779)', { skip: CAN_RUN ? false : SKIP_REASON }, () => {
  for (const check of GOLDEN) {
    it(`${check.poi}: propriedades do lote gerado batem com o calibrado`, async () => {
      const { dryRunPoi } = await import('@/lib/services/tp-dry-run')
      const result = await dryRunPoi(check.id)
      assert.equal(result.error, null, `dry-run falhou para ${check.poi}: ${result.error}`)

      const kept = result.rows.filter(r => r.source === 'generated' && !r.drop_reason)

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
