/**
 * The one way the push report routes answer a refused RPC (#1051). 22023 is a bad argument and
 * comes back 400; 42501 is 403; anything else is 502. The code travels with the body so the
 * screen picks the sentence by code (`lib/api/dashboard-fetch.ts` · `RpcError`). The log carries
 * the SQLSTATE only: the message of a people read may name the send.
 */

import { NextResponse } from 'next/server'

export function pushRpcFailure(read: 'report' | 'people', error: { code?: string | null }) {
  const code = error.code ?? 'unknown'
  console.error(`[dashboard/push] ${read} read refused:`, code)
  const status = code === '22023' ? 400 : code === '42501' ? 403 : 502
  return NextResponse.json({ error: `push ${read} read refused`, code }, { status })
}
