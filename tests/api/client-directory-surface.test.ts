/**
 * The unified list, from the spine to the screen — one row per establishment, one rail, and no
 * second derivation of anything.
 *
 * WHAT WAS TRUE BEFORE. `/admin/clients` listed `partner.clients`; `/admin/partnerships` listed
 * `partner.partner_form_submissions`. A promoted proposal was a row in both, described by two
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
const BOARD = 'components/admin/clients/ClientBoard.tsx'
const RAIL = 'components/admin/clients/DirectoryFilterRail.tsx'
const READ = 'lib/hooks/use-client-directory.ts'

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
  // Its state comes from the same pure function, fed by the client's OWN conference.
  //
  // It used to be fed `EMPTY_CONFERENCE`, on the premise that a client without a proposal had
  // nothing conferred — true only because there was nowhere to record it. Since 2026-08-21 the
  // conference is a fact about the client (`partner.client_conferences`), so the premise is
  // gone: reading a constant here would pin every directly registered client at `in_conference`
  // while the detail screen showed the conference it actually has.
  assert.match(
    directory,
    /proposalStatus: 'promoted',\s*conference: \(conferences\.get\(client\.id\) \?\? NO_CONFERENCE\)\.conference,/
  )
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
  // ONE READ FOR BOTH VIEWS since #409. The endpoint moved out of the table and into the hook
  // the table and the board share — without it, switching Quadro/Tabela re-fetched a thousand
  // rows and an act on a card could not invalidate the list behind it. The guarantee is
  // unchanged: one endpoint, and neither view calls it itself.
  const hook = read(READ)
  assert.match(hook, /DIRECTORY_ENDPOINT = '\/api\/admin\/clients\/directory'/)
  assert.match(hook, /fetch\(DIRECTORY_ENDPOINT\)/)

  for (const view of [SCREEN, BOARD]) {
    assert.equal(read(view).includes("fetch('/api/admin/clients"), false, `${view} must not fetch`)
  }

  const screen = read(SCREEN)
  assert.match(screen, /buildDirectoryView\(rows, filters\)/)
  assert.match(screen, /view\.rows\.map/)
  // The overdue counter reads the WHOLE set: it exists to reach rows the filter is hiding.
  assert.match(screen, /overdueCount\(rows\)/)

  // The counts on the rail and the rows in either view come from the same call: the rail is
  // handed the view, it does not build one of its own.
  const rail = read(RAIL)
  assert.match(rail, /view\.facets\[key\]/)
  assert.equal(
    rail.includes('buildDirectoryView('),
    false,
    'the rail must not filter on its own'
  )

  // The board hands the rail the SAME view it bucketed into columns.
  const board = read(BOARD)
  assert.match(board, /buildBoardView\(rows, filters/)
  assert.match(board, /view=\{board\.directory\}/)
  assert.match(board, /overdueCount\(rows\)/)
})

test('the old client list is gone, not left behind', () => {
  assert.equal(
    existsSync(resolve(root, 'components/admin/ClientsListAdmin.tsx')),
    false,
    'a screen with no route is an orphan (CLAUDE.md §6)'
  )
})

test('the rail speaks the esteira’s language, and the esteira is Portuguese', () => {
  // IT USED TO BE TRANSLATED, and the seam landed inside a card: `Proposta recebida` over
  // `Proposal, not registered yet` over `Open`. The pipeline vocabulary was already pt-only by
  // decision (#408); the rail describes the same pipeline, so it is pt too. What stayed
  // translated is the CLIENT's own record — a different object with a different owner.
  const directory = messages('pt').Clients.directory
  assert.equal(typeof directory.title, 'string')
  for (const key of ['country', 'region', 'city', 'clientType', 'status', 'contract', 'state']) {
    assert.equal(typeof directory.filters[key], 'string', `the ${key} facet needs a label`)
  }
  for (const key of ['none', 'draft', 'sent', 'signed']) {
    assert.equal(typeof directory.contractValues[key], 'string')
  }

  // Overlaid by the host rather than copied into en/es — the full assertion, including the
  // proof that nothing outside the esteira reads these namespaces, is in
  // `client-board-surface.test.ts`.
  const host = read('components/admin/AdminClientsPageContent.tsx')
  assert.match(host, /Partnerships: ptMessages\.Partnerships,/)
  assert.match(host, /directory: ptMessages\.Clients\.directory,/)
  for (const locale of ['en', 'es']) {
    assert.equal('Partnerships' in messages(locale), false, `${locale} must not carry the namespace`)
    assert.equal('directory' in messages(locale).Clients, false, `${locale} must not fork the rail`)
  }
})
