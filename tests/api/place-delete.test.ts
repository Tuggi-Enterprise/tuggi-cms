/**
 * APAGAR UM LOCAL, e o que apagar um local leva junto. #409.
 *
 * O FATO QUE DECIDE O DESENHO, lido do schema em 2026-08-23: `DELETE` em `core.attractions`
 * propaga em cascata para **17 tabelas**, e elas não são da mesma natureza.
 *
 *   cadastro, e se refaz     `attraction_coordinate`, `attraction_descriptions`,
 *                            `attraction_image`, `attraction_trigger_points`, `place_details`
 *   HISTÓRICO, e não volta   `drive.poi_visits`, `drive.poi_visit_analytics`,
 *                            `drive.poi_engagement`, `drive.attraction_feedback`,
 *                            `drive.trip_session_attractions`
 *   TRILHA DE DECISÃO        `partner.partner_triage_refusals` (append-only por BR-B2B-011,
 *                            item 5)
 *
 * E `partner.clients.welcome_poi_id` é `SET NULL`: o parceiro perde a página de boas-vindas sem
 * que nada diga que perdeu.
 *
 * POR ISSO ISTO NÃO É `deletePoi`. Aquele apaga tudo sem perguntar, e é uma armadilha que existe
 * — não um padrão a copiar. O que motivou o card são as duplicatas que
 * `Criar o local a partir da proposta` gerou ao lado de estabelecimentos já publicados, com zero
 * de tudo: essas são lixo. Um registro com história sai do ar por `is_active` (BR-POI-005).
 *
 * Mutações que deixam esta suíte vermelha:
 *  · apagar um local com visita, feedback ou sessão de viagem;
 *  · apagar um local com recusa de triagem, que é a trilha do que foi dito ao parceiro;
 *  · apagar o local de um parceiro sem desvincular antes, deixando a esteira apontando ao nada;
 *  · apagar o POI de boas-vindas de alguém;
 *  · devolver um motivo por vez, o que faz o operador tentar de novo para descobrir o seguinte;
 *  · decidir na tela em vez de na rota.
 *
 * Rodar com: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { canDelete, verdictFor, type PlaceHistory } from '@/lib/core/place-delete'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const ROUTE = 'app/api/admin/places/[attractionId]/route.ts'
const CONTROL = 'components/place-management/PlaceDeleteControl.tsx'

function history(overrides: Partial<PlaceHistory> = {}): PlaceHistory {
  return {
    visits: 0,
    feedback: 0,
    sessions: 0,
    triageRefusals: 0,
    welcomeFor: 0,
    partnerClientId: null,
    ...overrides,
  }
}

// ── O que pode sumir ─────────────────────────────────────────────────────────────────────────

test('#409 · um registro que não acumulou nada pode sumir — é o caso das duplicatas', () => {
  // `CAFETERIA ENCONTROS`, o place que o botão criou ao lado do estabelecimento já publicado:
  // zero visita, zero trigger point, zero descrição, sem vínculo. Medido em 2026-08-23.
  assert.deepEqual(verdictFor(history()), { kind: 'ok' })
  assert.equal(canDelete(history()), true)
})

// ── O que não pode ───────────────────────────────────────────────────────────────────────────

test('#409 · história de turista não se apaga junto com um cadastro', () => {
  // Nenhum reimport devolve uma visita. São pessoas que passaram ali.
  for (const [field, reason] of [
    ['visits', 'has_visits'],
    ['feedback', 'has_feedback'],
    ['sessions', 'has_sessions'],
  ] as const) {
    assert.deepEqual(verdictFor(history({ [field]: 1 } as Partial<PlaceHistory>)), {
      kind: 'blocked',
      reasons: [reason],
    })
  }
})

test('#409 · BR-B2B-011 item 5: a trilha da triagem é append-only, e apagar o local a levaria', () => {
  // Reapresentar reabre a triagem, e as rodadas anteriores são o registro do que foi dito ao
  // parceiro. Um `DELETE` no local apaga esse registro em cascata, em silêncio.
  assert.deepEqual(verdictFor(history({ triageRefusals: 1 })), {
    kind: 'blocked',
    reasons: ['has_triage_refusal'],
  })
})

test('#409 · o local de um parceiro não some sem alguém desvincular primeiro', () => {
  // Apagar deixaria a esteira apontando para o nada e a parceria sem endereço, sem que ninguém
  // tenha decidido isso. Desvincular é um ato, e um ato explícito.
  assert.deepEqual(verdictFor(history({ partnerClientId: 'client-1' })), {
    kind: 'blocked',
    reasons: ['is_partner_place'],
  })

  // `welcome_poi_id` é `SET NULL` no schema: o parceiro perderia a página de boas-vindas e nada
  // diria que perdeu.
  assert.deepEqual(verdictFor(history({ welcomeFor: 1 })), {
    kind: 'blocked',
    reasons: ['is_welcome_poi'],
  })
})

test('#409 · vêm TODOS os motivos, não o primeiro', () => {
  // Um local com visitas E vínculo de parceiro tem duas coisas a resolver. Devolver uma de cada
  // vez faz o operador tentar de novo só para descobrir a seguinte.
  const verdict = verdictFor(history({ visits: 3, welcomeFor: 1, partnerClientId: 'client-1' }))
  assert.equal(verdict.kind, 'blocked')
  assert.deepEqual(
    (verdict as { reasons: string[] }).reasons,
    ['has_visits', 'is_welcome_poi', 'is_partner_place']
  )
})

// ── As superfícies ───────────────────────────────────────────────────────────────────────────

test('#409 · quem decide é a rota, sobre contagens lidas no instante do clique', () => {
  const route = code(ROUTE)

  assert.match(route, /verdictFor\(history\)/)
  // As cinco contagens que a régua consome, cada uma da sua tabela.
  for (const [schema, table, column] of [
    ['drive', 'poi_visits', 'poi_id'],
    ['drive', 'attraction_feedback', 'attraction_id'],
    ['drive', 'trip_session_attractions', 'attraction_id'],
    ['partner', 'partner_triage_refusals', 'attraction_id'],
    ['partner', 'clients', 'welcome_poi_id'],
  ] as const) {
    assert.match(
      route,
      new RegExp(`countOf\\(auth\\.supabase, '${schema}', '${table}', '${column}'`),
      `a rota tem de contar ${schema}.${table}`
    )
  }

  // Falha fechada: apagar em cima de uma leitura que não respondeu é apagar sem saber.
  assert.match(route, /if \(error\) throw new Error\(`\$\{schema\}\.\$\{table\}: \$\{error\.message\}`\)/)
  assert.match(route, /catch \(lookupError\)[\s\S]*?status: 503/)

  // A recusa devolve a lista inteira, e a linha de auditoria é o que sobra de que aquilo existiu.
  assert.match(route, /reasons: verdict\.reasons/)
  assert.match(route, /action: 'DELETE_PLACE'/)
  assert.match(route, /withAuth<Params>\(\{ roles: \['admin'\] \}/)
})

test('#409 · a tela não adivinha se dá para apagar — ela pede e conta o que ouviu', () => {
  const control = code(CONTROL)
  assert.equal(control.indexOf('verdictFor'), -1, 'a régua é do servidor')
  assert.equal(control.indexOf('poi_visits'), -1)
  assert.match(control, /method: 'DELETE'/)
  assert.match(control, /payload\?\.error === 'has_history'/)

  // Confirmação em dois passos, NA TELA: o diálogo nativo é uma linha que se dispensa no
  // reflexo, e este ato apaga em cascata.
  assert.match(control, /confirming \? \(/)
  assert.equal(control.indexOf('window.confirm'), -1)
  assert.match(control, /t\('confirm', \{ name \}\)/)
})

test('#409 · todo motivo de recusa tem frase, e a saída sem perda é oferecida', () => {
  const copy = JSON.parse(read('messages/pt.json')).Modals.PlaceDetails.delete
  for (const reason of [
    'has_visits', 'has_feedback', 'has_sessions',
    'has_triage_refusal', 'is_welcome_poi', 'is_partner_place',
  ]) {
    assert.equal(typeof copy.reasons[reason], 'string', `falta a frase de ${reason}`)
  }
  for (const key of ['action', 'confirm', 'confirmAction', 'cancel', 'deleting', 'failed', 'blockedTitle', 'blockedHint']) {
    assert.equal(typeof copy[key], 'string', `falta ${key}`)
  }
  // `blockedHint` é o caminho que não perde nada: sair do ar por `is_active` (BR-POI-005).
  assert.match(copy.blockedHint, /Ativo/)
})
