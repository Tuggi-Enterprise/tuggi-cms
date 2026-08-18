/**
 * A published contract version is frozen — and this suite is the freezer.
 *
 * THE RULE IS THE TEMPLATE'S OWN: *"Publishing v2 therefore never edits v1 — it adds an entry.
 * Editing a published version in place would silently change what a signed hash claims to
 * prove."* It was broken on 2026-08-18: the due date and the apuração terms were written
 * straight into `v1`, while **four contracts had already been sent** to partners. None was
 * signed, so no hash proved anything yet — but four people held a link to a document whose text
 * changed under them. `v2` exists because of that, and `v1` went back to what was sent.
 *
 * WHAT THE PIN BELOW IS FOR. A frozen version cannot be defended by a comment: the next person
 * to add a paragraph will add it where the code is, which is `v1`. So `v1`'s rendered text is
 * pinned by SHA-256 over a fixed snapshot. Any edit — a word, a comma, a reordered clause —
 * turns this red, and the message says what to do instead.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { ACTIVE_TEMPLATE_VERSION, renderClauses, templateByVersion } from '@/lib/contract/template'
import type { ContractSnapshot } from '@/lib/contract/snapshot'

/** Every variable pinned, so the hash measures the TEMPLATE and nothing else. */
function fixedSnapshot(version: string): ContractSnapshot {
  return {
    templateVersion: version,
    tier: 'paid',
    provider: {
      legalName: 'Tuggi Tecnologia Ltda',
      taxId: '11222333000144',
      addressLine: 'Rua das Laranjeiras, 10, Rio de Janeiro, RJ',
      representativeName: 'Marta Lima',
      representativeRole: 'Sócia-administradora',
    },
    partner: {
      clientId: 'client-fixed',
      legalName: 'Restaurante do Porto Ltda',
      tradeName: 'Restaurante do Porto',
      taxId: '12345678000190',
      addressLine: 'Av. Beira Mar, 200, Santos, SP',
      representativeName: 'Ana Prado',
      representativeRole: 'Sócia',
    },
    monthlyFeeCents: 10000,
    isCourtesy: false,
    courtesyReason: null,
    paymentMethod: 'pix',
    commissionRate: 0.1,
    qrDeliveryDays: 30,
    generatedAt: '2026-08-18T12:00:00.000Z',
  }
}

function fingerprint(version: string): string {
  const text = renderClauses(fixedSnapshot(version))
    .map((clause) => `${clause.number}. ${clause.title}\n${clause.paragraphs.join('\n')}`)
    .join('\n\n')
  return createHash('sha256').update(text).digest('hex')
}

/**
 * The text of `v1-2026-08`, as it was sent to four partners.
 *
 * IF THIS TEST IS RED you almost certainly edited `v1` when you meant to change the contract.
 * The fix is never to update this number: add a version, put the change there, and point
 * `ACTIVE_TEMPLATE_VERSION` at it — `V2_REPLACEMENTS` shows the shape.
 */
const V1_FINGERPRINT = '0c5871c186fe6b704f2840225737f1f09676144e9b1fe47d9bc335e07242f252'

test('v1 is frozen — it is the text four partners were sent', () => {
  assert.equal(
    fingerprint('v1-2026-08'),
    V1_FINGERPRINT,
    'v1 changed. Do not update this hash: publish a new version instead.'
  )
})

test('a new contract is generated on the newest version, and the old ones still render', () => {
  assert.equal(ACTIVE_TEMPLATE_VERSION, 'v2-2026-08')
  // A contract stored on v1 keeps rendering v1: the version travels on the row, not on the code.
  for (const version of ['v1-2026-08', 'v2-2026-08']) {
    assert.ok(templateByVersion(version), `${version} must still resolve`)
  }
  // And an unknown version is an honest failure, never a silent fallback to the active one.
  assert.equal(templateByVersion('v9-2099-01'), null)
})

test('v2 changes exactly two clauses, and adds none', () => {
  const v1 = renderClauses(fixedSnapshot('v1-2026-08'))
  const v2 = renderClauses(fixedSnapshot('v2-2026-08'))

  assert.deepEqual(
    v2.map((clause) => clause.id),
    v1.map((clause) => clause.id),
    'the clause list and its order are the same — v2 is a revision, not a new instrument'
  )

  const changed = v1
    .filter((clause, index) => clause.paragraphs.join('') !== v2[index].paragraphs.join(''))
    .map((clause) => clause.id)

  // `electronic_acceptance` prints the version it belongs to — *"Este documento corresponde à
  // versão {x} do modelo"* — so it differs between any two versions by construction, and that
  // is the point of it. It is not a revision somebody wrote.
  assert.deepEqual(changed, ['price_and_payment', 'commission', 'electronic_acceptance'])
  assert.match(
    v2.find((clause) => clause.id === 'electronic_acceptance')!.paragraphs.join(' '),
    /versão v2-2026-08 do modelo/
  )
})
