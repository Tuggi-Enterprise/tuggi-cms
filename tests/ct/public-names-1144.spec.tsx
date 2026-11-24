/**
 * #1144 — the moderation of public names in a real browser: the API is answered by `page.route`,
 * the queue and the lists read it, the curator decides a report, adds to a list, resets a field and
 * locks an account. BR-USUARIO-051 items 2.d, 5 and 6, BR-USUARIO-050 item 7.
 *
 * `CT_CAPTURE_DIR` set = the inspection screenshots are written there (1440 and 390 px).
 *
 * Run with: npx playwright test -c playwright-ct.config.ts public-names-1144
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page, Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { PublicIdentityHarness, PublicNamesHarness } from './public-names-helpers'
import { ALICE, IDENTITY, LISTS, REPORTS } from './public-names-fixtures'

const CAPTURE = process.env.CT_CAPTURE_DIR

type Sent = { method: string; url: string; body: unknown }

async function servePage(page: Page, sent: Sent[]) {
  let reports = [...REPORTS]
  const lists = structuredCopy(LISTS)
  await page.route('**/api/admin/public-identity/reports', (route: Route) =>
    route.fulfill({ json: { reports, total: reports.length } })
  )
  await page.route('**/api/admin/public-identity/reports/*/decide', async (route: Route) => {
    const url = route.request().url()
    const body = route.request().postDataJSON() as { decision: string }
    sent.push({ method: 'POST', url, body })
    const id = Number(url.split('/').slice(-2)[0])
    reports = reports.filter((r) => r.reportId !== id)
    return route.fulfill({
      json: { outcome: body.decision === 'remove' ? { kind: 'removed', value: 'AndarilhoErrante88' } : { kind: 'dismissed' } },
    })
  })
  await page.route('**/api/admin/public-identity/lists', (route: Route) => route.fulfill({ json: lists }))
  await page.route('**/api/admin/public-identity/reserved-names*', async (route: Route) => {
    const request = route.request()
    sent.push({ method: request.method(), url: request.url(), body: request.postDataJSON() })
    const input = request.postDataJSON() as { name: string; match: 'exact' | 'contains'; appliesToDisplayName: boolean }
    if (input.name === 'admin') return route.fulfill({ status: 409, json: { error: 'duplicate' } })
    lists.reserved.push({ name: input.name, nameKey: input.name.toLowerCase(), match: input.match, appliesToDisplayName: input.appliesToDisplayName })
    return route.fulfill({ status: 201, json: { reserved: lists.reserved[lists.reserved.length - 1] } })
  })
}

function structuredCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function settle(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity)
  )
}

for (const size of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`#1144 the page at ${size.name} px shows the reports and the lists`, async ({ mount, page }) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    await servePage(page, [])
    const component = await mount(<PublicNamesHarness />)

    await expect(component.getByRole('heading', { name: 'Nomes públicos' })).toBeVisible()
    await expect(component.getByText('3 abertas')).toBeVisible()
    await expect(component.getByRole('heading', { name: 'Nomes reservados (10)' })).toBeVisible()
    await expect(component.getByText('9 termos, commit 5faf2ba')).toBeVisible()
    if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/nomes-publicos-${size.name}.png`, fullPage: true })
  })
}

test('#1144 BR-USUARIO-051 item 5.b: removing a reported @ asks twice and says the @ is blocked forever', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const sent: Sent[] = []
  await servePage(page, sent)
  const component = await mount(<PublicNamesHarness />)

  const row = component.getByRole('row', { name: /rei\.do\.palavrao/ }).first()
  await row.getByRole('button', { name: 'Remover' }).click()
  await expect(row.getByText('O @ removido fica bloqueado para sempre e não redireciona.', { exact: false })).toBeVisible()
  expect(sent).toEqual([])
  if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/nomes-publicos-confirmar-1440.png`, fullPage: true })

  await row.getByRole('button', { name: 'Confirmar remoção' }).click()
  await expect(component.getByRole('status')).toHaveText('Removido. O campo agora é AndarilhoErrante88.')
  await expect(component.getByText('2 abertas')).toBeVisible()
  expect(sent).toEqual([{ method: 'POST', url: expect.stringContaining('/api/admin/public-identity/reports/7/decide'), body: { decision: 'remove' } }])

  await settle(page)
  const results = await new AxeBuilder({ page }).include('section').analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
})

test('#1144 BR-USUARIO-051 item 5: keep closes the report in one click', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const sent: Sent[] = []
  await servePage(page, sent)
  const component = await mount(<PublicNamesHarness />)

  await component.getByRole('row', { name: /Nome Ofensivo/ }).getByRole('button', { name: 'Manter' }).click()
  await expect(component.getByRole('status')).toHaveText('Mantido. A denúncia saiu da fila.')
  expect(sent.map((s) => s.body)).toEqual([{ decision: 'dismiss' }])
})

test('#1144 BR-USUARIO-050 item 7: a reserved name is added, and one already there says so', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const sent: Sent[] = []
  await servePage(page, sent)
  const component = await mount(<PublicNamesHarness />)

  const name = component.getByLabel('Nome', { exact: true })
  await name.fill('são')
  await expect(component.getByRole('button', { name: 'Reservar' })).toBeDisabled()
  await name.fill('concierge')
  await component.getByRole('button', { name: 'Reservar' }).click()
  await expect(component.getByRole('heading', { name: 'Nomes reservados (11)' })).toBeVisible()
  await name.fill('admin')
  await component.getByRole('button', { name: 'Reservar' }).click()
  await expect(component.getByText('Já está na lista.')).toBeVisible()
  expect(sent.map((s) => s.body)).toEqual([
    { name: 'concierge', match: 'exact', appliesToDisplayName: false },
    { name: 'admin', match: 'exact', appliesToDisplayName: false },
  ])
})

test('#1144 BR-USUARIO-051 items 5 and 6: the record resets a field after confirming and locks the edit', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  let identity = { ...IDENTITY }
  const sent: Sent[] = []
  await page.route(`**/api/admin/users/${ALICE}/public-identity`, async (route: Route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { locked: boolean }
      sent.push({ method: 'PATCH', url: route.request().url(), body })
      identity = { ...identity, locked: body.locked, lockedAt: body.locked ? '2026-11-09T12:00:00Z' : null }
      return route.fulfill({ json: { locked: body.locked } })
    }
    return route.fulfill({ json: { identity } })
  })
  await page.route(`**/api/admin/users/${ALICE}/public-identity/reset`, async (route: Route) => {
    const body = route.request().postDataJSON() as { field: string }
    sent.push({ method: 'POST', url: route.request().url(), body })
    identity = { ...identity, nickname: 'ViajanteCurioso12', resetAt: { ...identity.resetAt, nickname: '2026-11-09T12:00:00Z' } }
    return route.fulfill({ json: { outcome: { field: body.field, value: 'ViajanteCurioso12', reportsClosed: 1 } } })
  })
  const component = await mount(<PublicIdentityHarness userId={ALICE} />)

  await expect(component.getByText('rei.do.palavrao', { exact: true })).toBeVisible()
  await component.getByRole('button', { name: 'Redefinir @' }).click()
  await expect(component.getByText(/bloqueado para sempre/)).toBeVisible()
  await component.getByRole('button', { name: 'Confirmar' }).click()
  await expect(component.getByRole('status')).toHaveText('Redefinido: ViajanteCurioso12')

  await component.getByLabel('Travar a edição de @ e bio').check()
  await expect(component.getByText('Travada desde 09/11/2026. A moderação ainda redefine.')).toBeVisible()
  expect(sent.map((s) => [s.method, s.body])).toEqual([
    ['POST', { field: 'nickname' }],
    ['PATCH', { locked: true }],
  ])
  if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/ficha-nome-publico-1440.png`, fullPage: true })

  const results = await new AxeBuilder({ page }).include('.rounded-xl').analyze()
  expect(results.violations.map((v) => v.id)).toEqual([])
})
