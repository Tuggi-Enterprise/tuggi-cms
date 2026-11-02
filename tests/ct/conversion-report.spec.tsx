/**
 * The Conversion report (#1068, spec-cms-relatorio-conversao-2026-11 §6), mounted with fixtures.
 *
 * Mounts `ConversionReport` and not the page: the page only owns `?month=` and the query, and the
 * proxy needs a CMS session this bench does not have (see `playwright-ct.config.ts`).
 *
 * Run with: npx playwright test -c playwright-ct.config.ts conversion-report
 * Set CONVERSION_SHOTS=<dir> to also write the 1440 and 390 captures.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import { ConversionHarness as Screen } from './conversion-helpers'
import type { ConversionFunnel } from '@/lib/conversion/funnel'
import ptMessages from '@/messages/pt.json'

const C = ptMessages.Pages.Dashboard.reports.conversion
const SHOTS = process.env.CONVERSION_SHOTS

const base: ConversionFunnel = {
  month: '2026-10',
  installs: { ios: 612, android: 388, total: 1000 },
  entered: 720,
  account: 312,
  usedHours: 455,
  purchased: 61,
}

async function noHorizontalScroll(page: import('@playwright/test').Page) {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
  expect(o.s).toBeLessThanOrEqual(o.c + 1)
}

for (const width of [1440, 390]) {
  test(`measured month at ${width}: five rows, rates of entered, difference, no horizontal scroll`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const c = await mount(<Screen funnel={base} />)
    await expect(c.getByText('280 instalaram e não entraram')).toBeVisible()
    await expect(c.getByText('43,3% de quem entrou')).toBeVisible()
    await expect(c.getByText('8,5% de quem entrou')).toBeVisible()
    await expect(c.getByText('iOS 612 · Android 388')).toBeVisible()
    await noHorizontalScroll(page)
    // at 390 no RankRow label is truncated with the final copy (spec §6.9)
    const truncated = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="conversion-funnel"] .truncate'))
        .filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent)
    )
    expect(truncated).toEqual([])
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/conversion-${width}.png`, fullPage: true })
  })
}

test('DS-COMPONENTE-084 item 1: installs below entered is a floor, with no difference and a note', async ({ mount }) => {
  const c = await mount(<Screen funnel={{ ...base, installs: { ios: 300, android: 200, total: 500 } }} />)
  await expect(c.getByText('iOS 300 · Android 200 · piso')).toBeVisible()
  await expect(c.getByText(C.floor_note)).toBeVisible()
  await expect(c.getByText(/instalaram e não entraram/)).toHaveCount(0)
})

test('DS-COMPONENTE-084 item 1: installs null prints the unknown mark, not 0', async ({ mount, page }) => {
  const c = await mount(<Screen funnel={{ ...base, installs: { ios: null, android: null, total: null } }} />)
  await expect(c.getByText(C.installs_unknown)).toBeVisible()
  await expect(c.getByText(/instalaram e não entraram/)).toHaveCount(0)
  if (SHOTS) {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: `${SHOTS}/conversion-1440-no-ga4.png`, fullPage: true })
  }
})

test('DS-COMPONENTE-084 item 2: entered = 0 prints no rate', async ({ mount }) => {
  const c = await mount(<Screen funnel={{ ...base, entered: 0, account: 0, usedHours: 0, purchased: 0 }} />)
  await expect(c.getByText(/^[0-9,]+% de quem entrou$/)).toHaveCount(0)
  await expect(c.getByText('100%')).toHaveCount(0)
})

test('loading and loaded funnel card have the same height', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const loading = await mount(<Screen isLoading />)
  const h1 = (await page.getByTestId('conversion-funnel').boundingBox())!.height
  await loading.update(<Screen funnel={base} />)
  await expect(page.getByText('280 instalaram e não entraram')).toBeVisible()
  const h2 = (await page.getByTestId('conversion-funnel').boundingBox())!.height
  expect(Math.abs(h1 - h2), `loading ${h1} loaded ${h2}`).toBeLessThanOrEqual(1)
})

test('RPC error: red box with retry, no zero printed', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const c = await mount(<Screen isError />)
  await expect(c.getByRole('alert')).toContainText(C.load_failed)
  await expect(c.getByRole('button', { name: C.retry })).toBeVisible()
  await expect(c.getByText(C.no_data)).toHaveCount(4)
  await expect(c.getByText('0', { exact: true })).toHaveCount(0)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/conversion-1440-error.png`, fullPage: true })
})
