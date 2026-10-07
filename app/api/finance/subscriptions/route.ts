/**
 * GET /api/finance/subscriptions?month=YYYY-MM — as mensalidades do Com história (#902): uma
 * linha por assinatura, cada cobrança com a nota dela, e os quatro totais do mês. Só leitura;
 * quem grava é o webhook do Asaas, pelas funções do #900 (`places-pagamento.md` §3.5 e §4).
 *
 * 503 quando qualquer das três leituras falha. Receita zero por erro é o gêmeo do custo zero
 * por erro, e este módulo não desenha nenhum dos dois.
 */

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { MODULES } from '@/lib/modules'
import { requireModule } from '@/lib/modules/requireModule'
import { loadPaidPayouts, loadPlaceInvoices, loadPlaceSubscriptions } from '@/lib/services/finance-service'
import {
  activeInMonth,
  pickInvoice,
  saoPauloDate,
  summarizePlaceMonth,
  type PlaceInvoice,
} from '@/lib/finance/place-billing'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export const GET = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin', 'editor'] }, async (req) => {
    const gate = await requireModule(MODULES.FINANCE, await cookies())
    if (!gate.ok) return gate.response

    const asked = new URL(req.url).searchParams.get('month')
    const month = asked !== null && MONTH.test(asked) ? asked : (saoPauloDate(new Date().toISOString()) as string).slice(0, 7)

    const [subscriptions, invoices, payoutsPaid] = await Promise.all([
      loadPlaceSubscriptions(),
      loadPlaceInvoices(),
      loadPaidPayouts(),
    ])
    if (subscriptions === null || invoices === null || payoutsPaid === null) {
      return NextResponse.json({ error: 'subscriptions_unavailable' }, { status: 503 })
    }

    const byPayment = new Map<string, PlaceInvoice[]>()
    for (const invoice of invoices) {
      if (!invoice.providerPaymentId) continue
      const list = byPayment.get(invoice.providerPaymentId) ?? []
      list.push(invoice)
      byPayment.set(invoice.providerPaymentId, list)
    }

    const withInvoices = subscriptions.map((subscription) => ({
      ...subscription,
      charges: subscription.charges.map((charge) => ({
        ...charge,
        invoice: pickInvoice(byPayment.get(charge.providerPaymentId) ?? []),
      })),
    }))

    // Os totais olham TODAS as assinaturas — um estorno deste mês de quem saiu no anterior ainda
    // é saída deste mês. A tabela mostra só quem estava no Com história no mês escolhido.
    return NextResponse.json({
      month,
      currency: 'BRL',
      totals: summarizePlaceMonth({ month, subscriptions: withInvoices, payoutsPaid }),
      // #902 gate: the contact e-mail never leaves the server here (only payout_without_pix_key shows it).
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      subscriptions: withInvoices
        .filter((subscription) => activeInMonth(subscription, month))
        .sort((a, b) => a.placeName.localeCompare(b.placeName, 'pt-BR'))
        .map(({ contactEmail, ...rest }) => rest),
    })
  })
)
