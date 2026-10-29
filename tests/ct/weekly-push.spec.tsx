/**
 * The weekly push screen (#1047, BR-COMUNICACAO-019 3.m) painted in a browser with the API mocked:
 * the three blocks at 1440 and at 390 without horizontal overflow of the page, axe clean, and the
 * Save of a text locked while the draft breaks the database rule (spec 6, items 1, 4 and 11).
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { WeeklyPushHarness } from './weekly-push-helpers'
import { RESULTS, SETTINGS } from './weekly-push-fixtures'

async function mockApi(page: Page, pushEnabledPeople: number | null = 1234) {
  await page.route(
    (url) => url.pathname === '/api/dashboard/push',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { devices: { push_enabled_people: pushEnabledPeople } } }),
      })
  )
  await page.route('**/api/admin/weekly-push/results', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESULTS) })
  )
  await page.route('**/api/admin/weekly-push', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SETTINGS) })
  )
}

for (const width of [1440, 390]) {
  test(`#1047: the three blocks paint at ${width} px, no new_place, axe clean`, async ({ mount, page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await mockApi(page)
    await mount(<WeeklyPushHarness />)
    await expect(page.getByRole('heading', { name: 'Peças' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Resultado por envio' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Textos' })).toBeVisible()
    await expect(page.getByText('Barrados pelo portão')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('new_place')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const axe = await new AxeBuilder({ page }).include('#root').analyze()
    expect(axe.violations.map((v) => v.id)).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`weekly-push-${width}.png`), fullPage: true })
  })
}

test('#1047 BR-COMUNICACAO-019 3.m: {city} in the reminder without city locks Save and says why, and the language chips lock', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page)
  await mount(<WeeklyPushHarness />)
  await page.getByRole('button', { name: 'Editar título e corpo de Quinta, Lembrete sem cidade' }).last().click()
  const body = page.getByLabel('Corpo', { exact: true })
  await body.fill('Dê uma volta por {city} com o Tuggi.')
  await expect(page.getByText('O lembrete sem cidade não pode ter {city}.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Salvar texto' })).toBeDisabled()
  await expect(body).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('button', { name: 'Inglês' })).toBeDisabled()
  await page.screenshot({ path: testInfo.outputPath('weekly-push-edit-1440.png'), fullPage: true })
})

test('#1046 BR-COMUNICACAO-019 3.m.1: the results open with the people who have push enabled, and null reads sem dado, never 0', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page, 1234)
  const mounted = await mount(<WeeklyPushHarness />)
  const tile = page.locator('[title^="Pessoas com o push do app ligado"]')
  await expect(tile).toContainText('Com push liberado')
  await expect(tile).toContainText('1.234')
  await expect(tile).toContainText('pessoas, não aparelhos')
  await mounted.unmount()

  await page.unrouteAll()
  await mockApi(page, null)
  await mount(<WeeklyPushHarness />)
  await expect(tile).toContainText('Com push liberado')
  await expect(tile).toContainText('sem dado')
  await expect(tile).not.toContainText('0')
})
