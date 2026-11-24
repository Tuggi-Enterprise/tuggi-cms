/**
 * The saved-photo and saved-story badges (#1000) on the board card and on the directory row, in a
 * real browser at 1440 px. The data side is `tests/api/client-directory-held.test.ts`; this is the
 * paint: both surfaces show the badge, and a row with nothing held shows none.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import { BoardHarness, DirectoryHarness, Wrapper } from './helpers'
import { BOARD_ROWS_EVERY_COLUMN } from './fixtures/partnerships'
import ptMessages from '@/messages/pt.json'

const HELD = ptMessages.Clients.directory.heldBadges

// The published card gets both, the awaiting-acceptance one only the photo; the rest hold nothing.
const ROWS = BOARD_ROWS_EVERY_COLUMN.map((row) =>
  row.submissionId === 'sub-0007'
    ? { ...row, hasHeldPhoto: true, hasHeldStory: true }
    : row.submissionId === 'sub-0006'
      ? { ...row, hasHeldPhoto: true }
      : row
)

async function mockDirectory(page: Page) {
  await page.route('**/api/admin/clients/directory', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: ROWS, truncated: false }) })
  )
}

test.use({ viewport: { width: 1440, height: 900 } })

test('#1000: the board card shows `Foto salva` and `História salva` only where something is held', async ({
  mount,
  page,
}, testInfo) => {
  await mockDirectory(page)
  await mount(
    <Wrapper>
      <BoardHarness />
    </Wrapper>
  )
  await expect(page.getByText(HELD.photo)).toHaveCount(2)
  await expect(page.getByText(HELD.story)).toHaveCount(1)
  const published = page.getByRole('article').filter({ hasText: HELD.story })
  await expect(published.getByText(HELD.photo)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('board-1440.png'), fullPage: true })
})

test('#1000: the directory row shows the same badges', async ({ mount, page }, testInfo) => {
  await mockDirectory(page)
  await mount(
    <Wrapper>
      <DirectoryHarness />
    </Wrapper>
  )
  await expect(page.getByText(HELD.photo)).toHaveCount(2)
  await expect(page.getByText(HELD.story)).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('directory-1440.png'), fullPage: true })
})
