/**
 * `PATCH /api/admin/social/accounts/{id}` with exactly `{ "active": false }` (#1059): stops collecting
 * a competitor. Never DELETE (the cascade would take `account_daily` and `media` with it), never our
 * own account. Admin only, on the operator's session (RLS of `social.watched_accounts`).
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { deactivateAccount, socialFailure } from '@/lib/social/repository'
import { UUID } from '@/lib/finance/input'

interface AccountParams {
  [key: string]: string | string[] | undefined
  id: string
}

export const PATCH = withAuth<AccountParams>({ roles: ['admin'] }, async (req, ctx, { supabase }) => {
  const params = ctx?.params ? await ctx.params : undefined
  const id = typeof params?.id === 'string' ? params.id : ''
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!UUID.test(id) || !body || Object.keys(body).length !== 1 || body.active !== false) {
    return NextResponse.json({ error: { code: 'invalid_body' } }, { status: 400 })
  }
  try {
    const done = await deactivateAccount(supabase, id)
    if (!done) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return socialFailure('deactivate', err)
  }
})
