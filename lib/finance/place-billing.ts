/**
 * O dinheiro REAL do Com história: assinaturas, cobranças e notas espelhadas do Asaas (#900),
 * e as pendências da view `partner.finance_pending_items`. Puro — sem banco, sem relógio lido
 * por dentro —, para o teste montar o caso à mão. Quem lê o banco é `finance-service.ts`.
 *
 * Contrato: `docs/contracts/places-pagamento.md` §3.5 e §4. Regras: BR-B2B-044, BR-B2B-045,
 * BR-B2B-046.
 */

import { DUE_DAY_OF_MONTH } from '@/lib/contract/template'

/** O fuso do contrato: `paid_on`, `competence_month` e o prazo do repasse são de São Paulo. */
export const BILLING_TIME_ZONE = 'America/Sao_Paulo'

/** `YYYY-MM-DD` em São Paulo de um instante ISO. `null` passa como `null`. */
export function saoPauloDate(iso: string | null): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  // `en-CA` é o locale que o Intl formata como `YYYY-MM-DD`.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BILLING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

// ── Pendências ─────────────────────────────────────────────────────────────────────────────────

export const PENDING_KINDS = [
  'charge_without_invoice',
  'invoice_error',
  'refund_invoice_not_canceled',
  'charge_overdue',
  'payout_period_not_calculated',
  'payout_not_released',
  'payout_failed',
  'payout_without_pix_key',
  // #903 (migration `20261007180000`): released > 15 min with no transfer recorded — search Asaas
  // for externalReference = payout id (`places-pagamento.md` §3.5, residual risk).
  'payout_stuck_released',
] as const
export type PendingKind = (typeof PENDING_KINDS)[number]
export type PendingSeverity = 'warning' | 'critical'

/** Uma linha da view, em camelCase, mais o nome e o contato que a tela precisa. */
export interface PendingItem {
  kind: PendingKind
  severity: PendingSeverity
  objectType: string
  objectId: string
  subscriptionId: string | null
  clientId: string | null
  periodMonth: string | null
  amountCents: number | null
  /** `YYYY-MM-DD`, São Paulo. "Desde" na tela; o prazo, nas linhas de repasse a liberar. */
  referenceDate: string | null
  detail: string | null
  /** O local, quando a pendência sabe de qual: assinatura ou cliente do repasse. */
  placeName: string | null
  /** O `core.attractions.id` do local — o destino de "Ver local", por `placeToolHref`. */
  attractionId: string | null
  /** `core.attractions.entity_kind`: decide entre o editor de local e o de POI. */
  attractionEntityKind: string | null
  /** Só em `payout_without_pix_key`: o e-mail de quem aceitou o contrato. */
  contactEmail: string | null
  /** Só em pendência de nota: separa `ERROR` de `CANCELLATION_DENIED` dentro de `invoice_error`. */
  invoiceStatus: InvoiceStatus | null
}

/** Os repasses: a seção deles é o #903, e o contador do menu dela conta só estes. */
export function isPayoutPending(kind: PendingKind): boolean {
  return kind.startsWith('payout_')
}

/**
 * Urgente primeiro; dentro do mesmo nível, a mais antiga primeiro. Sem data vai para o fim do
 * nível — não há "desde" para comparar. O desempate final é o id, para a ordem não piscar
 * entre dois recarregamentos.
 */
export function sortPendingItems<T extends Pick<PendingItem, 'severity' | 'referenceDate' | 'objectId'>>(
  items: readonly T[]
): T[] {
  const rank = (severity: PendingSeverity) => (severity === 'critical' ? 0 : 1)
  return [...items].sort((a, b) => {
    const bySeverity = rank(a.severity) - rank(b.severity)
    if (bySeverity !== 0) return bySeverity
    if (a.referenceDate !== b.referenceDate) {
      if (a.referenceDate === null) return 1
      if (b.referenceDate === null) return -1
      return a.referenceDate < b.referenceDate ? -1 : 1
    }
    return a.objectId < b.objectId ? -1 : a.objectId > b.objectId ? 1 : 0
  })
}

/** Dias inteiros entre duas datas `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

// ── Assinaturas, cobranças e notas ─────────────────────────────────────────────────────────────

export const INVOICE_STATUSES = [
  'SCHEDULED',
  'SYNCHRONIZED',
  'AUTHORIZED',
  'PROCESSING_CANCELLATION',
  'CANCELED',
  'CANCELLATION_DENIED',
  'ERROR',
] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export type ChargeStatus = 'overdue' | 'paid' | 'refund_pending' | 'refunded'

export interface PlaceInvoice {
  providerInvoiceId: string
  providerPaymentId: string | null
  status: InvoiceStatus
  number: string | null
  pdfUrl: string | null
  xmlUrl: string | null
  statusDescription: string | null
  updatedAt: string
}

export interface PlaceCharge {
  providerPaymentId: string
  kind: 'first' | 'renewal'
  status: ChargeStatus
  amountCents: number
  dueDate: string | null
  paidOn: string | null
  /** `YYYY-MM-DD` em São Paulo. */
  refundedOn: string | null
  /** A nota que vale para esta cobrança — ver `pickInvoice`. `null` = sem nota. */
  invoice: PlaceInvoice | null
}

/**
 * `portal`: nasceu de um aceite do portal. `cms_contract` (#918): a mensalidade do contrato do CMS,
 * anterior ao portal (`legacy:<client_id>` no Asaas), sem aceite. Mesma tabela, mesmas cobranças e
 * notas (`places-pagamento.md` §3.8).
 */
export type SubscriptionOrigin = 'portal' | 'cms_contract'

export interface PlaceSubscription {
  id: string
  origin: SubscriptionOrigin
  /** `null` só em `cms_contract`. */
  acceptanceId: string | null
  clientId: string | null
  /** Razão social do aceite; em `cms_contract`, o nome do cliente no CMS. */
  clientName: string | null
  attractionId: string | null
  attractionEntityKind: string | null
  placeName: string
  contactEmail: string
  /** 1, 3 ou 6 — `place_acceptances.billing_period` (BR-B2B-045). */
  billingPeriod: number | null
  paymentMethod: 'credit_card' | 'pix_automatic' | 'pix' | 'bank_slip_or_pix' | null
  status: 'pending_payment' | 'paid' | 'past_due' | 'expired' | 'refund_pending' | 'refunded'
  /** Instante ISO da criação da linha: o começo do contrato do CMS antes da 1ª cobrança paga. */
  createdAt: string | null
  paidAt: string | null
  /** `YYYY-MM-DD`, São Paulo: fim do mês pago = próxima cobrança. */
  paidThrough: string | null
  renews: boolean
  renewalAmountCents: number | null
  canceledAt: string | null
  expiredAt: string | null
  earlyTerminationFeeCents: number | null
  /** `YYYY-MM-DD`, São Paulo. */
  earlyTerminationPaidOn: string | null
  /**
   * `YYYY-MM-DD`: data interna de revisão do contrato do CMS (#918, `contract_ends_on`). Não é fim:
   * o contrato é por prazo indeterminado e a cobrança no Asaas renova sozinha. `null` no portal.
   */
  contractEndsOn: string | null
  /** Da mais nova para a mais antiga, por vencimento. */
  charges: PlaceCharge[]
}

/** Dias de antecedência do alerta de renovação do contrato do CMS (operador, 2026-10-08, #918). */
export const CONTRACT_REVIEW_NOTICE_DAYS = 30

/**
 * A revisão do contrato do CMS está a `CONTRACT_REVIEW_NOTICE_DAYS` dias ou menos (ou já passou),
 * com o contrato vivo. `today` é `YYYY-MM-DD` de São Paulo.
 */
export function contractReviewDue(subscription: PlaceSubscription, today: string): boolean {
  const endsOn = subscription.contractEndsOn
  if (endsOn === null || subscription.origin !== 'cms_contract' || isCanceled(subscription)) return false
  return daysBetween(today, endsOn) <= CONTRACT_REVIEW_NOTICE_DAYS
}

/**
 * A data da próxima cobrança (`YYYY-MM-DD`), ou `null` quando não há próxima (cancelada, sem renovação).
 *
 * Portal: `paidThrough`, o fim do mês pago. Contrato do CMS (#918): a assinatura `legacy:` do Asaas
 * vence todo dia `DUE_DAY_OF_MONTH`, pague o cliente quando pagar, e a cobrança ainda `PENDING` não é
 * gravada em `place_subscription_charges` (só paga, vencida ou estornada). Por isso é o primeiro dia
 * `DUE_DAY_OF_MONTH` de hoje em diante; se a cobrança desse dia já está gravada (paga adiantada), o do
 * mês seguinte. `paidThrough` ali conta da confirmação e não é vencimento. `today` é de São Paulo.
 */
export function nextChargeDate(subscription: PlaceSubscription, today: string): string | null {
  if (!subscription.renews || isCanceled(subscription)) return null
  if (subscription.origin !== 'cms_contract') return subscription.paidThrough
  const day = String(DUE_DAY_OF_MONTH).padStart(2, '0')
  let year = Number(today.slice(0, 4))
  let month = Number(today.slice(5, 7)) + (Number(today.slice(8, 10)) > DUE_DAY_OF_MONTH ? 1 : 0)
  for (;;) {
    if (month > 12) [year, month] = [year + 1, 1]
    const due = `${year}-${String(month).padStart(2, '0')}-${day}`
    if (!subscription.charges.some((charge) => charge.dueDate === due)) return due
    month += 1
  }
}

/**
 * A nota de uma cobrança, entre as que o Asaas guardou para o mesmo `pay_`.
 *
 * Uma cobrança pode ter mais de uma nota: a que deu `ERROR` e a reemitida. Vale a viva
 * (`AUTHORIZED` antes de tudo, depois a em andamento), e só sem nenhuma viva a mais recente.
 * É o mesmo critério da view para `invoice_error` — uma `ERROR` com outra viva ao lado não é
 * pendência.
 */
export function pickInvoice(invoices: readonly PlaceInvoice[]): PlaceInvoice | null {
  if (invoices.length === 0) return null
  const order: Record<InvoiceStatus, number> = {
    AUTHORIZED: 0,
    PROCESSING_CANCELLATION: 1,
    SYNCHRONIZED: 2,
    SCHEDULED: 3,
    CANCELLATION_DENIED: 4,
    ERROR: 5,
    CANCELED: 6,
  }
  return [...invoices].sort(
    (a, b) => order[a.status] - order[b.status] || (a.updatedAt < b.updatedAt ? 1 : -1)
  )[0]
}

/** Paga sem nota AUTORIZADA — o filtro "Sem nota" e o `charge_without_invoice` da view. */
export function isPaidWithoutInvoice(charge: PlaceCharge): boolean {
  return charge.status === 'paid' && charge.invoice?.status !== 'AUTHORIZED'
}

export function isCanceled(subscription: PlaceSubscription): boolean {
  return (
    subscription.canceledAt !== null ||
    subscription.status === 'expired' ||
    subscription.status === 'refunded' ||
    subscription.status === 'refund_pending'
  )
}

export type SubscriptionFilter = 'all' | 'overdue' | 'without_invoice' | 'canceled'

export function matchesFilter(subscription: PlaceSubscription, filter: SubscriptionFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'overdue':
      return subscription.charges.some((charge) => charge.status === 'overdue')
    case 'without_invoice':
      return subscription.charges.some(isPaidWithoutInvoice)
    case 'canceled':
      return isCanceled(subscription)
  }
}

/** `YYYY-MM` → o primeiro e o último dia, `YYYY-MM-DD`. */
function monthBounds(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7))
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

const inMonth = (date: string | null, month: string) => date !== null && date.slice(0, 7) === month

/**
 * O contrato do CMS corre antes da 1ª cobrança paga (a view conta a 1ª vencida como pendência,
 * §3.8): `pending_payment` dele é contrato vivo, não rascunho de checkout.
 */
function contractRunsUnpaid(subscription: PlaceSubscription): boolean {
  return subscription.origin === 'cms_contract' && subscription.status === 'pending_payment' && subscription.canceledAt === null
}

/**
 * Quem estava no Com história no mês: pagou alguma vez até o fim dele e não tinha saído antes
 * do começo. `pending_payment` nunca pagou — é rascunho de checkout, não assinatura. O contrato do
 * CMS (#918) conta desde que a linha existe, pago ou não.
 */
export function activeInMonth(subscription: PlaceSubscription, month: string): boolean {
  const { from, to } = monthBounds(month)
  const startedOn = saoPauloDate(
    subscription.paidAt ?? (subscription.origin === 'cms_contract' ? subscription.createdAt : null)
  )
  if (startedOn === null || startedOn > to) return false
  const left = [saoPauloDate(subscription.canceledAt), saoPauloDate(subscription.expiredAt)]
    .filter((date): date is string => date !== null)
    .sort()[0]
  return left === undefined || left >= from
}

export interface PlaceMonthTotals {
  month: string
  /** Mensalidades pagas no mês (`paid_on`), estornadas depois ou não. */
  receivedCents: number
  /** Soma da mensalidade de quem está em dia ou atrasado — o recorrente que o contrato promete. */
  recurringCents: number
  /** Tudo o que entrou no mês: mensalidades e a diferença do desconto (BR-B2B-045). */
  inflowCents: number
  /** Tudo o que saiu no mês: estornos e repasses pagos (BR-B2B-044 item 6). */
  outflowCents: number
}

export function summarizePlaceMonth(input: {
  month: string
  subscriptions: readonly PlaceSubscription[]
  /** `paid_at` em São Paulo e valor dos repasses `paid`. */
  payoutsPaid: readonly { paidOn: string; amountCents: number }[]
}): PlaceMonthTotals {
  let receivedCents = 0
  let recurringCents = 0
  let earlyTerminationCents = 0
  let refundedCents = 0

  for (const subscription of input.subscriptions) {
    if (subscription.status === 'paid' || subscription.status === 'past_due' || contractRunsUnpaid(subscription)) {
      recurringCents += subscription.renewalAmountCents ?? subscription.charges[0]?.amountCents ?? 0
    }
    if (inMonth(subscription.earlyTerminationPaidOn, input.month)) {
      earlyTerminationCents += subscription.earlyTerminationFeeCents ?? 0
    }
    for (const charge of subscription.charges) {
      if (charge.status !== 'overdue' && inMonth(charge.paidOn, input.month)) {
        receivedCents += charge.amountCents
      }
      if (charge.status === 'refunded' && inMonth(charge.refundedOn, input.month)) {
        refundedCents += charge.amountCents
      }
    }
  }

  const payoutsCents = input.payoutsPaid
    .filter((payout) => inMonth(payout.paidOn, input.month))
    .reduce((sum, payout) => sum + payout.amountCents, 0)

  return {
    month: input.month,
    receivedCents,
    recurringCents,
    inflowCents: receivedCents + earlyTerminationCents,
    outflowCents: refundedCents + payoutsCents,
  }
}

/**
 * O recebido por cliente (`partner.clients.id`), para a lucratividade (#902 item 3): mensalidade
 * paga e não estornada, mais a diferença do desconto paga. Só entra no mapa quem tem ao menos
 * uma cobrança espelhada — quem não tem continua no valor declarado, e a tela diz "declarado".
 */
export function receivedByClient(subscriptions: readonly PlaceSubscription[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const subscription of subscriptions) {
    if (subscription.clientId === null || subscription.charges.length === 0) continue
    const charges = subscription.charges
      .filter((charge) => charge.status === 'paid')
      .reduce((sum, charge) => sum + charge.amountCents, 0)
    const fee = subscription.earlyTerminationPaidOn !== null ? subscription.earlyTerminationFeeCents ?? 0 : 0
    out.set(subscription.clientId, (out.get(subscription.clientId) ?? 0) + charges + fee)
  }
  return out
}
