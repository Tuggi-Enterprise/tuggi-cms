/**
 * #1171: the funnel from store to sign-up on the Acquisition page, painted in Chromium with the reads
 * mocked. DS-COMPONENTE-084: a store with no collector prints UNKNOWN_VALUE and never 0, a partial source
 * prints a floor, no rate crosses sources. Axe clean on the section at 1440 and 390.
 *
 * Set CT_CAPTURE_DIR=<dir> to also write the 1440 and 390 captures of the whole page.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { AcquisitionHarness } from './acquisition-helpers'
import { ACQUISITION, FUNNEL_FULL, FUNNEL_TODAY, MONTHS } from './acquisition-fixtures'

const SHOTS = process.env.CT_CAPTURE_DIR
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mockReads(page: Page, funnel: unknown, funnelStatus = 200) {
  await page.route('**/rest/v1/rpc/dashboard_acquisition_months', (route) => route.fulfill(json(MONTHS)))
  await page.route('**/rest/v1/rpc/dashboard_acquisition', (route) => route.fulfill(json(ACQUISITION)))
  await page.route('**/rest/v1/rpc/acquisition_funnel', (route) =>
    route.fulfill(funnelStatus === 200 ? json(funnel) : json({ code: '42501', message: 'permission denied' }, funnelStatus))
  )
}

const funnelValue = (page: Page, store: string, step: string) => page.locator(`[data-testid="acquisition-funnel"] .grid >> nth=0`).locator('> div').nth(store === 'app_store' ? 0 : 1).getByTestId(`step-funnel-value-${step}`)

test('DS-COMPONENTE-084 item 1: today, the stores have no collector and print no number, GA4 installs do', async ({ mount, page }) => {
  await mockReads(page, FUNNEL_TODAY)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const c = await mount(<AcquisitionHarness month="2026-11-01" />)
  const section = c.getByTestId('acquisition-funnel')
  await expect(section.getByRole('heading', { level: 2 })).toHaveText('Como chegam ao app')
  for (const store of ['app_store', 'play_store']) {
    for (const step of ['impressions', 'page_views', 'downloads']) await expect(funnelValue(page, store, step)).toHaveText('—')
  }
  await expect(funnelValue(page, 'app_store', 'installs_ga4')).toContainText('≥ 23')
  await expect(funnelValue(page, 'app_store', 'installs_ga4')).toContainText('GA4')
  await expect(funnelValue(page, 'play_store', 'entered')).toContainText('41')
  await expect(funnelValue(page, 'play_store', 'entered')).toContainText('banco')
  await expect(section.getByTestId('coverage-apple_store').first()).toContainText('App Store: sem dado, o coletor ainda não foi configurado.')
  await expect(section.getByTestId('coverage-ga4').first()).toContainText('GA4 do app: dados até 08/11.')
  await expect(section.getByTestId('play-no-impressions')).toBeVisible()
  await expect(section.getByTestId('funnel-app_store-installsStore').getByTestId('stat-line-value')).toHaveText('—')
  await expect(section.getByTestId('origin-app_store')).toHaveCount(0)
  await expect(section.getByTestId('site-channels')).toHaveCount(0)
  await expect(c.getByText('2 sem sistema registrado ficam fora das duas colunas.')).toBeVisible()

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const result = await new AxeBuilder({ page }).include('[data-testid="acquisition-funnel"]').analyze()
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/acquisition-1171-today-${width}.png`, fullPage: true })
  }
})

test('DS-COMPONENTE-084 item 2: rates only inside a store, over impressions on the App Store and page views on Play', async ({ mount, page }) => {
  await mockReads(page, FUNNEL_FULL)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const c = await mount(<AcquisitionHarness month="2026-10-01" />)
  const section = c.getByTestId('acquisition-funnel')
  // App Store covers from 12/10: floor on every store number, the rate still prints (same report)
  await expect(funnelValue(page, 'app_store', 'impressions')).toHaveText('≥ 4.210')
  await expect(funnelValue(page, 'app_store', 'downloads')).toHaveText('≥ 210 · 5%')
  await expect(funnelValue(page, 'play_store', 'impressions')).toHaveText('—')
  await expect(funnelValue(page, 'play_store', 'page_views')).toHaveText('860')
  await expect(funnelValue(page, 'play_store', 'downloads')).toHaveText('190 · 22,1%')
  await expect(funnelValue(page, 'play_store', 'installs_ga4')).not.toContainText('%')
  await expect(section.getByTestId('coverage-apple_store').first()).toContainText('desde 12/10')
  await expect(section.getByTestId('funnel-play_store-uninstalls').getByTestId('stat-line-value')).toHaveText('58')
  const origin = section.getByTestId('origin-app_store')
  await expect(origin.locator('tbody tr').last()).toContainText('≥ 210')
  await expect(section.getByTestId('origin-play_store').locator('tbody tr')).toHaveCount(5)
  await expect(section.getByTestId('site-total-users')).toHaveText('—')
  await expect(section.getByTestId('site-channels').locator('tbody tr').last()).toContainText('3.217')
  await expect(section.getByRole('link', { name: 'Ver Instagram por campanha' })).toHaveAttribute('href', /\/admin\/social#campaigns$/)

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const result = await new AxeBuilder({ page }).include('[data-testid="acquisition-funnel"]').analyze()
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/acquisition-1171-full-${width}.png`, fullPage: true })
  }
})

test('a failed funnel read shows the error with retry and leaves the geography intact', async ({ mount, page }) => {
  await mockReads(page, null, 500)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const c = await mount(<AcquisitionHarness month="2026-11-01" />)
  const section = c.getByTestId('acquisition-funnel')
  await expect(section.getByRole('alert')).toContainText('Não foi possível carregar o funil deste mês.')
  await expect(section.getByRole('button')).toBeVisible()
  await expect(section.getByText('0')).toHaveCount(0)
  await expect(c.getByText('Cabo Frio').first()).toBeVisible()
})
