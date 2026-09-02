/**
 * GET  /api/finance/fixed-costs — o custo de estrutura, e o ponto de equilíbrio que ele exige.
 * POST /api/finance/fixed-costs — registra a impressora, a assinatura, o que não é do cliente.
 *
 * ESTA ROTA NÃO ACEITA `clientId`, E ISSO É O DESENHO INTEIRO. A impressora não fica mais barata
 * se cortarmos um parceiro; um rateio dela por cliente produziria um número que não serve para
 * decidir sobre cliente nenhum, e faria um parceiro pequeno parecer caro só porque a estrutura
 * existe. O custo fixo cobre contra a SOMA das margens, na camada MC II
 * (`lib/finance/structure.ts`). Custo que É do cliente tem outra porta: `/api/finance/entries`.
 *
 * `one_off` E `recurring` SÃO DUAS COISAS E O CHECK DO BANCO EXIGE A DIFERENÇA. Um `recurring`
 * sem período seria uma conta que ninguém sabe se chega todo mês ou todo ano — e lida como
 * mensal, multiplicaria por doze o que a operação precisa cobrir.
 *
 * SÃO QUATRO EIXOS, E CADA UM RESPONDE UMA PERGUNTA (ver `lib/finance/cost-taxonomy.ts`):
 * `category` (para onde o dinheiro vai), `nature` (fixo ou variável — só o fixo entra no ponto
 * de equilíbrio), `kind` (cadência) e `entryType` (custo ou crédito). Um crédito é lançado com
 * valor POSITIVO e `entryType: 'credit'` — o sinal é coluna, nunca o valor, porque um total que
 * soma tudo cru acerta por acidente e erra na pergunta que importa: quanto isto custa a preço
 * cheio, no dia em que o crédito promocional acabar.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { logAuditEvent } from '@/lib/services/audit-service'
import { createFixedCost, loadFixedCosts } from '@/lib/services/finance-service'
import { text, toAmountCents, toCurrency, toInteger, toIsoDate } from '@/lib/finance/input'
import { isCostCategory, isCostEntryType, isCostNature } from '@/lib/finance/cost-taxonomy'

/** Cento e vinte meses. Uma assinatura com período maior que isso é erro de digitação. */
const PERIOD_MAX = 120

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async () => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    return NextResponse.json({ fixedCosts: await loadFixedCosts() })
  })
)

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

    const label = text(body.label)
    if (!label) return NextResponse.json({ error: 'invalid_label' }, { status: 400 })

    if (body.kind !== 'one_off' && body.kind !== 'recurring') {
      return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
    }
    const kind = body.kind

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

    // Exigido em `recurring` e recusado em `one_off` — o mesmo par que o CHECK do banco impõe.
    // Assumir 1 quando ninguém informou leria uma conta anual como mensal.
    let periodMonths: number | null = null
    if (kind === 'recurring') {
      periodMonths = toInteger(body.periodMonths)
      if (periodMonths === null || periodMonths < 1 || periodMonths > PERIOD_MAX) {
        return NextResponse.json({ error: 'invalid_period' }, { status: 400 })
      }
    } else if (body.periodMonths !== undefined && body.periodMonths !== null) {
      return NextResponse.json({ error: 'invalid_period' }, { status: 400 })
    }

    // AUSENTE CAI NO DEFAULT, ERRADO É 400. São dois casos diferentes: um cliente antigo que não
    // conhece a coluna manda ausente e recebe o mesmo default do banco; um cliente que manda
    // `nature: "fixo"` errou, e aceitar isso em silêncio como `fixed` gravaria uma classificação
    // que ninguém escolheu — a mesma razão de `toCurrency` recusar em vez de normalizar.
    const category = body.category === undefined ? 'other' : body.category
    if (!isCostCategory(category)) {
      return NextResponse.json({ error: 'invalid_category' }, { status: 400 })
    }

    const nature = body.nature === undefined ? 'fixed' : body.nature
    if (!isCostNature(nature)) {
      return NextResponse.json({ error: 'invalid_nature' }, { status: 400 })
    }

    const entryType = body.entryType === undefined ? 'cost' : body.entryType
    if (!isCostEntryType(entryType)) {
      return NextResponse.json({ error: 'invalid_entry_type' }, { status: 400 })
    }

    // A FOLHA É BASE DO FATOR R, E CRÉDITO NÃO CONSTRÓI BASE. Um desconto de plano marcado como
    // folha inflaria o índice que decide o anexo do Simples — e o inflaria para cima, na direção
    // que faz a empresa se planejar para uma alíquota que ela não alcançou.
    if (body.isPayroll !== undefined && typeof body.isPayroll !== 'boolean') {
      return NextResponse.json({ error: 'invalid_payroll' }, { status: 400 })
    }
    const isPayroll = body.isPayroll === true
    if (isPayroll && entryType === 'credit') {
      return NextResponse.json({ error: 'invalid_payroll' }, { status: 400 })
    }

    // A VIGÊNCIA SÓ EXISTE NO RECORRENTE. Um desembolso de uma vez só não tem "até quando" — ele
    // aconteceu num dia — e aceitar a data ali gravaria um campo que nenhuma leitura consulta.
    let endsAt: string | null = null
    if (body.endsAt !== undefined && body.endsAt !== null && body.endsAt !== '') {
      endsAt = toIsoDate(body.endsAt)
      if (endsAt === null || endsAt < incurredAt || kind !== 'recurring') {
        return NextResponse.json({ error: 'invalid_ends_at' }, { status: 400 })
      }
    }

    const outcome = await createFixedCost({
      label,
      kind,
      amountCents,
      currency,
      incurredAt,
      periodMonths,
      category,
      nature,
      entryType,
      isPayroll,
      endsAt,
      notes: text(body.notes),
      createdBy: auth.user.id,
    })

    if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 503 })

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'CREATE_FINANCE_FIXED_COST',
      entity: 'FINANCE',
      entityId: outcome.id,
      description:
        `${entryType === 'credit' ? 'Crédito' : 'Custo'} ${nature} ${kind} "${label}" ` +
        `[${category}]: ${amountCents} centavos em ${currency}, ${incurredAt}` +
        (periodMonths ? `, a cada ${periodMonths} mês(es)` : '') +
        (endsAt ? `, até ${endsAt}` : '') +
        (isPayroll ? ', na base do fator R' : ''),
      request: req,
    })

    return NextResponse.json({ id: outcome.id }, { status: 201 })
  })
)
