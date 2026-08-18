/**
 * Every hole in the contract checklist says where it is filled — TWICE, and the second answer
 * is the one a screen can act on.
 *
 * THE ROUND TRIP THIS REMOVES. `where` is prose (`aba Fiscal e Pagamentos`), so obeying it cost
 * a page change per missing field: leave the contract, hunt for the record in the client list,
 * find the tab, fill one field, come back, discover the next hole. Ten items, ten round trips.
 * With `target`, the item is a control and the record is a drawer that opens over the contract.
 *
 * THE ASSERTION THAT MATTERS MOST is that the two sides of the contract point at DIFFERENT
 * records. `Razão social da Tuggi` is missing from the row flagged `is_platform_owner`, not
 * from the partner in front of the operator — a target that carried the partner's id would
 * open the wrong registration and invite somebody to type Tuggi's CNPJ into a partner's row.
 *
 * Mutations that turn this suite red:
 *  · giving the platform-owner items the partner's id;
 *  · pointing `tax_id` at the profile tab, or `address` at the fiscal one;
 *  · handing a target to an item whose field is not in a client record (`qr_delivery`);
 *  · turning the checklist back into prose on the contract screen.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { contractChecklist, type ChecklistItem } from '@/lib/contract/snapshot'
import { EMPTY_CONFERENCE } from '@/lib/partner-form/regularity'
import type { Client } from '@/types/clients'

const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8')

const PARTNER_ID = '11111111-1111-4111-8111-111111111111'
const OWNER_ID = '22222222-2222-4222-8222-222222222222'

/** An empty registration: every field the checklist looks at is missing. */
const bare = (id: string): Client => ({ id, status: 'pending' }) as unknown as Client

function checklist(client: Client | null, ownerFound: boolean): ChecklistItem[] {
  return contractChecklist(
    client,
    { tier: 'paid', paymentMethod: null, qrDeliveryDays: null },
    {
      platformOwner: ownerFound
        ? { state: 'found', client: bare(OWNER_ID) }
        : { state: 'absent' },
      regularity: { conference: EMPTY_CONFERENCE } as never,
      // `null` de propósito: esta suíte prova os ALVOS dos itens de cadastro, e a trava do
      // marcador de revisão tem suíte própria em `contract-jurisdiction.test.ts`.
      templateMarker: null,
    }
  ).missing
}

const byId = (items: ChecklistItem[], id: string) => {
  const item = items.find((candidate) => candidate.id === id)
  assert.ok(item, `the checklist should still raise \`${id}\``)
  return item!
}

test('every missing item carries a target — none is left as prose only', () => {
  for (const items of [checklist(bare(PARTNER_ID), true), checklist(null, false)]) {
    for (const item of items) {
      assert.ok(item.target, `\`${item.id}\` has no target`)
      assert.ok(
        ['client', 'conference', 'page'].indexOf(item.target.kind) >= 0,
        `\`${item.id}\` has an unknown target kind`
      )
      // The prose is what a person reads and it never goes away: the control is labelled with it.
      assert.equal(typeof item.where, 'string')
      assert.ok(item.where.length > 0)
    }
  }
})

test('the two sides of the contract point at DIFFERENT records', () => {
  const items = checklist(bare(PARTNER_ID), true)

  // Tuggi's side lives in the row flagged `is_platform_owner`.
  for (const id of ['provider_legal_name', 'provider_tax_id', 'provider_address']) {
    const target = byId(items, id).target
    assert.equal(target.kind, 'client')
    assert.equal(
      target.kind === 'client' ? target.clientId : null,
      OWNER_ID,
      `\`${id}\` is a field of Tuggi's own registration, not of the partner's`
    )
  }

  // The partner's side lives in the record the operator has open.
  for (const id of ['tax_id', 'legal_name', 'address', 'representative_name']) {
    const target = byId(items, id).target
    assert.equal(target.kind, 'client')
    assert.equal(target.kind === 'client' ? target.clientId : null, PARTNER_ID)
  }
})

test('each field opens the tab it is actually edited on', () => {
  const items = checklist(bare(PARTNER_ID), true)
  const tabOf = (id: string) => {
    const target = byId(items, id).target
    return target.kind === 'client' ? target.tab : null
  }

  // `design` split them this way: identity and address on Perfil, money and the legal
  // representative on Fiscal e Pagamentos.
  assert.equal(tabOf('legal_name'), 'profile')
  assert.equal(tabOf('address'), 'profile')
  assert.equal(tabOf('provider_legal_name'), 'profile')
  assert.equal(tabOf('tax_id'), 'fiscal')
  assert.equal(tabOf('representative_name'), 'fiscal')
  assert.equal(tabOf('representative_role'), 'fiscal')
  assert.equal(tabOf('commission_rate'), 'fiscal')
  assert.equal(tabOf('monthly_fee'), 'fiscal')
})

test('a hole with no single record to open offers no button', () => {
  // Nobody flagged as the platform owner: there is no row to fill in, so the item stays prose.
  const target = byId(checklist(bare(PARTNER_ID), false), 'platform_owner').target
  assert.equal(target.kind, 'client')
  assert.equal(target.kind === 'client' ? target.clientId : 'set', null)

  const items = checklist(bare(PARTNER_ID), true)
  // These two are not fields of anybody's registration.
  assert.equal(byId(items, 'qr_delivery').target.kind, 'page')
  assert.equal(byId(items, 'payment_method').target.kind, 'page')
  assert.equal(byId(items, 'business_license').target.kind, 'conference')
})

test('the contract screen acts on the target instead of printing an instruction', () => {
  const manager = read('components/admin/contract/ContractManager.tsx')

  // The record comes to the operator; the operator does not go to the record.
  assert.match(manager, /import \{ ClientEditorModal \}/)
  assert.match(manager, /<ClientEditorModal/)
  assert.match(
    manager,
    /onOpenClient=\{\(clientId, tab\) => setEditing\(\{ clientId, tab \}\)\}/,
    'a checklist item must open the record at the tab its target names'
  )
  // Closing the drawer re-reads the checklist, or the item the operator just resolved would
  // sit there until a manual reload — which is the round trip this card removes.
  assert.match(manager, /onClose=\{\(\) => \{\s*setEditing\(null\)\s*void reload\(\)/)
  assert.match(manager, /onSaved=\{\(\) => void reload\(\)\}/)
})
