/**
 * #652 — quantas search queries o passo 1 executou, contadas e persistidas.
 *
 * POR QUE ESTE TESTE EXISTE. O pedágio de grounding foi 94% da conta de Gemini de
 * agosto/2026 (11.193 chamadas, ~US$ 392; token de geração somou ~US$ 29 no mês inteiro), e
 * as duas famílias cobram em unidades diferentes — 2.5 por PROMPT, 3.x por SEARCH QUERY
 * executada. Setembro/2026 roda a 3.x nas duas posições do retrieval para medir. Se a
 * contagem não chegar em `generation_meta`, no fim do mês teremos o total da fatura e
 * continuaremos sem o único número que decide a família em outubro: queries por prompt
 * (equilíbrio em ~2,95). Medição que nasce morta custa o mês inteiro, não um card.
 *
 * O QUE ELE TRAVA. Que a contagem SOMA as tentativas em vez de sobrescrever — o fallback de
 * retrieval executa um segundo lote de buscas e a fatura cobra os dois. `sourceCount` usa
 * máximo (`if (sc > sourceCount)`), e copiar aquele padrão aqui esconderia justamente o
 * custo do fallback.
 *
 * Módulo Deno puro, carregado por caminho montado em tempo de execução: um import estático
 * terminaria em `.ts` e reprovaria o `npm run type-check` do repositório inteiro.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface MasterPackResultShape {
  description: string
  grounded?: boolean
  sourceCount?: number
  searchQueryCount?: number
  retrievalAttempts?: number
  modelUsed?: string
}

interface MasterPackModule {
  generateMasterPack: (
    poiName: string,
    city: string,
    rawContext: string,
    language: string,
    apiKey: string,
    poiData?: unknown,
    audioDuration?: number,
    memberPois?: unknown[],
    referenceLinks?: string[],
    entity?: { kind: 'poi' | 'event' | 'place' }
  ) => Promise<MasterPackResultShape>
}

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/masterPackGenerator.ts'
)

const DESCRIPTION_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/generate-description/index.ts'
)

/** Fonte com os comentários removidos, para que um comentário não passe teste. */
function sourceOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

let mod: MasterPackModule
const realFetch = globalThis.fetch

before(async () => {
  mod = (await import(pathToFileURL(MODULE_PATH).href)) as MasterPackModule
})

after(() => {
  globalThis.fetch = realFetch
})

// ── O dublê da API ───────────────────────────────────────────────────────────
//
// Uma resposta roteirizada por tentativa de retrieval, na ordem. Compose sempre entrega, sem
// buscas: ele não usa a tool e por isso não paga pedágio — se a contagem do compose vazasse
// para o total, o número da medição já nasceria inflado.

type RetrievalScript = {
  /** Tamanho de `groundingMetadata.webSearchQueries` — o que a família 3.x cobra. */
  queries: number | null
  /** Tamanho de `groundingChunks` — fontes, que é outra coisa e vira `sourceCount`. */
  chunks?: number
  text?: string
  finishReason?: string
  httpStatus?: number
}

const USABLE_FACTS = [
  '- [type] Crêperie, opened in 1983',
  '- [character] Founded by Michelle Faure, known as "Michou"',
  '- [curiosity] The 1986 move was celebrated with a chocolate war',
].join('\n')

const COMPOSE_OK =
  '<master_description>Crêperie du Vieux Port. Aberta em 1983, virou ponto de encontro do bairro.</master_description>\n' +
  '<master_facts>history|Aberta em 1983 por uma cozinheira bretã</master_facts>'

let calledModels: string[] = []

function installFetch(script: RetrievalScript[]) {
  let retrievalIndex = 0
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const model = String(url).match(/models\/([^:]+):/)?.[1] ?? 'unknown'
    calledModels.push(model)
    const body = JSON.parse(String(init?.body ?? '{}'))
    const isRetrieval = Array.isArray(body.tools)

    if (!isRetrieval) {
      return new Response(
        JSON.stringify({
          candidates: [
            { finishReason: 'STOP', content: { parts: [{ text: COMPOSE_OK }] } },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        }),
        { status: 200 },
      )
    }

    const step = script[retrievalIndex++] ?? { queries: 0 }
    if (step.httpStatus && step.httpStatus !== 200) {
      return new Response(JSON.stringify({ error: { message: 'boom' } }), {
        status: step.httpStatus,
      })
    }
    return new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: step.finishReason ?? 'STOP',
            content: { parts: [{ text: step.text ?? USABLE_FACTS }] },
            groundingMetadata: {
              // `null` = a resposta veio sem o campo (o modelo não buscou nada).
              ...(step.queries === null
                ? {}
                : { webSearchQueries: Array.from({ length: step.queries }, (_, i) => `q${i}`) }),
              groundingChunks: Array.from({ length: step.chunks ?? 2 }, () => ({ web: {} })),
            },
          },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      }),
      { status: 200 },
    )
  }) as typeof fetch
}

const run = () =>
  mod.generateMasterPack(
    'Crêperie du Vieux Port',
    'Marseille, France',
    'test',
    'pt-br',
    'test-key',
  )

beforeEach(() => {
  calledModels = []
})

// ── A contagem ───────────────────────────────────────────────────────────────

test('#652 — uma tentativa: a contagem persistida é o tamanho de webSearchQueries', async () => {
  installFetch([{ queries: 4 }])
  const r = await run()
  assert.equal(r.searchQueryCount, 4)
  assert.equal(r.retrievalAttempts, 1)
})

test('#652 — duas tentativas: a contagem é a SOMA, não a última nem a maior', async () => {
  // A primeira recusa com NONE e o laço cai no fallback. As 3 buscas dela já foram
  // executadas e cobradas: sobrescrever com as 2 da segunda apagaria o custo do fallback,
  // que é exatamente o que a medição de setembro precisa enxergar.
  installFetch([
    { queries: 3, text: 'NONE', chunks: 0 },
    { queries: 2, text: USABLE_FACTS },
  ])
  const r = await run()
  assert.equal(r.searchQueryCount, 5)
  assert.equal(r.retrievalAttempts, 2)
})

test('#652 — a tentativa descartada por finishReason também conta: a busca já foi paga', async () => {
  installFetch([
    { queries: 6, finishReason: 'MAX_TOKENS' },
    { queries: 1, text: USABLE_FACTS },
  ])
  const r = await run()
  assert.equal(r.searchQueryCount, 7)
  assert.equal(r.retrievalAttempts, 2)
})

test('#652 — resposta sem webSearchQueries conta ZERO, e zero não é ausência de dado', async () => {
  // Prompt que o modelo respondeu de memória: nenhum pedágio. Precisa aparecer como 0 na
  // trilha, não como undefined — a média de queries/prompt divide pelo total de prompts.
  installFetch([{ queries: null }])
  const r = await run()
  assert.equal(r.searchQueryCount, 0)
  assert.equal(r.retrievalAttempts, 1)
})

test('#652 — a contagem é independente de sourceCount: fontes e buscas são unidades diferentes', async () => {
  installFetch([{ queries: 2, chunks: 9 }])
  const r = await run()
  assert.equal(r.searchQueryCount, 2)
  assert.equal(r.sourceCount, 9)
})

test('#652 — o compose não entra na conta do pedágio: ele não liga a tool', async () => {
  installFetch([{ queries: 3 }])
  const r = await run()
  assert.equal(r.searchQueryCount, 3)
  // 1 retrieval + 1 compose: se o compose somasse, o número viraria outro.
  assert.equal(calledModels.length, 2)
})

// ── A integridade do experimento de setembro ─────────────────────────────────

test('#652 — as duas posições do retrieval são 3.x, para o pedágio cair num SKU só', async () => {
  // Lista misturada devolve a ambiguidade de atribuição por SKU que travou a conciliação de
  // agosto/2026 — a fatura deixa de ser legível e a medição não conclui nada.
  installFetch([{ queries: 1, text: 'NONE', chunks: 0 }, { queries: 1 }])
  await run()
  const retrieval = calledModels.slice(0, 2)
  assert.deepEqual(retrieval, ['gemini-3.7-flash', 'gemini-3.5-flash'])
  for (const m of retrieval) assert.match(m, /^gemini-3\./, m)
})

test('#652 — o compose fica em 2.5: sem grounding, 3.x só encareceria o token', async () => {
  // US$ 0,75/3,75 por milhão contra US$ 0,30/2,50, sem pedágio nenhum a economizar.
  installFetch([{ queries: 1 }])
  await run()
  assert.equal(calledModels[calledModels.length - 1], 'gemini-2.5-flash')
})

// ── A ponta que persiste ─────────────────────────────────────────────────────

test('#652 — a contagem entra em generation_meta, sem coluna nova', async () => {
  const src = sourceOf(DESCRIPTION_PATH)
  assert.match(src, /search_queries:\s*masterResult\.searchQueryCount/)
  assert.match(src, /retrieval_attempts:\s*masterResult\.retrievalAttempts/)
  // A trilha é payload JSON; qualquer coluna nova aqui seria schema, e schema não é deste
  // card nem deste dono (CLAUDE.md §1 — `supabase/migrations/` é do `data`).
  assert.equal(/generation_meta\s*:\s*generationMeta/.test(src), true)
})

// ── O comentário que explicava por que ninguém viu o custo chegar ────────────

test('#652 — o arquivo não afirma mais que grounding é grátis', async () => {
  const raw = readFileSync(MODULE_PATH, 'utf8')
  assert.equal(
    /grátis \(cota free\)|Search é grátis/.test(raw),
    false,
    'a afirmação "grounding é grátis" era verdade só no tier gratuito',
  )
  // O custo real fica escrito com a data da conferência: sem a data, a próxima pessoa não
  // sabe se o número ainda vale.
  assert.match(raw, /US\$ 35 por 1\.000 PROMPTS/)
  assert.match(raw, /US\$ 14 por 1\.000 SEARCH QUERIES/)
  assert.match(raw, /2026-09-01/)
})
