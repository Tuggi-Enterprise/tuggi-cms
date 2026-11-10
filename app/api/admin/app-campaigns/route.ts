/**
 * The CMS door to the campaigns of the app (#1192; contract `docs/contracts/banco-para-cms.md`, Parte 29).
 *
 * `GET`  every campaign, `priority desc, created_at desc` (the app's order), with its coupon.
 * `POST` creates one; a gift campaign also ties its coupon to it (`syncCampaignCoupon`).
 *
 * `withAuth({ roles: ['admin'] })` is the whole gate (`/api/*` is outside the proxy matcher), then
 * the service role, as `drive.coupons` is written. The table's CHECKs are the judge; a refusal comes
 * back as a code that `messages/*.json` (`AppCampaigns.errors`) turns into a sentence.
 * Logs carry the SQLSTATE only.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  CAMPAIGN_SELECT,
  campaignErrorStatus,
  classifyCampaignWriteError,
  parseCampaignInput,
  type CampaignError,
} from '@/lib/campaigns/app-campaigns'
import { syncCampaignCoupon } from '@/lib/services/app-campaign-service'

/** A handful of rows by design (D8 of the migration); the cap only keeps a runaway list bounded. */
const LIST_LIMIT = 200

function refuse(error: CampaignError): NextResponse {
  return NextResponse.json({ error }, { status: campaignErrorStatus(error) })
}

export const GET = withAuth({ roles: ['admin'] }, async () => {
  const { data, error } = await getSupabaseService()
    .schema('drive')
    .from('in_app_campaigns')
    .select(CAMPAIGN_SELECT)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (error) {
    console.error('[app-campaigns] list refused:', error.code)
    return refuse({ code: 'write_failed' })
  }
  return NextResponse.json({ campaigns: data ?? [] })
})

export const POST = withAuth({ roles: ['admin'] }, async (req) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }
  const parsed = parseCampaignInput(body)
  if (!parsed.ok) return refuse(parsed.error)

  const db = getSupabaseService()
  const { data, error } = await db
    .schema('drive')
    .from('in_app_campaigns')
    .insert(parsed.fields)
    .select(CAMPAIGN_SELECT)
    .single()
  if (error || !data) {
    console.error('[app-campaigns] create refused:', error?.code ?? 'no row')
    return refuse(error ? classifyCampaignWriteError(error) : { code: 'write_failed' })
  }

  const sync = await syncCampaignCoupon(db, data, false)
  if (!sync.ok) return NextResponse.json({ error: { code: 'coupon_sync_failed' }, campaign: data }, { status: 500 })
  return NextResponse.json({ campaign: data }, { status: 201 })
})
