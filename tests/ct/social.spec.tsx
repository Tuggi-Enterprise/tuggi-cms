/**
 * #1059: `/admin/social` painted in Chromium with the API mocked. The three views at 1440 and 390
 * (spec section 8 items 1, 2, 4 to 11), axe clean, nothing leaking at 390, no raw enum on screen.
 * The captures go to the test output folder (`social-*.png`).
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { SocialHarness } from './social-helpers'
import {
  ACCOUNTS,
  COMPETITOR_POSTS,
  MARKETS,
  OVERVIEW,
  OVERVIEW_SPARSE,
  POSTS,
  STORIES,
  STORIES_NEVER,
  competitorGrowth,
  growthFixture,
} from './social-fixtures'

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** #1064: what the PATCH of a market answers; a test flips it to a failure. */
const marketWrite = { fail: false, bodies: [] as unknown[] }

async function mockApi(page: Page, overview: unknown = OVERVIEW, stories: unknown = STORIES) {
  const seen: string[] = []
  marketWrite.fail = false
  marketWrite.bodies = []
  await page.route('**/api/admin/social/growth*', (route) => {
    const url = route.request().url()
    seen.push(url)
    const id = new URL(url).searchParams.get('account')
    if (id === 'own') return route.fulfill(json({ ...OVERVIEW.growth, kind: 'own', account: { id: 'own', username: 'tuggi_app' } }))
    if (id === 'c5') return route.fulfill(json({ from: OVERVIEW.growth.to, to: OVERVIEW.growth.to, days: [], measured: { net: 0 }, kind: 'competitor', account: { id: 'c5', username: 'shakaguide' } }))
    return route.fulfill(json(competitorGrowth()))
  })
  await page.route('**/api/admin/social/markets', (route) => {
    seen.push(route.request().url())
    return route.fulfill(json(MARKETS))
  })
  await page.route('**/api/admin/social/stories*', (route) => {
    seen.push(route.request().url())
    return route.fulfill(json(stories))
  })
  await page.route('**/api/admin/social/competitor-posts*', (route) => {
    const url = route.request().url()
    seen.push(url)
    const week = new URL(url).searchParams.get('week')
    if (!week) return route.fulfill(json(COMPETITOR_POSTS))
    return route.fulfill(json({ ...COMPETITOR_POSTS, week_start: week, rows: COMPETITOR_POSTS.rows.slice(0, 2) }))
  })
  await page.route('**/api/admin/social/overview*', (route) => {
    seen.push(route.request().url())
    return route.fulfill(json(overview))
  })
  await page.route('**/api/admin/social/posts', (route) => {
    seen.push(route.request().url())
    return route.fulfill(json(POSTS))
  })
  await page.route('**/api/admin/social/accounts', (route) => {
    seen.push(route.request().url())
    if (route.request().method() === 'POST') {
      const { username, market } = route.request().postDataJSON() as { username: string; market: string | null }
      if (username === 'izitravel') return route.fulfill(json({ error: { code: 'duplicate', id: 'c1' } }, 409))
      if (username === 'romatours') return route.fulfill(json({ account: { id: 'c9', username, market, followers: 9000, reactivated: false } }))
      return route.fulfill(json({ error: { code: 'not_found' } }, 422))
    }
    return route.fulfill(json(ACCOUNTS))
  })
  await page.route('**/api/admin/social/accounts/*', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    if (!('market' in body)) return route.fulfill(json({ ok: true }))
    marketWrite.bodies.push(body)
    if (marketWrite.fail) return route.fulfill(json({ error: { code: 'server_error' } }, 500))
    return route.fulfill(json({ account: { id: 'c1', username: 'izitravel', market: body.market } }))
  })
  return seen
}

async function settle(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity)
  )
}

async function axeClean(page: Page) {
  await settle(page)
  const axe = await new AxeBuilder({ page }).include('#root').analyze()
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
}

/** The `WidgetCard` around a heading (#1061: the cards are `WidgetCard`, not `section`). */
const CARD_OF = 'xpath=ancestor::div[contains(@class,"shadow-sm")][1]'

const RAW = /CAROUSEL_ALBUM|REELS|IMAGE|VIDEO|Pages\.Social|\bpending\b/

async function noLeak(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test('#1059: the overview at 1440 has three numbered recommendations, four rankings and six funnel strips', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const seen = await mockApi(page)
  await mount(<SocialHarness search="" />)
  await expect(page.getByRole('heading', { level: 1, name: 'Redes sociais' })).toBeVisible()
  await expect(page.locator('ol > li')).toHaveCount(3)
  await expect(page.getByText('Modelo: gemini-2.5-flash-lite.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Geral', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // The floor: Imagem has 2 posts, so it is last, with no number and no bar.
  const format = page.getByRole('heading', { level: 3, name: 'Por formato' }).locator(CARD_OF)
  await expect(format.locator('li').last()).toContainText('Imagem')
  await expect(format.locator('li').last()).toContainText('Poucos posts (2)')
  await expect(format.locator('li').first()).toContainText('7,2%')
  await expect(page.getByText('Visitas ao perfil', { exact: true })).toBeVisible()
  await expect(page.locator('[data-strip] .recharts-responsive-container')).toHaveCount(6)
  await expect(page.locator('#root')).not.toContainText(RAW)
  expect(seen.filter((u) => u.includes('/posts') || u.includes('/accounts'))).toEqual([])
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-overview-1440.png'), fullPage: true })
})

test('#1061: the page follows the reports: h1 with the icon, tabs on their own line, four indicators above 400 px', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await mount(<SocialHarness search="" />)
  const h1 = page.getByRole('heading', { level: 1, name: 'Redes sociais' })
  await expect(h1.locator('svg')).toHaveClass(/text-tuggi-purple/)
  const tabs = page.getByRole('button', { name: 'Geral', exact: true })
  expect((await tabs.boundingBox())!.y).toBeGreaterThan((await h1.boundingBox())!.y + 40)
  const tiles = page.locator('div.grid', { has: page.getByText('Instalações', { exact: true }) }).last().locator(':scope > *')
  await expect(tiles).toHaveCount(4)
  await expect(page.getByText('+38 em 7 dias')).toBeVisible()
  await expect(page.getByText('24.180')).toBeVisible()
  await expect(page.getByText('4,1%', { exact: true })).toBeVisible()
  for (const tile of await tiles.all()) expect((await tile.boundingBox())!.y + (await tile.boundingBox())!.height).toBeLessThan(400)
  // R1 item 7: the rankings section is a real heading; its four cards sit under it as h3.
  await expect(page.getByRole('heading', { level: 2, name: 'O que rende mais' })).toHaveClass(/text-lg font-bold/)
  await expect(page.locator('section[aria-labelledby="social-ranking-title"]').getByRole('heading', { level: 3 })).toHaveCount(4)
  await expect(page.locator('.shadow-sm', { has: page.getByRole('heading', { level: 2, name: 'O que postar nesta semana' }) })).toHaveCount(1)
})

test('#1061: at 390 no tab label wraps: the bar scrolls inside its box and nothing leaks', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await mount(<SocialHarness search="" />)
  await expect(page.locator('ol > li')).toHaveCount(3)
  for (const name of ['Geral', 'Posts', 'Concorrentes']) {
    const tab = page.getByRole('button', { name, exact: true })
    await expect(tab.locator('svg')).toBeVisible()
    expect((await tab.boundingBox())!.height).toBeLessThan(40)
  }
  await expect(page.locator('[data-strip] .recharts-responsive-container')).toHaveCount(6)
  await settle(page)
  await noLeak(page)
  await page.screenshot({ path: testInfo.outputPath('social-overview-390.png'), fullPage: true })
})

test('#1059: our posts at 1440 sort by reach with aria-sort, filter by format, and print "sem dado" for a null', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const seen = await mockApi(page)
  await mount(<SocialHarness search="view=posts" />)
  await expect(page.locator('table').first().locator('tbody tr')).toHaveCount(POSTS.posts.length)
  expect(seen.some((u) => u.includes('/overview'))).toBe(false)
  await expect(page.locator('table').first().locator('thead th')).toHaveCount(12)
  const reach = page.locator('table').first().locator('th', { hasText: /^Alcance$/ })
  await reach.getByRole('button').click()
  await expect(reach).toHaveAttribute('aria-sort', 'descending')
  await expect(page.locator('table').first().locator('tbody tr').first().locator('td').nth(4)).toHaveText(/2\.581/)
  await reach.getByRole('button').click()
  await expect(reach).toHaveAttribute('aria-sort', 'ascending')
  // #1061 R1 item 8: a row with the 32 px link is 40 px, as a plain CELL row (plus its 1 px top border).
  for (const row of (await page.locator('table').first().locator('tbody tr').all()).slice(0, 3)) expect(Math.round((await row.boundingBox())!.height)).toBeLessThanOrEqual(41)
  // R1 item 9: the short head names the whole column in its title.
  await expect(page.getByRole('button', { name: 'Compart.' })).toHaveAttribute('title', 'Ordenar por Compartilhamentos')
  await expect(page.locator('table').first().locator('tbody td', { hasText: 'sem dado' }).first()).toHaveAttribute('class', /text-right/)
  await expect(page.locator('table').first().locator('tbody tr').nth(0).locator('a[target="_blank"]')).toHaveAttribute('href', /instagram\.com\/p\/fixture/)
  await page.getByRole('button', { name: /^Reels/ }).click()
  await expect(page.locator('table').first().locator('tbody tr')).toHaveCount(5)
  await page.getByRole('button', { name: /^Todos/ }).click()
  await expect(page.locator('#root')).not.toContainText(RAW)
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-posts-1440.png'), fullPage: true })
})

test('#1059: at 390 the posts table scrolls inside its box and the page does not', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await mount(<SocialHarness search="view=posts" />)
  await expect(page.locator('table').first().locator('tbody tr')).toHaveCount(POSTS.posts.length)
  await noLeak(page)
  await page.screenshot({ path: testInfo.outputPath('social-posts-390.png'), fullPage: true })
})

test('#1059: competitors at 1440 put our account first, marked by a word and with no remove button', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await mount(<SocialHarness search="view=competitors" />)
  const rows = page.locator('table').first().locator('tbody tr')
  await expect(rows).toHaveCount(ACCOUNTS.accounts.length)
  await expect(rows.first()).toContainText('@tuggi_app')
  await expect(rows.first()).toContainText('Nossa conta')
  await expect(rows.first().getByRole('button', { name: /Remover/ })).toHaveCount(0)
  await expect(rows.nth(1)).toContainText('@melhoresdestinos')
  // #1061 R1 item 8: the remove button is a 32 px target, no longer the 40 px that stretched the row.
  expect((await rows.nth(1).getByRole('button', { name: /Remover/ }).boundingBox())!.height).toBe(32)
  // Not enough days: the cell says so, with no "+0".
  const shaka = page.locator('table').first().locator('tr[data-account="shakaguide"]')
  await expect(shaka.locator('td').nth(3)).toHaveText('sem dado')
  // A failed collection is amber with its glyph.
  await expect(page.locator('table').first().locator('tr[data-account="autioapp"] td').nth(9).locator('svg')).toBeVisible()
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-competitors-1440.png'), fullPage: true })
})

test('#1059: adding refuses a bad @ before any call, a duplicate on the field, and removing asks first', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const seen = await mockApi(page)
  await mount(<SocialHarness search="view=competitors" />)
  await expect(page.locator('table').first().locator('tbody tr')).toHaveCount(ACCOUNTS.accounts.length)
  const field = page.getByLabel('Acompanhar outra conta')
  const posts = () => seen.filter((u) => u.endsWith('/accounts')).length

  const before = posts()
  await field.fill('nome com espaço')
  await page.getByRole('button', { name: 'Adicionar' }).click()
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('Digite só o nome de usuário')).toBeVisible()
  await field.fill('@Tuggi_App ')
  await page.getByRole('button', { name: 'Adicionar' }).click()
  await expect(page.getByText('@tuggi_app é a nossa conta.')).toBeVisible()
  expect(posts()).toBe(before)

  await field.fill('@izitravel')
  await page.getByRole('button', { name: 'Adicionar' }).click()
  await expect(page.getByText('@izitravel já está na lista.')).toBeVisible()
  await expect(page.locator('table').first().locator('tr[data-account="izitravel"]')).toHaveClass(/bg-primary-800\/5/)
  await axeClean(page)

  await page.getByRole('button', { name: 'Remover @roadtrippers da lista' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Parar de acompanhar @roadtrippers?')
  await expect(dialog.getByRole('button', { name: 'Voltar' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('#1059: at 390 the competitors table scrolls inside its box and the form wraps', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await mount(<SocialHarness search="view=competitors" />)
  await expect(page.locator('table').first().locator('tbody tr')).toHaveCount(ACCOUNTS.accounts.length)
  await noLeak(page)
  await page.screenshot({ path: testInfo.outputPath('social-competitors-390.png'), fullPage: true })
})

test('#1059: the funnel with the first production collection keeps every bar inside its own strip (DS-COMPONENTE-084)', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page, OVERVIEW_SPARSE)
  await mount(<SocialHarness search="" />)
  await expect(page.locator('[data-strip] .recharts-responsive-container')).toHaveCount(5)
  await settle(page)
  // Every bar of a strip stays inside that strip's own box: no bar crosses into the next strip.
  // #1062: no store click measured yet: that strip says "sem dado" with its reason, and draws no bar.
  await expect(page.locator('[data-strip="store_clicks"]')).toContainText('sem dado')
  await expect(page.locator('[data-strip="store_clicks"] p[title*="click_store"]')).toHaveCount(1)
  for (const key of ['posts', 'profile_views', 'website_clicks', 'site_sessions', 'installs']) {
    const strip = page.locator(`[data-strip="${key}"]`)
    const box = (await strip.boundingBox())!
    for (const bar of await strip.locator('.recharts-bar-rectangle path').all()) {
      const b = (await bar.boundingBox())!
      expect(b.y, key).toBeGreaterThanOrEqual(box.y)
      expect(b.y + b.height, key).toBeLessThanOrEqual(box.y + box.height + 0.5)
    }
  }
  // Visits: one day of 9 gets its own top, 10, and the bar fills most of the strip from its base.
  const visits = page.locator('[data-strip="profile_views"]')
  await expect(visits.locator('svg text').filter({ hasText: /\d/ })).toHaveText(['10'])
  const ninePx = (await visits.locator('.recharts-bar-rectangle path').first().boundingBox())!.height
  expect(ninePx).toBeGreaterThan(35)
  // Measured on 1 of 28 days: a floor with its coverage, and no change printed.
  await expect(visits).toContainText('em 1 de 28 dias')
  await expect(visits.locator('.text-green-700, .text-red-700')).toHaveCount(0)
  await expect(page.locator('[data-strip="website_clicks"]')).toContainText('em 1 de 28 dias')
  // Posts come from the whole history: their change prints.
  await expect(page.locator('[data-strip="posts"]')).toContainText('+600,0%')
  // Gray is named in the legend.
  await expect(page.getByText('Cinza: últimos 2 dias do GA4, ainda podem mudar')).toBeVisible()
  const card = page.getByRole('heading', { name: 'Do Instagram ao app' }).locator(CARD_OF)
  await card.screenshot({ path: testInfo.outputPath('social-funnel-sparse-1440.png') })
})

test('#1059: the funnel with 28 full days, both periods measured, prints totals and changes (DS-COMPONENTE-084)', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await mount(<SocialHarness search="" />)
  await expect(page.locator('[data-strip] .recharts-responsive-container')).toHaveCount(6)
  await settle(page)
  await expect(page.locator('[data-strip="profile_views"]')).not.toContainText(' de 28 dias')
  await expect(page.locator('[data-strip="profile_views"] .text-green-700, [data-strip="profile_views"] .text-red-700')).toHaveCount(1)
  const card = page.getByRole('heading', { name: 'Do Instagram ao app' }).locator(CARD_OF)
  await card.screenshot({ path: testInfo.outputPath('social-funnel-full-1440.png') })
})

test('#1062 R2.2 R2.3 R2.5: the overview adds store clicks between sessions and installs, the campaigns and the audience', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await mount(<SocialHarness search="" />)
  await expect(page.locator('[data-strip] .recharts-responsive-container')).toHaveCount(6)
  const order = await page.locator('[data-strip]').evaluateAll((els) => els.map((e) => e.getAttribute('data-strip')))
  expect(order).toEqual(['posts', 'profile_views', 'website_clicks', 'site_sessions', 'store_clicks', 'installs'])
  // Campaigns: without the Apple key the column says so once, in the note and the head; no ratio anywhere.
  const campaigns = page.getByRole('heading', { level: 2, name: 'Por campanha' }).locator(CARD_OF)
  await expect(campaigns).toContainText('Downloads iOS: sem a chave da Apple.')
  await expect(campaigns.getByRole('button', { name: 'Downloads iOS' })).toHaveAttribute('title', /sem a chave da Apple/)
  await expect(campaigns.locator('tbody tr')).toHaveCount(3)
  await expect(campaigns.locator('tbody tr').nth(2).locator('td').nth(1)).toHaveText('0')
  await expect(campaigns.locator('tbody tr').first().locator('td').nth(3)).toHaveText('—')
  await expect(campaigns).not.toContainText('%')
  // Audience: four lists under h3, share and count, the date of the snapshot.
  const audience = page.getByRole('heading', { level: 2, name: 'Quem nos segue' }).locator(CARD_OF)
  await expect(audience.getByRole('heading', { level: 3 })).toHaveText(['Cidade', 'País', 'Idade', 'Gênero'])
  await expect(audience).toContainText('Brasil')
  await expect(audience).toContainText('25 a 34')
  await expect(audience).toContainText('65 ou mais')
  await expect(audience).toContainText('Mulheres')
  await expect(audience).toContainText('39,3%')
  await expect(audience).toContainText('Não muda com o período.')
  await expect(page.locator('#root')).not.toContainText(RAW)
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-overview-1062-1440.png'), fullPage: true })
})

test('#1062 R2.3: with the Apple report covering part of the period, the head says since when; unknown stores print no zero', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const partial = {
    ...OVERVIEW,
    clicks_by_store: false,
    apple: { configured: true, first_day: OVERVIEW.funnel.to },
    campaigns: OVERVIEW.campaigns.map((c) => ({ ...c, downloads_ios: 3 })),
  }
  await mockApi(page, partial)
  await mount(<SocialHarness search="" />)
  const campaigns = page.getByRole('heading', { level: 2, name: 'Por campanha' }).locator(CARD_OF)
  await expect(campaigns.getByRole('button', { name: /^Downloads iOS desde / })).toBeVisible()
  await expect(campaigns.locator('tbody tr').first().locator('td').nth(1)).toHaveText('sem dado')
  await expect(campaigns.locator('tbody tr').first().locator('td').nth(3)).toHaveText('3')
})

test('#1062 R2.5: under 100 followers the audience says why, and nothing else', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page, { ...OVERVIEW, audience: null, audience_reason: 'below_100' })
  await mount(<SocialHarness search="" />)
  await expect(page.getByText('A Meta só informa o público a partir de 100 seguidores.')).toBeVisible()
})

test('#1062 R2.4 R2.6: with "Reels" the posts table swaps two columns for three, and the stories card follows', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await mount(<SocialHarness search="view=posts" />)
  const posts = page.getByRole('heading', { level: 2, name: 'Nossos posts' }).locator(CARD_OF)
  await expect(posts.locator('tbody tr')).toHaveCount(POSTS.posts.length)
  await expect(posts.locator('thead th')).toHaveCount(12)
  await expect(posts.getByRole('button', { name: 'Visualiz.' })).toHaveCount(0)
  await page.getByRole('button', { name: /^Reels/ }).click()
  await expect(posts.locator('thead th')).toHaveCount(13)
  await expect(posts.getByRole('button', { name: 'Visualiz.' })).toBeVisible()
  await expect(posts.getByRole('button', { name: 'Tempo médio' })).toHaveAttribute('title', 'Ordenar por Tempo médio assistido')
  await expect(posts.getByRole('button', { name: 'Seguiram' })).toHaveCount(0)
  await expect(posts.getByRole('button', { name: 'Visitas ao perfil' })).toHaveCount(0)
  await expect(posts).toContainText('1 min 05 s')
  await expect(posts).toContainText('3 h 12 min')
  await expect(posts).toContainText('48 min')
  // R2.4: three columns in (90 + 90 + 100) for two out (76 + 76): the table grows by 128 px and no more. The
  // absolute 1340 px of the spec is measured in Inter; this bench paints in the browser's sans (no next/font).
  const width = () => posts.locator('table').evaluate((el) => el.getBoundingClientRect().width)
  const withReels = await width()
  await page.getByRole('button', { name: /^Todos/ }).click()
  const withAll = await width()
  expect(withReels - withAll).toBeLessThanOrEqual(128 + 2)
  await page.getByRole('button', { name: /^Reels/ }).click()
  await posts.getByRole('button', { name: 'Tempo médio' }).click()
  await expect(posts.locator('tbody tr').first()).toContainText('1 min 05 s')

  // Stories: newest first, "No ar" only on the live one, exit over reach sorts.
  const stories = page.getByRole('heading', { level: 2, name: 'Stories' }).locator(CARD_OF)
  await expect(stories.locator('tbody tr')).toHaveCount(3)
  await expect(stories.locator('tbody tr').first()).toContainText('No ar')
  await expect(stories.getByText('No ar', { exact: true })).toHaveCount(1)
  await expect(stories.locator('tbody tr').nth(2)).toContainText('sem dado')
  const exitRate = stories.locator('th', { hasText: 'Saída ÷ alcance' })
  await exitRate.getByRole('button').click()
  await expect(exitRate).toHaveAttribute('aria-sort', 'descending')
  await expect(stories.locator('tbody tr').first()).toContainText('21,4%')
  for (const row of await stories.locator('tbody tr').all()) expect(Math.round((await row.boundingBox())!.height)).toBeLessThanOrEqual(41)
  await page.getByRole('button', { name: /^Todos/ }).click()
  await expect(page.locator('#root')).not.toContainText(RAW)
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-posts-1062-1440.png'), fullPage: true })
})

test('#1062 R2.6: before the hourly job ever ran, the stories card says so with a reload, never an empty table', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page, OVERVIEW, STORIES_NEVER)
  await mount(<SocialHarness search="view=posts" />)
  const stories = page.getByRole('heading', { level: 2, name: 'Stories' }).locator(CARD_OF)
  await expect(stories).toContainText('ainda não rodou')
  await expect(stories.getByRole('button', { name: 'Recarregar' })).toBeVisible()
  await expect(stories.locator('table')).toHaveCount(0)
})

test('#1062 R2.1: the competitors\' best posts of the last closed week, in the database\'s order; the select changes the week', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const seen = await mockApi(page)
  await mount(<SocialHarness search="view=competitors" />)
  const top = page.getByRole('heading', { level: 2, name: 'O que rendeu nos concorrentes' }).locator(CARD_OF)
  await expect(top.locator('tbody tr')).toHaveCount(10)
  await expect(top.locator('tbody tr').first().getByRole('link', { name: '@izitravel', exact: true })).toHaveAttribute('href', 'https://www.instagram.com/izitravel/')
  await expect(top.locator('tbody tr').first()).toContainText('#viagem #roadtrip #roma #italia #dicasdeviagem')
  await expect(top.locator('tbody tr').first().getByText('+2')).toHaveAttribute('title', /#audioguia/)
  await expect(top.locator('tbody tr').first()).toContainText('8,43%')
  await expect(top.locator('tbody tr').first()).toContainText('Sem tema ainda')
  expect(seen.filter((u) => u.includes('competitor-posts'))).toEqual([expect.stringMatching(/competitor-posts$/)])
  await expect(top.locator('select')).toHaveValue(COMPETITOR_POSTS.weeks[0])
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-competitors-1062-1440.png'), fullPage: true })
  await top.locator('select').selectOption(COMPETITOR_POSTS.weeks[1])
  await expect(top.locator('tbody tr')).toHaveCount(2)
  expect(seen.some((u) => u.endsWith(`competitor-posts?week=${COMPETITOR_POSTS.weeks[1]}`))).toBe(true)
})

// ---------------------------------------------------------------------------------------------
// #1063: how the account grew (spec G9).

const growthCard = (page: Page) => page.locator('.shadow-sm', { has: page.getByRole('heading', { level: 2, name: 'Como a conta cresceu' }) })

test('#1063 G9: the growth card sits between the indicators and the recommendations, under 380 px, strips of 96, 64 and 56 + 22', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page)
  await mount(<SocialHarness search="" />)
  const card = growthCard(page)
  await expect(card.locator('.recharts-surface')).toHaveCount(3)
  await card.screenshot({ path: testInfo.outputPath('social-growth-1440.png') })
  const box = (await card.boundingBox())!
  const tiles = (await page.getByText('Instalações', { exact: true }).boundingBox())!
  const recs = (await page.getByRole('heading', { level: 2, name: 'O que postar nesta semana' }).boundingBox())!
  expect(box.y).toBeGreaterThan(tiles.y)
  expect(box.y + box.height).toBeLessThan(recs.y)
  expect(box.height).toBeLessThanOrEqual(380)
  const heights = await card.locator('.recharts-responsive-container').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  expect(heights).toEqual([96, 64, 78])
  await expect(card.getByText('Histórico inteiro. O período acima não muda este gráfico.')).toBeVisible()
  await expect(card.getByText(/A Meta só guarda 90 dias/)).toBeVisible()
  // DS-COMPONENTE-084: the net over days not all measured is a floor, and says so.
  await expect(card.getByText(/· em 88 de 90 dias$/)).toBeVisible()
  await axeClean(page)
})

test('#1063 G9 DS-COMPONENTE-084: hover prints five lines; a day Meta did not answer prints the unknown mark and its reason', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page)
  await mount(<SocialHarness search="" />)
  const card = growthCard(page)
  const plots = card.locator('.recharts-wrapper')
  await expect(plots).toHaveCount(3)
  const posts = (await plots.nth(2).boundingBox())!
  const g = OVERVIEW.growth
  const xOf = (i: number) => posts.x + 42 + 8 / 2 + ((posts.width - 42 - 8) * (i + 0.5)) / g.days.length
  // The refused day (index span - 50 = 40): unknown moves and net, with the reason.
  await page.mouse.move(xOf(40), posts.y + 20)
  const tip = card.locator('.recharts-tooltip-wrapper').nth(2)
  await expect(tip).toContainText('Ganhos e perdas: —')
  await expect(tip).toContainText('Saldo: —')
  await expect(tip).toContainText('A Meta não devolveu os ganhos e perdas deste dia.')
  // A day with a loss: five lines, the net with its sign from Intl.
  await page.mouse.move(xOf(70), posts.y + 20)
  await expect(tip).toContainText('Ganhos e perdas: +1 / -9')
  await expect(tip).toContainText('Saldo: -8')
  await expect(tip).toContainText(/Seguidores: \d/)
  await expect(tip).toContainText(/post/)
})

test('#1063 G9: 130 days group by week, with Monday ticks and a week title; the period does not change the card', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const growth = growthFixture(130)
  await mockApi(page, { ...OVERVIEW, period: '6m', growth })
  await mount(<SocialHarness search="?period=6m" />)
  const card = growthCard(page)
  await expect(card.getByText('Histórico inteiro, por semana. O período acima não muda este gráfico.')).toBeVisible()
  await expect(card.getByText('Saldo da semana')).toBeVisible()
  await expect(card.getByRole('group', { name: /semana a semana/ })).toBeVisible()
  const posts = (await card.locator('.recharts-wrapper').nth(2).boundingBox())!
  await page.mouse.move(posts.x + posts.width / 2, posts.y + 20)
  await expect(card.locator('.recharts-tooltip-wrapper').nth(2)).toContainText('Semana de')
})

test('#1063 G9: at 390 the growth card scrolls inside its box and nothing leaks; without moves it says why', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await mount(<SocialHarness search="" />)
  const card = growthCard(page)
  await expect(card.locator('.recharts-surface')).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await card.screenshot({ path: testInfo.outputPath('social-growth-390.png') })
})

test('#1063 G5: no follows and unfollows yet is the empty state, never a flat line of zeros', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page, { ...OVERVIEW, growth: { from: OVERVIEW.growth.to, to: OVERVIEW.growth.to, days: [], measured: { net: 0 } } })
  await mount(<SocialHarness search="" />)
  const card = growthCard(page)
  await expect(card.getByText('Ainda sem histórico de seguidores')).toBeVisible()
  await expect(card.locator('.recharts-surface')).toHaveCount(0)
})

// ---------------------------------------------------------------------------------------------
// #1064: competitors by market (spec M1 to M9).

const cardOf = (page: Page, name: string) => page.locator('.shadow-sm', { has: page.getByRole('heading', { level: 2, name }) })

test('#1064 M9.1: the Competitors view at 1440 has four cards in order; Mercado is the second column; our row has no select', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await mount(<SocialHarness search="view=competitors" />)
  const table = page.locator('table').first()
  await expect(table.locator('tbody tr')).toHaveCount(ACCOUNTS.accounts.length)
  await expect(table.locator('thead th').nth(1)).toHaveText('Mercado')
  await expect(page.locator('.recharts-surface')).toHaveCount(3)
  const titles = await page.getByRole('heading', { level: 2 }).allTextContents()
  expect(titles).toEqual(['Concorrentes', 'Como a conta cresceu', 'O que rende em cada mercado', 'O que rendeu nos concorrentes'])
  const own = table.locator('tbody tr').first()
  await expect(own.locator('select')).toHaveCount(0)
  const rival = table.locator('tr[data-account="izitravel"]')
  await expect(rival.getByLabel('Mercado de @izitravel')).toHaveValue('EU')
  const none = table.locator('tr[data-account="shakaguide"]').getByLabel('Mercado de @shakaguide')
  await expect(none).toHaveValue('')
  await expect(none).toHaveAttribute('title', /Fora da comparação por mercado/)
  // The select does not grow the row: a competitor row is as tall as ours, which has none.
  expect(Math.round((await rival.boundingBox())!.height)).toBe(Math.round((await own.boundingBox())!.height))
  expect(Math.round((await rival.getByLabel('Mercado de @izitravel').boundingBox())!.height)).toBe(32)
  const scroller = table.locator('xpath=..')
  expect(await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-competitors-1064-1440.png'), fullPage: true })
})

test('#1064 M9.2: adding sends the market chosen in the form; none is the default and the hint says what it means', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await mount(<SocialHarness search="view=competitors" />)
  const market = page.getByLabel('Mercado', { exact: true })
  await expect(market).toHaveValue('')
  await expect(page.getByText(/Sem mercado, a conta fica fora da comparação por mercado/)).toBeVisible()
  await page.getByLabel('Acompanhar outra conta').fill('romatours')
  await market.selectOption('EU')
  const post = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/accounts'))
  await page.getByRole('button', { name: 'Adicionar' }).click()
  expect((await post).postDataJSON()).toEqual({ username: 'romatours', market: 'EU' })
  await expect(market).toHaveValue('')
})

test('#1064 M9.3: a market change PATCHes, announces, and reloads the comparison; a failure puts the old value back with an alert', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const seen = await mockApi(page)
  await mount(<SocialHarness search="view=competitors" />)
  const select = page.getByLabel('Mercado de @izitravel')
  await expect(select).toHaveValue('EU')
  await expect(cardOf(page, 'O que rende em cada mercado').locator('table')).toHaveCount(3)
  const readsBefore = seen.filter((u) => u.endsWith('/markets')).length
  await select.selectOption('BR')
  await expect(page.getByRole('status').filter({ hasText: '@izitravel agora entra na comparação como Brasil.' })).toHaveCount(1)
  expect(marketWrite.bodies).toEqual([{ market: 'BR' }])
  await expect.poll(() => seen.filter((u) => u.endsWith('/markets')).length).toBeGreaterThan(readsBefore)

  marketWrite.fail = true
  const other = page.getByLabel('Mercado de @roadtrippers')
  await other.selectOption('')
  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível salvar o mercado de @roadtrippers.' })).toBeVisible()
  await expect(other).toHaveValue('US')
  await expect(other).toBeEnabled()
})

test('#1064 M9.4: the growth card starts on the first competitor, four tooltip lines, a gap where a total is missing; ours is the overview chart', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await mount(<SocialHarness search="view=competitors" />)
  const card = cardOf(page, 'Como a conta cresceu')
  const picker = card.getByRole('combobox', { name: /^Conta/ })
  await expect(picker).toHaveValue('c3')
  await expect(picker.locator('option').first()).toHaveText('@tuggi_app (nossa conta)')
  const g = competitorGrowth()
  await expect(card.getByText(`Histórico de @melhoresdestinos a partir de`)).toBeVisible()
  await expect(card.getByText(/Para outra conta, a Meta mostra só o total de seguidores do dia/)).toBeVisible()
  await expect(card.getByRole('group', { name: /crescimento de @melhoresdestinos/ })).toBeVisible()
  await expect(card.getByText(/\d ganhos/)).toHaveCount(0)
  const plots = card.locator('.recharts-wrapper')
  await expect(plots).toHaveCount(3)
  await card.scrollIntoViewIfNeeded()
  const posts = (await plots.nth(2).boundingBox())!
  const xOf = (i: number) => posts.x + 42 + 8 / 2 + ((posts.width - 42 - 8) * (i + 0.5)) / g.days.length
  const tip = card.locator('.recharts-tooltip-wrapper').nth(2)
  await page.mouse.move(xOf(6), posts.y + 20)
  await expect(tip).toContainText('Seguidores: —')
  await expect(tip).toContainText('Saldo: —')
  await expect(tip).toContainText('Sem saldo: falta o total de seguidores deste dia ou do anterior.')
  await expect(tip).not.toContainText('Ganhos e perdas')
  await page.mouse.move(xOf(7), posts.y + 20)
  await expect(tip).toContainText('Saldo: —')
  await page.mouse.move(xOf(9), posts.y + 20)
  await expect(tip).toContainText(/Saldo: [+-]\d/)
  await axeClean(page)

  await picker.selectOption('own')
  await expect(card.getByText('Histórico inteiro. O período acima não muda este gráfico.')).toBeVisible()
  await expect(card.getByText(/A Meta só guarda 90 dias/)).toBeVisible()
  await picker.selectOption('c5')
  await expect(card.getByText(/Ainda sem histórico de @shakaguide/)).toBeVisible()
  await expect(card.locator('.recharts-surface')).toHaveCount(0)
})

test('#1064 M9.5: the comparison by market: format and theme side by side, weekday below, fixed order, one bar ruler per table', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await mount(<SocialHarness search="view=competitors" />)
  const card = cardOf(page, 'O que rende em cada mercado')
  const tables = card.locator('[data-market-dimension]')
  await expect(tables).toHaveCount(3)
  const [format, theme, weekday] = await Promise.all([0, 1, 2].map(async (i) => (await tables.nth(i).boundingBox())!))
  expect(Math.round(format.y)).toBe(Math.round(theme.y))
  expect(theme.x).toBeGreaterThan(format.x)
  expect(weekday.y).toBeGreaterThan(format.y + format.height - 1)
  await expect(card.getByRole('heading', { level: 3 })).toHaveText(['Por formato', 'Por tema', 'Por dia da semana'])
  const formatTable = tables.nth(0)
  await expect(formatTable.locator('tbody th')).toHaveText(['Imagem', 'Carrossel', 'Reels'])
  await expect(formatTable.locator('thead th').nth(1)).toContainText('Brasil1 conta')
  // Europa has no account: the whole column is the unknown mark with its reason.
  const eu = formatTable.locator('tbody tr td:nth-of-type(3)')
  await expect(eu).toHaveText(['—', '—', '—'])
  await expect(eu.first()).toHaveAttribute('title', 'Nenhuma conta marcada como Europa.')
  // A group of 2 posts prints no number, the count on the left, and the floor in the title.
  const fewBr = formatTable.locator('tbody tr').first().locator('td').first()
  await expect(fewBr).toContainText('2 posts')
  await expect(fewBr).toContainText('—')
  await expect(fewBr).toHaveAttribute('title', /Menos de 3 posts/)
  // The highest of each column is bold; Reels in Brasil, Carrossel in the US.
  await expect(formatTable.locator('tbody tr').nth(2).locator('td').first().locator('.font-semibold')).toHaveCount(1)
  await expect(formatTable.locator('tbody tr').nth(1).locator('td').nth(1).locator('.font-semibold')).toHaveCount(1)
  const bar = (row: number, col: number) =>
    formatTable.locator('tbody tr').nth(row).locator('td').nth(col).locator('[aria-hidden] > span').evaluate((el) => el.getBoundingClientRect().width)
  expect(await bar(2, 0)).toBeGreaterThan(await bar(1, 0))
  await expect(card.getByText('0,00%')).toHaveCount(0)
  await expect(tables.nth(2).locator('tbody tr').last().locator('td').nth(1)).toHaveAttribute('title', /Sem o total de seguidores/)
  const rowHeights = await formatTable.locator('tbody tr').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
  expect(rowHeights.every((h) => h === 40)).toBe(true)
  await card.screenshot({ path: testInfo.outputPath('social-markets-1440.png') })
})

test('#1064 M9.6: a post at 3.1 times its account median wears the seal and the Ad Library link; at 2.9 it does not; the row stays 40 px', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await mount(<SocialHarness search="view=competitors" />)
  const top = cardOf(page, 'O que rendeu nos concorrentes')
  const rows = top.locator('tbody tr')
  await expect(rows).toHaveCount(10)
  await expect(rows.nth(0).getByText('Fora da curva')).toHaveAttribute('title', /acima de 3 vezes a mediana .* pelo menos 5 posts/)
  const ad = rows.nth(0).getByRole('link', { name: 'Ver os anúncios de @izitravel na Biblioteca de Anúncios da Meta' })
  const href = new URL((await ad.getAttribute('href'))!)
  expect(href.origin + href.pathname).toBe('https://www.facebook.com/ads/library/')
  expect(href.searchParams.get('q')).toBe('izitravel')
  await expect(rows.nth(1).getByText('Fora da curva')).toHaveCount(0)
  await expect(rows.nth(4).getByText('Fora da curva')).toHaveCount(0)
  const h = async (i: number) => Math.round((await rows.nth(i).boundingBox())!.height)
  // The seal does not grow the row: the sealed row is as tall as the one without.
  expect(await h(0)).toBe(await h(1))
  await expect(top.getByText(/Fora da curva: interações por seguidor acima de 3 vezes/)).toBeVisible()
  await axeClean(page)
})

test('#1064 M9.7: at 390 the form stacks, every table scrolls inside its box, nothing leaks, axe clean', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await mount(<SocialHarness search="view=competitors" />)
  await expect(page.locator('[data-market-dimension]')).toHaveCount(3)
  await expect(page.locator('.recharts-surface')).toHaveCount(3)
  const field = (await page.getByLabel('Acompanhar outra conta').boundingBox())!
  const market = (await page.getByLabel('Mercado', { exact: true }).boundingBox())!
  const add = (await page.getByRole('button', { name: 'Adicionar' }).boundingBox())!
  expect(market.y).toBeGreaterThan(field.y + field.height - 1)
  expect(add.y).toBeGreaterThan(market.y + market.height - 1)
  await noLeak(page)
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-competitors-1064-390.png'), fullPage: true })
})

test('#1064 M9.8: the comparison card holds its height within 8 px from loading to data', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  let release: () => void = () => undefined
  const gate = new Promise<void>((r) => (release = r))
  await page.route('**/api/admin/social/markets', async (route) => {
    await gate
    return route.fulfill(json(MARKETS))
  })
  await mount(<SocialHarness search="view=competitors" />)
  const card = cardOf(page, 'O que rende em cada mercado')
  await expect(card.getByRole('status')).toBeVisible()
  const before = (await card.boundingBox())!.height
  release()
  await expect(card.locator('[data-market-dimension]')).toHaveCount(3)
  const after = (await card.boundingBox())!.height
  expect(Math.abs(after - before)).toBeLessThanOrEqual(8)
})
