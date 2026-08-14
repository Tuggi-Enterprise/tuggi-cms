/**
 * Creates the invite link of the partner form (#341) and sends it.
 *
 * Authenticated, admin only: this is the act that mints a credential for an outside
 * person, so it is exactly the opposite of the surface it opens. The raw token exists
 * once, here, in the response and in the e-mail; the database only ever holds its hash.
 *
 * The URL is always built with the `/pt/` segment. `i18n.ts` falls back to `en` for a
 * missing or invalid locale, so a link without the segment would hand an English form to
 * a Brazilian restaurant owner — and the two documents this form asks for (CNPJ, alvará)
 * are Brazilian by definition.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { createInvite, INVITE_TTL_DAYS } from '@/lib/services/partner-proposal-service'
import { PARTNER_FORM_LOCALE, buildPartnerFormUrl } from '@/lib/partner-form/link'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const POST = withRateLimit(20, 60_000)(
  withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const recipientEmail = String(body.recipientEmail ?? '').trim()
    if (!EMAIL_PATTERN.test(recipientEmail)) {
      return NextResponse.json({ error: 'invalid_recipient_email' }, { status: 400 })
    }

    const ttlDays = Number.isFinite(Number(body.ttlDays)) && Number(body.ttlDays) > 0
      ? Math.min(Number(body.ttlDays), 60)
      : INVITE_TTL_DAYS

    const created = await createInvite({
      clientId: typeof body.clientId === 'string' ? body.clientId : null,
      recipientEmail,
      recipientName: typeof body.recipientName === 'string' ? body.recipientName : null,
      tradeName: typeof body.tradeName === 'string' ? body.tradeName : null,
      createdBy: auth.user.id,
      ttlDays,
    })

    if (!created.ok || !created.token) {
      console.error('[partner-invites] could not create the invite')
      return NextResponse.json({ error: 'invite_not_created' }, { status: 503 })
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin
    const url = buildPartnerFormUrl(origin, created.token)

    const emailed = await sendInviteEmail({
      to: recipientEmail,
      name: typeof body.recipientName === 'string' ? body.recipientName : '',
      tradeName: typeof body.tradeName === 'string' ? body.tradeName : '',
      url,
    })

    // The link is returned either way: an e-mail that did not go out must not cost the
    // operator the invite they just minted — there is no second chance at the raw token.
    return NextResponse.json({
      inviteId: created.inviteId,
      expiresAt: created.expiresAt,
      url,
      emailed,
    })
  })
)

async function sendInviteEmail(input: {
  to: string
  name: string
  tradeName: string
  url: string
}): Promise<boolean> {
  try {
    // `functions.invoke` resolves for any HTTP answer and only fills `error` on a
    // non-2xx, so the envelope has to be read too — a 200 with `{ error }` is a failure
    // that looks like success.
    const { data, error } = await getSupabaseService().functions.invoke('send-transactional', {
      body: {
        type: 'partner_form_invite',
        to: input.to,
        lang: PARTNER_FORM_LOCALE,
        data: { name: input.name, trade_name: input.tradeName, url: input.url },
      },
    })

    if (error || (data && typeof data === 'object' && 'error' in data)) {
      console.error('[partner-invites] invite e-mail refused by send-transactional')
      return false
    }
    return true
  } catch (err) {
    console.error('[partner-invites] invite e-mail failed:', err instanceof Error ? err.message : err)
    return false
  }
}
