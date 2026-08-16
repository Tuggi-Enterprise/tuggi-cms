/**
 * The PDF the partner downloads — the archive copy of #342.
 *
 * Public, keyed by the signing token, and read-only: it hands back the bytes that are IN
 * the private bucket and never re-renders them. Re-rendering would produce a different
 * file with a different hash, and the number printed on the receipt would stop matching
 * the file it names.
 *
 * Before signature it serves the document as generated — the one the reader is being asked
 * to accept — and after signature the signed copy with the acceptance appendix. A link that
 * is no longer open serves neither: the state gate is `canServeDocument`, the same function
 * the page calls, because two doors to one document may not have two rules. Both come
 * from `lib/services/partner-contract-service.ts`, which is where `service_role` lives;
 * this file never touches it, which is what keeps `withPublicRoute` legitimate here
 * (`scripts/check-route-policies.ts`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { withPublicRoute, withRateLimit } from '@/lib/auth-middleware'
import {
  canServeDocument,
  downloadDocument,
  getAcceptance,
  resolveSigningToken,
} from '@/lib/services/partner-contract-service'

const PUBLIC_REASON =
  'The partner reads and files their own contract without a CMS login (BR-B2B-026, item 2)'

interface TokenParams {
  token: string
  [key: string]: string | string[] | undefined
}

export const GET = withRateLimit(20, 60_000)(
  withPublicRoute<TokenParams>({ reason: PUBLIC_REASON }, async (_req: NextRequest, ctx) => {
    const params = ctx?.params ? await ctx.params : undefined
    const token = typeof params?.token === 'string' ? params.token : ''

    const resolved = await resolveSigningToken(token)
    // The same ruler the page reads (`canServeDocument`), and not a copy of it: an expired,
    // superseded or terminated link used to be refused in words on the page and answered
    // with the whole document here.
    if (!resolved.contract || !canServeDocument(resolved.state)) {
      return NextResponse.json({ state: resolved.state }, { status: 404 })
    }

    const acceptance =
      resolved.acceptance ?? (resolved.state === 'signed' ? await getAcceptance(resolved.contract.id) : null)

    const path = acceptance?.signed_document_path ?? resolved.contract.document_path
    const bytes = await downloadDocument(path)

    if (!bytes) {
      // The page says so in words and keeps the full text on screen: the PDF is a copy for
      // filing, never the only way to read the document (spec do `design`, §4.3).
      console.error('[contract] pdf unavailable for contract', resolved.contract.id)
      return NextResponse.json({ error: 'pdf_unavailable' }, { status: 503 })
    }

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="contrato-tuggi${acceptance ? '-assinado' : ''}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  })
)
