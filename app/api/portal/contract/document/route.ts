/**
 * #919 — the signed PDF of the CMS contract (state B), for the partner portal's Contract section
 * (`docs/contracts/portal-contrato.md` §4, item 3). Answers `{ url }`, a signed URL of the private
 * bucket `partner-contracts` that lives `SIGNED_URL_SECONDS` and is never stored; the Worker turns
 * it into the redirect. Same three barriers as `../route.ts`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withPublicRoute, withRateLimit } from '@/lib/auth-middleware'
import { placesCaller, signedDocumentUrl } from '@/lib/services/portal-contract-service'

const PUBLIC_REASON = "The partner portal's Worker calls with PLACES_CMS_SECRET and the portal user's JWT; the database proves the owner (#919)"
const READ_PER_MINUTE = 30
const MINUTE = 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET = withRateLimit(READ_PER_MINUTE, MINUTE)(
  withPublicRoute({ reason: PUBLIC_REASON }, async (req: NextRequest) => {
    const caller = placesCaller(req.headers)
    if (!caller) return NextResponse.json({ error: 'relogin' }, { status: 401 })
    const submissionId = req.nextUrl.searchParams.get('submission_id') ?? ''
    if (!UUID.test(submissionId)) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    const o = await signedDocumentUrl(caller.jwt, submissionId)
    return o.ok
      ? NextResponse.json(o.data, { headers: { 'cache-control': 'no-store' } })
      : NextResponse.json(o.failure.body, { status: o.failure.status })
  })
)
