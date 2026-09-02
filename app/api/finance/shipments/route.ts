/**
 * POST /api/finance/shipments — quanto REALMENTE saiu de um pedido.
 *
 * POR QUE ESTA ROTA EXISTE. O custo saía de `material_order_items.quantity`, que é o que o
 * parceiro PEDIU, e superestimava todo parceiro que recebeu menos do que pediu — *"não é pq um
 * parceiro pediu 40 displays, que enviamos os 40"* (operador, 2026-09-01). O que saiu é outro
 * fato, informado por quem embalou a caixa, e é este.
 *
 * ELA NÃO MOVE O PEDIDO E NÃO GRAVA CUSTO. A esteira continua sendo quem avança o status
 * (`PATCH /api/admin/clients/{id}/material-orders`) e `setMaterialOrderStatus` continua sendo
 * quem dispara o custo. A tela chama esta rota ANTES do PATCH, para que a quantidade já esteja
 * lá quando o custo for calculado — e se o PATCH falhar, o que sobra é um envio informado sobre
 * um pedido que não andou, que é inofensivo e corrigível.
 *
 * `PUT`-COMO-`POST`: o `upsert` torna a chamada idempotente, e corrigir uma contagem é o caso
 * normal — pessoas contam errado. O que esta rota NUNCA corrige é o custo unitário, que fica
 * congelado na linha de consumo.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { logAuditEvent } from '@/lib/services/audit-service'
import { loadCatalog, saveOrderShipment } from '@/lib/services/finance-service'
import { UUID, toInteger } from '@/lib/finance/input'

/** Quatro dígitos, o mesmo teto que o formulário público impõe à quantidade pedida. */
const QUANTITY_MAX = 9999

export const POST = withRateLimit(30, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async (req, _ctx, auth) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const orderId = typeof body.orderId === 'string' ? body.orderId : ''
    if (!UUID.test(orderId)) {
      return NextResponse.json({ error: 'invalid_order_id' }, { status: 400 })
    }

    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const catalog = await loadCatalog()
    if (!catalog) return NextResponse.json({ error: 'finance_unavailable' }, { status: 503 })

    const lines: { productId: string; quantity: number; requestedQuantity: number | null }[] = []
    for (const raw of body.lines as Record<string, unknown>[]) {
      const productId = typeof raw?.productId === 'string' ? raw.productId : ''
      if (!catalog.products.some((product) => product.id === productId)) {
        return NextResponse.json({ error: 'unknown_product' }, { status: 400 })
      }

      // Zero é aceito e um negativo não: "não saiu nada" é resposta, "saiu menos que nada" não é.
      const quantity = toInteger(raw?.quantity)
      if (quantity === null || quantity < 0 || quantity > QUANTITY_MAX) {
        return NextResponse.json({ error: 'invalid_quantity', field: productId }, { status: 400 })
      }

      const requested = raw?.requestedQuantity === undefined ? null : toInteger(raw.requestedQuantity)
      lines.push({ productId, quantity, requestedQuantity: requested })
    }

    const saved = await saveOrderShipment({ orderId, lines, createdBy: auth.user.id })
    if (!saved) return NextResponse.json({ error: 'write_failed' }, { status: 503 })

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'CREATE_FINANCE_SHIPMENT',
      entity: 'FINANCE',
      entityId: orderId,
      description:
        `Envio do pedido ${orderId}: ` +
        lines
          .map((line) => `${line.productId} ${line.quantity}/${line.requestedQuantity ?? '?'}`)
          .join(', '),
      request: req,
    })

    return NextResponse.json({ ok: true }, { status: 201 })
  })
)
