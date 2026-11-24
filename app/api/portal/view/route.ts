/**
 * #996 — the portal's side of "Ver como o lojista" (`docs/contracts/places-cms.md` §11):
 * `POST /api/portal/view`, called only by the portal's Worker.
 *
 * Body: `{ "action": "open", "access": string }` spends the access minted by
 * `/api/admin/partnerships/portal-view/{id}` and answers `{ session, expires_at, submission_id }`;
 * `{ "action": "read", "session": string, "fn": string, "args"?: object }` answers `{ data }` for one
 * read of the viewed submission.
 *
 * Public to the CMS session on purpose: the caller is the Worker, never a browser. Barriers:
 * `withRateLimit`; `PLACES_CMS_SECRET` (`isPlacesWorker`); and the signed access or session, which
 * only an admin's click produces. The read list is closed and holds no write.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withPublicRoute, withRateLimit } from '@/lib/auth-middleware'
import { isPlacesWorker } from '@/lib/services/portal-contract-service'
import { openPortalView, readPortalView, type ViewOutcome } from '@/lib/services/portal-view-service'

const PUBLIC_REASON = "The partner portal's Worker calls with PLACES_CMS_SECRET and an access or session signed by the CMS for one admin (#996)"
/** A `/status` load is about ten reads, plus one a minute while the tab is visible. */
const PER_MINUTE = 240
const MINUTE = 60_000

const reply = <T,>(o: ViewOutcome<T>, body: (data: T) => unknown) =>
  o.ok
    ? NextResponse.json(body(o.data), { headers: { 'Cache-Control': 'no-store' } })
    : NextResponse.json({ error: o.error }, { status: o.status, headers: { 'Cache-Control': 'no-store' } })

export const POST = withRateLimit(PER_MINUTE, MINUTE)(
  withPublicRoute({ reason: PUBLIC_REASON }, async (req: NextRequest) => {
    if (!isPlacesWorker(req.headers)) return NextResponse.json({ error: 'forbidden' }, { status: 401 })
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (body?.action === 'open') {
      const opened = await openPortalView(req, body.access)
      return reply(opened, (d) => ({ session: d.session, expires_at: d.expiresAt, submission_id: d.submissionId }))
    }
    if (body?.action === 'read') {
      return reply(await readPortalView(body.session, body.fn, body.args), (data) => ({ data }))
    }
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  })
)
