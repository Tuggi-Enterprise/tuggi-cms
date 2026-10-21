/**
 * #919 — the partner portal's Contract section, CMS side (`docs/contracts/portal-contrato.md` §4):
 * `GET ?submission_id=` reads the CMS contract to accept (state C); `POST` accepts it.
 *
 * Public to the CMS session on purpose: the caller is the portal's Worker, not a CMS operator. Three
 * barriers, because `withPublicRoute` proves nothing: `withRateLimit`; `PLACES_CMS_SECRET` plus the
 * portal user's JWT (`placesCaller`), and without both nothing runs; and ownership proved by the
 * database with that JWT before `service_role` touches anything (`portal-contract-service.ts`).
 * The IP and user agent in the body are what the Worker read at the edge (`cf-connecting-ip`). The
 * database does not prove their origin: `core.portal_accept_contract` takes `p_ip`/`p_user_agent`
 * from any caller with a portal session, so they are evidence declared by the channel, as in
 * `portal_submit` (BR-B2B-047).
 */

import { NextRequest, NextResponse } from 'next/server'
import { withPublicRoute, withRateLimit } from '@/lib/auth-middleware'
import { acceptFromPortal, contractToAccept, parseAcceptBody, placesCaller, type Outcome } from '@/lib/services/portal-contract-service'

const PUBLIC_REASON = "The partner portal's Worker calls with PLACES_CMS_SECRET and the portal user's JWT; the database proves the owner (#919)"
const READ_PER_MINUTE = 30
const WRITE_PER_MINUTE = 10
const MINUTE = 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const reply = <T,>(o: Outcome<T>) => (o.ok ? NextResponse.json(o.data) : NextResponse.json(o.failure.body, { status: o.failure.status }))
const refused = () => NextResponse.json({ error: 'relogin' }, { status: 401 })

export const GET = withRateLimit(READ_PER_MINUTE, MINUTE)(
  withPublicRoute({ reason: PUBLIC_REASON }, async (req: NextRequest) => {
    const caller = placesCaller(req.headers)
    if (!caller) return refused()
    const submissionId = req.nextUrl.searchParams.get('submission_id') ?? ''
    if (!UUID.test(submissionId)) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    return reply(await contractToAccept(caller.jwt, submissionId))
  })
)

export const POST = withRateLimit(WRITE_PER_MINUTE, MINUTE)(
  withPublicRoute({ reason: PUBLIC_REASON }, async (req: NextRequest) => {
    const caller = placesCaller(req.headers)
    if (!caller) return refused()
    const body = parseAcceptBody(await req.json().catch(() => null))
    if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    return reply(await acceptFromPortal(caller.jwt, body))
  })
)
