/**
 * The client's places, seen from the client record — the tab that made
 * `core.attractions.partner_client_id` visible outside band 4 of the pipeline.
 *
 * WHAT THE ASSERTIONS ARE PROTECTING. The tab is a second surface over facts that already have
 * an owner, and every failure mode here is the same one: it starts deciding for itself. So the
 * suite reads the source and proves that it asks the pipeline endpoint for the readiness rather
 * than computing it, that creating a place goes through `applyPartnerApprovalEffects` by the
 * route that already exists, and that the acts belonging to the triage — publish and refuse —
 * are NOT offered twice (BR-B2B-011: the triage is one human decision, in one place).
 *
 * Mutations that turn this suite red:
 *  · calling `buildPlaceReadiness` inside the tab;
 *  · writing `attractions` from the tab instead of POSTing the provisioning route;
 *  · adding a publish or refuse control to the record;
 *  · dropping `returnTo` from the links that leave for the POI editor;
 *  · breaking the old `?tab=pois` deep link.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const messages = (locale: string) => JSON.parse(read(`messages/${locale}.json`))

const TAB = 'components/admin/clients/tabs/PlacesTab.tsx'

/** The source WITHOUT its comments — every assertion about what a file DOES reads this. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

test('the places tab reads the readiness, it does not compute it', () => {
  const tab = read(TAB)

  assert.match(
    tab,
    /fetch\(`\/api\/admin\/partnerships\/clients\/\$\{clientId\}`\)/,
    'the tab must read the same answer the pipeline and the queue read'
  )
  // Deciding what is missing has one owner. A second implementation would let the record and
  // the queue disagree about the same place.
  assert.equal(tab.indexOf('buildPlaceReadiness'), -1, 'readiness is decided on the server')
  assert.equal(tab.indexOf('summarizePlaces'), -1)
  // No direct table access: the record must not learn to read `attractions` on its own.
  assert.equal(tab.indexOf("from('attractions')"), -1)
})

test('creating a place reuses the provisioning route, and writes nothing itself', () => {
  const tab = read(TAB)

  assert.match(
    tab,
    /fetch\(`\/api\/admin\/partnerships\/clients\/\$\{clientId\}\/places`, \{\s*method: 'POST',/,
    'the create button posts to the route that already runs applyPartnerApprovalEffects'
  )
  // The route is the one guarded against a second prefill and against approving anything.
  const route = read('app/api/admin/partnerships/clients/[clientId]/places/route.ts')
  assert.match(route, /applyPartnerApprovalEffects/)
  // `approved` appears in the prose above the handler, explaining that the place is born
  // `approved = false`. What may not appear is a WRITE of it.
  assert.equal(tab.indexOf('approved:'), -1, 'the record never approves a place')
  assert.equal(tab.indexOf("method: 'PATCH'"), -1, 'and it patches nothing about the place')
})

test('the triage stays in the pipeline — the record does not offer it twice', () => {
  // COMMENTS STRIPPED, and the assertion narrowed to what an act actually looks like: the
  // first version matched the bare word `publish`, so a comment explaining that a linked
  // establishment was ALREADY PUBLISHED turned the suite red. A ruler that reads prose measures
  // the prose — the guarantee is that the tab never CALLS the act, not that it never names it.
  const tab = code(TAB)
  for (const act of ['/triage-refusal', '/publish', 'PublishPanel', 'RefusalPanel', 'setApproved']) {
    assert.equal(
      tab.indexOf(act),
      -1,
      `publishing and refusing are the triage's acts and belong to the pipeline, not to ${TAB}`
    )
  }
  assert.match(
    tab,
    /admin\/partnerships\/clients\/\$\{clientId\}/,
    'and the tab says where that decision is taken'
  )
})

test('every way out of the tab declares the way back into it', () => {
  const tab = read(TAB)
  assert.match(tab, /from '@\/lib\/navigation\/return-to'/)
  assert.match(
    tab,
    /const backHere = `\/admin\/clients\?clientId=\$\{clientId\}&tab=places`/,
    'the way back is this tab, not the client list'
  )
  assert.match(tab, /returnParams\(backHere, returnLabel\)/)
  // The POI editor is reached ON the object, never on a search screen.
  assert.match(tab, /`\/pois\/\$\{attractionId\}\?\$\{query\.toString\(\)\}`/)
})

test('the old ?tab=pois deep link still lands on the places tab', () => {
  const record = read('components/admin/AdminClientsPageContent.tsx')
  assert.match(record, /requestedTab === 'pois' \? 'places' : requestedTab/)

  const modal = read('components/admin/clients/ClientEditorModal.tsx')
  assert.match(modal, /id: 'places', labelKey: 'places'/)
  assert.equal(modal.indexOf("id: 'pois'"), -1, 'the tab is named after its subject now')
})

test('the tab is labelled in all three locales; its Portuguese-only copy is in pt alone', () => {
  for (const locale of ['pt', 'en', 'es']) {
    const tabs = messages(locale).Clients.editor.tabs
    assert.equal(typeof tabs.places, 'string', `${locale} must label the places tab`)
    assert.equal(tabs.pois, undefined, `${locale} must not keep the old label around`)
  }

  // `Partnerships` is Portuguese-only by decision (#408, spec §2) — the same reason the tab
  // carries its own provider. Copying it into en/es would create the second source.
  const pt = messages('pt').Partnerships.clientPlaces
  for (const key of ['title', 'body', 'pipelineLink', 'returnLabel', 'createFailed']) {
    assert.equal(typeof pt[key], 'string', `pt must carry Partnerships.clientPlaces.${key}`)
  }
  for (const locale of ['en', 'es']) {
    assert.equal(
      read(`messages/${locale}.json`).indexOf('clientPlaces'),
      -1,
      `${locale} must not carry the Portuguese-only partnership copy`
    )
  }
})

test('the tab hands its subtree the Portuguese namespace, and only that subtree', () => {
  const tab = read(TAB)
  // Without this an operator on /en/ would read `Partnerships.pendencies...` as a label.
  assert.match(tab, /locale="pt"/)
  assert.match(tab, /messages=\{\{ Partnerships: ptMessages\.Partnerships \}\}/)
  // The welcome-POI section is translated in all three, so it stays outside the provider.
  const provider = tab.slice(tab.indexOf('<NextIntlClientProvider'), tab.indexOf('</NextIntlClientProvider>'))
  assert.equal(provider.indexOf('<PoisTab'), -1, 'PoisTab keeps the operator locale')
})
