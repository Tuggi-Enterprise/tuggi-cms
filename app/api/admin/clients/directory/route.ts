/**
 * GET /api/admin/clients/directory — the unified list.
 *
 * One answer where there were two: `/api/admin/clients` reads `partner.clients` and
 * `/api/admin/partnerships` reads `partner.partner_form_submissions`, so the same establishment
 * was two rows in two screens, and neither could answer `quais parceiros de Minas ainda não
 * assinaram o contrato?` — half the answer lived in the other screen.
 *
 * IT RETURNS THE ROWS WHOLE AND FILTERS NOTHING. The facet counts have to be computed over the
 * same set the table renders, or a counter opens an empty table — the defect DS-COPY-020,
 * point 5, names. `lib/clients/directory-filter` decides, and it is pure.
 *
 * Measured on 2026-08-17: 11 clients and 2 submissions. The caps in `loadClientDirectory` are
 * three orders of magnitude above that and the payload says when it hits them, rather than
 * truncating in silence.
 *
 * `core.attractions` is read with the OPERATOR's client, for the reason
 * `partnership-service` writes down: an unapproved place is visible through the `CMS admins
 * can read attractions` policy, and asking with `service_role` would answer for an identity
 * that is not the one on the screen.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { loadClientDirectory } from '@/lib/services/partnership-service'

export const GET = withAuth({ roles: ['admin'] }, async (_req, _ctx, auth) => {
  const directory = await loadClientDirectory(auth.supabase)
  return NextResponse.json(directory)
})
