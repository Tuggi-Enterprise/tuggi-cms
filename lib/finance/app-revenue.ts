/**
 * A RECEITA DO APP — lida do evento do RevenueCat, que é quem sabe quanto foi cobrado.
 *
 * A FONTE É O PAYLOAD, E NÃO UM PREÇO DECLARADO. `drive.subscription_history.metadata.full_event`
 * guarda o evento inteiro que o RevenueCat mandou para a EF `app-revenuecat-webhook`: valor na
 * moeda da compra, moeda, país, loja, produto, tipo de período e o percentual que sobra para a
 * Tuggi. Conferido em 2026-09-02 contra o painel do próprio RevenueCat: **9 de 9 transações
 * pagas, valor idêntico, US$ 77,44 bruto**.
 *
 * ISSO APOSENTOU DUAS INVENÇÕES MINHAS. A tabela de preço declarado (`finance.pass_prices`) e a
 * inferência de moeda por fuso horário existiam porque eu achava que o valor não estava no banco.
 * Estava — nas colunas erradas. `price_local`, `price_local_currency` e `environment` da tabela
 * estão NULAS em 100% das linhas; o dado vive no jsonb ao lado delas.
 *
 * REALIZADO E RECORRENTE SÃO COISAS DIFERENTES, e a separação é a razão deste arquivo existir.
 * O passe de 7 dias (`com.tuggi.premium.7day`) foi descontinuado — decisão do operador em
 * 2026-09-02: *"o plano de 7 dias era antigo e não existe mais, essa compra é antiga, mas podemos
 * considerá-la como receita"*. Ele entra no que JÁ ENTROU e não entra no que VAI ENTRAR. Não
 * precisa de lista de produtos mortos: compra de uma vez não tem vencimento futuro, e é o
 * vencimento que decide o recorrente.
 *
 * SANDBOX NÃO É RECEITA. Em 2026-09-02 havia R$ 5.816,93 em renovações de teste na mesma tabela —
 * 61 linhas com dinheiro, contra 9 de produção. Sem o filtro de ambiente, a tela mostraria uma
 * empresa sessenta vezes maior do que ela é.
 *
 * MOEDA NÃO CONVERTE. Cinco das nove vendas são fora do Brasil — Itália, Alemanha, Suíça e dois
 * Estados Unidos. Um total único em reais não descreve este negócio, e uma taxa de câmbio
 * cadastrada faria o histórico depender de quando alguém a atualizou. O USD do próprio payload
 * viaja ao lado, porque é o RevenueCat quem o calcula, não este módulo.
 *
 * Puro: sem fetch, sem Supabase, sem React. Provado por `tests/api/finance-app-revenue.test.ts`.
 */

import { convertCents, rateOn, type FxRate } from './fx'

/** Os tipos de evento que representam DINHEIRO ENTRANDO. Os demais mudam estado, não caixa. */
export const PAID_EVENT_TYPES: readonly string[] = [
  'INITIAL_PURCHASE',
  'RENEWAL',
  'NON_RENEWING_PURCHASE',
  'NON_SUBSCRIPTION_PURCHASE',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
]

/** Um evento do RevenueCat, reduzido ao que decide receita. */
export interface RcEvent {
  /** O id do evento no RevenueCat. É a chave de deduplicação: o webhook pode reentregar. */
  eventId: string
  userId: string
  type: string
  /** `PRODUCTION` ou `SANDBOX`. Só o primeiro é dinheiro. */
  environment: string
  store: string
  productId: string
  currency: string
  /** `price_in_purchased_currency` — o que a pessoa pagou, na moeda dela. */
  priceLocal: number
  /** `price` — o mesmo valor em dólar, calculado pelo RevenueCat. */
  priceUsd: number
  /** `takehome_percentage` — a fração que sobra depois da loja. `null` quando não veio. */
  takehome: number | null
  countryCode: string | null
  /** `NORMAL`, `TRIAL`, `INTRO`. Teste não é receita. */
  periodType: string
  purchasedAt: string
  /** ISO, ou `null` em compra de uma vez. É ele que separa recorrente de avulso. */
  expiresAt: string | null
  /** O parceiro que trouxe esta pessoa, vindo de `subscriber_attributes.partner_id`. */
  partnerId: string | null
}

/** Um número, ou `null` — e `null` nunca vira zero. */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isoFromMs(value: unknown): string | null {
  const ms = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(ms) || ms <= 0) return null
  return new Date(ms).toISOString()
}

/**
 * Um evento do jsonb, ou `null` quando aquela linha não descreve uma compra.
 *
 * DEVOLVE `null` EM VEZ DE UM EVENTO COM ZEROS. Uma linha `expired` gravada pelo sistema tem
 * `metadata` vazio, e transformá-la num evento de R$ 0,00 encheria a receita de transações que
 * nunca existiram — o mesmo motivo de `null` nunca virar zero no resto do módulo.
 */
export function parseRcEvent(metadata: unknown): RcEvent | null {
  if (!metadata || typeof metadata !== 'object') return null
  const outer = metadata as Record<string, unknown>
  const raw = outer.full_event
  if (!raw || typeof raw !== 'object') return null

  const event = raw as Record<string, unknown>
  const priceLocal = Number(event.price_in_purchased_currency)
  const userId = typeof event.app_user_id === 'string' ? event.app_user_id : ''
  const eventId = typeof event.id === 'string' ? event.id : ''
  if (!userId || !eventId || !Number.isFinite(priceLocal)) return null

  // O parceiro chega dentro de `subscriber_attributes`, num objeto `{ value, updated_at_ms }`.
  const attributes = (event.subscriber_attributes ?? {}) as Record<string, { value?: unknown }>
  const partner = attributes.partner_id?.value
  const purchasedAt = isoFromMs(event.purchased_at_ms) ?? isoFromMs(event.event_timestamp_ms)

  return {
    eventId,
    userId,
    type: String(event.type ?? ''),
    environment: String(event.environment ?? ''),
    store: String(event.store ?? ''),
    productId: String(event.product_id ?? ''),
    currency: String(event.currency ?? ''),
    priceLocal,
    priceUsd: numberOrNull(event.price) ?? 0,
    // `Number(null)` é ZERO e é finito, então a checagem tem de ser pela AUSÊNCIA e não pelo
    // resultado da conversão: com o teste de finitude sozinho, um `takehome_percentage` nulo
    // virava 0 e zerava a receita líquida daquela transação em silêncio.
    takehome: numberOrNull(event.takehome_percentage),
    countryCode: typeof event.country_code === 'string' ? event.country_code : null,
    periodType: String(event.period_type ?? 'NORMAL'),
    purchasedAt: purchasedAt ?? '',
    expiresAt: isoFromMs(event.expiration_at_ms),
    partnerId: typeof partner === 'string' && partner ? partner : null,
  }
}

/** Um total numa moeda. `net` já desconta a loja. */
export interface RevenueLine {
  currency: string
  grossCents: number
  netCents: number
  transactions: number
}

export interface AppRevenue {
  /** O que JÁ ENTROU, por moeda. Inclui produto descontinuado: ele foi vendido. */
  realized: RevenueLine[]
  /** O que VOLTA, por moeda — só assinatura com vencimento futuro. */
  recurring: RevenueLine[]
  /** Assinaturas vivas hoje, contadas. */
  activeSubscriptions: number
  /** Transações pagas de produção, contadas. */
  paidTransactions: number
  /** Transações de sandbox ignoradas. Sobem contadas para o filtro ser visível. */
  sandboxIgnored: number
  /** Compras em período de teste. Não são receita, e não somem. */
  trials: number
  /** O total em dólar que o próprio RevenueCat calculou. A única ponte entre as moedas. */
  grossUsdCents: number
  netUsdCents: number
}

/** Centavos a partir de um valor decimal da loja. */
function cents(value: number): number {
  return Math.round(value * 100)
}

function addTo(lines: Map<string, RevenueLine>, event: RcEvent): void {
  const line = lines.get(event.currency) ?? {
    currency: event.currency,
    grossCents: 0,
    netCents: 0,
    transactions: 0,
  }
  const gross = cents(event.priceLocal)
  line.grossCents += gross
  // Sem `takehome` o líquido é o bruto: supor uma comissão de loja seria descontar um número que
  // ninguém informou, e o erro cairia sempre para menos.
  line.netCents += Math.round(gross * (event.takehome ?? 1))
  line.transactions += 1
  lines.set(event.currency, line)
}

function sorted(lines: Map<string, RevenueLine>): RevenueLine[] {
  return Array.from(lines.values()).sort((a, b) => a.currency.localeCompare(b.currency))
}

/**
 * A receita do app, realizada e recorrente.
 *
 * DEDUPLICA POR `eventId`. O RevenueCat reentrega webhook quando a EF demora a responder, e uma
 * renovação contada duas vezes é receita inventada.
 *
 * `on` é injetado e não lido do relógio: uma assinatura que expira hoje decide o número, e um
 * resultado que muda sozinho entre duas execuções do mesmo teste não é demonstrável.
 */
export function summarizeAppRevenue(events: readonly RcEvent[], on: string): AppRevenue {
  const realized = new Map<string, RevenueLine>()
  const recurring = new Map<string, RevenueLine>()
  const seen = new Set<string>()

  let sandboxIgnored = 0
  let trials = 0
  let grossUsdCents = 0
  let netUsdCents = 0

  // A assinatura viva de cada pessoa: o evento pago MAIS RECENTE com vencimento no futuro. Sem
  // isto, quem renovou seis vezes contaria como seis assinantes.
  const live = new Map<string, RcEvent>()

  for (const event of events) {
    if (seen.has(event.eventId)) continue
    seen.add(event.eventId)

    if (!PAID_EVENT_TYPES.includes(event.type)) continue
    if (event.environment !== 'PRODUCTION') {
      if (event.priceLocal > 0) sandboxIgnored += 1
      continue
    }
    // Período de teste não cobra. Ele é contado para a tela poder dizer que existe.
    if (event.periodType === 'TRIAL') {
      trials += 1
      continue
    }
    if (!(event.priceLocal > 0)) continue

    addTo(realized, event)
    grossUsdCents += cents(event.priceUsd)
    netUsdCents += Math.round(cents(event.priceUsd) * (event.takehome ?? 1))

    // Compra de uma vez não tem vencimento, e é isso que a mantém fora do recorrente sem precisar
    // de uma lista de produtos descontinuados.
    if (!event.expiresAt || event.expiresAt.slice(0, 10) < on) continue
    const known = live.get(event.userId)
    if (!known || event.purchasedAt > known.purchasedAt) live.set(event.userId, event)
  }

  for (const event of live.values()) addTo(recurring, event)

  return {
    realized: sorted(realized),
    recurring: sorted(recurring),
    activeSubscriptions: live.size,
    paidTransactions: Array.from(realized.values()).reduce((sum, line) => sum + line.transactions, 0),
    sandboxIgnored,
    trials,
    grossUsdCents,
    netUsdCents,
  }
}

/** Quanto uma pessoa já pagou, na moeda dela. */
export interface UserSpend {
  userId: string
  currency: string
  grossCents: number
  netCents: number
  transactions: number
  countryCode: string | null
  partnerId: string | null
}

/**
 * Quanto cada cliente JÁ PAGOU — o pedido do operador em 2026-09-02.
 *
 * Uma linha por pessoa e moeda: quem comprou em duas moedas tem duas linhas, porque somá-las
 * exigiria câmbio. Ordenado pelo maior gasto, que é como a pergunta é feita.
 */
export function spendByUser(events: readonly RcEvent[]): UserSpend[] {
  const rows = new Map<string, UserSpend>()
  const seen = new Set<string>()

  for (const event of events) {
    if (seen.has(event.eventId)) continue
    seen.add(event.eventId)
    if (event.environment !== 'PRODUCTION') continue
    if (!PAID_EVENT_TYPES.includes(event.type)) continue
    if (event.periodType === 'TRIAL' || !(event.priceLocal > 0)) continue

    const key = `${event.userId}|${event.currency}`
    const row = rows.get(key) ?? {
      userId: event.userId,
      currency: event.currency,
      grossCents: 0,
      netCents: 0,
      transactions: 0,
      countryCode: event.countryCode,
      partnerId: event.partnerId,
    }
    const gross = cents(event.priceLocal)
    row.grossCents += gross
    row.netCents += Math.round(gross * (event.takehome ?? 1))
    row.transactions += 1
    // O parceiro pode chegar só numa das compras: a primeira que o traz manda.
    if (!row.partnerId && event.partnerId) row.partnerId = event.partnerId
    rows.set(key, row)
  }

  return Array.from(rows.values()).sort(
    (a, b) => b.grossCents - a.grossCents || a.userId.localeCompare(b.userId)
  )
}

/** O que um parceiro tem a receber, na moeda em que a compra foi feita. */
export interface PartnerCommission {
  partnerId: string
  currency: string
  /** A base: o LÍQUIDO da Tuggi, depois da loja. Comissão sobre o bruto pagaria a loja duas vezes. */
  baseCents: number
  commissionCents: number
  transactions: number
}

/**
 * A comissão de cada parceiro, sobre a receita que o QR dele produziu.
 *
 * A BASE É O LÍQUIDO, e o contrato diz isso: *"a receita líquida dos turistas que chegarem pelo
 * seu QR Code"*. Calcular sobre o bruto pagaria ao parceiro uma fatia da comissão que a loja já
 * levou.
 *
 * `rates` chega de `core.clients.commission_rate` e é FRAÇÃO (0,20 = 20%). Parceiro sem taxa
 * cadastrada não vira zero: ele fica de fora e a tela o nomeia, porque zero por cima de uma
 * receita real é uma dívida que some.
 */
export function commissionByPartner(
  events: readonly RcEvent[],
  rates: ReadonlyMap<string, number>
): { lines: PartnerCommission[]; withoutRate: string[] } {
  const lines = new Map<string, PartnerCommission>()
  const withoutRate = new Set<string>()

  for (const spend of spendByUser(events)) {
    if (!spend.partnerId) continue
    const rate = rates.get(spend.partnerId)
    if (rate === undefined || !Number.isFinite(rate)) {
      withoutRate.add(spend.partnerId)
      continue
    }

    const key = `${spend.partnerId}|${spend.currency}`
    const line = lines.get(key) ?? {
      partnerId: spend.partnerId,
      currency: spend.currency,
      baseCents: 0,
      commissionCents: 0,
      transactions: 0,
    }
    line.baseCents += spend.netCents
    line.commissionCents += Math.round(spend.netCents * rate)
    line.transactions += spend.transactions
    lines.set(key, line)
  }

  return {
    lines: Array.from(lines.values()).sort(
      (a, b) => b.commissionCents - a.commissionCents || a.partnerId.localeCompare(b.partnerId)
    ),
    withoutRate: Array.from(withoutRate).sort(),
  }
}

// ── A RECEITA DO APP NO CALENDÁRIO ────────────────────────────────────────────────────────────

/** Quantos dias uma assinatura dura, quando o payload permite medir. */
function periodDays(event: RcEvent): number | null {
  if (!event.expiresAt || !event.purchasedAt) return null
  const days = Math.round(
    (Date.parse(event.expiresAt) - Date.parse(event.purchasedAt)) / 86_400_000
  )
  return days > 0 && days <= 400 ? days : null
}

function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

export interface AppMonthly {
  /** Mês → centavos, na moeda pedida. Passado é cobrança feita; futuro é renovação prevista. */
  byMonth: Record<string, number>
  /** O que ficou de fora por NÃO TER TAXA DECLARADA. Nomeado, nunca convertido por palpite. */
  otherCurrencies: RevenueLine[]
  /** Assinaturas vivas que a projeção fez renovar. */
  projectedSubscriptions: number
  /** As taxas declaradas que esta leitura usou. Vazia quando nada foi convertido. */
  appliedRates: FxRate[]
}

/**
 * A RECEITA DO APP, MÊS A MÊS — o que já foi cobrado e o que vai renovar.
 *
 * DUAS METADES, COMO NO LADO DO PARCEIRO. Até o mês corrente, a linha é a soma das cobranças que
 * o RevenueCat de fato registrou. Do mês seguinte em diante, é a renovação de cada assinatura
 * viva, rolada pelo período dela — o mesmo que `billingSchedule` faz com a mensalidade, só que o
 * ciclo aqui vem do payload (`expiration_at_ms − purchased_at_ms`) e não do dia 20.
 *
 * COMPRA DE UMA VEZ NÃO RENOVA. O passe de 7 dias entra no passado, onde ele foi vendido, e
 * some do futuro — não tem vencimento, então não há o que rolar. É a mesma regra que separa
 * `realized` de `recurring`, aplicada ao tempo.
 *
 * O EURO VIRA REAL — PELA TAXA DECLARADA, e isto MUDOU em 2026-09-02 por decisão do operador.
 *
 * Antes, o gráfico tinha um eixo e uma moeda só: tudo que não fosse a moeda pedida ia para
 * `otherCurrencies`, nomeado em vez de somado, porque converter exigiria uma taxa que ninguém
 * tinha declarado. Aqui isso doía mais do que em qualquer outro lugar do módulo: dos 3 assinantes
 * de loja ativos, 2 estão em fuso europeu, então a linha em reais desenhava um TERÇO da receita
 * do app e parecia a receita inteira.
 *
 * Com `finance.fx_rates`, a taxa existe, tem procedência e não oscila (`lib/finance/fx.ts`). O que
 * segue voltando em `otherCurrencies` é só a moeda SEM taxa declarada — e essa continua nomeada,
 * nunca somada, porque a regra que não mudou é a que importa: nada aqui inventa câmbio.
 *
 * A RENOVAÇÃO É CONVERTIDA NO MÊS EM QUE ELA VENCE, e não no da compra que a originou. O preço
 * da loja está em euro; se o operador declarar outra vigência, a renovação de março usa a taxa de
 * março. Com uma taxa fixa os dois caminhos dão o mesmo número — a diferença só aparece quando
 * existir uma segunda vigência, e aí ela importa.
 */
export function appRevenueByMonth(
  events: readonly RcEvent[],
  input: {
    from: string
    months: number
    currency: string
    on: string
    /** As taxas declaradas. Vazio = nada converte, e a moeda volta nomeada como antes. */
    rates?: readonly FxRate[]
  }
): AppMonthly {
  const rates = input.rates ?? []
  const applied = new Map<string, FxRate>()

  /** O valor da cobrança na moeda do gráfico, ou `null` quando falta taxa. */
  const inReport = (event: RcEvent, on: string): number | null => {
    const gross = cents(event.priceLocal)
    if (event.currency === input.currency) return gross
    const converted = convertCents(gross, event.currency, input.currency, rates, on)
    if (converted === null) return null
    const used = rateOn(rates, event.currency, on)
    if (used) applied.set(event.currency, used)
    return converted
  }

  const byMonth: Record<string, number> = {}
  const others = new Map<string, RevenueLine>()
  const seen = new Set<string>()
  const live = new Map<string, RcEvent>()

  const span = Math.max(1, Math.min(36, Math.round(input.months)))
  const window: string[] = []
  let cursor = input.from
  for (let index = 0; index < span; index += 1) {
    window.push(cursor)
    byMonth[cursor] = 0
    const year = Number(cursor.slice(0, 4))
    const month = Number(cursor.slice(5, 7))
    cursor = month >= 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
  }
  const last = window[window.length - 1]

  for (const event of events) {
    if (seen.has(event.eventId)) continue
    seen.add(event.eventId)
    if (event.environment !== 'PRODUCTION') continue
    if (!PAID_EVENT_TYPES.includes(event.type)) continue
    if (event.periodType === 'TRIAL' || !(event.priceLocal > 0)) continue

    // O que JÁ foi cobrado, no mês em que foi — convertido pela taxa que valia naquele dia.
    const month = monthOf(event.purchasedAt)
    const amount = inReport(event, event.purchasedAt.slice(0, 10))
    if (amount === null) {
      // Sem taxa declarada, a venda não entra no eixo: ela volta nomeada, com o total dela.
      addTo(others, event)
      continue
    }
    if (month in byMonth) byMonth[month] += amount

    // A assinatura viva de cada pessoa, para rolar as renovações.
    if (!event.expiresAt || event.expiresAt.slice(0, 10) < input.on) continue
    const known = live.get(event.userId)
    if (!known || event.purchasedAt > known.purchasedAt) live.set(event.userId, event)
  }

  let projected = 0
  for (const event of live.values()) {
    const days = periodDays(event)
    if (days === null) continue
    projected += 1

    // Cada vencimento é uma cobrança nova. Rola até sair da janela — e o teto de iterações
    // existe porque um período de um dia daria centenas de voltas.
    let due = Date.parse(event.expiresAt as string)
    for (let guard = 0; guard < 64; guard += 1) {
      const month = new Date(due).toISOString().slice(0, 7)
      if (month > last) break
      // Convertida NO MÊS DO VENCIMENTO: o preço está em euro, e é a taxa daquele mês que diz
      // quanto ele vale em real.
      const renewal = inReport(event, `${month}-01`)
      if (month in byMonth && renewal !== null) byMonth[month] += renewal
      due += days * 86_400_000
    }
  }

  return {
    byMonth,
    otherCurrencies: sorted(others),
    projectedSubscriptions: projected,
    appliedRates: Array.from(applied.values()).sort((a, b) =>
      a.currency.localeCompare(b.currency)
    ),
  }
}
