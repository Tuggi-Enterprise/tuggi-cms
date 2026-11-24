/**
 * #1281 in a real browser, the API answered by `page.route`: the Painel tab of `/admin/trip-reminder`
 * gains the month of the wish (BR-USUARIO-055 item 11.e) and, as its last block, the list of who got
 * the hours of "estou viajando agora" (BR-MONETIZACAO-091 item 8.2), which loads and fails alone.
 *
 * `CT_CAPTURE_DIR` set = the inspection screenshots of the tab are written there (1440 and 390 px).
 *
 * Run with: npx playwright test -c playwright-ct.config.ts trip-reminder-1281
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import { TripReminderHarness } from './trip-reminder-helpers'
import { NOW_CREDITS, PANEL, SENDS, SETTINGS } from './trip-reminder-fixtures'

const CAPTURE = process.env.CT_CAPTURE_DIR
const HEADING = 'Horas de quem está viajando agora'
const MISSING_FUNCTION = { error: { code: 'unknown', sqlstate: 'PGRST202' } }

type Reply = { status: number; json: unknown }

async function serve(page: Page, replies: { panel?: Reply; nowCredits?: () => Reply } = {}) {
  await page.route('**/api/admin/trip-reminder/settings', (route) => route.fulfill({ json: SETTINGS }))
  await page.route('**/api/admin/trip-reminder/sends**', (route) => route.fulfill({ json: { sends: SENDS } }))
  await page.route('**/api/admin/trip-reminder/panel', (route) => route.fulfill(replies.panel ?? { json: PANEL }))
  await page.route('**/api/admin/trip-reminder/now-credits', (route) =>
    route.fulfill(replies.nowCredits ? replies.nowCredits() : { json: NOW_CREDITS })
  )
}

for (const size of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`#1281 BR-USUARIO-055 item 11.e and BR-MONETIZACAO-091 item 8.2: the wishes by month, and the hours of "now" last, by the email of the account, at ${size.name} px`, async ({ mount, page }) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    await serve(page)
    const component = await mount(<TripReminderHarness />)

    // The wishes read like the trips: the month first.
    const wishes = component.getByRole('region', { name: 'Desejos de destino' })
    await expect(wishes).toBeVisible()
    expect(await wishes.locator('th').allTextContents()).toEqual(['Quando quer ir', 'Destino', 'Desejos'])
    expect((await wishes.locator('tbody tr td:first-child').allTextContents()).map((s) => s.trim())).toEqual([
      expect.stringMatching(/^set\.? de 2027$/),
      'Sem mês',
      expect.stringMatching(/^abr\.? de 2027$/),
    ])

    // The list of the hours of "now" is the last block of the tab.
    const list = component.getByRole('region', { name: HEADING })
    await expect(list.getByRole('table')).toBeVisible()
    const sections = await component.getByRole('tabpanel').locator('section').evaluateAll((all) => all.map((s) => s.getAttribute('aria-labelledby')))
    expect(sections[sections.length - 1]).toBe('trip-now-hours')

    expect(await list.locator('th').allTextContents()).toEqual(['Conta', 'Dia do crédito', 'Horas', 'Duração'])
    const rows = await list.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim())))
    expect(rows).toEqual([
      ['ana.souza.viagens@example.com', '24/11/2026, 18:10', '2 h', 'De 4 a 7 dias'],
      ['bia@example.com', '24/11/2026, 15:00', '1 h', 'Sem duração'],
      ['caio@example.com', '23/11/2026, 09:30', '3 h', 'Mais de 7 dias'],
    ])
    // Never the destination: the section has no column nor flag for it (BR-USUARIO-055 item 6.c).
    await expect(list.getByText(/Destino|Lisboa|Roma/)).toHaveCount(0)
    await expect(list.getByText('Contas: 73')).toBeVisible()
    await expect(list.getByText('Mostrando as 3 mais recentes de 73.')).toBeVisible()

    // The email never breaks in the middle: one line, the table scrolls inside its border instead.
    const email = list.getByRole('cell', { name: 'ana.souza.viagens@example.com' })
    const lines = await email.evaluate((td) => {
      const range = document.createRange()
      range.selectNodeContents(td)
      return range.getClientRects().length
    })
    expect(lines).toBe(1)

    if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/painel-1281-${size.name}.png`, fullPage: true })
  })
}

test('#1281 BR-MONETIZACAO-091 item 8.2: before the function reaches production the list fails alone, names the code, and comes back on retry', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  let applied = false
  await serve(page, { nowCredits: () => (applied ? { status: 200, json: NOW_CREDITS } : { status: 500, json: MISSING_FUNCTION }) })
  const component = await mount(<TripReminderHarness />)

  const list = component.getByRole('region', { name: HEADING })
  await expect(list.getByRole('alert')).toContainText('PGRST202')
  await expect(list.getByText('Contas:')).toHaveCount(0)
  // The counts above do not fall with it.
  await expect(component.getByRole('region', { name: 'Viagens por duração' })).toBeVisible()
  await expect(component.getByRole('region', { name: 'Desejos de destino' }).getByRole('table')).toBeVisible()
  await expect(component.getByRole('alert')).toHaveCount(1)
  if (CAPTURE) await page.screenshot({ path: `${CAPTURE}/painel-1281-falha-1440.png`, fullPage: true })

  applied = true
  await list.getByRole('button', { name: 'Recarregar' }).click()
  await expect(list.getByRole('table')).toBeVisible()
  await expect(list.getByRole('alert')).toHaveCount(0)
})

test('#1281 BR-MONETIZACAO-091 item 8.2: when the counts fail the list still loads, and an empty list says so', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serve(page, {
    panel: { status: 500, json: { error: { code: 'unknown', sqlstate: '57014' } } },
    nowCredits: () => ({ status: 200, json: { total: 0, rows: [] } }),
  })
  const component = await mount(<TripReminderHarness />)

  await expect(component.getByRole('alert')).toContainText('57014')
  const list = component.getByRole('region', { name: HEADING })
  await expect(list.getByText('Nenhuma conta ganhou horas por "estou viajando agora" ainda.')).toBeVisible()
  await expect(list.getByText('Contas: 0')).toBeVisible()
  await expect(list.getByRole('table')).toHaveCount(0)
  await expect(list.getByText(/^Mostrando/)).toHaveCount(0)
})
