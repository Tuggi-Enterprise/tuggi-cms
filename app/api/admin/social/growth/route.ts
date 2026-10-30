/**
 * `GET /api/admin/social/growth?account=<uuid>` (#1064, spec M8 item 2): the growth chart of any
 * active account, ours or a competitor's, as `readAccountGrowth` builds it. A malformed id is 400; an
 * id that is not an active account is 404. Admin only; the reads run on the operator's session.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { readAccountGrowth, socialFailure } from '@/lib/social/repository'
import { UUID } from '@/lib/finance/input'

export const GET = withAuth({ roles: ['admin'] }, async (req, _ctx, { supabase }) => {
  const id = new URL(req.url).searchParams.get('account') ?? ''
  if (!UUID.test(id)) return NextResponse.json({ error: { code: 'invalid_account' } }, { status: 400 })
  try {
    const growth = await readAccountGrowth(supabase, id)
    if (!growth) return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 })
    return NextResponse.json(growth)
  } catch (err) {
    return socialFailure('growth', err)
  }
})
