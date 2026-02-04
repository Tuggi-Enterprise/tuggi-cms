/**
 * Deprecated endpoint.
 * Use POST /api/admin/clients/[clientId]/reject
 */

import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Deprecated. Use /api/admin/clients/[clientId]/reject instead.' },
    { status: 410 }
  )
}
