/**
 * #716 — o token de raciocínio entra na conta, e a conta é por estágio.
 *
 * POR QUE ESTE TESTE EXISTE. `callGemini` gravava `candidatesTokenCount` como `output_tokens` e
 * ignorava `thoughtsTokenCount`. O Gemini fatura raciocínio na MESMA SKU de output, e o
 * retrieval roda com `thinkingConfig` ligado: nos oito primeiros dias de setembro/2026 a fatura
 * cobrou ~R$ 774 de token onde o banco registrava o equivalente a ~R$ 62 — cerca de 12×. Com o
 * número errado, a decisão do #652 sobre qual família de modelo fica em outubro é tomada sobre
 * a menor parte do custo.
 *
 * O QUE ELE TRAVA, em três frentes:
 *
 * 1. `thoughtsTokenCount` entra em `output_tokens`, e sobra em `thinking_tokens` para quem
 *    precisa saber se o modelo ficou caro por escrever ou por pensar.
 * 2. O usage SOMA as tentativas em vez de sobrescrever. Era o defeito irmão do que o #652
 *    corrigiu na contagem de buscas: uma resposta descartada por `finishReason` ou por recusa
 *    já foi cobrada, e reatribuir `step1Usage` apagava a cobrança da tentativa anterior —
 *    justamente nos 13,1% de descrições de agosto/2026 que caíram no fallback.
 * 3. Retrieval e compose saem separados. Desde o #652 os dois estágios rodam em famílias com
 *    preço por token 5× diferente, e `llm_model` guarda o par colado com os tokens somados:
 *    sem a separação, atribuir custo a um modelo depende do relatório por SKU da fatura, que
 *    chega um mês depois e não separa por POI.
 *
 * Módulo Deno puro, carregado por caminho montado em tempo de execução: um import estático
 * terminaria em `.ts` e reprovaria o `npm run type-check` do repositório inteiro.
 *
 * Run with: npm run test:api
 */

import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface UsageShape {
  input_tokens: number
  output_tokens: number
  thinking_tokens: number
  model: string
}

interface MasterPackResultShape {
  description: string
  usage: UsageShape | null
  retrieveUsage?: UsageShape | null
  composeUsage?: UsageShape | null
  retrievalAttempts?: number
}

interface MasterPackModule {
  generateMasterPack: (
    poiName: string,
    city: string,
    rawContext: string,
    language: string,
    apiKey: string,
  ) => Promise<MasterPackResultShape>
}

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/masterPackGenerator.ts'
)

let mod: MasterPackModule
const realFetch = globalThis.fetch

before(async () => {
  mod = (await import(pathToFileURL(MODULE_PATH).href)) as MasterPackModule
})

after(() => {
  globalThis.fetch = realFetch
})

// ── O dublê da API ───────────────────────────────────────────────────────────

type Step = {
  prompt: number
  candidates: number
  /** Ausente = a resposta veio sem o campo, como num modelo sem thinking. */
  thoughts?: number
  text?: string
  finishReason?: string
}

const USABLE_FACTS = [
  '- [type] Crêperie, opened in 1983',
  '- [character] Founded by Michelle Faure, known as "Michou"',
  '- [curiosity] The 1986 move was celebrated with a chocolate war',
].join('\n')

const COMPOSE_OK =
  '<master_description>Crêperie du Vieux Port. Aberta em 1983, virou ponto de encontro do bairro.</master_description>\n' +
  '<master_facts>history|Aberta em 1983 por uma cozinheira bretã</master_facts>'

function usageMetadata(step: Step) {
  return {
    promptTokenCount: step.prompt,
    candidatesTokenCount: step.candidates,
    ...(step.thoughts === undefined ? {} : { thoughtsTokenCount: step.thoughts }),
  }
}

function installFetch(retrieval: Step[], compose: Step[]) {
  let ri = 0
  let ci = 0
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    const isRetrieval = Array.isArray(body.tools)
    const step = isRetrieval
      ? (retrieval[ri++] ?? { prompt: 0, candidates: 0 })
      : (compose[ci++] ?? { prompt: 0, candidates: 0 })

    return new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: step.finishReason ?? 'STOP',
            content: {
              parts: [{ text: step.text ?? (isRetrieval ? USABLE_FACTS : COMPOSE_OK) }],
            },
            ...(isRetrieval
              ? {
                  groundingMetadata: {
                    webSearchQueries: ['q0'],
                    groundingChunks: [{ web: {} }, { web: {} }],
                  },
                }
              : {}),
          },
        ],
        usageMetadata: usageMetadata(step),
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
  globalThis.fetch = realFetch
})

// ── 1. O raciocínio entra no output ──────────────────────────────────────────

test('#716 — thoughtsTokenCount entra em output_tokens e sobra em thinking_tokens', async () => {
  installFetch(
    [{ prompt: 100, candidates: 50, thoughts: 900 }],
    [{ prompt: 10, candidates: 20, thoughts: 0 }],
  )
  const r = await run()

  // O retrieval pensou 900 e escreveu 50: a fatura cobra os 950 na SKU de output.
  assert.equal(r.retrieveUsage?.output_tokens, 950)
  assert.equal(r.retrieveUsage?.thinking_tokens, 900)
  assert.equal(r.retrieveUsage?.input_tokens, 100)

  // E o agregado, que é o que vai para a coluna `output_tokens`, carrega os dois estágios.
  assert.equal(r.usage?.output_tokens, 970)
  assert.equal(r.usage?.thinking_tokens, 900)
})

test('#716 — resposta sem thoughtsTokenCount não vira NaN nem infla o output', async () => {
  installFetch([{ prompt: 100, candidates: 50 }], [{ prompt: 10, candidates: 20 }])
  const r = await run()
  assert.equal(r.retrieveUsage?.output_tokens, 50)
  assert.equal(r.retrieveUsage?.thinking_tokens, 0)
  assert.equal(r.usage?.thinking_tokens, 0)
})

// ── 2. A soma das tentativas ─────────────────────────────────────────────────

test('#716 — a tentativa descartada por finishReason também conta: o token já foi pago', async () => {
  // MAX_TOKENS é o caso caro: o modelo pensou até estourar o teto e a resposta é inútil. O
  // laço cai no fallback, e sobrescrever o usage apagaria exatamente o gasto que se mede.
  installFetch(
    [
      { prompt: 100, candidates: 0, thoughts: 2048, finishReason: 'MAX_TOKENS' },
      { prompt: 100, candidates: 50, thoughts: 300 },
    ],
    [{ prompt: 10, candidates: 20 }],
  )
  const r = await run()
  assert.equal(r.retrievalAttempts, 2)
  assert.equal(r.retrieveUsage?.input_tokens, 200)
  assert.equal(r.retrieveUsage?.output_tokens, 2048 + 50 + 300)
  assert.equal(r.retrieveUsage?.thinking_tokens, 2348)
})

test('#716 — a tentativa que recusa em prosa também conta', async () => {
  installFetch(
    [
      { prompt: 100, candidates: 40, thoughts: 500, text: 'NONE' },
      { prompt: 100, candidates: 50, thoughts: 200 },
    ],
    [{ prompt: 10, candidates: 20 }],
  )
  const r = await run()
  assert.equal(r.retrieveUsage?.output_tokens, 40 + 500 + 50 + 200)
})

// ── 3. Um estágio não contamina o outro ──────────────────────────────────────

test('#716 — retrieve e compose saem separados, e o agregado é a soma dos dois', async () => {
  installFetch(
    [{ prompt: 100, candidates: 50, thoughts: 900 }],
    [{ prompt: 1000, candidates: 400, thoughts: 0 }],
  )
  const r = await run()

  assert.equal(r.composeUsage?.input_tokens, 1000)
  assert.equal(r.composeUsage?.output_tokens, 400)
  assert.equal(r.composeUsage?.thinking_tokens, 0)

  // O compose não pensa, então todo o raciocínio da linha é do retrieval — é essa atribuição
  // que `llm_model`, com o par colado e os tokens somados, não consegue fazer.
  assert.equal(r.usage?.input_tokens, 1100)
  assert.equal(r.usage?.output_tokens, 950 + 400)
  assert.equal(r.usage?.thinking_tokens, 900)
  assert.equal(r.retrieveUsage?.thinking_tokens, r.usage?.thinking_tokens)
})
