/**
 * The CMS door to `drive.reward_settings` — card #855 (values created by #854).
 *
 * `GET`   lists every key with its value and unit.
 * `PATCH` changes ONE value through `drive.set_reward_setting(p_key, p_value)`, the only write
 *         of the table. Nothing here writes the table directly: it is closed to every client
 *         role, `service_role` included.
 *
 * The write runs on the OPERATOR's cookie-bound client, not the service one — the same reason
 * as `app/api/admin/users/[userId]/credit/route.ts`: the RPC records `updated_by = auth.uid()`,
 * which is `NULL` under `service_role`, and its gate `core.is_caller_platform_admin()` accepts
 * the JWT of an active `cms_users` admin.
 *
 * The read is two RPCs because no single one serves the CMS everything:
 * - `drive.get_reward_settings()` (operator JWT): value + unit, minus `podium.*` (#854 finding D);
 * - `drive.reward_settings_map()` (service, EXECUTE is `service_role` only): value of every key,
 *   `podium.*` included. It runs only after `withAuth` proved an admin.
 *
 * Values apply to FUTURE grants only: the ledger stores minutes and `expires_at` at grant time.
 * `/api/*` is outside the proxy matcher, so `withAuth` is the whole gate.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  REWARD_KEY_RE,
  classifyRewardSettingError,
  mergeRewardReads,
  rewardSettingErrorStatus,
  type RewardSettingError,
} from '@/lib/rewards/settings'

function refuse(error: RewardSettingError): NextResponse {
  return NextResponse.json({ error }, { status: rewardSettingErrorStatus(error) })
}

export const GET = withAuth({ roles: ['admin'] }, async (_req, _ctx, auth) => {
  const [appRead, fullMap] = await Promise.all([
    auth.supabase.schema('drive').rpc('get_reward_settings'),
    getSupabaseService().schema('drive').rpc('reward_settings_map'),
  ])

  if (appRead.error || fullMap.error) {
    // SQLSTATE only: no message, no operator in Vercel logs.
    console.error(
      '[reward-settings] read refused:',
      appRead.error?.code ?? '-',
      fullMap.error?.code ?? '-'
    )
    return refuse(classifyRewardSettingError(appRead.error ?? fullMap.error))
  }

  return NextResponse.json(mergeRewardReads(appRead.data, fullMap.data))
})

export const PATCH = withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return refuse({ code: 'invalid_body' })
  }

  const key = body?.key
  const value = body?.value
  if (typeof key !== 'string' || key.length > 120 || !REWARD_KEY_RE.test(key)) {
    return refuse({ code: 'invalid_body' })
  }
  // Range is the database's (reward_settings_value_ck + the per-act cap). Here only the shape.
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return refuse({ code: 'invalid_body' })
  }

  const { data, error } = await auth.supabase
    .schema('drive')
    .rpc('set_reward_setting', { p_key: key, p_value: value })

  if (error) {
    console.error('[reward-settings] write refused:', error.code)
    return refuse(classifyRewardSettingError(error))
  }

  return NextResponse.json(data)
})
