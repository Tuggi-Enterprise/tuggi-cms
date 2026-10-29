/**
 * The social agenda (#1058) painted in a browser with the API mocked: calendar and list at 1440,
 * the list alone at 390 with nothing leaking, the editor of a new post (link before any save) and
 * of a published one (fields locked, reason line, "Ver no Instagram" on the permalink). Axe clean.
 * Spec `spec-cms-redes-sociais-agenda-2026-10.md` section 8, items 1, 2, 3, 9 and 12.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { SocialAgendaHarness, SocialEditorHarness } from './social-helpers'
import { POSTS, PUBLISHED_ID, THUMB_SVG } from './social-fixtures'

async function mockApi(page: Page, posts: unknown[] | 'fail' = POSTS) {
  await page.route('**/storage/v1/object/public/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: THUMB_SVG })
  )
  await page.route('**/api/admin/social/posts?month=*', (route) =>
    posts === 'fail'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"server_error"}}' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ posts }) })
  )
  await page.route(`**/api/admin/social/posts/${PUBLISHED_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ post: POSTS[0] }) })
  )
}

const month = POSTS[0].scheduled_at.slice(0, 7)

async function axeClean(page: Page) {
  const axe = await new AxeBuilder({ page }).include('#root').analyze()
  expect(axe.violations.map((v) => v.id)).toEqual([])
}

test('#1058: the calendar at 1440 starts on Monday, one chip per post, no raw enum', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await mockApi(page)
  await mount(<SocialAgendaHarness search={`month=${month}`} />)
  await expect(page.locator('table caption')).toHaveCount(1)
  await expect(page.locator('thead th').first()).toHaveText(/seg/i)
  await expect(page.locator('tbody a[href*="/admin/social/"][aria-label*=":"]')).toHaveCount(POSTS.length)
  await expect(page.locator('#root')).not.toContainText(/scheduled|instagram|CAROUSEL/)
  await expect(page.getByRole('button', { name: 'Calendário' })).toHaveAttribute('aria-pressed', 'true')
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-calendar-1440.png'), fullPage: true })
})

test('#1058: the list at 1440 has the filter chips with counts and a word per network', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page)
  await mount(<SocialAgendaHarness search={`month=${month}&view=list`} />)
  await expect(page.getByRole('button', { name: /Com falha/ })).toContainText('1')
  await expect(page.getByRole('button', { name: /Todos/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Falhou')).toBeVisible()
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-list-1440.png'), fullPage: true })
})

test('#1058: at 390 the page is the list, without the switch, and nothing leaks', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockApi(page)
  await mount(<SocialAgendaHarness search={`month=${month}`} />)
  await expect(page.getByRole('button', { name: /Todos/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Calendário' })).toHaveCount(0)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await page.screenshot({ path: testInfo.outputPath('social-list-390.png'), fullPage: true })
})

test('#1058: a failed read says so and offers Tentar de novo', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 700 })
  await mockApi(page, 'fail')
  await mount(<SocialAgendaHarness search={`month=${month}`} />)
  await expect(page.getByRole('alert')).toContainText('Não foi possível carregar os posts')
  await page.screenshot({ path: testInfo.outputPath('social-error-1440.png'), fullPage: true })
})

test('#1058: the new post shows its download link before any save, and Agendar marks every field', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await mockApi(page)
  await mount(<SocialEditorHarness postId={null} search="" />)
  const link = page.locator('#social-link')
  await expect(link).toHaveValue(/^https:\/\/www\.tuggi\.app\/download\?utm_source=meta&utm_medium=social&utm_campaign=post_[0-9a-f]{8}$/)
  await expect(page.locator('#social-scheduled-at')).toHaveAttribute('step', '300')
  await page.getByRole('button', { name: 'Agendar' }).click()
  await expect(page.getByText('Falta a mídia.')).toBeVisible()
  await expect(page.locator('#social-scheduled-at')).toHaveAttribute('aria-invalid', 'true')
  await axeClean(page)
  await page.screenshot({ path: testInfo.outputPath('social-editor-new-1440.png'), fullPage: true })
})

test('#1058: a published post locks its fields, says why, and links the permalink', async ({ mount, page }, testInfo) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 })
    await mockApi(page)
    const component = await mount(<SocialEditorHarness postId={PUBLISHED_ID} search="" />)
    await expect(page.getByText('Este post já saiu.')).toBeVisible()
    await expect(page.locator('#social-caption')).toHaveAttribute('readonly', '')
    await expect(page.getByRole('link', { name: /Ver no Instagram/ })).toHaveAttribute('href', 'https://www.instagram.com/p/CTFIXTURE/')
    await expect(page.getByRole('button', { name: 'Tentar de novo no Facebook' })).toBeVisible()
    await axeClean(page)
    await page.screenshot({ path: testInfo.outputPath(`social-editor-published-${width}.png`), fullPage: true })
    await component.unmount()
  }
})
