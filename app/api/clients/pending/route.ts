/**
 * Deprecated endpoint.
 * Use GET /api/admin/clients/pending
 */

import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json(
    { error: 'Deprecated. Use /api/admin/clients/pending instead.' },
    { status: 410 }
  )
}
