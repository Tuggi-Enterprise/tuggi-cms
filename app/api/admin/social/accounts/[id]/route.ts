/**
 * `PATCH /api/admin/social/accounts/{id}` (#1059, #1064), admin only, on the operator's session (RLS
 * of `social.watched_accounts`). The body is exactly one of:
 *
 * - `{ "active": false }`: stops collecting a competitor. Never DELETE (the cascade would take
 *   `account_daily` and `media` with it), never our own account. Answers `{ ok: true }`.
 * - `{ "market": "BR" | "US" | "EU" | null }`: marks the market of an active competitor and answers
 *   the row. Our own account never gets a market (400 `own_account`); an id that is not an active
 *   account is 404.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { deactivateAccount, setAccountMarket, socialFailure } from '@/lib/social/repository'
import { isMarket } from '@/lib/social/labels'
import { UUID } from '@/lib/finance/input'

interface AccountParams {
  [key: string]: string | string[] | undefined
  id: string
}

export const PATCH = withAuth<AccountParams>({ roles: ['admin'] }, async (req, ctx, { supabase }) => {
  const params = ctx?.params ? await ctx.params : undefined
  const id = typeof params?.id === 'string' ? params.id : ''
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const keys = body && typeof body === 'object' ? Object.keys(body) : []
  const deactivate = keys.length === 1 && body?.active === false
  const market = keys.length === 1 && keys[0] === 'market' && (body?.market === null || isMarket(body?.market))
  if (!UUID.test(id) || (!deactivate && !market)) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 })
  }
  try {
    if (market) {
      const outcome = await setAccountMarket(supabase, id, isMarket(body?.market) ? body.market : null)
      if (outcome.kind === 'own_account') return NextResponse.json({ error: { code: 'own_account' } }, { status: 400 })
      if (outcome.kind === 'not_found') return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 })
      return NextResponse.json({ account: outcome.account })
    }
    const done = await deactivateAccount(supabase, id)
    if (!done) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return socialFailure(market ? 'set_market' : 'deactivate', err)
  }
})
