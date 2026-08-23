/**
 * GET /api/admin/materials — every partner's material order, for the queue screen.
 *
 * READ ONLY, AND THAT IS THE DESIGN. Closing an order already has a route
 * (`PATCH /api/admin/clients/{clientId}/material-orders`) with the rule that a closed order does
 * not reopen written into the `.eq('status', 'requested')` of the update. A second write path
 * here would be a second place for that rule to be forgotten — the board carries the partner's
 * id on every card, so it calls the route that already exists.
 *
 * The dashboard is NOT computed here: `summarizeMaterialQueue` runs over the same array the
 * board renders, so the tiles and the columns cannot disagree.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { loadMaterialOrderQueue } from '@/lib/services/material-order-service'

/**
 * The cap, and the screen is TOLD when it was hit. 17 orders exist today, so 500 is far away —
 * but a count printed over a cut set is a lower bound wearing the clothes of a fact, and the
 * board turns every number into `≥ n` when this comes back true.
 */
const QUEUE_CAP = 500

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin'] }, async () => {
    const orders = await loadMaterialOrderQueue(QUEUE_CAP)
    return NextResponse.json({ orders, truncated: orders.length >= QUEUE_CAP })
  })
)
