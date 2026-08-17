/**
 * The pipeline as a tab of the client record — the card that made the record the entrance.
 *
 * THE ROUND TRIP THIS REMOVES. Band 3 of the pipeline names `Assinar o contrato` and used to
 * LINK at two other pages to take that step: the client record and the contract. Reading the
 * pipeline meant leaving the record, and filling one fiscal field meant leaving the pipeline.
 * Inside the record the two destinations are neighbouring tabs — no navigation, no fetch, and
 * no losing the state that was on screen.
 *
 * WHAT THE ASSERTIONS PROTECT. One component in two hosts, never two implementations of the
 * five bands: a record and a queue that derive the same state separately is the single failure
 * mode `lib/partnerships/pipeline` exists to make impossible. And the chrome is what differs —
 * the standalone page draws the way back to the queue, the tab does not, because a link back to
 * a list the operator never came from is a false trail.
 *
 * Mutations that turn this suite red:
 *  · copying the bands into a tab-only component;
 *  · giving the embedded pipeline a `backHref`, or dropping it from the standalone page;
 *  · turning the band's tab switches back into links when `onOpenTab` is given;
 *  · replacing the record's messages instead of overlaying `Partnerships` on them, which would
 *    print key names inside `PlaceFormModal`.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(import.meta.dirname, '../..', path), 'utf8')
const messages = (locale: string) => JSON.parse(read(`messages/${locale}.json`))

const TAB = 'components/admin/clients/tabs/PartnershipTab.tsx'
const PAGE = 'app/[locale]/admin/partnerships/clients/[clientId]/page.tsx'
const DETAIL = 'components/admin/partnerships/PartnershipDetail.tsx'

test('one pipeline, two hosts — the tab renders the same component the page does', () => {
  for (const host of [TAB, PAGE]) {
    assert.match(
      read(host),
      /import \{ PartnershipDetail \}|PartnershipDetail\b/,
      `${host} must render PartnershipDetail, not a copy of the five bands`
    )
  }
  // The bands themselves are declared once, in the component both hosts render.
  const tab = read(TAB)
  for (const band of ['ProposalBand', 'ConferenceBand', 'ClientBand', 'PlaceBand']) {
    assert.equal(tab.indexOf(`function ${band}`), -1, `${band} may exist only in ${DETAIL}`)
  }
})

test('the way back is chrome, and only the standalone page has a queue behind it', () => {
  assert.match(
    read(PAGE),
    /backHref=\{`\/\$\{locale\}\/admin\/partnerships`\}/,
    'the standalone page came from the queue and draws the way back to it'
  )
  // The prop, not the word: the docblock above explains why this host does not pass one.
  assert.equal(
    read(TAB).indexOf('backHref='),
    -1,
    'inside the record the way out is the tab strip, not a list the operator never came from'
  )
})

test('band 3 switches tabs when embedded, and links when it is on its own page', () => {
  const detail = read(DETAIL)

  // Embedded: the act, not a door to it.
  assert.match(detail, /onClick=\{\(\) => onOpenTab\('profile'\)\}/)
  assert.match(detail, /onClick=\{\(\) => onOpenTab\('contract'\)\}/)
  // Standalone: the links survive, because there is no tab strip to move to.
  assert.match(detail, /href=\{clientHref\(\)\}/)
  assert.match(detail, /href=\{contractHref\(\)\}/)
  // And the choice is made by the presence of the callback, never by a flag nobody sets.
  assert.match(detail, /\{onOpenTab \?/)
})

test('the tab overlays the Portuguese namespace instead of replacing the record messages', () => {
  const tab = read(TAB)
  // `PlaceFormModal` opens from band 4 and reads `Modals` and `Common` in the operator's
  // locale; a provider carrying only `Partnerships` would print key names inside it.
  assert.match(tab, /messages=\{\{ \.\.\.messages, Partnerships: ptMessages\.Partnerships \}\}/)
  assert.match(tab, /locale=\{locale\}/, 'the operator keeps their locale for everything else')
})

test('the tab is first, labelled in all three locales, and closed while the client is born', () => {
  const modal = read('components/admin/clients/ClientEditorModal.tsx')

  const tabsBlock = modal.slice(modal.indexOf('const TABS'), modal.indexOf('export function ClientEditorModal'))
  assert.ok(
    tabsBlock.indexOf("id: 'partnership'") < tabsBlock.indexOf("id: 'profile'"),
    'the pipeline is the work, so it comes first'
  )
  assert.match(
    modal,
    /!isEditing && \(tab\.id === 'partnership'/,
    'a registration with no id yet has no pipeline to read'
  )
  assert.match(modal, /onOpenTab=\{setActiveTab\}/)

  for (const locale of ['pt', 'en', 'es']) {
    assert.equal(
      typeof messages(locale).Clients.editor.tabs.partnership,
      'string',
      `${locale} must label the partnership tab`
    )
  }
})
