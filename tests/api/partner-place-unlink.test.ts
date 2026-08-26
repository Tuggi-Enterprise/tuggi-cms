/**
 * Soltar o local do parceiro — o par que faltava de `LINK_PARTNER_PLACE`.
 *
 * O BECO. `verdictFor` recusa vincular o local que já é de outro cliente (`other_owner`,
 * BR-B2B-033, item 3) e a ida trava a corrida com `.is('partner_client_id', null)`. As duas
 * coisas estão certas, e juntas não deixavam saída: quem vinculou o registro errado — a
 * duplicata vazia no lugar do estabelecimento publicado, o defeito de 3 em 3 clientes de
 * `lib/partnerships/place-link` — não tinha ato nenhum para desfazer. Pedido do operador em
 * 2026-08-26: *"precisa ser necessário tirar um local vinculado ao parceiro e vincular outro"*.
 *
 * Mutações que deixam esta suíte vermelha:
 *  · `unlinkVerdictFor` deixar um cliente soltar o local de outro;
 *  · a rota escrever qualquer coisa além de `partner_client_id`, ou perder a trava de corrida;
 *  · `welcome_poi_id` continuar apontando para o local solto;
 *  · a rota sair de trás de `withAuth({ roles: ['admin'] })`;
 *  · o ato perder o passo de confirmação na tela, ou a linha de auditoria;
 *  · um cliente com um local só e sem boas-vindas ficar sem como escolher um.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { unlinkVerdictFor, type LinkCandidate } from '../../lib/partnerships/place-link'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const messages = (locale: string) => JSON.parse(read(`messages/${locale}.json`))

const ROUTE = 'app/api/admin/partnerships/clients/[clientId]/places/unlink/route.ts'
const TAB = 'components/admin/clients/tabs/PlacesTab.tsx'

/** O fonte SEM comentários — toda asserção sobre o que um arquivo FAZ lê isto. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const CLIENT = '44444444-4444-4444-4444-444444444444'
const OTHER = '55555555-5555-5555-5555-555555555555'

function candidate(partnerClientId: string | null): LinkCandidate {
  return {
    attractionId: '11111111-1111-1111-1111-111111111111',
    name: 'Cozi +',
    city: 'Cabo Frio',
    state: 'Rio de Janeiro',
    country: 'Brazil',
    entityKind: 'place',
    approved: true,
    hasCoordinate: true,
    partnerClientId,
  }
}

test('só o dono solta o que é dele', () => {
  assert.deepEqual(unlinkVerdictFor(candidate(CLIENT), CLIENT), { kind: 'ok' })
})

test('a tela de um parceiro não decide sobre o local de outro', () => {
  // Seria o `other_owner` de `verdictFor` pela porta dos fundos.
  assert.deepEqual(unlinkVerdictFor(candidate(OTHER), CLIENT), { kind: 'not_linked' })
  assert.deepEqual(unlinkVerdictFor(candidate(null), CLIENT), { kind: 'not_linked' })
})

test('soltar não olha para a curadoria do local — só para o dono', () => {
  const notReady = { ...candidate(CLIENT), approved: false, hasCoordinate: false, entityKind: 'event' }
  assert.deepEqual(
    unlinkVerdictFor(notReady, CLIENT),
    { kind: 'ok' },
    'o local vinculado por engano é justamente o que não passa nas recusas da ida'
  )
})

test('a rota escreve UMA coluna do catálogo, e trava a corrida', () => {
  const route = code(ROUTE)

  assert.match(route, /\.update\(\{ partner_client_id: null \}\)/)
  assert.match(route, /\.eq\('partner_client_id', clientId\)/, 'a trava de corrida, espelho do .is(..., null) da ida')

  // Soltar não é despublicar e não é apagar. A leitura de `approved` é legítima (o candidato
  // carrega o mesmo tipo da ida); o que não pode existir é uma ESCRITA além das duas colunas —
  // por isso a asserção lê os payloads de `.update(...)`, e não o arquivo inteiro.
  const writes = [...route.matchAll(/\.update\((\{[^}]*\})\)/g)].map((m) => m[1])
  assert.deepEqual(writes, ['{ partner_client_id: null }', '{ welcome_poi_id: null }'])
  assert.equal(route.indexOf('.delete('), -1, 'apagar o local é outro ato, com outra guarda')
})

test('a rota é o portão, e usa o veredito puro', () => {
  const route = code(ROUTE)

  assert.match(route, /withAuth<\{ clientId: string \}>\(\{ roles: \['admin'\] \}/)
  assert.match(route, /unlinkVerdictFor\(candidate, clientId\)/)
  // O veredito é aplicado sobre a linha lida NESTE instante, nunca sobre o que a tela mandou.
  assert.match(route, /\.from\('attractions'\)[\s\S]{0,200}\.eq\('id', attractionId\)/)
})

test('o POI de boas-vindas não sobrevive ao vínculo que o gerou', () => {
  const route = code(ROUTE)

  assert.match(route, /\.update\(\{ welcome_poi_id: null \}\)/)
  assert.match(route, /\.eq\('welcome_poi_id', attractionId\)/, 'só limpa quando aponta para ESTE local')
  // `authenticated` não tem USAGE no schema `partner` (42501) — a escrita tem de ser service_role.
  assert.match(route, /getSupabaseService\(\)\s*\.schema\('partner'\)/)
})

test('um duplo clique não vira erro', () => {
  const route = code(ROUTE)
  assert.match(route, /unlinked: false/, 'o local já solto responde 200, não 409')
})

test('o ato deixa rastro: sem ele, "cadê o local deste parceiro?" não tem resposta', () => {
  const route = code(ROUTE)
  assert.match(route, /action: 'UNLINK_PARTNER_PLACE'/)
  assert.match(read('lib/services/audit-service.ts'), /\| 'UNLINK_PARTNER_PLACE'/)
})

test('na tela, soltar pergunta antes — e diz o que NÃO vai acontecer', () => {
  const tab = code(TAB)

  assert.match(tab, /places\/unlink/)
  assert.match(tab, /setConfirmingUnlink\(true\)/)
  assert.match(tab, /unlink\.confirmAction/)
  assert.match(tab, /unlink\.confirmBody/)
  // A lista recarregada É a confirmação, como no vínculo e no boas-vindas.
  assert.match(tab, /await onUnlinked\(\)/)
})

test('o cliente que voltou a ter um local só ainda escolhe o boas-vindas', () => {
  const tab = code(TAB)
  assert.match(
    tab,
    /canChooseWelcome=\{detail\.places\.length > 1 \|\| !detail\.client\.welcomePoiId\}/,
    'desvincular limpa welcome_poi_id, e sem isto ninguém saúda o turista em /d/{slug}'
  )
})

test('a copy do ato existe, e ela é pt — o vocabulário da esteira só mora lá', () => {
  const unlink = messages('pt').Partnerships.unlink
  for (const key of ['action', 'confirmTitle', 'confirmBody', 'confirmAction', 'cancel', 'unlinking', 'failed']) {
    assert.ok(unlink?.[key], `falta Partnerships.unlink.${key}`)
  }
  assert.match(unlink.confirmTitle, /\{place\}/, 'a pergunta nomeia o local que vai ser solto')
})
