/**
 * CHANGING THE SEARCH LEAVES NO ROW BEHIND. #991.
 *
 * On 2026-10-22 the published list showed Ancho&Faca under "office", and five rows under
 * "pão do" with a range of three. The proposal row and the portal row of one client shared
 * `rowKey`, and React reused the row of the previous search. The server sends one row per client
 * now (`assembleDirectoryRows`, `tests/api/client-directory-one-row.test.ts`); this suite feeds the
 * table the OLD shape on purpose, both rows of one client, so it proves the key alone.
 *
 * Mutation that turns it red: `rowKey` back to `clientId ?? submissionId`.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import { DirectorySearchHarness, Wrapper } from './helpers'
import { queueRow } from './fixtures/partnerships'

const CLIENTS: [string, string][] = [
  ['ancho', 'Ancho&Faca Parrilla e Fogos'],
  ['office', 'Office café'],
  ['edu-matriz', 'Pão do Edu'],
  ['edu-filial', 'Pão do Edu Filial'],
]

const ROWS = CLIENTS.flatMap(([id, name], index) => [
  queueRow({
    submissionId: `proposal-${id}`,
    clientId: id,
    state: 'published',
    target: { kind: 'client', clientId: id, tab: 'partnership' },
    status: 'approved',
    name,
    city: 'Cabo Frio',
    since: `2026-08-${String(index + 10)}T00:00:00.000Z`,
  }),
  queueRow({
    submissionId: `mirror-${id}`,
    clientId: id,
    state: 'published',
    target: { kind: 'client', clientId: id, tab: 'partnership' },
    status: 'approved',
    origin: 'portal',
    name,
    city: 'Cabo Frio',
    since: '2026-10-08T00:00:00.000Z',
  }),
])

test('#991 · every search draws exactly the rows its range counts', async ({ mount, page }) => {
  await page.route('**/api/admin/clients/directory', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: ROWS, truncated: false }) })
  )
  await mount(
    <Wrapper>
      <DirectorySearchHarness />
    </Wrapper>
  )
  const search = page.getByLabel('harness-search')
  const body = page.locator('tbody tr')
  await expect(body).toHaveCount(ROWS.length)

  // Each client has two rows in this fixture, so each search expects twice its clients.
  const steps: [string, string, number][] = [
    ['office', 'Office café', 2],
    ['ancho', 'Ancho&Faca', 2],
    ['pão do', 'Pão do Edu', 4],
    ['office', 'Office café', 2],
  ]
  for (const [query, name, count] of steps) {
    await search.fill(query)
    await expect(body).toHaveCount(count)
    await expect(page.getByText(`Mostrando 1–${count} de ${count}`).first()).toBeVisible()
    for (const text of await body.allInnerTexts()) expect(text).toContain(name)
  }
})
