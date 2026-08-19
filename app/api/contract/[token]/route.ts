/**
 * The acceptance — the one write of the public half of #342.
 *
 * Public on purpose: the person signing is the legal representative of a restaurant who
 * has no CMS login and never will (BR-B2B-026, item 2). The credential is the signing
 * token in the URL: 256 bits from the CSPRNG, with an expiry, stored only as a SHA-256
 * hash, and it authorizes exactly one thing — accepting the one contract it points at.
 *
 * Three barriers, because `withPublicRoute` proves nothing:
 *   1. `withRateLimit`, because a route that writes is the only barrier left when
 *      `service_role` ignores RLS.
 *   2. The body is two short strings and both are validated here; everything else that
 *      goes into the row — the timestamp, the IP, the user agent, the e-mail, the value,
 *      the version, the hash — comes from the server, never from the caller.
 *   3. Nothing here can reach `partner.clients`, and nothing here re-reads the registration:
 *      the document was frozen when it was generated (BR-B2B-017, item 5).
 *
 * IDEMPOTENT BY CONTRACT, WHICH IS WHAT LETS THE RETRY BUTTON EXIST. The second request
 * with the same token gets the first acceptance back — same stamp, same hash, HTTP 200 —
 * so "toque em tentar de novo, a gente não assina duas vezes" is true (spec do `design`,
 * §4.3). The deduplication is the database's, not this handler's.
 *
 * Logs carry the contract id and nothing else: no name, no e-mail, no CNPJ, no IP.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withPublicRoute, withRateLimit } from '@/lib/auth-middleware'
import { acceptContract, resolveSigningToken } from '@/lib/services/partner-contract-service'
import { shortHash } from '@/lib/contract/hash'

const PUBLIC_REASON =
  'The partner signs without a CMS login; the signing token is the credential (BR-B2B-026, item 2)'

const WRITE_PER_MINUTE = 10
const MINUTE = 60_000

/** A signature is a name, not an essay; and a row has to stay a row. */
const MAX_NAME_LENGTH = 120
const MIN_NAME_LENGTH = 3

interface TokenParams {
  token: string
  [key: string]: string | string[] | undefined
}

async function tokenOf(ctx: { params?: Promise<TokenParams> }): Promise<string> {
  const params = ctx.params ? await ctx.params : undefined
  return typeof params?.token === 'string' ? params.token : ''
}

/**
 * The signer's IP, taken from the edge and from nowhere else.
 *
 * On Vercel `x-forwarded-for` is the client's public IP and the platform overwrites
 * whatever a caller sends, precisely to stop spoofing
 * (https://vercel.com/docs/headers/request-headers); `x-real-ip` is documented as the same
 * value and is the local fallback. Same reading as
 * `tuggi-enterprise/src/app/api/attribution/route.ts`, and for a stronger reason here: an
 * IP the caller could choose is an audit trail the caller could write.
 */
function readClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip')
  const first = forwarded?.split(',')[0]?.trim()
  if (!first) return 'unknown'
  return first.replace(/^::ffff:/i, '').slice(0, 45)
}

function readUserAgent(req: NextRequest): string {
  return (req.headers.get('user-agent') ?? 'unknown').slice(0, 400)
}

export const POST = withRateLimit(WRITE_PER_MINUTE, MINUTE)(
  withPublicRoute<TokenParams>({ reason: PUBLIC_REASON }, async (req: NextRequest, ctx) => {
    const token = await tokenOf(ctx)
    const resolved = await resolveSigningToken(token)

    // An already signed link answers with the receipt it produced the first time. This is
    // the retry path and it is a success, not a conflict: the fact exists exactly once.
    if (resolved.state === 'signed' && resolved.acceptance) {
      return NextResponse.json(receipt(resolved.acceptance), { status: 200 })
    }

    if (resolved.state !== 'open' || !resolved.contract) {
      return NextResponse.json(
        { state: resolved.state },
        { status: resolved.state === 'invalid' ? 404 : 410 }
      )
    }

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const signerName = String(body.signerName ?? '').trim().slice(0, MAX_NAME_LENGTH)
    const signerRole = String(body.signerRole ?? '').trim().slice(0, MAX_NAME_LENGTH)
    const accepted = body.accepted === true

    // The checkbox is one of the two affirmative acts of DS-COMPONENTE-017, and the server
    // does not take the other one's word for it: a POST without it is not an acceptance.
    if (!accepted) return NextResponse.json({ error: 'acceptance_not_declared' }, { status: 400 })
    if (signerName.length < MIN_NAME_LENGTH) {
      return NextResponse.json({ error: 'signer_name_required' }, { status: 400 })
    }
    if (signerRole.length < 2) {
      return NextResponse.json({ error: 'signer_role_required' }, { status: 400 })
    }

    const outcome = await acceptContract({
      contract: resolved.contract,
      // The service sends the signed copy and composes the link from the token, because
      // `service_role` lives there and not here: `scripts/check-route-policies.ts` refuses
      // a `withPublicRoute` in a file that reaches the service client, and it is right to.
      signingToken: token,
      signerName,
      signerRole,
      ipAddress: readClientIp(req),
      userAgent: readUserAgent(req),
    })

    if (!outcome.ok) {
      if (outcome.reason === 'unknown_template') {
        return NextResponse.json({ error: 'unknown_template' }, { status: 409 })
      }
      console.error('[contract] acceptance failed for contract', resolved.contract.id)
      return NextResponse.json({ error: 'accept_failed' }, { status: 503 })
    }

    return NextResponse.json(receipt(outcome.acceptance), { status: 200 })
  })
)

function receipt(acceptance: {
  signer_name: string
  signer_role: string
  accepted_at: string
  signed_document_hash: string | null
  recipient_email: string
}) {
  return {
    state: 'signed' as const,
    signerName: acceptance.signer_name,
    signerRole: acceptance.signer_role,
    acceptedAt: acceptance.accepted_at,
    recipientEmail: acceptance.recipient_email,
    documentHash: acceptance.signed_document_hash,
    verificationCode: acceptance.signed_document_hash ? shortHash(acceptance.signed_document_hash) : null,
  }
}
