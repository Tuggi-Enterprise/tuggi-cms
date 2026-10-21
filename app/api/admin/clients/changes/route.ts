/**
 * GET /api/admin/clients/changes
 *
 * The queue of photo and text changes proposed in the partner portal (#922, BR-B2B-061 item 2;
 * contract `docs/contracts/portal-fotos-e-texto.md` §5.1): every pending change, oldest first, with
 * what is on the air and the proposal side by side. `partner.place_change_queue()` is granted to
 * service_role only; `withAuth` is the gate (admin and editor). Until the migration is applied the
 * function does not exist: 503 `not_available`.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { listPlaceChanges } from '@/lib/services/place-change-service'

export const GET = withAuth({ roles: ['admin', 'editor'] }, async () => {
  const r = await listPlaceChanges()
  if (!r.ok) return NextResponse.json({ error: r.error, code: r.error }, { status: r.status })
  return NextResponse.json({ changes: r.data })
})
