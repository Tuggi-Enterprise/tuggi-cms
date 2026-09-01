/**
 * #653 — o raio do que conta como fonte aproveitável, e o que ele NÃO afrouxou.
 *
 * O QUE MUDOU. O passo 1 exigia fonte confiável especificamente sobre AQUELE lugar e proibia o
 * entorno com todas as letras. Para o POI obscuro — a maior parte do acervo — isso devolvia NONE
 * em cima de material que daria narração honesta: em agosto/2026, 2.003 de 11.227 gerações (17,8%)
 * pagaram o pedágio de grounding duas vezes por causa disso, e 799 terminaram em SAFE MODE, texto
 * genérico gravado com `needs_review`. Agora o entorno entra — sempre etiquetado `[area]`.
 *
 * O QUE ESTE TESTE TRAVA É A FRONTEIRA, NÃO O ESTILO. Nenhum teste de prompt prova que o modelo
 * obedece; ele prova o que nós pedimos, e que ninguém removeu o pedido depois. Quatro coisas:
 *   1. fonte só sobre o entorno é APROVEITADA em vez de virar NONE (o objetivo do card);
 *   2. a procedência continua distinguível — `factScope` sai da colheita, não da narração;
 *   3. as guardas do #651 seguem inteiras no prompt REALMENTE enviado (BR-CONTEUDO-006 e 007);
 *   4. sem fonte nenhuma, NONE continua sendo o resultado, e recusa em prosa que fala do entorno
 *      continua sendo recusa — afrouxar o raio não podia virar porta para o passo 2 narrar um
 *      "não encontrei" (BR-CONTEUDO-008 item 1).
 *
 * TENSÃO REGISTRADA, não escondida: BR-CONTEUDO-008 item 4 diz que fato da cidade ou da região não
 * sustenta a descrição. `factScope === 'area'` é exatamente essa população, e é decisão do operador
 * em 2026-09-01 (card #653) publicá-la. O que este arquivo garante é que ela fique CONTÁVEL.
 *
 * #654 (seção 7) — a frase de assunto do passo 1 passou a dizer ONDE o lugar fica: cidade,
 * estado e país, e `in` no lugar de `near`. Mora aqui porque é o MESMO prompt de colheita que
 * as seções acima travam, e o interceptador de `fetch` já existe — um terceiro arquivo só
 * duplicaria o harness.
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
  retrievalAttempts?: number
  factScope?: 'place' | 'area' | 'mixed'
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
  judgeRetrievalOutput: (text: string) => {
    usable: boolean
    reason: 'ok' | 'empty' | 'none' | 'refusal' | 'no_bullets'
    taggedBullets: number
  }
  scopeOfFacts: (facts: string | null | undefined) => 'place' | 'area' | 'mixed' | undefined
}

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/masterPackGenerator.ts'
)

/** #654 — a montagem do contexto de lugar mora na Edge Function, que não é importável daqui
 *  (Deno.serve). O que se prova por leitura do fonte é o que ela PEDE ao banco e como junta. */
const DESCRIPTION_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/generate-description/index.ts'
)

let mod: MasterPackModule
const realFetch = globalThis.fetch

before(async () => {
  mod = (await import(pathToFileURL(MODULE_PATH).href)) as MasterPackModule
})

after(() => {
  globalThis.fetch = realFetch
})

// ── Colheitas ────────────────────────────────────────────────────────────────

/** Só o lugar em si — como o passo 1 sempre respondeu quando o POI é documentado. */
const PLACE_FACTS = [
  '- [type] Crêperie, opened in 1983',
  '- [character] Founded by Michelle Faure, known as "Michou"',
  '- [curiosity] The 1986 move was celebrated with a chocolate war',
].join('\n')

/** Só o entorno: a colheita que ANTES do #653 era jogada fora e virava NONE. */
const AREA_FACTS = [
  '- [area] Rua das Pedras was the first paved street in the old town, opened in 1890',
  '- [area] This part of town grew around the fishing harbour and kept its warehouse fronts',
].join('\n')

const MIXED_FACTS = [
  '- [type] A two-storey stone house, still a family home',
  '- [area] The street was the first paved one in the old town, opened in 1890',
].join('\n')

const COMPOSE_OK =
  '<master_description>Casa da Rua das Pedras. A rua onde você está foi a primeira calçada da vila.</master_description>\n' +
  '<master_facts>Area|A rua foi a primeira calçada da vila, em 1890</master_facts>'

type RetrievalStep = { text?: string; chunks?: number }

let retrievalPrompts: string[] = []
let composeSystems: string[] = []
let calledModels: string[] = []

function installFetch(script: RetrievalStep[]) {
  let i = 0
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const model = String(url).match(/models\/([^:]+):/)?.[1] ?? 'unknown'
    calledModels.push(model)
    const body = JSON.parse(String(init?.body ?? '{}'))
    const isRetrieval = Array.isArray(body.tools)

    if (!isRetrieval) {
      composeSystems.push(String(body.system_instruction?.parts?.[0]?.text ?? ''))
      return new Response(
        JSON.stringify({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: COMPOSE_OK }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        }),
        { status: 200 },
      )
    }

    retrievalPrompts.push(String(body.contents?.[0]?.parts?.[0]?.text ?? ''))
    const step = script[i++] ?? {}
    return new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: step.text ?? PLACE_FACTS }] },
            groundingMetadata: {
              webSearchQueries: ['q0'],
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

const run = (kind: 'poi' | 'event' | 'place' = 'poi', locationContext = 'Búzios, Brazil') =>
  mod.generateMasterPack(
    'Casa da Rua das Pedras',
    locationContext,
    'test',
    'pt-br',
    'test-key',
    undefined,
    25,
    [],
    [],
    { kind },
  )

beforeEach(() => {
  retrievalPrompts = []
  composeSystems = []
  calledModels = []
})

// ── 1. O entorno é aproveitado em vez de virar NONE ──────────────────────────

test('#653 — an area-only harvest passes the step 1 gate instead of being thrown away', () => {
  const v = mod.judgeRetrievalOutput(AREA_FACTS)
  assert.equal(v.usable, true)
  assert.equal(v.reason, 'ok')
  // Os dois bullets contam como etiquetados: `[area]` entrou em FACT_BULLET_TAGS, e sem isso
  // uma colheita só de entorno cairia no ramo `no_bullets` e pagaria o segundo modelo.
  assert.equal(v.taggedBullets, 2)
})

test('#653 — sources only about the surroundings produce a grounded narration, with ONE retrieval attempt', async () => {
  installFetch([{ text: AREA_FACTS }])
  const r = await run()
  assert.equal(r.grounded, true)
  assert.equal(r.factScope, 'area')
  // O ponto do card é o pedágio: se o entorno ainda caísse no NONE, haveria uma segunda
  // tentativa aqui — 17,8% das gerações de agosto/2026 eram exatamente esta linha.
  assert.equal(r.retrievalAttempts, 1)
})

// ── 2. A procedência continua distinguível ───────────────────────────────────

test('#653 — factScope separates place, area and mixed harvests', async () => {
  assert.equal(mod.scopeOfFacts(PLACE_FACTS), 'place')
  assert.equal(mod.scopeOfFacts(AREA_FACTS), 'area')
  assert.equal(mod.scopeOfFacts(MIXED_FACTS), 'mixed')
  // Sem colheita não há procedência a declarar — e `undefined` não é `'place'`, que seria a
  // afirmação falsa de que existe fato sobre o lugar.
  assert.equal(mod.scopeOfFacts(''), undefined)
  assert.equal(mod.scopeOfFacts(null), undefined)
})

test('#653 — a mixed harvest is reported as mixed, not flattened into place', async () => {
  installFetch([{ text: MIXED_FACTS }])
  const r = await run()
  assert.equal(r.factScope, 'mixed')
})

test('#653 — a harvest about the place itself keeps reporting place', async () => {
  installFetch([{ text: PLACE_FACTS }])
  const r = await run()
  assert.equal(r.factScope, 'place')
})

// ── 3. As guardas do #651 seguem no prompt REALMENTE enviado ─────────────────

test('#653 — BR-CONTEUDO-006: the private-person guard survives in both prompts actually sent', async () => {
  installFetch([{ text: AREA_FACTS }])
  await run()
  const gather = retrievalPrompts[0]
  const compose = composeSystems[0]
  for (const [label, text] of [['harvest', gather], ['narration', compose]] as const) {
    assert.match(text, /never (name|pronounce the name of) a (private individual|person who is not a public or historical figure)/i, label)
    assert.match(text, /social-media post/, label)
  }
})

test('#653 — BR-CONTEUDO-007: contemporary politics and accusations stay out of both prompts actually sent', async () => {
  installFetch([{ text: AREA_FACTS }])
  await run()
  for (const [label, text] of [['harvest', retrievalPrompts[0]], ['narration', composeSystems[0]]] as const) {
    assert.match(text, /corruption allegation/, label)
    assert.match(text, /never (for|by) who occupies it today/, label)
    assert.match(text, /(treaty was signed here)/, label)
  }
})

test('#653 — the widened radius is about SOURCES, never about inventing', async () => {
  installFetch([{ text: AREA_FACTS }])
  await run()
  const gather = retrievalPrompts[0]
  // A régua que não se move: só o que a fonte diz.
  assert.match(gather, /Never invent, guess, approximate or embellish/)
  assert.match(gather, /Never fill the gap by inventing/)
  // BR-CONTEUDO-008 item 4 na prática: o fato do entorno não pode ser vestido de fato daqui —
  // nem na colheita, nem na narração.
  assert.match(gather, /never be restated as this place's own/)
  assert.match(composeSystems[0], /NEVER move an \[area\] date, number, person or event onto this place/)
})

// ── 4. Sem fonte nenhuma, NONE continua sendo o resultado ────────────────────

test('#653 — with nothing in the sources, NONE still ends in SAFE MODE and no scope is claimed', async () => {
  installFetch([
    { text: 'NONE', chunks: 0 },
    { text: 'NONE', chunks: 0 },
  ])
  const r = await run()
  assert.equal(r.grounded, false)
  assert.equal(r.factScope, undefined)
  assert.equal(r.retrievalAttempts, 2)
})

test('#653 — a prose refusal that TALKS about the surroundings is still a refusal, not area material', async () => {
  // String real de produção (#651). Ela cita "Alum Rock Park" — o entorno — e é justamente o
  // formato que o raio ampliado poderia passar a aceitar por engano. Recusa não é matéria-prima:
  // BR-CONTEUDO-008 item 1, o turista nunca ouve sobre a nossa busca.
  const refusal =
    "Ponderosa Woods... I'm unable to find specific information about a place called \"Ponderosa Woods\" near Alum Rock, California. My search results provide details about Alum Rock Park."
  assert.equal(mod.judgeRetrievalOutput(refusal).usable, false)
  assert.equal(mod.judgeRetrievalOutput(refusal).reason, 'refusal')

  installFetch([{ text: refusal }, { text: AREA_FACTS }])
  const r = await run()
  // A recusa foi descartada e o laço foi ao segundo modelo, exatamente como antes do #653.
  assert.equal(r.retrievalAttempts, 2)
  assert.equal(r.factScope, 'area')
})

// ── 5. O ramo de evento não herdou o raio ────────────────────────────────────

test('#653 — the event branch keeps its narrow scope: an edition is not explained by its surroundings', async () => {
  installFetch([{ text: PLACE_FACTS }])
  await run('event')
  const gather = retrievalPrompts[0]
  assert.equal(/\[area\]/.test(gather), false, 'evento não colhe entorno')
  assert.match(gather, /This is one specific event/)
})

// ── 6. O entorno colhido tem que ser específico DAQUELE entorno ─────────────
//
// BR-CONTEUDO-008 item 5: o teste do substituto passou a ter granularidade — afirmação sobre o
// entorno se testa trocando por outra rua, outro bairro ou outra cidade. Sem esta condição o item
// 4.b devolve ao acervo o genérico atmosférico que o item 2 proíbe, com roupa de contexto.

test('#653/BR-CONTEUDO-008 item 5 — the harvest prompt actually sent demands area facts specific to that area', async () => {
  installFetch([{ text: AREA_FACTS }])
  await run('poi')
  const gather = retrievalPrompts[0]
  // A condição, e não o exemplo: trocar o entorno tem que tornar a frase falsa.
  assert.match(gather, /must be SPECIFIC to that street, neighbourhood or town/)
  assert.match(
    gather,
    /swap it for another street, another neighbourhood or another town and the sentence must STOP being true/,
  )
  // A calibragem que o `produto` usou, nos dois sentidos — o exemplo que reprova e o que passa.
  assert.match(gather, /This neighbourhood is known for its restaurants/)
  assert.match(gather, /the town's first paved road, in 1890/)
})

test('#653/BR-CONTEUDO-008 item 5 — the establishment branch carries the same condition, not a second copy of it', async () => {
  installFetch([{ text: AREA_FACTS }])
  await run('place')
  assert.match(retrievalPrompts[0], /must be SPECIFIC to that street, neighbourhood or town/)
})

test('#653/BR-CONTEUDO-008 item 5 — specificity did not displace the non-transference rule', async () => {
  installFetch([{ text: AREA_FACTS }])
  await run('poi')
  const gather = retrievalPrompts[0]
  // 4.c continua na mesma frase do bullet: o item 5 é condição de COLHEITA, não substituto da
  // proibição de vestir o fato do entorno de fato do lugar.
  assert.match(gather, /never be restated as this place's own/)
  assert.match(gather, /Tag EVERY such bullet \[area\]/)
})

test('#653/BR-CONTEUDO-008 item 5 — the event branch stays out of it: no area, therefore no area condition', async () => {
  installFetch([{ text: PLACE_FACTS }])
  await run('event')
  assert.equal(/must be SPECIFIC to that street/.test(retrievalPrompts[0]), false)
})

test('#653 — the POI branch no longer carries the blanket prohibition on the surrounding town', async () => {
  installFetch([{ text: PLACE_FACTS }])
  await run('poi')
  const gather = retrievalPrompts[0]
  assert.equal(
    /surrounding town, resort, region or a different nearby place, do NOT include those facts/.test(gather),
    false,
    'a proibição inteira do entorno é o que devolvia NONE ao POI obscuro',
  )
  assert.match(gather, /\[area\]/)
  // O que sobrou da régua: confundir lugar continua proibido.
  assert.match(gather, /a source about a DIFFERENT place/i)
})

// ── 7. #654 — a frase de assunto diz ONDE o lugar fica ───────────────────────
//
// O operador, em 2026-09-01: "pode ter dez Fonte da Juventude perto de uma cidade... mas se na
// cidade específica ele vai falar da cidade específica". O limite que ele mesmo pôs foi não
// inflar o prompt — por isso o que entra é cidade, estado e país, e NÃO coordenada.
//
// Como sempre: nenhum teste de prompt prova que o Google acha o lugar certo. Este prova o que
// nós pedimos, e que ninguém desfez o pedido depois.

test('#654 — city, state and country all reach the subject line of the harvest actually sent', async () => {
  installFetch([{ text: PLACE_FACTS }])
  await run('poi', 'Búzios, Rio de Janeiro, Brazil')
  const subject = retrievalPrompts[0].split('\n')[0]
  assert.match(subject, /research this SPECIFIC place: "Casa da Rua das Pedras", in Búzios, Rio de Janeiro, Brazil\./)
  // O estado já era enviado antes do #654 e ninguém sabia — o nome da variável escondia. O país
  // é o que o card acrescentou; se ele sumir da frase, sumiu do `select`.
  for (const part of ['Búzios', 'Rio de Janeiro', 'Brazil']) {
    assert.ok(subject.includes(part), `${part} sumiu da frase de assunto`)
  }
})

test('#654 — the POI branch says `in`, not `near`: it is the POI own city, not the nearest one', async () => {
  installFetch([{ text: PLACE_FACTS }])
  await run('poi', 'Búzios, Rio de Janeiro, Brazil')
  const subject = retrievalPrompts[0].split('\n')[0]
  assert.match(subject, /, in Búzios/)
  assert.equal(/research this SPECIFIC place: "[^"]+", near /.test(subject), false, '`near` afrouxa a busca sem ser mais honesto')
})

test('#654 — an establishment keeps `in`, and an event keeps `held near`', async () => {
  installFetch([{ text: PLACE_FACTS }])
  await run('place', 'Búzios, Rio de Janeiro, Brazil')
  assert.match(retrievalPrompts[0].split('\n')[0], /research this SPECIFIC establishment: "[^"]+", in Búzios, Rio de Janeiro, Brazil\./)

  retrievalPrompts.length = 0
  installFetch([{ text: PLACE_FACTS }])
  await run('event', 'Búzios, Rio de Janeiro, Brazil')
  // A sede fica na cidade; a edição nem sempre. O ramo de evento não entrou no #654.
  assert.match(retrievalPrompts[0].split('\n')[0], /research this SPECIFIC event: "[^"]+", held near Búzios, Rio de Janeiro, Brazil/)
})

test('#654 — with the country missing the sentence stays well formed: no dangling comma', async () => {
  installFetch([{ text: PLACE_FACTS }])
  // O que a Edge Function entrega quando `country` (ou `state`) não veio: o `filter(Boolean)`
  // já derrubou o campo, então o gerador nunca vê ", ," nem vírgula antes do ponto final.
  await run('poi', 'Búzios')
  const subject = retrievalPrompts[0].split('\n')[0]
  assert.match(subject, /research this SPECIFIC place: "Casa da Rua das Pedras", in Búzios\./)
  assert.equal(/,\s*,/.test(subject), false, 'vírgula solta no meio')
  assert.equal(/,\s*\./.test(subject), false, 'vírgula solta antes do ponto')
})

test('#654 — with no location at all the sentence is still a sentence', async () => {
  installFetch([{ text: PLACE_FACTS }])
  // `"an unknown location"` é o fallback da Edge Function quando cidade, estado e país faltam.
  await run('poi', 'an unknown location')
  assert.match(retrievalPrompts[0].split('\n')[0], /, in an unknown location\./)
})

test('#654 — the Edge Function asks the database for country in BOTH selects of core.attractions', () => {
  const src = readFileSync(DESCRIPTION_PATH, 'utf8')
  // A intenção estava escrita no comentário e o join lia `poiDataFromDB?.country` desde sempre,
  // mas nenhum dos dois `select` pedia a coluna: o valor chegava `undefined` e o
  // `.filter(Boolean)` o descartava em silêncio. É o defeito que o #654 fechou.
  const selects = src.match(/"(id, )?name, city, state, country, osm_tags[^"]*"/g) ?? []
  assert.equal(selects.length, 2, 'os dois select de core.attractions precisam pedir country')
  // Batch e single: nenhum dos dois pode ficar para trás — o app usa um e o CMS o outro.
  assert.ok(selects.some((s) => s.startsWith('"id, ')), 'select do batch')
  assert.ok(selects.some((s) => !s.startsWith('"id, ')), 'select do single')
})

test('#654 — the location context is joined from the three fields, and the name no longer lies', () => {
  const src = readFileSync(DESCRIPTION_PATH, 'utf8')
  assert.match(src, /const locationContext = \[\s*cityName,\s*poiDataFromDB\?\.state \|\| null,\s*poiDataFromDB\?\.country \|\| null,\s*\]\.filter\(Boolean\)\.join\(", "\)/)
  // `cityName` continua existindo e continua sendo A CIDADE — é o que o bônus de completude de
  // `calculateHeuristicScore` procura dentro do texto. O que foi renomeado é o contexto inteiro.
  assert.match(src, /const cityName = poiDataFromDB\?\.city \|\| poiDataFromDB\?\.osm_tags\?\.\["addr:city"\] \|\| null;/)
  assert.match(src, /generateMasterPack\(\s*poiName,\s*locationContext,/)
})
