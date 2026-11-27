/**
 * #1309: stores by country and the store search position on the Acquisition page, painted in Chromium
 * with the four tables of contract banco-para-cms Parte 31 answered by a small PostgREST stand-in (it
 * filters, orders, pages and returns `Content-Range`, so the paging of the month is the real one).
 * DS-COMPONENTE-084: a country a store did not send prints UNKNOWN_VALUE and never 0, a partial store
 * prints a floor, "not in results" is `> results_read`, a blocked day is a day not read. Axe clean on the
 * section at 1440 and 390.
 *
 * Set CT_CAPTURE_DIR=<dir> to also write the 1440 and 390 captures of the whole page.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page, Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { AcquisitionHarness } from './acquisition-helpers'
import { ACQUISITION, ASO_JOBS, COUNTRY_DAYS, FUNNEL_FULL, FUNNEL_TODAY, MONTHS, RANK_APPS, RANK_DAYS, RANK_KEYWORDS } from './acquisition-fixtures'

const SHOTS = process.env.CT_CAPTURE_DIR
type Row = Record<string, unknown>

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })

/** The part of PostgREST the section uses: `eq`, `gte`, `lte`, `in`, `order`, `offset` and `limit`, and the exact count. */
function answer(route: Route, rows: Row[]) {
  const url = new URL(route.request().url())
  let out = [...rows]
  for (const [key, value] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue
    const dot = value.indexOf('.')
    const op = value.slice(0, dot)
    const arg = value.slice(dot + 1)
    if (op === 'eq') out = out.filter((r) => String(r[key]) === arg)
    if (op === 'gte') out = out.filter((r) => String(r[key]) >= arg)
    if (op === 'lte') out = out.filter((r) => String(r[key]) <= arg)
    if (op === 'in') {
      const set = new Set(arg.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')))
      out = out.filter((r) => set.has(String(r[key])))
    }
  }
  const order = (url.searchParams.get('order') ?? '').split(',').filter(Boolean).map((o) => o.split('.'))
  out.sort((a, b) => {
    for (const [col, dir] of order) {
      const x = String(a[col])
      const y = String(b[col])
      if (x !== y) return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1)
    }
    return 0
  })
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const limit = Number(url.searchParams.get('limit') ?? out.length)
  const page = out.slice(offset, offset + limit)
  return route.fulfill(json(page, 200, { 'Content-Range': `${page.length ? `${offset}-${offset + page.length - 1}` : '*'}/${out.length}` }))
}

interface Tables {
  jobs: Row[]
  countries: Row[]
  keywords: Row[]
  apps: Row[]
  rank: Row[]
  funnel: unknown
  /** The offset of `store_rank_daily` that answers 500. */
  failRankAt?: number
}

async function mockReads(page: Page, t: Tables) {
  const rankOffsets: number[] = []
  await page.route('**/rest/v1/rpc/dashboard_acquisition_months', (route) => route.fulfill(json(MONTHS)))
  await page.route('**/rest/v1/rpc/dashboard_acquisition', (route) => route.fulfill(json(ACQUISITION)))
  await page.route('**/rest/v1/rpc/acquisition_funnel', (route) => route.fulfill(json(t.funnel)))
  await page.route('**/rest/v1/collector_runs?*', (route) => answer(route, t.jobs))
  await page.route('**/rest/v1/store_country_daily?*', (route) => answer(route, t.countries))
  await page.route('**/rest/v1/store_rank_keywords?*', (route) => answer(route, t.keywords))
  await page.route('**/rest/v1/store_rank_apps?*', (route) => answer(route, t.apps))
  await page.route('**/rest/v1/store_rank_daily?*', (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('select')?.includes('position')) {
      const offset = Number(url.searchParams.get('offset') ?? 0)
      rankOffsets.push(offset)
      if (t.failRankAt === offset) return route.fulfill(json({ code: '57014', message: 'canceling statement due to statement timeout' }, 500))
    }
    return answer(route, t.rank)
  })
  return rankOffsets
}

const OCTOBER: Tables = { jobs: ASO_JOBS, countries: COUNTRY_DAYS, keywords: RANK_KEYWORDS, apps: RANK_APPS, rank: RANK_DAYS, funnel: FUNNEL_FULL }

async function axeClean(page: Page, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const result = await new AxeBuilder({ page }).include('[data-testid="acquisition-aso"]').analyze()
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    // the tables scroll inside their box: the page itself never scrolls sideways
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/acquisition-1309-${name}-${width}.png`, fullPage: true })
  }
}

test('DS-COMPONENTE-084 item 1: by country, an absent country is unknown, the App Store detail is a floor, Play has no impressions column', async ({ mount, page }) => {
  await mockReads(page, OCTOBER)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const c = await mount(<AcquisitionHarness month="2026-10-01" />)
  const section = c.getByTestId('acquisition-aso')
  await expect(section.getByRole('heading', { level: 2 })).toHaveText('Lojas por país e busca')
  const card = section.getByTestId('store-countries')
  const table = card.getByTestId('store-countries-table')
  // two groups, App Store four columns and Play three: no impressions column on Play
  await expect(table.locator('thead th[scope="colgroup"]')).toHaveText(['App Store', 'Google Play'])
  await expect(table.locator('thead tr').nth(1).locator('th')).toHaveCount(8)
  await expect(card.getByTestId('countries-play-no-impressions')).toHaveText('O Google Play não informa impressões.')
  // sorted by App Store downloads, the country with no App Store row last
  await expect(table.locator('tbody tr')).toHaveCount(4)
  await expect(table.locator('tbody th')).toHaveText(['🇧🇷Brasil', '🇺🇸Estados Unidos', '🇮🇹Itália', '🇦🇷Argentina'])
  await expect(card.getByTestId('country-BR-app_store-downloads')).toHaveText('≥ 140')
  await expect(card.getByTestId('country-BR-app_store-conversion')).toHaveText('4,7%')
  await expect(card.getByTestId('country-BR-play_store-downloads')).toHaveText('155')
  await expect(card.getByTestId('country-BR-play_store-conversion')).toHaveText('25%')
  const itPlay = card.getByTestId('country-IT-play_store-downloads')
  await expect(itPlay).toHaveText('—')
  await expect(itPlay.locator('span')).toHaveAttribute('title', /A loja não mandou este país no mês/)
  await expect(card.getByTestId('country-AR-app_store-impressions')).toHaveText('—')
  await expect(card.getByTestId('coverage-apple_store')).toContainText('coleta desde 12/10')
  await expect(card.getByTestId('coverage-play')).toHaveCount(0)
  await expect(card.getByTestId('countries-gap-app_store')).toHaveText('App Store: Os países somam 10 downloads a menos que o total da loja no funil.')
  await expect(card.getByTestId('countries-gap-play_store')).toHaveCount(0)
  await expect(card.getByText('0', { exact: true })).toHaveCount(0)
  // the funnel above is still there and unchanged
  await expect(c.getByTestId('acquisition-funnel').getByRole('heading', { level: 2 })).toHaveText('Como chegam ao app')
})

test('DS-COMPONENTE-084: the search position pages the month, marks a blocked Play day, and tells "not in results" from a move', async ({ mount, page }) => {
  const offsets = await mockReads(page, OCTOBER)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const c = await mount(<AcquisitionHarness month="2026-10-01" />)
  const card = c.getByTestId('store-rank')
  await expect(card.getByTestId('rank-country')).toHaveValue('BR')
  await expect(card.getByTestId('rank-country').locator('option')).toHaveText(['Brasil', 'Portugal'])
  // 1,052 rows: two pages, by range
  await expect(card.getByTestId('rank-app_store')).toBeVisible()
  expect(offsets).toEqual([0, 1000])

  // App Store first, then Play
  await expect(card.locator('h4')).toHaveText(['App Store', 'Google Play'])
  const ios = card.getByTestId('rank-app_store')
  await expect(ios.getByTestId('rank-found-app_store').getByTestId('stat-line-value')).toHaveText('2 de 4')
  await expect(ios.getByTestId('rank-top10-app_store').getByTestId('stat-line-value')).toHaveText('1')
  await expect(ios.locator('thead th')).toHaveText(['Palavra', 'Tuggi', 'No mês', 'GetYourGuide', 'Rick Steves', 'VoiceMap', 'SmartGuide'])
  await expect(ios.locator('tbody th')).toHaveText(['audioguia', 'guia de viagem', 'passeio de barco', 'roteiro'])

  const audio = ios.getByTestId('rank-row-k-audio')
  await expect(audio.getByTestId('rank-own')).toHaveText('4')
  await expect(audio.getByTestId('rank-trend')).toHaveAttribute('data-kind', 'moved')
  await expect(audio.getByTestId('rank-trend')).toContainText('+3')
  await expect(audio.getByTestId('rank-trend')).toContainText('subiu 3 posições')
  await expect(ios.getByTestId('rank-row-k-guide').getByTestId('rank-trend')).toContainText('caiu 2 posições')
  // the store returned 200 results and the app was not among them: a measured fact, not unknown and not 0
  const route = ios.getByTestId('rank-row-k-route')
  await expect(route.getByTestId('rank-own')).toContainText('> 200')
  await expect(route.getByTestId('rank-own')).toContainText('Não apareceu')
  await expect(route.getByTestId('rank-trend')).toHaveText('deixou de aparecer')
  // Tuggi never in results all month
  const boat = ios.getByTestId('rank-row-k-boat')
  await expect(boat.getByTestId('rank-own')).toContainText('> 200')
  await expect(boat.getByTestId('rank-trend')).toHaveText('fora o mês todo')
  await expect(audio.getByTestId('rank-app-smart-ios')).toContainText('> 200')

  // Play blocked four days: one line in the block, the positions still print, the App Store has no such line
  const play = card.getByTestId('rank-play_store')
  await expect(play.getByTestId('rank-missing-play_store')).toHaveText('Google Play: sem leitura em 14/10, 15/10, 16/10, 17/10. Nesses dias a posição falta, não caiu.')
  await expect(play.getByTestId('rank-missing-play_store')).toHaveAttribute('title', /o rastreador não grava posição naquele dia/)
  await expect(ios.getByTestId('rank-missing-app_store')).toHaveCount(0)
  await expect(play.getByTestId('rank-row-k-audio').getByTestId('rank-own')).toHaveText('4')
  await expect(play.getByTestId('rank-row-k-route').getByTestId('rank-own')).toContainText('> 50')

  // one open row at a time, the chart and the days line readable without a mouse
  const toggle = audio.getByRole('button', { name: 'audioguia' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(ios.getByTestId('rank-chart-k-audio')).toBeVisible()
  await expect(ios.getByTestId('rank-days')).toHaveText('Apareceu em 31 de 31 dias lidos, 0 sem leitura. Última leitura em 31/10.')
  await play.getByTestId('rank-row-k-audio').getByRole('button', { name: 'audioguia' }).click()
  await expect(play.getByTestId('rank-days')).toHaveText('Apareceu em 27 de 27 dias lidos, 4 sem leitura. Última leitura em 31/10.')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(card.getByTestId('rank-days')).toHaveCount(1)

  await axeClean(page, 'october')
})

test('DS-COMPONENTE-084 item 1: today, no collector and no keyword: no number, no table, the reason once', async ({ mount, page }) => {
  await mockReads(page, { jobs: [], countries: [], keywords: [], apps: [], rank: [], funnel: FUNNEL_TODAY })
  await page.setViewportSize({ width: 1440, height: 1000 })
  const c = await mount(<AcquisitionHarness month="2026-11-01" />)
  const section = c.getByTestId('acquisition-aso')
  const countries = section.getByTestId('store-countries')
  await expect(countries.getByTestId('coverage-apple_store')).toContainText('App Store: sem dado, o coletor ainda não foi configurado.')
  await expect(countries.getByTestId('coverage-play')).toContainText('Google Play: sem dado, o coletor ainda não foi configurado.')
  await expect(countries.getByTestId('store-countries-table')).toHaveCount(0)
  await expect(section.getByTestId('rank-not-configured')).toHaveText('Nenhuma palavra acompanhada ainda. A lista de palavras e concorrentes é cadastrada pelo time, não por esta tela.')
  await expect(section.getByTestId('rank-country')).toHaveCount(0)
  await expect(section.getByText('0', { exact: true })).toHaveCount(0)
  await axeClean(page, 'today')
})

test('DS-COMPONENTE-084 item 1: a month with no row yet says no day was collected, never an empty month of zeros', async ({ mount, page }) => {
  await mockReads(page, { ...OCTOBER, funnel: FUNNEL_TODAY })
  await page.setViewportSize({ width: 1440, height: 1000 })
  const c = await mount(<AcquisitionHarness month="2026-11-01" />)
  const section = c.getByTestId('acquisition-aso')
  await expect(section.getByTestId('store-countries').getByTestId('coverage-apple_store')).toContainText('App Store: nenhum dia deste mês foi coletado ainda.')
  await expect(section.getByTestId('store-countries-table')).toHaveCount(0)
  await expect(section.getByTestId('store-countries').getByText('Nenhum país com visita ou download neste mês.')).toHaveCount(0)
  const ios = section.getByTestId('rank-app_store')
  await expect(ios.getByTestId('coverage-store_rank')).toContainText('Rastreador de busca: nenhum dia deste mês foi coletado ainda.')
  await expect(ios.getByTestId('rank-table-app_store')).toHaveCount(0)
  await expect(section.getByText('0', { exact: true })).toHaveCount(0)
})

test('a page that fails in the middle of the month says the read is incomplete and leaves the other card and the funnel intact', async ({ mount, page }) => {
  await mockReads(page, { ...OCTOBER, failRankAt: 1000 })
  await page.setViewportSize({ width: 1440, height: 1000 })
  const c = await mount(<AcquisitionHarness month="2026-10-01" />)
  const rank = c.getByTestId('store-rank')
  await expect(rank.getByRole('alert')).toContainText('A leitura deste mês parou no meio.')
  await expect(rank.getByRole('button', { name: /tentar/i })).toBeVisible()
  await expect(rank.locator('table')).toHaveCount(0)
  await expect(c.getByTestId('store-countries-table')).toBeVisible()
  await expect(c.getByTestId('acquisition-funnel').getByRole('alert')).toHaveCount(0)
})

test('?store= and ?country= open the section where the link left it: Play only, Portugal', async ({ mount, page }) => {
  await mockReads(page, OCTOBER)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const c = await mount(<AcquisitionHarness month="2026-10-01" search="month=2026-10-01&store=play_store&country=PT" />)
  const section = c.getByTestId('acquisition-aso')
  await expect(section.getByRole('button', { name: 'Google Play' })).toHaveAttribute('aria-pressed', 'true')
  await expect(section.getByTestId('store-countries-table').locator('thead th')).toHaveText(['País', 'Visitas', 'Downloads', 'Conversão'])
  await expect(section.getByTestId('countries-gap-app_store')).toHaveCount(0)
  await expect(section.getByTestId('rank-country')).toHaveValue('PT')
  await expect(section.getByTestId('rank-app_store')).toHaveCount(0)
  // Portugal has a keyword and no reading this month: a row with no number, no trend
  const play = section.getByTestId('rank-play_store')
  await expect(play.getByTestId('coverage-store_rank')).toContainText('nenhum dia deste mês foi coletado ainda.')
  await section.getByRole('button', { name: 'As duas lojas' }).click()
  await expect(section.locator('[data-testid="store-rank"] h4')).toHaveText(['App Store', 'Google Play'])
})
