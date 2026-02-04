/**
 * Deprecated endpoint.
 * Use POST /api/admin/clients/[clientId]/approve
 */

import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Deprecated. Use /api/admin/clients/[clientId]/approve instead.' },
    { status: 410 }
  )
}
