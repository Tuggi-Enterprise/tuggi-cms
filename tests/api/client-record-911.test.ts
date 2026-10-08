/**
 * #911 — the other tabs of the client record, shorter (spec `docs/design/spec-cms-ficha-demais-abas-2026-10.md`).
 *
 * The browser half of §8 is `tests/ct/client-record-911.spec.tsx`. This file holds what a mount does
 * not reach: the address the page reads (§8 item 1, `?tab=appusers` opens Pessoas), the copy table
 * of the spec word for word, the keys it retired, and the provider the contract page now gives the
 * record it opens.
 *
 * Mutations that turn it red: putting `appusers` back in `TABS`; dropping the `?tab=appusers` alias;
 * changing a label from the spec's table; leaving a retired key in `messages/`; bringing back the
 * `Enter {label}...` placeholder; opening the record from `ContractManager` without `ClientRecordProviders`.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8')
const messages = (locale: string) => JSON.parse(read(`messages/${locale}.json`))
const at = (tree: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree)

test('#911 §8 item 1: seven tabs in the spec order, Pessoas is `team`, and `?tab=appusers` opens it', () => {
  const modal = read('components/admin/clients/ClientEditorModal.tsx')
  const tabs = modal.slice(modal.indexOf('const TABS'), modal.indexOf('export function ClientEditorModal'))
  assert.deepEqual(
    Array.from(tabs.matchAll(/\{ id: '(\w+)', labelKey: '(\w+)'/g), (m) => `${m[1]}:${m[2]}`),
    ['partnership:partnership', 'profile:profile', 'fiscal:fiscal', 'contract:contract', 'team:people', 'places:places', 'coupons:coupons']
  )
  assert.doesNotMatch(modal, /'appusers'/, 'no appusers tab left in the record')
  const page = read('components/admin/AdminClientsPageContent.tsx')
  assert.match(page, /requestedTab === 'appusers' \? 'team'/)
})

const SPEC_TABLE: Record<string, string> = {
  'Clients.editor.tabs.people': 'Pessoas',
  'Clients.editor.tabs.afterSave': 'Disponível depois de salvar',
  'Clients.profile.qr.title': 'Link público e QR',
  'Clients.profile.qr.subtitle': 'Para imprimir em banner, voucher e cartão.',
  'Clients.profile.fields.slug': 'Slug (endereço /d/…)',
  'Clients.profile.sections.attribution': 'Aparência no app',
  'Clients.profile.sections.attributionEmpty': 'Aparência no app: avatar, @ e bio (vazio)',
  'Clients.profile.material.help': 'O primeiro pedido vem da proposta. Reposição se registra aqui.',
  'Clients.portal.acceptance.termLabel': 'Termo',
  'Partnerships.clientPlaces.pipelineLink': 'Ver na aba Parceria',
  'Clients.team.section': 'Logins no CMS',
  'Clients.team.saveFirst': 'Salve o cliente para criar logins.',
  'Clients.team.coordinatorTitle': 'Rede de afiliados',
  'Clients.team.parentCoordinatorHelp': 'Vincula esta empresa sob um coordenador.',
  'Clients.team.roles.owner': 'Dono',
  'Clients.team.unlinkLabel': 'Desvincular {who}',
  'Clients.appUsers.section': 'Usuários do app',
  'Clients.appUsers.unlinkLabel': 'Desvincular {who}',
  'Clients.coupons.scopedBanner': 'Só os cupons deste cliente. Os outros estão em <link>Cupons</link>.',
  'Clients.coupons.emptyScoped': 'Nenhum cupom para este cliente.',
}

test('#911: the pt labels are the spec table, word for word', () => {
  const pt = messages('pt')
  for (const [key, text] of Object.entries(SPEC_TABLE)) assert.equal(at(pt, key), text, key)
})

test('#911: en and es carry the same new keys (Partnerships and material are pt-only)', () => {
  for (const locale of ['en', 'es']) {
    const tree = messages(locale)
    for (const key of Object.keys(SPEC_TABLE)) {
      if (key.startsWith('Partnerships.') || key.startsWith('Clients.profile.material.')) continue
      assert.equal(typeof at(tree, key), 'string', `${locale}: ${key}`)
    }
  }
})

test('#911: the retired keys are gone from every locale', () => {
  const retired = [
    'Clients.editor.tabs.appusers',
    'Clients.editor.tabs.team',
    'Clients.editor.tabs.comingSoon',
    'Clients.editor.tabs.soonBadge',
    'Clients.profile.sections.attributionHelp',
    'Clients.team.emptyTitle',
    'Clients.team.emptyDesc',
    'Partnerships.clientPlaces.body',
  ]
  for (const locale of ['pt', 'en', 'es']) {
    const tree = messages(locale)
    for (const key of retired) assert.equal(at(tree, key), undefined, `${locale}: ${key}`)
  }
})

test('#911 §8 item 4: EditField has no default placeholder', () => {
  const field = read('components/admin/clients/shared/EditField.tsx')
  assert.doesNotMatch(field, /Enter \$\{label\}/)
})

test('#911 extra: the contract page opens the record inside ClientRecordProviders', () => {
  const manager = read('components/admin/contract/ContractManager.tsx')
  assert.match(manager, /<ClientRecordProviders messages=\{recordMessages\}>\s*<ClientEditorModal/)
  const page = read('app/[locale]/admin/clients/[clientId]/contract/page.tsx')
  assert.match(page, /recordMessages=\{clientRecordMessages\(\)\}/)
})
