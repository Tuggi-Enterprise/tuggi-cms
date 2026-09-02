/**
 * POST /api/finance/entries — o custo do cliente que não é unidade de material.
 *
 * Frete extra, um brinde, uma feira em que aquele parceiro foi apresentado. Entra no custo
 * DIRETO e portanto na margem daquele parceiro — que é exatamente o que o separa de
 * `/api/finance/fixed-costs`: aquele é estrutura e não desce para cliente nenhum.
 *
 * NÃO EXISTE `DELETE`, e a tabela nem concede o grant. Corrigir um lançamento é lançar o oposto,
 * não apagar a linha: um custo que some do histórico faz o total de um parceiro mudar sem que
 * nada explique por quê, e o log de auditoria apontaria para uma linha que não existe mais.
 *
 * O CLIENTE NÃO É VERIFICADO AQUI CONTRA `partner.clients` — a FK faz isso, e ela é quem
 * garante. O que a rota confere é o formato do UUID, para um id malformado virar 400 legível em
 * vez de um 500 vindo do banco.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { logAuditEvent } from '@/lib/services/audit-service'
import { createClientCostEntry } from '@/lib/services/finance-service'
import { UUID, text, toAmountCents, toCurrency, toIsoDate } from '@/lib/finance/input'

export const POST = withRateLimit(20, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async (req, _ctx, auth) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const clientId = typeof body.clientId === 'string' ? body.clientId : ''
    if (!UUID.test(clientId)) {
      return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    }

    const label = text(body.label)
    if (!label) return NextResponse.json({ error: 'invalid_label' }, { status: 400 })

    const amountCents = toAmountCents(body.amountCents)
    if (amountCents === null) {
      return NextResponse.json({ error: 'invalid_amount' }, { status: 400 })
    }

    const currency = toCurrency(body.currency)
    if (currency === null) {
      return NextResponse.json({ error: 'invalid_currency' }, { status: 400 })
    }

    const incurredAt = toIsoDate(body.incurredAt)
    if (incurredAt === null) {
      return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
    }

    const outcome = await createClientCostEntry({
      clientId,
      label,
      amountCents,
      currency,
      incurredAt,
      notes: text(body.notes),
      createdBy: auth.user.id,
    })

    if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 503 })

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'CREATE_FINANCE_CLIENT_COST',
      entity: 'FINANCE',
      entityId: outcome.id,
      description: `Custo avulso "${label}" de ${amountCents} centavos em ${currency} para o cliente ${clientId}, ${incurredAt}`,
      request: req,
    })

    return NextResponse.json({ id: outcome.id }, { status: 201 })
  })
)
