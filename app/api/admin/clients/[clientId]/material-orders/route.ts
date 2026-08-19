/**
 * GET  /api/admin/clients/{clientId}/material-orders — what this partner asked for.
 * POST /api/admin/clients/{clientId}/material-orders — register an order by hand.
 * PATCH is on the order itself, below, keyed by `orderId` in the body.
 *
 * The material is what carries the QR code into the establishment, and until this route the
 * team could not see a single order — the promotion wrote them and nothing read them.
 *
 * WHY THE CREATE PATH IS SO THIN: everything that could go wrong with an order is refused by
 * `partner.create_material_order`, in one transaction. This route's only jobs are proving the
 * caller is an admin, refusing a body that is not quantities, and turning the service's outcome
 * into a status code.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MATERIAL_KINDS, type MaterialKind } from '@/lib/partner-form/fields'
import {
  createMaterialOrder,
  loadMaterialOrders,
  setMaterialOrderStatus,
} from '@/lib/services/material-order-service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Four digits, the same ceiling the public form enforces. */
const QUANTITY_MAX = 9999
const NOTES_MAX = 500

export const GET = withRateLimit(60, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (_req, ctx) => {
    const params = await ctx.params
    const clientId = params?.clientId
    if (!clientId || !UUID_PATTERN.test(clientId)) {
      return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    }

    return NextResponse.json({ orders: await loadMaterialOrders(clientId) })
  })
)

export const POST = withRateLimit(20, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const params = await ctx.params
    const clientId = params?.clientId
    if (!clientId || !UUID_PATTERN.test(clientId)) {
      return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const source = (body as Record<string, unknown>).items
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    // An allowlist, like the public route's: a key outside `MATERIAL_KINDS` is dropped in
    // silence rather than refused, and a value that is not a whole positive number inside the
    // ceiling makes the whole body invalid. Half-accepting an order is how somebody ends up
    // printing the wrong amount.
    const items: Partial<Record<MaterialKind, number>> = {}
    for (const kind of MATERIAL_KINDS) {
      const raw = (source as Record<string, unknown>)[kind]
      if (raw === undefined || raw === null || raw === '') continue
      const quantity = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10)
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > QUANTITY_MAX) {
        return NextResponse.json({ error: 'invalid_quantity', field: kind }, { status: 400 })
      }
      items[kind] = quantity
    }

    const rawNotes = (body as Record<string, unknown>).notes
    const notes = typeof rawNotes === 'string' ? rawNotes.trim().slice(0, NOTES_MAX) : null

    const outcome = await createMaterialOrder({
      clientId,
      items,
      notes: notes || null,
      createdBy: auth.user.id,
    })

    if (!outcome.ok) {
      // `empty` is the operator's mistake and `write_failed` is ours — 400 and 503 say which.
      const status = outcome.reason === 'empty' ? 400 : 503
      return NextResponse.json({ error: outcome.reason }, { status })
    }

    return NextResponse.json({ orderId: outcome.orderId }, { status: 201 })
  })
)

export const PATCH = withRateLimit(20, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (req, ctx) => {
    const params = await ctx.params
    if (!params?.clientId || !UUID_PATTERN.test(params.clientId)) {
      return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    }

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const orderId = body?.orderId
    const status = body?.status
    if (typeof orderId !== 'string' || !UUID_PATTERN.test(orderId)) {
      return NextResponse.json({ error: 'invalid_order_id' }, { status: 400 })
    }
    // `requested` is absent from the accepted set on purpose: an order does not go back. A
    // partner who needs more material gets another order, which is the reason this is a table.
    if (status !== 'fulfilled' && status !== 'cancelled') {
      return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    }

    const changed = await setMaterialOrderStatus(orderId, status)
    // 409 and not 404: the order exists, it just is not `requested` any more — somebody else
    // closed it while this screen was open, and saying "not found" would send the operator
    // looking for a row that is right there.
    if (!changed) return NextResponse.json({ error: 'not_open' }, { status: 409 })

    return NextResponse.json({ ok: true })
  })
)
