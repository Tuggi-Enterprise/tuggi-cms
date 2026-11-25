/**
 * #1297 — the content block of the new builds in the queue, in a real browser, next to a request
 * of the build in the field. BR-USUARIO-052 items 4.a.i and 4.a.ii.
 *
 * `CT_CAPTURE_DIR` set = the inspection screenshots are written there (1440 and 390 px).
 *
 * Run with: npx playwright test -c playwright-ct.config.ts partner-requests-1297
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Route } from '@playwright/test'
import { PartnerRequestsBandHarness } from './partner-requests-helpers'
import { REQUESTS, V2_REQUESTS } from './partner-requests-fixtures'

const CAPTURE = process.env.CT_CAPTURE_DIR

for (const size of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`#1297 BR-USUARIO-052 4.a.i at ${size.name} px: channels link out, other stays text, v1 as it came`, async ({ mount, page }) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.route('**/api/admin/partner-requests', (route: Route) =>
      route.fulfill({ json: { requests: [...V2_REQUESTS, REQUESTS[0]] } })
    )
    const component = await mount(<PartnerRequestsBandHarness />)

    const carla = component.getByRole('row', { name: /Carla Mendes/ })
    await expect(carla.getByText('Brasil · Paraty')).toBeVisible()
    await expect(carla.getByRole('link', { name: '@carla.viaja' })).toHaveAttribute('href', 'https://www.instagram.com/carla.viaja')
    const site = carla.getByRole('link', { name: 'https://carlaviaja.com.br/blog' })
    await expect(site).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(site).toHaveAttribute('target', '_blank')
    await expect(carla.getByText('https://kwai.com/carla e newsletter')).toBeVisible()
    await expect(carla.getByRole('link', { name: /kwai/ })).toHaveCount(0)
    await expect(carla.getByText('Temas: viagem, gastronomia, viagem econômica')).toBeVisible()

    await expect(component.getByRole('row', { name: /Luana Costa/ }).getByText('Não cria conteúdo')).toBeVisible()
    await expect(component.getByRole('row', { name: /Ana Souza/ }).getByText('@ana.souza', { exact: true })).toBeVisible()
    if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/fila-conteudo-${size.name}.png`, fullPage: true })
  })
}
