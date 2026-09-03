/**
 * GET  /api/finance/app-credit — o lado B2C: quem COMPROU, quem só ganhou, e quanto isso vale.
 * POST /api/finance/app-credit — declara o preço de um passe.
 *
 * POR QUE ESTA ROTA É SEPARADA DE `/api/finance/clients`. As duas leituras agregadas do app —
 * `core.dashboard_entitlement_overview` e `core.dashboard_metered_users` — são de `admin` e
 * correm com o JWT do próprio operador (`auth.supabase`), não com o de serviço. O Financeiro
 * abre para `admin` e `editor`. Fundir as duas coisas numa rota só obrigaria a escolher entre
 * fechar o módulo inteiro para editor ou afrouxar uma leitura sobre pessoas — e nenhuma das duas
 * é o pedido. Assim o editor recebe `available: false` e a tela desenha a faixa AUSENTE, com o
 * motivo escrito, em vez de um buraco.
 *
 * 200 E NÃO 403 PARA O EDITOR, pelo mesmo contrato de `app/api/dashboard/entitlement`: a falta
 * de permissão para UMA faixa não é uma falha da tela. Um 403 aqui faria o `Promise.all` da
 * página tratar como erro o que é uma decisão de acesso.
 *
 * A RECEITA VEM DO REVENUECAT, E NÃO DE UM PREÇO DECLARADO. `loadRcEvents` lê o payload que a EF
 * `app-revenuecat-webhook` grava em `drive.subscription_history.metadata.full_event` — valor na
 * moeda da compra, país, loja, ambiente e o parceiro que trouxe a pessoa. Conferido contra o
 * painel do RevenueCat em 2026-09-02: 9 de 9 transações pagas, US$ 77,44 bruto.
 *
 * Uma versão anterior desta rota estimava a receita a preço declarado pelo operador, porque o
 * valor parecia não existir no banco. Existia, no jsonb ao lado das colunas vazias.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { logAuditEvent } from '@/lib/services/audit-service'
import {
  createPassPrice,
  loadCommissionRates,
  loadExcludedAccounts,
  loadPassPrices,
  loadRcEvents,
} from '@/lib/services/finance-service'
import { commissionByPartner, spendByUser, summarizeAppRevenue } from '@/lib/finance/app-revenue'
import { text, toAmountCents, toCurrency, toInteger, toIsoDate } from '@/lib/finance/input'

export const dynamic = 'force-dynamic'

/** O teto da lista de saldo. O mesmo de `/api/dashboard/entitlement`. */
const USER_LIMIT = 1000

/** Um passe de mais de 24 h não é um passe: é erro de digitação. */
const MINUTES_MAX = 24 * 60

/** Quantos maiores pagantes a tela mostra. Uma lista, não um relatório. */
const SPENDER_LIMIT = 10

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async (_req, _ctx, auth) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const prices = await loadPassPrices()
    // O CATÁLOGO RECUSADO NÃO VIRA "nenhum preço declarado". A tela nomeia produto sem preço como
    // pendência, e com `[]` por erro TODOS virariam pendência — mandando o operador cadastrar
    // preços que já existem.
    if (prices === null) {
      return NextResponse.json({ error: 'finance_unavailable' }, { status: 503 })
    }

    if (auth.cmsUser.role !== 'admin') {
      // O preço declarado NÃO é dado sobre pessoas, então ele sobe mesmo aqui: o editor consegue
      // ver e manter o catálogo, e é só o agregado de contas que fica de fora.
      return NextResponse.json({ available: false, reason: 'requires_admin', prices })
    }

    const core = auth.supabase.schema('core')
    const [overview, meteredUsers, subscriptions, excluded, rcEvents, rates] = await Promise.all([
      core.rpc('dashboard_entitlement_overview'),
      core.rpc('dashboard_metered_users', { limit_count: USER_LIMIT, max_balance_minutes: null }),
      core.rpc('dashboard_subscription_stats'),
      loadExcludedAccounts('app_user'),
      loadRcEvents(),
      loadCommissionRates(),
    ])

    // AS TRÊS LEITURAS QUE VIRAM NÚMERO PRECISAM TER RESPONDIDO. Sem os eventos, a receita do app
    // é R$ 0,00; sem as exclusões, as contas de teste voltam para dentro dela; sem as comissões, o
    // líquido vira o bruto. Os três erros caem para o lado otimista, que é o pior lado.
    if (rcEvents === null || excluded === null || rates === null) {
      return NextResponse.json({ error: 'finance_unavailable' }, { status: 503 })
    }

    const today = new Date().toISOString().slice(0, 10)

    // As contas marcadas como teste saem ANTES de qualquer soma, e aqui a exclusão alcança de
    // verdade: o evento carrega o `app_user_id`, ao contrário do agregado que chega somado.
    const paid = rcEvents.filter((event) => !excluded.has(event.userId))

    return NextResponse.json({
      available: true,
      // `{ data, error }` por chave, como `/api/dashboard/entitlement`: uma RPC ausente não pode
      // derrubar a faixa inteira, e a tela mostra o vazio daquela linha.
      overview: overview.error ? null : (overview.data?.[0] ?? null),
      subscriptions: subscriptions.error ? null : (subscriptions.data?.[0] ?? null),
      prices,
      meteredUsers: meteredUsers.error ? null : (meteredUsers.data ?? null),
      // A RECEITA DO APP, LIDA DO EVENTO DO REVENUECAT. Realizada e recorrente são separadas: o
      // passe de 7 dias foi descontinuado e conta no que já entrou, nunca no que volta — e isso
      // sai de graça da regra, porque compra de uma vez não tem vencimento futuro.
      revenue: summarizeAppRevenue(paid, today),
      // Quanto cada pessoa já pagou. As contas de teste saem daqui, que é onde o CMS alcança.
      topSpenders: spendByUser(paid).slice(0, SPENDER_LIMIT),
      // A comissão que cada parceiro tem a receber, sobre o LÍQUIDO — é o que o contrato promete.
      commission: commissionByPartner(paid, rates),
      excludedAppUsers: excluded.size,
      /** Verdadeiro sempre que há conta marcada: o agregado do banco ainda a inclui. */
      aggregateIncludesExcluded: excluded.size > 0,
    })
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

    const productId = text(body.productId)
    if (!productId) return NextResponse.json({ error: 'invalid_product_id' }, { status: 400 })

    const label = text(body.label)
    if (!label) return NextResponse.json({ error: 'invalid_label' }, { status: 400 })

    const priceCents = toAmountCents(body.priceCents)
    if (priceCents === null) return NextResponse.json({ error: 'invalid_price' }, { status: 400 })

    const currency = toCurrency(body.currency)
    if (!currency) return NextResponse.json({ error: 'invalid_currency' }, { status: 400 })

    const effectiveFrom = toIsoDate(body.effectiveFrom)
    if (!effectiveFrom) return NextResponse.json({ error: 'invalid_date' }, { status: 400 })

    // Minutos é opcional: nem todo passe do catálogo é medido em tempo. Mas se vier, vem inteiro
    // e positivo — um passe de zero minuto não concede nada e não teria preço.
    let minutes: number | null = null
    if (body.minutes !== undefined && body.minutes !== null && body.minutes !== '') {
      minutes = toInteger(body.minutes)
      if (minutes === null || minutes <= 0 || minutes > MINUTES_MAX) {
        return NextResponse.json({ error: 'invalid_minutes' }, { status: 400 })
      }
    }

    const created = await createPassPrice({
      productId,
      label,
      priceCents,
      currency,
      effectiveFrom,
      minutes,
      notes: text(body.notes),
      createdBy: auth.user.id,
    })

    // 409 E NÃO 500: já existe preço deste passe nesta data, e a resposta certa é trocar a data
    // ou olhar o que está lá — nunca reescrever, porque preço é fato do dia.
    if (!created.ok) {
      return created.conflict
        ? NextResponse.json({ error: 'duplicate_price' }, { status: 409 })
        : NextResponse.json({ error: 'write_failed' }, { status: 503 })
    }

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'CREATE_FINANCE_PASS_PRICE',
      entity: 'FINANCE',
      entityId: productId,
      description: `Preco declarado do passe ${label} (${productId}): ${priceCents} ${currency} a partir de ${effectiveFrom}`,
      request: req,
    })

    return NextResponse.json({ ok: true }, { status: 201 })
  })
)
