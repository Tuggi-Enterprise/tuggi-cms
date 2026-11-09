/**
 * GET /api/admin/partner-requests — the queue of requests of partners without a place from the
 * app (#1139, BR-B2B-066, BR-USUARIO-052 item 4.d). Contract `parceiro-sem-local.md` §4.1.
 *
 * Admin only: the rows carry CPF, CNPJ, WhatsApp and e-mail, and the document never leaves an
 * admin screen (BR-B2B-066 item 5.b). `no-store`, so no proxy or browser keeps a copy.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { listPartnerRequests } from '@/lib/services/partner-request-service'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin'] }, async () => {
    const requests = await listPartnerRequests()
    if (requests === null) {
      return NextResponse.json({ error: 'requests_unavailable' }, { status: 503, headers: NO_STORE })
    }
    return NextResponse.json({ requests }, { headers: NO_STORE })
  })
)
