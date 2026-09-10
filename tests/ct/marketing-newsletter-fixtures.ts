/**
 * Every request the newsletter screen makes, intercepted, plus the copy the assertions read.
 *
 * The counters come back from `mockAll` so a test can assert on the SHAPE of the traffic —
 * "exactly one POST" is the entire point of the double-schedule test, and a boolean "was it
 * called" would have gone green on the defect.
 */

import type { Page, Route } from '@playwright/test'
import ptMessages from '@/messages/pt.json'

export const AUDIENCE = ptMessages.Pages.Marketing.Audience
export const NEWSLETTER = ptMessages.Pages.Marketing.Newsletter

/** The two tiers the audience picker offers, as `drive.subscription_tiers` returns them. */
export const TIERS = [
  { id: '19ed18ca-c285-4d60-85cd-7e6b4810aa44', name: 'free', display_name: 'Free' },
  { id: 'b2c3d4e5-1111-2222-3333-444455556666', name: 'premium', display_name: 'Premium' },
]

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** One campaign already scheduled, so the history has something to cancel. */
export const SCHEDULED_CAMPAIGN = {
  id: 'campaign-scheduled',
  name: 'Novidades de outubro',
  default_language: 'pt',
  content: { pt: { subject: 'Oi', blocks: [] } },
  audience_filters: {},
  status: 'scheduled',
  scheduled_for: '2030-01-01T13:00:00.000Z',
  sent_at: null,
  created_by: null,
  metadata: {},
  created_at: '2026-09-01T10:00:00.000Z',
  updated_at: '2026-09-01T10:00:00.000Z',
}

export interface MockOptions {
  /** Rows `GET /api/admin/marketing/campaigns` answers with. */
  campaigns?: unknown[]
  /** The number `estimate_newsletter_audience` answers. */
  estimate?: number
  /** When set, the RPC answers this PostgREST error instead of a number. */
  estimateError?: { status: number; body: Record<string, unknown> }
}

export async function mockAll(page: Page, options: MockOptions = {}) {
  const calls = {
    campaignPost: 0,
    campaignPatch: 0,
    campaignDelete: 0,
    send: 0,
    schedule: 0,
    estimate: 0,
    patchBodies: [] as any[],
  }

  // `useCmsUser` — an admin, so `canEdit` is true and no button is disabled for a reason this
  // suite is not testing.
  await page.route('**/api/auth/check', (route) =>
    json(route, { user: { role: 'admin', enabledModules: ['marketing'] } })
  )

  await page.route('**/rest/v1/rpc/estimate_newsletter_audience', (route) => {
    calls.estimate += 1
    if (options.estimateError) {
      return json(route, options.estimateError.body, options.estimateError.status)
    }
    return json(route, options.estimate ?? 12873)
  })

  await page.route('**/rest/v1/subscription_tiers**', (route) => json(route, TIERS))

  await page.route('**/api/admin/marketing/campaigns', (route) => {
    if (route.request().method() === 'POST') {
      calls.campaignPost += 1
      return json(route, { success: true, campaign: { id: 'campaign-1', status: 'draft' } })
    }
    return json(route, { success: true, campaigns: options.campaigns ?? [] })
  })

  await page.route('**/api/admin/marketing/campaigns/*', (route) => {
    const method = route.request().method()
    if (method === 'PATCH') {
      calls.campaignPatch += 1
      const body = route.request().postDataJSON()
      calls.patchBodies.push(body)
      // The route echoes the row back with the patch applied, which is what the real one does
      // for a field on its allowlist — and what `cancelCampaign` verifies before saying it
      // worked.
      return json(route, { success: true, campaign: { ...SCHEDULED_CAMPAIGN, ...body } })
    }
    if (method === 'DELETE') {
      // Counted so a test can prove the cancel is a STATUS and never a `DELETE` (CLAUDE.md §3).
      calls.campaignDelete += 1
      return json(route, { success: true })
    }
    return json(route, { success: true, campaign: SCHEDULED_CAMPAIGN, stats: {} })
  })

  await page.route('**/functions/v1/send-newsletter/send', (route) => {
    calls.send += 1
    return json(route, { sent: 12873 })
  })
  await page.route('**/functions/v1/send-newsletter/schedule', (route) => {
    calls.schedule += 1
    return json(route, { ok: true })
  })

  return calls
}
