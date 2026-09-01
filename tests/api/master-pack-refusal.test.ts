/**
 * #651 — a recusa do modelo nunca vira narração.
 *
 * O DEFEITO. `masterPackGenerator` pedia ao passo 1 `reply with exactly: NONE` e testava
 * `txt.toUpperCase() !== 'NONE'`. Quando o modelo recusa em prosa — "Não foi possível encontrar
 * informações sobre…" — a igualdade passa, a recusa vira `<verified_facts>` e o passo 2 narra a
 * recusa. Medição de 2026-09-01, antes do conserto: 126 linhas de `core.attraction_descriptions`
 * abrindo com uma recusa, todas com mp3 sintetizado e todas alcançáveis pelo app. Destas, 72 vieram
 * do passo 1 (`grounded=true`) e 48 nasceram no próprio passo 2, já em SAFE MODE.
 *
 * As entradas de recusa deste arquivo são strings REAIS de produção, não inventadas — é o que faz
 * o teste medir o defeito vivido em vez de medir a minha imaginação. As narrações legítimas também
 * são reais, e são o que impede o detector de ficar guloso.
 *
 * Módulo Deno puro, carregado por caminho montado em tempo de execução.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface MasterPackModule {
  isRefusalText: (text: string) => boolean
  judgeRetrievalOutput: (text: string) => {
    usable: boolean
    reason: 'ok' | 'empty' | 'none' | 'refusal' | 'no_bullets'
    taggedBullets: number
  }
}

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/masterPackGenerator.ts'
)

let mod: MasterPackModule

before(async () => {
  mod = (await import(pathToFileURL(MODULE_PATH).href)) as MasterPackModule
})

// ── Recusas reais, gravadas em core.attraction_descriptions ──────────────────
const REAL_REFUSALS: [string, string][] = [
  [
    'pt-br — a do card, com a pessoa privada citada',
    'Não foi possível encontrar informações sobre "Pruitt\'s Point" nas fontes disponíveis. As buscas mencionam "Pruett Vineyard", "Point Cabrillo" e uma publicação no Facebook de "Julie Pruitt", mas nenhuma delas se refere a este local.',
  ],
  [
    'pt-br — recusa curta',
    'Não foi possível encontrar informações específicas sobre este local, Gruebstai J.C. Heer 1859-1925, em fontes confiáveis.',
  ],
  [
    'pt-br — recusa por ambiguidade, sem a palavra "encontrar"',
    'Não é possível identificar qual Paróquia São Francisco Xavier você está vendo. Existem várias em São Paulo: uma no Jardim Japão, fundada em 1954, e outra na Vila Gomes Cardim.',
  ],
  [
    'en — desculpa de primeira pessoa',
    'I am sorry, but I could not find reliable information specifically about "Torre geodetica di Paterno" near Lanzara, Campania. The search results provided information about other locations.',
  ],
  [
    'en — nome do POI ANTES da recusa (o prefixo curto não descaracteriza)',
    "Ponderosa Woods... I'm unable to find specific information about a place called \"Ponderosa Woods\" near Alum Rock, California. My search results provide details about Alum Rock Park.",
  ],
  [
    'en — recusa por regra de idioma, não por falta de fonte',
    'I cannot fulfill this request. The provided `LANGUAGE RULE` explicitly states: "Write ALL output exclusively in English (United States)".',
  ],
  [
    'en — "unfortunately" é lead fraco e só conta com a palavra-meta ao lado',
    'Unfortunately, I was unable to find specific historical details for "Àrea de Autocarvanas La Colomina" to create the master content summary as requested.',
  ],
  [
    'es — desculpa de primeira pessoa',
    'Lo siento, pero no he podido encontrar información fiable sobre una "Parroquia San Luis de los Franceses" cerca de Castellana, Madrid.',
  ],
  [
    'es — sem desculpa, só a impossibilidade',
    'No puedo decirte nada sobre la Iglesia de la Santa Cruz en este lugar exacto, porque hay varias iglesias con ese nombre en la provincia de Burgos.',
  ],
]

for (const [label, text] of REAL_REFUSALS) {
  test(`#651 — recusa reconhecida: ${label}`, () => {
    assert.equal(mod.isRefusalText(text), true, `deveria ser recusa: ${text.slice(0, 60)}`)
  })
}

test('#651 — o NONE literal continua sendo recusa, com ou sem pontuação', () => {
  for (const t of ['NONE', 'none', ' None. ', 'NONE!']) {
    assert.equal(mod.isRefusalText(t), true, t)
  }
})

// ── Narrações legítimas, também reais. Nenhuma pode ser recusada ─────────────
const REAL_NARRATIONS: [string, string][] = [
  [
    'pt-br',
    "L'uomo e la vite, um percurso criado em 2006, documenta a dramática transformação da viticultura local. Ela deixou de ser um passatempo camponês para se tornar um pilar profissional da região.",
  ],
  [
    'pt-br — abre com o nome do POI e ponto final',
    'Centro Esportivo do Fim do Mundo. Este complexo, inaugurado em 1970, com pavilhões desde 1944, é uma verdadeira instituição em Genebra.',
  ],
  [
    'it — abre com o nome do POI e ponto final',
    'Palácio de São Bento. Originariamente un monastero benedettino del 1598, la sua funzione cambiò radicalmente dopo la dissoluzione degli ordini religiosi.',
  ],
  [
    'it',
    'Il Teatro Nacional de São Carlos, inaugurato il 30 giugno 1793, fu costruito in soli sei mesi. Il suo architetto, José da Costa e Silva, si ispirò a teatri italiani come il San Carlo.',
  ],
  [
    'pt-br — "não foi possível" DENTRO da história é lead fraco sem palavra-meta: narração, não recusa',
    'Igreja da Sé. Não foi possível terminar a torre em pedra antes da guerra, e o campanário de madeira ficou ali por quarenta anos, batendo as horas de um jeito que ninguém esqueceu.',
  ],
  ['vazio não é recusa — é ausência, e quem trata é o chamador', ''],
]

for (const [label, text] of REAL_NARRATIONS) {
  test(`#651 — narração legítima não é recusada: ${label}`, () => {
    assert.equal(mod.isRefusalText(text), false, `falso positivo em: ${text.slice(0, 60)}`)
  })
}

// ── O portão do passo 1 ──────────────────────────────────────────────────────
test('#651 — bullets etiquetados passam pelo portão do retrieval', () => {
  const facts = [
    '- [type] Crêperie, opened in 1983',
    '- [character] Founded by Michelle Faure, known as "Michou"',
    '- [curiosity] The 1986 move was celebrated with a chocolate war',
  ].join('\n')
  const v = mod.judgeRetrievalOutput(facts)
  assert.equal(v.usable, true)
  assert.equal(v.reason, 'ok')
  assert.equal(v.taggedBullets, 3)
})

test('#651 — bullets sem etiqueta ainda passam (dois ou mais): o contrato aperta sem quebrar a colheita boa', () => {
  const v = mod.judgeRetrievalOutput('- Opened in 1983 by a French cook\n- Moved next door in 1986')
  assert.equal(v.usable, true)
})

test('#651 — a recusa em prosa NÃO passa pelo portão, e o motivo vai para o log', () => {
  const v = mod.judgeRetrievalOutput(
    'Não foi possível encontrar informações sobre "Pruitt\'s Point" nas fontes disponíveis.'
  )
  assert.equal(v.usable, false)
  assert.equal(v.reason, 'refusal')
})

test('#651 — prosa sem bullets nenhum é fora do contrato, não matéria-prima', () => {
  const v = mod.judgeRetrievalOutput(
    'This place is a nice square in the middle of town where people gather in the evening.'
  )
  assert.equal(v.usable, false)
  assert.equal(v.reason, 'no_bullets')
})

test('#651 — NONE e vazio continuam com motivos distintos, porque são falhas distintas', () => {
  assert.equal(mod.judgeRetrievalOutput('NONE').reason, 'none')
  assert.equal(mod.judgeRetrievalOutput('   ').reason, 'empty')
})

// ── As duas regras editoriais do #651, no texto dos prompts ──────────────────
//
// Guarda contra remoção silenciosa. O prompt não é extraível sem refatorar o gerador, então o que
// se afirma aqui é o mínimo verificável: as regras existem nas DUAS pontas — colher e escrever.
// Um teste de conteúdo de prompt não prova que o modelo obedece; prova que nós pedimos.
test('#651 — pessoa privada é barrada no passo 1 e no passo 2', () => {
  const src = readFileSync(MODULE_PATH, 'utf8')
  const gather = src.slice(0, src.indexOf('const systemInstruction'))
  const compose = src.slice(src.indexOf('const systemInstruction'))
  for (const [label, text] of [['colheita', gather], ['narração', compose]] as const) {
    assert.match(text, /never (name|pronounce the name of) a (private individual|person who is not a public or historical figure)/i, label)
    assert.match(text, /social-media post/, label)
  }
})

test('#651 — política contemporânea e acusação ficam fora, nas duas pontas', () => {
  const src = readFileSync(MODULE_PATH, 'utf8')
  const gather = src.slice(0, src.indexOf('const systemInstruction'))
  const compose = src.slice(src.indexOf('const systemInstruction'))
  for (const [label, text] of [['colheita', gather], ['narração', compose]] as const) {
    assert.match(text, /corruption allegation/, label)
    assert.match(text, /never (for|by) who occupies it today/, label)
    // O corte é no contemporâneo, não na história: isto é o que impede a regra de apagar o museu.
    assert.match(text, /(treaty was signed here)/, label)
  }
})
