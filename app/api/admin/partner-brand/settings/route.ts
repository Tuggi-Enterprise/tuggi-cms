/**
 * `GET /api/admin/partner-brand/settings` (#1257) → `{ term_days, switches, packages }`: the brand
 * term in days (`partner_brand.days`, BR-B2B-070 item 7), the three switches of the product
 * (BR-B2B-070 item 4 and the gift per platform) and the gift packages with their price (item 9).
 *
 * Read only. The writes belong to the routes that already own them: the term to
 * `PATCH /api/admin/reward-settings` (`drive.set_reward_setting`), a switch to
 * `PATCH /api/admin/trip-reminder/switches` (`drive.cms_set_feature_switch`), a price to
 * `PATCH /api/admin/partner-brand/packages`.
 * Gate: `withAuth({ roles: ['admin'] })`, then the service role.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { readBrandSettings } from '@/lib/services/partner-brand-service'
import { partnerBrandErrorStatus } from '@/lib/partner-brand/brand'

export const GET = withAuth({ roles: ['admin'] }, async () => {
  const read = await readBrandSettings(getSupabaseService())
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: partnerBrandErrorStatus(read.error) })
  return NextResponse.json(read.value, { headers: { 'Cache-Control': 'no-store' } })
})
