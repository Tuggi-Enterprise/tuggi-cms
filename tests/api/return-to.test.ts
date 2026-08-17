/**
 * The way back out of a tool reached from a pipeline — DS-LAYOUT-006, point 2.
 *
 * THE DEFECT THIS SUITE WAS WRITTEN AGAINST is not the module, it is the link: band 3 of the
 * partnership detail linked `?client={id}` while `AdminClientsPageContent` reads `clientId`,
 * so every `Abrir a ficha do cliente` dropped the operator on the paginated client list with
 * nothing open. It was invisible to every test because both sides were internally consistent —
 * which is why the assertion here reads the two files and compares the KEY, not the behaviour
 * of either one alone.
 *
 * The other half is security, and it is the reason the rule became a module: `returnTo` names
 * a place the CMS sends an authenticated operator to. `//evil.com` and `/\evil.com` are read
 * by browsers as another origin, and two screens deciding that separately is two chances to
 * get it wrong.
 *
 * Mutations that turn this suite red:
 *  · loosening `parseReturnTo` to `startsWith('/')`;
 *  · letting `parseReturnLabel` return a label without a path;
 *  · putting `?client=` back into the partnership detail;
 *  · dropping the `returnTo` read from the client record's close handler.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  RETURN_LABEL_PARAM,
  RETURN_TO_PARAM,
  parseReturnLabel,
  parseReturnTo,
  returnParams,
} from '@/lib/navigation/return-to'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

// ── The rule ─────────────────────────────────────────────────────────────────────────────────

test('parseReturnTo accepts the in-app paths the CMS actually links with', () => {
  assert.equal(parseReturnTo('/pt/admin/partnerships/clients/abc'), '/pt/admin/partnerships/clients/abc')
  assert.equal(parseReturnTo('/admin/clients?clientId=abc&tab=contract'), '/admin/clients?clientId=abc&tab=contract')
})

test('parseReturnTo refuses anything that could leave this origin', () => {
  // Protocol-relative and backslash forms: the browser resolves both as another host.
  assert.equal(parseReturnTo('//evil.com'), null)
  assert.equal(parseReturnTo('/\\evil.com'), null)
  assert.equal(parseReturnTo('https://evil.com'), null)
  assert.equal(parseReturnTo('javascript:alert(1)'), null)
  // Relative paths have no leading slash and are not accepted either.
  assert.equal(parseReturnTo('admin/clients'), null)
  assert.equal(parseReturnTo(''), null)
  assert.equal(parseReturnTo(null), null)
  assert.equal(parseReturnTo(undefined), null)
})

test('a label never survives a path that did not', () => {
  assert.equal(parseReturnLabel('Voltar para a parceria', null), null)
  assert.equal(parseReturnLabel('Voltar para a parceria', '/pt/admin/partnerships'), 'Voltar para a parceria')
  // No label is not an error: the caller may leave the destination to render its own default.
  assert.equal(parseReturnLabel(null, '/pt/admin/partnerships'), null)
})

test('returnParams carries the label only when there is one', () => {
  assert.deepEqual(returnParams('/pt/admin/partnerships'), { [RETURN_TO_PARAM]: '/pt/admin/partnerships' })
  assert.deepEqual(returnParams('/pt/admin/partnerships', 'Voltar'), {
    [RETURN_TO_PARAM]: '/pt/admin/partnerships',
    [RETURN_LABEL_PARAM]: 'Voltar',
  })
  assert.deepEqual(returnParams('/pt/admin/partnerships', null), {
    [RETURN_TO_PARAM]: '/pt/admin/partnerships',
  })
})

// ── The two sides of the link ────────────────────────────────────────────────────────────────

test('the partnership detail opens the client record with the key that record reads', () => {
  const detail = read('components/admin/partnerships/PartnershipDetail.tsx')
  const record = read('components/admin/AdminClientsPageContent.tsx')

  // The defect, named: a query key the other side does not read.
  assert.ok(
    !/\?client=\$\{/.test(detail),
    'PartnershipDetail must not link `?client=` — AdminClientsPageContent reads `clientId`'
  )
  assert.ok(
    /URLSearchParams\(\{ clientId,/.test(detail),
    'the client record link must carry `clientId`'
  )
  assert.ok(
    /searchParams\.get\('clientId'\)/.test(record),
    'AdminClientsPageContent must still read `clientId` — this test compares the two'
  )
})

test('every screen that takes a way back parses it with the shared module', () => {
  const takers = [
    'app/[locale]/pois/[id]/page.tsx',
    'app/[locale]/admin/clients/[clientId]/contract/page.tsx',
    'components/admin/AdminClientsPageContent.tsx',
  ]

  for (const path of takers) {
    const source = read(path)
    assert.ok(
      /from '@\/lib\/navigation\/return-to'/.test(source),
      `${path} must parse returnTo with lib/navigation/return-to, not its own regex`
    )
    assert.ok(
      !/\^\\\/\[\^\\\/\\\\\]/.test(source),
      `${path} must not carry a second copy of the returnTo pattern`
    )
  }
})

test('closing the client record honours the way back', () => {
  const record = read('components/admin/AdminClientsPageContent.tsx')
  const closeHandler = record.slice(record.indexOf('const closeDrawers'), record.indexOf('const startCreateNew'))
  assert.ok(
    /if \(returnTo\)/.test(closeHandler),
    'closeDrawers must send the operator back to `returnTo` when there is one'
  )
})
