/**
 * One vocabulary for `core.clients.client_type` — #357.
 *
 * What this file is red for, and each one is a defect that shipped:
 *  · a value the database accepts that the CMS type does not know (`driver`, written by the
 *    published app, which has no OTA);
 *  · the merchant type not existing at all (`venue`, BR-B2B-020, item 5);
 *  · a type with no label, which is how a `<select>` renders a raw identifier at an operator;
 *  · the default declared in more than one place, which is how two of them drift.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { CLIENT_TYPES, DEFAULT_CLIENT_TYPE, isClientType } from '@/types/clients'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

/**
 * `clients_client_type_check` as measured on the live database on 2026-08-16, after the
 * migration `20260816150000_issue357_client_type_aceita_venue`:
 *
 *   CHECK ((client_type = ANY (ARRAY['business','influencer','hotel','partner','creator',
 *                                    'driver','venue'])))
 *
 * Written out here instead of imported from the production module on purpose: a mirror
 * compared against itself proves nothing. With the constraint on this side, dropping a value
 * from `CLIENT_TYPES` — or adding one the CHECK does not accept — is red.
 */
const CHECK_CONSTRAINT_VALUES = [
  'business',
  'influencer',
  'hotel',
  'partner',
  'creator',
  'driver',
  'venue',
]

test('BR-B2B-020: the CMS vocabulary is exactly the CHECK the database enforces', () => {
  assert.deepEqual([...CLIENT_TYPES], CHECK_CONSTRAINT_VALUES)
})

test('BR-B2B-020: `venue`, the merchant type, exists', () => {
  // Item 5, declared by the operator on 2026-08-14 — *"será tipo locais"*. The establishment
  // enters as a type of its own and NOT as `business`, `partner` or `hotel`.
  assert.equal(isClientType('venue'), true)
  assert.equal(isClientType('locais'), false, 'the label is Portuguese, the identifier is not')
})

test('#357: `driver` is known, because the published app already writes it', () => {
  // `drive.register_partner_v1` stores it, and the app has no OTA: a type that refuses a value
  // in the database is the type that is wrong. The badge screens render the raw column.
  assert.equal(isClientType('driver'), true)
})

test('#357: a value outside the CHECK is refused before it reaches the database', () => {
  for (const value of ['', 'venues', 'Business', 'restaurant', null, undefined, 7, {}]) {
    assert.equal(isClientType(value), false, `${String(value)} should not be a client type`)
  }
})

test('#357: every client type has a label in the three locales', () => {
  // The `<select>` of `ProfileTab` renders `clientTypes.<value>` for every member of the list.
  // Adding a value without a label puts the identifier itself in front of the operator, and
  // that is exactly what `driver` did before this card.
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(
      readFileSync(join(REPO_ROOT, 'messages', `${locale}.json`), 'utf8')
    )
    const labels = messages?.Clients?.profile?.clientTypes ?? {}
    for (const type of CLIENT_TYPES) {
      assert.equal(
        typeof labels[type] === 'string' && labels[type].length > 0,
        true,
        `messages/${locale}.json is missing Clients.profile.clientTypes.${type}`
      )
    }
  }
})

// ── SSOT: the default is declared once (CLAUDE.md §6) ────────────────────────────────────────
//
// It used to be typed out at four call sites — `app/api/admin/clients/route.ts` (POST),
// `app/api/coordinator/children/route.ts`, `ClientEditorModal` and `CoordinatorChildModal` —
// plus a fifth copy of the value LIST inside `ProfileTab`. Four declarations of one decision
// is not four bugs today; it is the guarantee that a fifth reader will find a stale one.

const SOURCE_DIRS = ['app', 'components', 'lib']
const SOURCE_EXTENSIONS = ['.ts', '.tsx']

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(full))
    else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(full)
  }
  return found
}

test('#357: no source file re-declares the client_type default', () => {
  const literal = /client_type\s*:\s*['"]business['"]/
  const offenders: string[] = []

  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(join(REPO_ROOT, dir))) {
      if (literal.test(readFileSync(file, 'utf8'))) offenders.push(file.slice(REPO_ROOT.length + 1))
    }
  }

  assert.deepEqual(offenders, [], 'the default lives in types/clients.ts and is read from there')
  assert.equal(DEFAULT_CLIENT_TYPE, 'business', 'the column default in `core.clients`')
})
