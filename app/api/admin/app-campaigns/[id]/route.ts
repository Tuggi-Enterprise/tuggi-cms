/**
 * `PATCH /api/admin/app-campaigns/:id` (#1192): edit a campaign, or only turn it on or off.
 *
 * Body `{ is_active }` alone is the switch of the list; any other body is the whole form, parsed
 * like the `POST`. Either way the coupon of a gift campaign follows (`syncCampaignCoupon`): it reads
 * the row before writing to know the coupon the campaign gave until now, which is turned off when
 * the save takes it out of the campaign.
 * Gate: `withAuth({ roles: ['admin'] })`, then the service role. Logs carry the SQLSTATE only.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  CAMPAIGN_SELECT,
  campaignErrorStatus,
  classifyCampaignWriteError,
  isUuid,
  parseCampaignInput,
  type CampaignError,
} from '@/lib/campaigns/app-campaigns'
import { syncCampaignCoupon } from '@/lib/services/app-campaign-service'

function refuse(error: CampaignError): NextResponse {
  return NextResponse.json({ error }, { status: campaignErrorStatus(error) })
}

export const PATCH = withAuth<{ id: string }>({ roles: ['admin'] }, async (req, ctx) => {
  const params = ctx.params ? await ctx.params : undefined
  const id = params?.id
  if (!isUuid(id)) return refuse({ code: 'not_found' })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse({ code: 'invalid_body' })

  const keys = Object.keys(body)
  let update: Record<string, unknown>
  if (keys.length === 1 && keys[0] === 'is_active') {
    const isActive = (body as { is_active: unknown }).is_active
    if (typeof isActive !== 'boolean') return refuse({ code: 'invalid_body' })
    update = { is_active: isActive }
  } else {
    const parsed = parseCampaignInput(body)
    if (!parsed.ok) return refuse(parsed.error)
    update = { ...parsed.fields }
  }

  const db = getSupabaseService()
  const { data: before, error: readError } = await db
    .schema('drive')
    .from('in_app_campaigns')
    .select('id, action_type, coupon_id')
    .eq('id', id)
    .maybeSingle()
  if (readError) {
    console.error('[app-campaigns] read before update refused:', readError.code)
    return refuse({ code: 'write_failed' })
  }
  if (!before) return refuse({ code: 'not_found' })

  const { data, error } = await db
    .schema('drive')
    .from('in_app_campaigns')
    .update(update)
    .eq('id', id)
    .select(CAMPAIGN_SELECT)
    .maybeSingle()
  if (error) {
    console.error('[app-campaigns] update refused:', error.code)
    return refuse(classifyCampaignWriteError(error))
  }
  if (!data) return refuse({ code: 'not_found' })

  const sync = await syncCampaignCoupon(db, data, before)
  if (!sync.ok) return NextResponse.json({ error: { code: 'coupon_sync_failed' }, campaign: data }, { status: 500 })
  return NextResponse.json({ campaign: data })
})
