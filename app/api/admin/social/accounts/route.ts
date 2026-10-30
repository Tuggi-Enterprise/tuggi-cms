/**
 * `/api/admin/social/accounts` (#1059), admin only, on the operator's session (RLS of `social.*`).
 *
 * `GET`  the active accounts with the last followers, growth over 7 and 30 days, the engagement of
 *        `social.account_engagement` and the format mix of the last 30 days.
 * `POST { username, market? }` normalizes (trim, no `@`, lowercase), refuses a bad username, our own account
 *        and an active duplicate BEFORE the Meta, then checks Business Discovery through
 *        `social-collect` and inserts, or reactivates a removed account (its history comes back).
 *        No DELETE exists: removing is `PATCH accounts/{id}` with `active: false`. `market` (#1064) is
 *        'BR', 'US', 'EU' or null (the default); any other value is 400 before anything is read.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { addAccount, readAccounts, socialFailure } from '@/lib/social/repository'
import { USERNAME_PATTERN, isMarket, normalizeUsername } from '@/lib/social/labels'

export const GET = withAuth({ roles: ['admin'] }, async (_req, _ctx, { supabase }) => {
  try {
    return NextResponse.json(await readAccounts(supabase))
  } catch (err) {
    return socialFailure('accounts', err)
  }
})

export const POST = withAuth({ roles: ['admin'] }, async (req, _ctx, { supabase }) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const username = normalizeUsername(body?.username)
  if (!USERNAME_PATTERN.test(username)) {
    return NextResponse.json({ error: { code: 'invalid' } }, { status: 400 })
  }
  const market = body?.market ?? null
  if (market !== null && !isMarket(market)) {
    return NextResponse.json({ error: { code: 'invalid_market' } }, { status: 400 })
  }
  try {
    const outcome = await addAccount(supabase, username, market)
    if (outcome.kind === 'refused') {
      return NextResponse.json({ error: { code: outcome.code, id: outcome.id } }, { status: outcome.status })
    }
    return NextResponse.json({ account: outcome.account })
  } catch (err) {
    return socialFailure('add_account', err)
  }
})
