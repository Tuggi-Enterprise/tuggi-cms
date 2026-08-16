/**
 * The PDF for the operator (#342). Same bytes as the partner's copy, same bucket, no
 * re-render — the file the hash names is the file everybody gets.
 *
 * Authenticated and admin only: the archive of a signed contract carries the CNPJ, the
 * legal representative and the IP of whoever signed it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { downloadDocument, getLiveContract } from '@/lib/services/partner-contract-service'

interface ClientParams {
  clientId: string
  [key: string]: string | string[] | undefined
}

export const GET = withRateLimit(60, 60_000)(
  withAuth<ClientParams>({ roles: ['admin'] }, async (_req: NextRequest, ctx) => {
    const params = ctx?.params ? await ctx.params : undefined
    const clientId = typeof params?.clientId === 'string' ? params.clientId : ''

    const { contract, acceptance } = await getLiveContract(clientId)
    if (!contract) return NextResponse.json({ error: 'contract_not_found' }, { status: 404 })

    const path = acceptance?.signed_document_path ?? contract.document_path
    const bytes = await downloadDocument(path)
    if (!bytes) return NextResponse.json({ error: 'pdf_unavailable' }, { status: 503 })

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="contrato-${clientId}${acceptance ? '-assinado' : ''}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  })
)
