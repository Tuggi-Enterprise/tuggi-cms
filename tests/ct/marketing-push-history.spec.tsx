/**
 * THE HISTORY AND THE QUEUE.
 *
 * Two of these assertions are about a number that never existed on the screen and one is about
 * a table the screen never read. The fourth is the one that matters most operationally:
 * cancelling a scheduled campaign must be a STATUS WRITE and never a `DELETE` (CLAUDE.md §3) —
 * the row is the only record that the campaign was ever planned.
 */

import { test, expect } from '@playwright/experimental-ct-react'
import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import ptMessages from '@/messages/pt.json'
import { PushHistoryHarness } from './marketing-push-helpers'

const PUSH = ptMessages.Pages.Notifications

const SENT_LOG = {
  id: 'log-1',
  type: 'broadcast',
  title: 'Uma oferta para você',
  body: 'Toque para ver o que preparamos hoje.',
  data: { type: 'promo_verao_2026', lang: 'pt' },
  user_ids: [],
  status: 'sent',
  sent_at: '2026-09-01T12:00:00Z',
  created_at: '2026-09-01T12:00:00Z',
  success_count: 903,
  failure_count: 21,
  recipient_count: 924,
  audience_filters: { last_platform: 'ios' },
}

/** FCM took some tokens and refused others — neither `sent` nor `failed` says that. */
const PARTIAL_LOG = { ...SENT_LOG, id: 'log-partial', title: 'Metade passou', status: 'partial' }

/** A row logged before the Edge Function learned to persist the counts. */
const LEGACY_LOG = {
  ...SENT_LOG,
  id: 'log-legacy',
  title: 'Campanha antiga',
  success_count: undefined,
  failure_count: undefined,
  recipient_count: undefined,
  audience_filters: null,
}

const PENDING = {
  id: 'sched-1',
  type: 'broadcast',
  title: 'Agendada para amanhã',
  body: 'Corpo da agendada.',
  data: {},
  user_ids: null,
  topic: null,
  priority: 'normal',
  scheduled_for: '2099-01-01T09:00:00Z',
  status: 'pending',
  audience_filters: {},
  created_at: '2026-09-01T12:00:00Z',
}

/** Same row, but its hour has gone by and the cron never took it. */
const OVERDUE = { ...PENDING, id: 'sched-2', title: 'Venceu e ficou', scheduled_for: '2020-01-01T09:00:00Z' }

async function mockHistory(
  page: Page,
  opts: { logs?: unknown[]; queue?: unknown[]; queueStatus?: number; legacyRpc?: boolean } = {}
) {
  await page.route('**/rest/v1/subscription_tiers**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('**/rest/v1/rpc/get_notification_logs', async (route) => {
    const args = JSON.parse(route.request().postData() || '{}')
    // The widened signature is not deployed yet; PostgREST answers PGRST202 for it.
    if (opts.legacyRpc && 'p_offset' in args) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST202', message: 'Could not find the function' }),
      })
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(opts.logs ?? [SENT_LOG]),
    })
  })
  await page.route('**/rest/v1/rpc/get_scheduled_notifications', (route) =>
    route.fulfill({
      status: opts.queueStatus ?? 200,
      contentType: 'application/json',
      body:
        opts.queueStatus && opts.queueStatus >= 400
          ? JSON.stringify({ code: 'PGRST202', message: 'Could not find the function' })
          : JSON.stringify(opts.queue ?? []),
    })
  )
}

test('a sent broadcast shows the FCM counts, the segment as chips, and the caveat', async ({ mount, page }) => {
  await mockHistory(page)
  await mount(<PushHistoryHarness />)

  await expect(page.getByText('903 enviados · 21 falharam')).toBeVisible()
  await expect(page.getByText(PUSH.history.fcm_caveat)).toBeVisible()
  // "All Users" for every broadcast, segmented or not, is what this replaced.
  await expect(page.getByText('Plataforma: Apple iOS')).toBeVisible()
  await expect(page.getByText('promo_verao_2026')).toBeVisible()
})

test('a row logged before the counts existed says so instead of showing a zero', async ({ mount, page }) => {
  await mockHistory(page, { logs: [LEGACY_LOG] })
  await mount(<PushHistoryHarness />)

  await expect(page.getByText(PUSH.history.no_counts)).toBeVisible()
  await expect(page.getByText(PUSH.history.whole_base)).toBeVisible()
})

test('a pass FCM only half accepted is labelled partial, not sent and not failed', async ({ mount, page }) => {
  await mockHistory(page, { logs: [PARTIAL_LOG] })
  await mount(<PushHistoryHarness />)

  await expect(page.getByText(PUSH.history.status.partial, { exact: true })).toBeVisible()
})

test('the queue lists pending items and flags the one the cron did not take', async ({ mount, page }) => {
  await mockHistory(page, { queue: [PENDING, OVERDUE] })
  await mount(<PushHistoryHarness />)

  await expect(page.getByText(PENDING.title)).toBeVisible()
  await expect(page.getByText(OVERDUE.title)).toBeVisible()
  await expect(page.getByText(PUSH.scheduled.overdue)).toHaveCount(1)
})

/** CLAUDE.md §3 — no agent and no screen issues a destructive statement. */
test('cancelling a scheduled campaign writes a status and never a DELETE', async ({ mount, page }) => {
  await mockHistory(page, { queue: [PENDING] })
  const cancels: string[] = []
  const destructive: string[] = []
  await page.route('**/rest/v1/rpc/cancel_scheduled_notification', (route) => {
    cancels.push(route.request().postData() || '')
    return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  })
  page.on('request', (r) => {
    if (r.method() === 'DELETE') destructive.push(r.url())
  })

  await mount(<PushHistoryHarness />)
  await page.getByRole('button', { name: PUSH.scheduled.cancel }).click()

  await expect(page.getByText(PUSH.scheduled.cancelled)).toBeVisible()
  await expect(page.getByText(PENDING.title)).toBeHidden()
  expect(cancels).toHaveLength(1)
  expect(JSON.parse(cancels[0]).p_id).toBe(PENDING.id)
  expect(destructive).toEqual([])
})

/** The queue's RPC is not deployed yet. Its absence is a band in one section, not a dead screen. */
test('a missing queue RPC degrades to a band and leaves the history readable', async ({ mount, page }) => {
  await mockHistory(page, { queueStatus: 404 })
  await mount(<PushHistoryHarness />)

  await expect(page.getByRole('alert')).toContainText('Could not find the function')
  await expect(page.getByText(SENT_LOG.title)).toBeVisible()
})

/** The search and the page are the database's; the browser-side filter over 50 rows is gone. */
test('search and paging are arguments to the RPC, not a filter over the loaded page', async ({ mount, page }) => {
  const calls: any[] = []
  await page.route('**/rest/v1/subscription_tiers**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('**/rest/v1/rpc/get_scheduled_notifications', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('**/rest/v1/rpc/get_notification_logs', (route) => {
    calls.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(Array.from({ length: 25 }, (_, i) => ({ ...SENT_LOG, id: `log-${i}` }))),
    })
  })

  await mount(<PushHistoryHarness />)
  await expect.poll(() => calls.length).toBeGreaterThan(0)

  await page.getByRole('searchbox').fill('verao')
  await expect.poll(() => calls.some((c) => c.p_search === 'verao')).toBe(true)

  await page.getByRole('button', { name: PUSH.history.next }).click()
  await expect.poll(() => calls.some((c) => c.p_offset === 25)).toBe(true)
})

/** The widened RPC is a dependency, so the screen still works against the old one. */
test('the history falls back to the one-argument RPC while the migration is not deployed', async ({ mount, page }) => {
  await mockHistory(page, { legacyRpc: true })
  await mount(<PushHistoryHarness />)

  await expect(page.getByText(SENT_LOG.title)).toBeVisible()
})

test('mounted in pt, none of the old English literals survive in the history', async ({ mount, page }) => {
  await mockHistory(page, { queue: [PENDING] })
  await mount(<PushHistoryHarness />)

  const text = await page.evaluate(() => document.body.innerText)
  for (const literal of [
    'All Users',
    'No history found',
    'Search history',
    'Track all previously sent notifications',
    'Recipients',
    'Payload',
    'Keys',
    'Clients',
  ]) {
    expect(text, `English literal still on screen: ${literal}`).not.toContain(literal)
  }
})

test('axe-core reports no critical violation on the history', async ({ mount, page }) => {
  await mockHistory(page, { queue: [PENDING, OVERDUE] })
  await mount(<PushHistoryHarness />)
  await expect(page.getByText(SENT_LOG.title)).toBeVisible()

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()

  expect(results.violations.filter((v) => v.impact === 'critical').map((v) => v.id)).toEqual([])
})
