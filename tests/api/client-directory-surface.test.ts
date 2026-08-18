/**
 * The unified list, from the spine to the screen — one row per establishment, one rail, and no
 * second derivation of anything.
 *
 * WHAT WAS TRUE BEFORE. `/admin/clients` listed `core.clients`; `/admin/partnerships` listed
 * `core.partner_form_submissions`. A promoted proposal was a row in both, described by two
 * vocabularies, and a client somebody registered by hand was invisible in the queue. The two
 * screens each had a loader, so the same partnership could be `client_created` in one and
 * something else in the other.
 *
 * WHAT THE ASSERTIONS HOLD. There is ONE loader — the queue is a filter over the directory,
 * not a second assembly — and the list screen renders one component that reads one endpoint.
 * `ClientsListAdmin` is gone rather than left behind: a screen with no route is an orphan, and
 * an orphan that still fetches is worse than dead code (CLAUDE.md §6).
 *
 * Mutations that turn this suite red:
 *  · giving the queue its own assembly again;
 *  · filtering rows inside the endpoint, which would make the facet counts lie;
 *  · dropping `country` or `client_type` from the columns the directory decides with;
 *  · leaving a client with no proposal out of the list.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const messages = (locale: string) => JSON.parse(read(`messages/${locale}.json`))

const SERVICE = 'lib/services/partnership-service.ts'
const SCREEN = 'components/admin/clients/ClientDirectory.tsx'

test('one loader, because there is one list', () => {
  const service = read(SERVICE)

  // `loadPartnershipQueue` was a second assembly of the same rows, feeding a second screen.
  // Both are gone: the working set is `/admin/clients?state=in_progress`, a filter of this one.
  assert.equal(
    service.indexOf('loadPartnershipQueue'),
    -1,
    'a second assembly is how two screens end up disagreeing about the same partnership'
  )
  assert.equal(service.indexOf('PartnershipQueueRow'), -1)

  // The state is derived in exactly two places here — once per row shape the directory builds
  // (the proposal-backed rows and the clients no proposal claims), both inside the one loader.
  const directory = service.slice(service.indexOf('export async function loadClientDirectory'))
  assert.equal(
    (service.match(/derivePipelineState\(/g) ?? []).length,
    (directory.match(/derivePipelineState\(/g) ?? []).length,
    'nothing outside the directory loader derives a pipeline state'
  )
})

test('a client no proposal claims is still a row — the half the queue could not show', () => {
  const service = read(SERVICE)
  const directory = service.slice(service.indexOf('export async function loadClientDirectory'))

  assert.match(directory, /loadAllClients\(DIRECTORY_CLIENT_CAP\)/, 'every client, not only the promoted ones')
  assert.match(directory, /const claimed = new Set\(/)
  assert.match(directory, /if \(claimed\.has\(client\.id\)\) continue/)
  // Its state comes from the same pure function, with the answer a client without a proposal
  // already has: nothing was conferred, because there was no conference.
  assert.match(directory, /proposalStatus: 'promoted',\s*conference: EMPTY_CONFERENCE,/)
})

test('the directory decides with country and client_type, and says so in its columns', () => {
  const service = read(SERVICE)
  const columns = /const CLIENT_COLUMNS =\s*([\s\S]*?)\n\n/.exec(service)
  assert.ok(columns, 'the allowlist is still declared in one place')
  for (const column of ['country', 'client_type', 'city', 'state']) {
    assert.ok(
      columns![1].indexOf(column) >= 0,
      `\`${column}\` is a filter of the rail and must be read`
    )
  }
})

test('the endpoint returns the rows whole — filtering there would make the counts lie', () => {
  const route = read('app/api/admin/clients/directory/route.ts')
  assert.match(route, /withAuth\(\{ roles: \['admin'\] \}/)
  assert.match(route, /loadClientDirectory\(auth\.supabase\)/)
  // No `?country=`, no `?state=`: the facet counts are computed over the same set the table
  // renders, which is only possible if the screen holds all of it.
  assert.equal(route.indexOf('searchParams'), -1)
})

test('the screen reads one endpoint and decides nothing on its own', () => {
  const screen = read(SCREEN)
  assert.match(screen, /fetch\('\/api\/admin\/clients\/directory'\)/)
  assert.match(screen, /buildDirectoryView\(rows, filters\)/)
  // The counts on the rail and the rows in the table come from the same call.
  assert.match(screen, /view\.facets\[key\]/)
  assert.match(screen, /view\.rows\.map/)
  // The overdue counter reads the WHOLE set: it exists to reach rows the filter is hiding.
  assert.match(screen, /overdueCount\(rows\)/)
})

test('the old client list is gone, not left behind', () => {
  assert.equal(
    existsSync(resolve(root, 'components/admin/ClientsListAdmin.tsx')),
    false,
    'a screen with no route is an orphan (CLAUDE.md §6)'
  )
})

test('the rail is translated in all three locales; the pipeline vocabulary stays Portuguese', () => {
  for (const locale of ['pt', 'en', 'es']) {
    const directory = messages(locale).Clients.directory
    assert.equal(typeof directory.title, 'string', `${locale} must carry the list title`)
    for (const key of ['country', 'region', 'city', 'clientType', 'status', 'contract', 'state']) {
      assert.equal(typeof directory.filters[key], 'string', `${locale} must label the ${key} facet`)
    }
    for (const key of ['none', 'draft', 'sent', 'signed']) {
      assert.equal(typeof directory.contractValues[key], 'string')
    }
  }

  // The states, `o que falta` and the triage clock are `Partnerships`, which is pt-only by
  // decision (#408) and overlaid by the host rather than copied into en/es.
  const host = read('components/admin/AdminClientsPageContent.tsx')
  assert.match(host, /messages=\{\{ \.\.\.messages, Partnerships: ptMessages\.Partnerships \}\}/)
  // The KEY, parsed — not the literal string, which is also the English title of the screen
  // now that the operator renamed it `Parcerias`.
  for (const locale of ['en', 'es']) {
    assert.equal('Partnerships' in messages(locale), false, `${locale} must not carry the namespace`)
  }
})
