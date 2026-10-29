/**
 * #1059: `/admin/social` painted in Chromium with the API mocked. The three views at 1440 and 390
 * (spec section 8 items 1, 2, 4 to 11), axe clean, nothing leaking at 390, no raw enum on screen.
 * The captures go to the test output folder (`social-*.png`).
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { SocialHarness } from './social-helpers'
import { ACCOUNTS, OVERVIEW, OVERVIEW_SPARSE, POSTS } from './social-fixtures'

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mockApi(page: Page, overview: unknown = OVERVIEW) {
  const seen: string[] = []
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
      const { username } = route.request().postDataJSON() as { username: string }
      if (username === 'izitravel') return route.fulfill(json({ error: { code: 'duplicate', id: 'c1' } }, 409))
      return route.fulfill(json({ error: { code: 'not_found' } }, 422))
    }
    return route.fulfill(json(ACCOUNTS))
  })
  await page.route('**/api/admin/social/accounts/*', (route) => route.fulfill(json({ ok: true })))
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

const RAW = /CAROUSEL_ALBUM|REELS|IMAGE|VIDEO|Pages\.Social|\bpending\b/

async function noLeak(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test('#1059: the overview at 1440 has three numbered recommendations, four rankings and five funnel strips', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const seen = await mockApi(page)
  await mount(<SocialHarness search="" />)
  await expect(page.getByRole('heading', { level: 1, name: 'Redes sociais' })).toBeVisible()
  await expect(page.locator('ol > li')).toHaveCount(3)
  await expect(page.getByText('Modelo: gemini-2.5-flash-lite.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Visão geral/ })).toHaveAttribute('aria-pressed', 'true')
  // The floor: Imagem has 2 posts, so it is last, with no number and no bar.
  const format = page.getByRole('heading', { name: 'Por formato' }).locator('xpath=ancestor::section[1]')
  await expect(format.locator('li').last()).toContainText('Imagem')
  await expect(format.locator('li').last()).toContainText('Poucos posts (2)')
  await expect(format.locator('li').first()).toContainText('7,2%')
  await expect(page.getByText('Visitas ao perfil', { exact: true })).toBeVisible()
  await expect(page.locator('.recharts-responsive-container')).toHaveCount(5)
  await expect(page.locator('#root')).not.toContainText(RAW)
  expect(seen.filter((u) => u.includes('/posts') || u.includes('/accounts'))).toEqual([])
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-overview-1440.png'), fullPage: true })
})

test('#1059: at 390 the overview tabs fit, the icons go and nothing leaks', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await mount(<SocialHarness search="" />)
  await expect(page.locator('ol > li')).toHaveCount(3)
  await expect(page.getByRole('button', { name: /Nossos posts/ }).locator('svg')).toBeHidden()
  await expect(page.locator('.recharts-responsive-container')).toHaveCount(5)
  await settle(page)
  await noLeak(page)
  await page.screenshot({ path: testInfo.outputPath('social-overview-390.png'), fullPage: true })
})

test('#1059: our posts at 1440 sort by reach with aria-sort, filter by format, and print "sem dado" for a null', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const seen = await mockApi(page)
  await mount(<SocialHarness search="view=posts" />)
  await expect(page.locator('tbody tr')).toHaveCount(POSTS.posts.length)
  expect(seen.some((u) => u.includes('/overview'))).toBe(false)
  await expect(page.locator('thead th')).toHaveCount(12)
  const reach = page.locator('th', { hasText: 'Alcance' })
  await reach.getByRole('button').click()
  await expect(reach).toHaveAttribute('aria-sort', 'descending')
  await expect(page.locator('tbody tr').first().locator('td').nth(4)).toHaveText(/2\.581/)
  await reach.getByRole('button').click()
  await expect(reach).toHaveAttribute('aria-sort', 'ascending')
  await expect(page.locator('tbody td', { hasText: 'sem dado' }).first()).toHaveAttribute('class', /text-right/)
  await expect(page.locator('tbody tr').nth(0).locator('a[target="_blank"]')).toHaveAttribute('href', /instagram\.com\/p\/fixture/)
  await page.getByRole('button', { name: /^Reels/ }).click()
  await expect(page.locator('tbody tr')).toHaveCount(5)
  await page.getByRole('button', { name: /^Todos/ }).click()
  await expect(page.locator('#root')).not.toContainText(RAW)
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-posts-1440.png'), fullPage: true })
})

test('#1059: at 390 the posts table scrolls inside its box and the page does not', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await mount(<SocialHarness search="view=posts" />)
  await expect(page.locator('tbody tr')).toHaveCount(POSTS.posts.length)
  await noLeak(page)
  await page.screenshot({ path: testInfo.outputPath('social-posts-390.png'), fullPage: true })
})

test('#1059: competitors at 1440 put our account first, marked by a word and with no remove button', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await mount(<SocialHarness search="view=competitors" />)
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(ACCOUNTS.accounts.length)
  await expect(rows.first()).toContainText('@tuggi_app')
  await expect(rows.first()).toContainText('Nossa conta')
  await expect(rows.first().getByRole('button', { name: /Remover/ })).toHaveCount(0)
  await expect(rows.nth(1)).toContainText('@melhoresdestinos')
  // Not enough days: the cell says so, with no "+0".
  const shaka = page.locator('tr[data-account="shakaguide"]')
  await expect(shaka.locator('td').nth(2)).toHaveText('sem dado')
  // A failed collection is amber with its glyph.
  await expect(page.locator('tr[data-account="autioapp"] td').nth(8).locator('svg')).toBeVisible()
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-competitors-1440.png'), fullPage: true })
})

test('#1059: adding refuses a bad @ before any call, a duplicate on the field, and removing asks first', async ({ mount, page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const seen = await mockApi(page)
  await mount(<SocialHarness search="view=competitors" />)
  await expect(page.locator('tbody tr')).toHaveCount(ACCOUNTS.accounts.length)
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
  await expect(page.locator('tr[data-account="izitravel"]')).toHaveClass(/bg-primary-800\/5/)
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
  await expect(page.locator('tbody tr')).toHaveCount(ACCOUNTS.accounts.length)
  await noLeak(page)
  await page.screenshot({ path: testInfo.outputPath('social-competitors-390.png'), fullPage: true })
})

test('#1059: the funnel with the first production collection keeps every bar inside its own strip (DS-COMPONENTE-084)', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page, OVERVIEW_SPARSE)
  await mount(<SocialHarness search="" />)
  await expect(page.locator('.recharts-responsive-container')).toHaveCount(5)
  await settle(page)
  // Every bar of a strip stays inside that strip's own box: no bar crosses into the next strip.
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
  const card = page.getByRole('heading', { name: 'Do Instagram ao app' }).locator('xpath=ancestor::section[1]')
  await card.screenshot({ path: testInfo.outputPath('social-funnel-sparse-1440.png') })
})

test('#1059: the funnel with 28 full days, both periods measured, prints totals and changes (DS-COMPONENTE-084)', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await mount(<SocialHarness search="" />)
  await expect(page.locator('.recharts-responsive-container')).toHaveCount(5)
  await settle(page)
  await expect(page.locator('[data-strip="profile_views"]')).not.toContainText(' de 28 dias')
  await expect(page.locator('[data-strip="profile_views"] .text-green-700, [data-strip="profile_views"] .text-red-700')).toHaveCount(1)
  const card = page.getByRole('heading', { name: 'Do Instagram ao app' }).locator('xpath=ancestor::section[1]')
  await card.screenshot({ path: testInfo.outputPath('social-funnel-full-1440.png') })
})
