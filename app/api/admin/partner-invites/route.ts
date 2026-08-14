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
 *
 * TWO ACTS, ONE ROUTE, AND ONLY ONE OF THEM READS AN ADDRESS FROM THE BODY:
 *
 *  · first contact — `recipientEmail` is required and mints an empty proposal with the
 *    invite;
 *  · resend — `submissionId` is required and NOTHING else identifies the destination.
 *    The new link opens the proposal that already exists, so it hands back the CNPJ, the
 *    legal representative and the documents already sent; an address retyped here would
 *    deliver all of it to whoever the typo names. The address comes from the record
 *    (`createInvite`), and a `recipientEmail` in the body of a resend is ignored.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { createInvite, INVITE_TTL_DAYS } from '@/lib/services/partner-proposal-service'
import { PARTNER_FORM_LOCALE, buildPartnerFormUrl } from '@/lib/partner-form/link'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = withRateLimit(20, 60_000)(
  withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const submissionId = String(body.submissionId ?? '').trim()
    const isResend = submissionId.length > 0

    if (isResend && !UUID_PATTERN.test(submissionId)) {
      return NextResponse.json({ error: 'invalid_submission_id' }, { status: 400 })
    }

    const recipientEmail = String(body.recipientEmail ?? '').trim()
    if (!isResend && !EMAIL_PATTERN.test(recipientEmail)) {
      return NextResponse.json({ error: 'invalid_recipient_email' }, { status: 400 })
    }

    const ttlDays = Number.isFinite(Number(body.ttlDays)) && Number(body.ttlDays) > 0
      ? Math.min(Number(body.ttlDays), 60)
      : INVITE_TTL_DAYS

    // A resend is built from the id alone. `recipientEmail`, `recipientName`, `tradeName`
    // and `clientId` are not read on this branch — not "ignored later", not passed and
    // dropped: they have no way in, and the type of `createInvite` is what says so.
    const created = isResend
      ? await createInvite({ submissionId, createdBy: auth.user.id, ttlDays })
      : await createInvite({
          clientId: typeof body.clientId === 'string' ? body.clientId : null,
          recipientEmail,
          recipientName: typeof body.recipientName === 'string' ? body.recipientName : null,
          tradeName: typeof body.tradeName === 'string' ? body.tradeName : null,
          createdBy: auth.user.id,
          ttlDays,
        })

    if (!created.ok) {
      if (created.reason === 'unknown_submission') {
        console.warn('[partner-invites] resend asked for a proposal that has no invite')
        return NextResponse.json({ error: 'unknown_submission' }, { status: 404 })
      }
      console.error('[partner-invites] could not create the invite')
      return NextResponse.json({ error: 'invite_not_created' }, { status: 503 })
    }

    const invite = created.invite
    const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin
    const url = buildPartnerFormUrl(origin, invite.token)

    const emailed = await sendInviteEmail({
      to: invite.recipientEmail,
      name: invite.recipientName ?? '',
      tradeName: invite.tradeName ?? '',
      token: invite.token,
    })

    // The link is returned either way: an e-mail that did not go out must not cost the
    // operator the invite they just minted — there is no second chance at the raw token.
    // `recipientEmail` comes back because on a resend it is the answer to "where did this
    // go?", and the operator did not choose it.
    return NextResponse.json({
      inviteId: invite.inviteId,
      submissionId: invite.submissionId,
      recipientEmail: invite.recipientEmail,
      expiresAt: invite.expiresAt,
      url,
      emailed,
    })
  })
)

/**
 * The e-mail gets the TOKEN, never the assembled URL: `send-transactional` is reachable
 * without authorization until #346, and a function that renders whatever href its body
 * asks for is a phishing kit with our DKIM on it. The origin is composed there, from
 * `PARTNER_FORM_ORIGIN`. The URL in the response above is for the operator, not for the
 * e-mail.
 */
async function sendInviteEmail(input: {
  to: string
  name: string
  tradeName: string
  token: string
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
        data: { name: input.name, trade_name: input.tradeName, token: input.token },
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
