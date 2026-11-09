/**
 * #1139 — the queue of app partner requests above the partners board, in a real browser: the API
 * is answered by `page.route`, the band reads it, the curator approves and refuses.
 * BR-B2B-066 items 2 and 5.a, BR-USUARIO-052 item 4.d.
 *
 * `CT_CAPTURE_DIR` set = the inspection screenshots are written there (1440 and 390 px).
 *
 * Run with: npx playwright test -c playwright-ct.config.ts partner-requests-1139
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page, Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { PartnerRequestsBandHarness } from './partner-requests-helpers'
import { RPC_ROWS, REQUESTS } from './partner-requests-fixtures'

const CAPTURE = process.env.CT_CAPTURE_DIR

async function serveQueue(page: Page, posts: { url: string; body: unknown }[], sharedId?: number) {
  let rows = REQUESTS.map((row) => ({ ...row, recordShared: row.requestId === sharedId }))
  await page.route('**/api/admin/partner-requests', (route: Route) =>
    route.fulfill({ json: { requests: rows } })
  )
  await page.route('**/api/admin/partner-requests/*/*', async (route: Route) => {
    const url = route.request().url()
    posts.push({ url, body: route.request().postDataJSON() })
    const id = Number(url.split('/').slice(-2)[0])
    if (url.endsWith('/approve') && id === 13) {
      return route.fulfill({ json: { outcome: { kind: 'document_in_use' } } })
    }
    if (url.endsWith('/approve') && id === sharedId) {
      return route.fulfill({ json: { outcome: { kind: 'record_shared' } } })
    }
    rows = rows.filter((row) => row.requestId !== id)
    if (url.endsWith('/approve')) {
      return route.fulfill({
        json: { outcome: { kind: 'approved', clientId: '33333333-3333-4333-8333-333333333333', partnerCode: 'ANA123', commissionRate: 0.2 } },
      })
    }
    return route.fulfill({ json: { outcome: { kind: 'refused' } } })
  })
}

for (const size of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`#1139 the queue at ${size.name} px shows the requests and the document mark`, async ({ mount, page }) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    await serveQueue(page, [])
    const component = await mount(<PartnerRequestsBandHarness />)

    await expect(component.getByRole('heading', { name: 'Pedidos de parceiro pelo app' })).toBeVisible()
    await expect(component.getByText('3 pedidos esperando decisão')).toBeVisible()
    await expect(component.getByText('CPF 529.982.247-25')).toBeVisible()
    await expect(component.getByText('Documento já está em outro parceiro')).toHaveCount(1)
    if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/fila-${size.name}.png`, fullPage: true })
  })
}

test('#1139 BR-B2B-066 2: approving calls the route and says the code and the rate the database wrote', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const posts: { url: string; body: unknown }[] = []
  await serveQueue(page, posts)
  const component = await mount(<PartnerRequestsBandHarness />)

  await component.getByRole('row', { name: /Ana Souza/ }).getByRole('button', { name: 'Aprovar' }).click()
  await expect(component.getByRole('status')).toHaveText('Aprovado. Código ANA123, comissão de 20%.')
  await expect(component.getByText('2 pedidos esperando decisão')).toBeVisible()
  expect(posts.map((post) => post.url.split('/api/')[1])).toEqual(['admin/partner-requests/12/approve'])
  if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/fila-aprovado-1440.png`, fullPage: true })
})

test('#1139 BR-B2B-066 5.a: the repeated document is not approved and stays in the queue', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveQueue(page, [])
  const component = await mount(<PartnerRequestsBandHarness />)

  await component.getByRole('row', { name: /Viaja Rio/ }).getByRole('button', { name: 'Aprovar' }).click()
  await expect(component.getByRole('status')).toContainText('o documento já é de outro parceiro')
  await expect(component.getByText('3 pedidos esperando decisão')).toBeVisible()
})

test('#1139 contract §4.2 record_shared: the shared record is marked, not approved, and the request stays', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serveQueue(page, [], 12)
  const component = await mount(<PartnerRequestsBandHarness />)

  const row = component.getByRole('row', { name: /Ana Souza/ })
  await expect(row.getByText('Outra conta também usa este cadastro')).toBeVisible()
  await row.getByRole('button', { name: 'Aprovar' }).click()
  await expect(component.getByRole('status')).toContainText('Desvincule as outras contas e aprove de novo, ou recuse com motivo.')
  await expect(component.getByText('3 pedidos esperando decisão')).toBeVisible()
  if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/fila-cadastro-compartilhado-1440.png`, fullPage: true })
})

test('#1139 BR-USUARIO-052 4.d: refusing needs a reason and sends it', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const posts: { url: string; body: unknown }[] = []
  await serveQueue(page, posts)
  const component = await mount(<PartnerRequestsBandHarness />)

  await component.getByRole('row', { name: /José Pereira/ }).getByRole('button', { name: 'Recusar' }).click()
  const confirm = component.getByRole('button', { name: 'Recusar com este motivo' })
  await expect(confirm).toBeDisabled()
  await component.getByLabel('Motivo da recusa. A pessoa lê este texto no app.').fill('O CPF não é de quem pediu.')
  if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/fila-recusa-1440.png`, fullPage: true })
  await confirm.click()
  await expect(component.getByRole('status')).toContainText('Recusado.')
  expect(posts).toEqual([
    { url: expect.stringContaining('/api/admin/partner-requests/14/refuse'), body: { reason: 'O CPF não é de quem pediu.' } },
  ])

  const results = await new AxeBuilder({ page }).include('section').analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
})

test('the fixture rows are the RPC rows, parsed', () => {
  expect(REQUESTS.map((row) => row.requestId)).toEqual(RPC_ROWS.map((row) => row.request_id))
})
