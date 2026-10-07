/**
 * #875 — the client record is one screen: the standalone partnership page is only a redirect,
 * the `pending` routes are gone, and the modal drops the record cache when a save or an
 * approval can have changed what the tabs read.
 *
 * Run with: npm run test:api
 */

import { before, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

let redirected: string[] = []
let Page: (props: { params: Promise<{ locale: string; clientId: string }> }) => Promise<unknown>

before(async () => {
  mock.module('next/navigation', {
    namedExports: {
      redirect: (url: string) => {
        redirected.push(url)
        throw new Error('NEXT_REDIRECT')
      },
    },
  })
  Page = (await import('@/app/[locale]/admin/partnerships/clients/[clientId]/page')).default as typeof Page
})

test('#875: /admin/partnerships/clients/[clientId] redirects to the record, tab=partnership, keeping locale and id', async () => {
  redirected = []
  await assert.rejects(Page({ params: Promise.resolve({ locale: 'pt', clientId: 'abc-123' }) }), /NEXT_REDIRECT/)
  assert.equal(redirected.length, 1)
  const url = new URL(redirected[0], 'http://localhost')
  assert.equal(url.pathname, '/pt/admin/clients')
  assert.equal(url.searchParams.get('clientId'), 'abc-123')
  assert.equal(url.searchParams.get('tab'), 'partnership')
})

test('#875: the redirect escapes a hostile clientId instead of splicing it into the address', async () => {
  redirected = []
  await assert.rejects(Page({ params: Promise.resolve({ locale: 'en', clientId: 'x&tab=profile#frag' }) }), /NEXT_REDIRECT/)
  const url = new URL(redirected[0], 'http://localhost')
  assert.equal(url.pathname, '/en/admin/clients')
  assert.equal(url.searchParams.get('clientId'), 'x&tab=profile#frag')
  assert.equal(url.searchParams.get('tab'), 'partnership')
})

test('#875: the `pending` routes no longer exist, and nothing in the three apps calls them', () => {
  assert.equal(existsSync(resolve(ROOT, 'app/api/admin/clients/pending')), false)
  assert.equal(existsSync(resolve(ROOT, 'app/api/clients/pending')), false)
  for (const file of [
    'components/admin/clients/ClientEditorModal.tsx',
    'components/admin/AdminClientsPageContent.tsx',
    'lib/hooks/use-client-directory.ts',
  ]) {
    if (existsSync(resolve(ROOT, file))) assert.doesNotMatch(read(file), /clients\/pending/, file)
  }
})

test('#875: the modal drops the record cache on save and on approve/reject, and the tabs read through it', () => {
  const modal = read('components/admin/clients/ClientEditorModal.tsx')
  assert.equal(
    (modal.match(/recordCache\.clear\(\)/g) ?? []).length,
    3,
    'save + ApprovalHeaderControls.onChanged + the validation decision (#890: approve/reject of the portal submission)'
  )
  const save = modal.indexOf('recordCache.clear()')
  assert.ok(modal.lastIndexOf('setClient(merged)', save) > 0, 'cleared after the saved state is in')
  assert.match(modal, /<RecordCacheProvider cache=\{recordCache\}>/)
  for (const tab of ['PartnershipTab', 'ProfileTab', 'FiscalPaymentsTab', 'ContractTab', 'PlacesTab', 'ValidationTab']) {
    assert.match(modal, new RegExp(`<${tab}\\b`), `${tab} stays inside the provider`)
  }
  // The readers go through the cache; the acts (POST to a sub-path) are plain fetches on purpose.
  for (const file of [
    'components/admin/partnerships/PartnershipDetail.tsx',
    'components/admin/clients/tabs/PlacesTab.tsx',
    'components/admin/clients/shared/use-client-contract.ts',
  ]) {
    const source = read(file)
    assert.match(source, /useRecordRead\(\)/, file)
    assert.doesNotMatch(
      source,
      /fetch\(\s*`\/api\/admin\/(partnerships\/clients|clients)\/\$\{[\w.]+\}(\/contract)?`\s*[,)]\s*(?!.*method)/,
      `${file} must not bypass the cache for the shared reads`
    )
  }
})
