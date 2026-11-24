/**
 * GET /api/admin/public-identity/reports — the open reports of display name, @ and bio (#1144,
 * BR-USUARIO-051 item 5). Contract `identidade-publica.md`, "Tabelas que o CMS lê e escreve direto":
 * `status = 'open'`, ordered by `last_reported_at`.
 *
 * Admin only and `no-store`: a reported value is a person's public name, and no proxy or browser
 * keeps a copy of the queue.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { listOpenReports } from '@/lib/services/public-identity-moderation-service'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin'] }, async () => {
    const queue = await listOpenReports()
    if (queue === null) {
      return NextResponse.json({ error: 'reports_unavailable' }, { status: 503, headers: NO_STORE })
    }
    return NextResponse.json(queue, { headers: NO_STORE })
  })
)
