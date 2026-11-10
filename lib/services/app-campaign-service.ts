/**
 * The coupon a gift campaign gives lives and dies with the campaign (#1192, security review of #1190).
 *
 * A redeemed coupon of days keeps its code visible to whoever redeemed it, so a code that outlives
 * the campaign can be passed around. Two writes on every save of a `redeem_coupon` campaign:
 *
 *   - `valid_until` of the coupon = `ends_at` of the campaign (null with null: then the coupon ends
 *     when the campaign is turned off).
 *   - turned on, the campaign turns its coupon on; turned off (it was on, now it is not), it turns
 *     its coupon off, unless another campaign that is on still gives the same coupon.
 *
 * Not atomic with the campaign write (no transaction across two PostgREST calls, and no migration in
 * this card): the campaign is written first, and a coupon write that fails comes back as
 * `coupon_sync_failed`, so the operator saves again instead of reading a success that did not happen.
 * Server only: runs on the service role after `withAuth` proved an admin.
 */

import type { CampaignWriteFields } from '@/lib/campaigns/app-campaigns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface CampaignCouponState {
  id: string
  is_active: boolean
  ends_at: string | null
  action_type: CampaignWriteFields['action_type']
  coupon_id: string | null
}

export async function syncCampaignCoupon(
  db: Db,
  campaign: CampaignCouponState,
  wasActive: boolean
): Promise<{ ok: true } | { ok: false }> {
  if (campaign.action_type !== 'redeem_coupon' || !campaign.coupon_id) return { ok: true }

  const patch: { valid_until: string | null; is_active?: boolean } = { valid_until: campaign.ends_at }
  if (campaign.is_active) {
    patch.is_active = true
  } else if (wasActive) {
    const { data: others, error: othersError } = await db
      .schema('drive')
      .from('in_app_campaigns')
      .select('id')
      .eq('coupon_id', campaign.coupon_id)
      .eq('is_active', true)
      .neq('id', campaign.id)
      .limit(1)
    if (othersError) {
      console.error('[app-campaigns] coupon sharing lookup failed:', othersError.code)
      return { ok: false }
    }
    if (!others || others.length === 0) patch.is_active = false
  }

  // The effect is the proof: the row must come back, or nothing was written.
  const { data, error } = await db
    .schema('drive')
    .from('coupons')
    .update(patch)
    .eq('id', campaign.coupon_id)
    .select('id')
    .maybeSingle()
  if (error || !data) {
    console.error('[app-campaigns] coupon sync failed:', error?.code ?? 'no row')
    return { ok: false }
  }
  return { ok: true }
}
