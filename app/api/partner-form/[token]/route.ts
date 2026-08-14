/**
 * The public partner form (#341) — read the link, autosave, submit.
 *
 * Public on purpose: the person filling this in is a restaurant owner who has no CMS
 * login and never will (BR-B2B-026, item 2). The credential is the invite token in the
 * URL: 256 bits from the CSPRNG, single use, with an expiry, stored only as a hash.
 *
 * Three barriers, because `withPublicRoute` proves nothing:
 *   1. `withRateLimit` on every method, including the reads.
 *   2. The body is validated against the field allowlist before anything is persisted —
 *      unknown keys are stripped, so `commission_rate` posted by hand goes nowhere.
 *   3. Nothing here can write `core.clients`. The submission is a proposal, and the
 *      promotion into the live registration is an authenticated act of the team
 *      (BR-B2B-026, item 4). `lib/services/partner-proposal-service.ts` cannot reach the
 *      clients table at all, and the reason is written there.
 *
 * Logs carry the invite id and the state, never the e-mail, the CNPJ or the answers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withPublicRoute, withRateLimit } from '@/lib/auth-middleware'
import {
  resolveInvite,
  saveDraft,
  submitProposal,
  type ResolvedInvite,
} from '@/lib/services/partner-proposal-service'
import { normalizeAnswers, validateAnswers } from '@/lib/partner-form/schema'
import { PARTNER_DOCUMENT_KINDS, type PartnerDocumentKind } from '@/lib/partner-form/fields'

const PUBLIC_REASON =
  'Partner fills this form without a CMS login; the invite token is the credential (BR-B2B-026, item 2)'

/**
 * Reads are cheap but enumerable; writes are the expensive ones.
 *
 * The composition is written out at every export on purpose: `scripts/check-route-policies.ts`
 * only accepts `withRateLimit(...)(gate(...))` literally, so that "who may call this route,
 * and how often" is answerable without following a constant.
 */
const READ_PER_MINUTE = 30
const WRITE_PER_MINUTE = 12
const MINUTE = 60_000

interface TokenParams {
  token: string
  [key: string]: string | string[] | undefined
}

async function tokenOf(ctx: { params?: Promise<TokenParams> }): Promise<string> {
  const params = ctx.params ? await ctx.params : undefined
  return typeof params?.token === 'string' ? params.token : ''
}

/**
 * A link that is not open answers with its state and nothing else. In particular a used
 * link does NOT echo back what was submitted: the link is single use because it can leak,
 * and returning the CNPJ and the legal representative to whoever holds the URL would be
 * the leak paying off.
 */
function closedLink(resolved: ResolvedInvite): NextResponse {
  return NextResponse.json(
    {
      state: resolved.state,
      usedAt: resolved.state === 'used' ? (resolved.invite?.used_at ?? null) : null,
    },
    { status: resolved.state === 'invalid' ? 404 : 410 }
  )
}

function missingDocuments(documents: { kind: PartnerDocumentKind }[]): PartnerDocumentKind[] {
  const present = new Set(documents.map((document) => document.kind))
  return PARTNER_DOCUMENT_KINDS.filter((kind) => !present.has(kind))
}

export const GET = withRateLimit(READ_PER_MINUTE, MINUTE)(
  withPublicRoute<TokenParams>({ reason: PUBLIC_REASON }, async (req: NextRequest, ctx) => {
    const resolved = await resolveInvite(await tokenOf(ctx))
    if (resolved.state !== 'valid' || !resolved.invite) return closedLink(resolved)

    return NextResponse.json({
      state: 'valid',
      invite: {
        recipientName: resolved.invite.recipient_name,
        recipientEmail: resolved.invite.recipient_email,
        tradeName: resolved.invite.trade_name,
        expiresAt: resolved.invite.expires_at,
      },
      answers: resolved.submission?.answers ?? {},
      savedAt: resolved.submission?.updated_at ?? null,
      documents: (resolved.documents ?? []).map((document) => ({
        id: document.id,
        kind: document.kind,
        fileName: document.file_name,
        byteSize: document.byte_size,
      })),
    })
  })
)

/** Autosave on every step change. Never consumes the link. */
export const PUT = withRateLimit(WRITE_PER_MINUTE, MINUTE)(
  withPublicRoute<TokenParams>({ reason: PUBLIC_REASON }, async (req: NextRequest, ctx) => {
    const resolved = await resolveInvite(await tokenOf(ctx))
    if (resolved.state !== 'valid' || !resolved.invite) return closedLink(resolved)

    const body = await readJson(req)
    if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

    // A body that is not answers is refused, never normalised into `{}` — saving `{}` over
    // the draft and answering 200 destroys what the person typed and calls it success.
    const answers = normalizeAnswers((body as { answers?: unknown }).answers)
    if (!answers) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

    const saved = await saveDraft(resolved.invite.id, answers)

    if (!saved.ok) {
      console.warn('[partner-form] draft save failed for invite', resolved.invite.id)
      return NextResponse.json({ error: 'save_failed' }, { status: 503 })
    }

    return NextResponse.json({ savedAt: new Date().toISOString() })
  })
)

/**
 * Submits, once. A missing document does not block: BR-B2B-022 makes the licence and the
 * incorporation document a condition to SIGN THE CONTRACT, not to send the form, and the
 * gate is applied where BR-B2B-026 item 4 puts it — the team's conference. The submission
 * comes back flagged partial, naming what is missing.
 */
export const POST = withRateLimit(WRITE_PER_MINUTE, MINUTE)(
  withPublicRoute<TokenParams>({ reason: PUBLIC_REASON }, async (req: NextRequest, ctx) => {
    const resolved = await resolveInvite(await tokenOf(ctx))
    if (resolved.state !== 'valid' || !resolved.invite) return closedLink(resolved)

    const body = await readJson(req)
    if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

    const answers = normalizeAnswers((body as { answers?: unknown }).answers)
    if (!answers) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

    const documents = resolved.documents ?? []
    const missing = missingDocuments(documents)

    const problems = validateAnswers(answers, {
      hasBusinessLicenseFile: !missing.includes('business_license'),
    })

    if (problems.length > 0) {
      return NextResponse.json({ error: 'invalid_answers', problems }, { status: 400 })
    }

    const outcome = await submitProposal(resolved.invite.id, answers, {
      isPartial: missing.length > 0,
    })

    if (!outcome.ok) {
      if (outcome.reason === 'already_used') {
        // The link was consumed between the read above and the write. The database, not
        // this handler, decided the winner — which is why the check is an UPDATE with a
        // predicate and not an `if` over a previous SELECT.
        console.warn('[partner-form] replayed token on invite', resolved.invite.id)
        return NextResponse.json({ state: 'used' }, { status: 409 })
      }
      console.error('[partner-form] submit failed for invite', resolved.invite.id)
      return NextResponse.json({ error: 'submit_failed' }, { status: 503 })
    }

    return NextResponse.json({
      state: 'submitted',
      isPartial: outcome.isPartial,
      missingDocuments: missing,
      recipientEmail: resolved.invite.recipient_email,
    })
  })
)

async function readJson(req: NextRequest): Promise<unknown | null> {
  try {
    return await req.json()
  } catch {
    return null
  }
}
