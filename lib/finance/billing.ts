/**
 * O CALENDÁRIO DA COBRANÇA — quando cada mensalidade de fato vence.
 *
 * ESTE ARQUIVO EXISTE PORQUE A RECEITA ESTAVA SENDO CONTADA POR UM RELÓGIO QUE O CONTRATO NÃO
 * CONHECE. `assessClient` contava meses inteiros desde `partner.clients.approved_at` — que não é
 * a assinatura, não é a publicação, e ignora o dia do vencimento. Um parceiro aprovado em 1º de
 * agosto e publicado em 25 aparecia com um mês faturado que ninguém cobrou.
 *
 * AS TRÊS REGRAS SÃO DO INSTRUMENTO, e cada uma está escrita nele:
 *
 *  1. **Vigência e cobrança são coisas distintas.** A vigência começa na assinatura; a
 *     contraprestação *"somente começa a correr na data da publicação, no aplicativo"*
 *     (cláusula `term`). Assinar não cobra — publicar cobra.
 *  2. **O primeiro vencimento é o dia 20 do mês SEGUINTE ao da publicação**, e a primeira fatura
 *     *"compreende o período proporcional entre a data da publicação e o último dia daquele mês,
 *     somado ao mês do vencimento"* (cláusula `price_and_payment`).
 *  3. **A mensalidade corresponde ao mês em que vence** — não ao mês vencido. Quem publica em 25
 *     de agosto paga em 20 de setembro, e aquela fatura cobre 7 dias de agosto mais setembro
 *     inteiro.
 *
 * O DIA 20 NÃO É REDECLARADO AQUI. Ele vem de `DUE_DAY_OF_MONTH`, no template do contrato, que é
 * quem o define para o instrumento inteiro. Um segundo 20 neste arquivo seria a mesma classe de
 * defeito que este módulo persegue: dois lugares dizendo a mesma coisa até o dia em que um muda.
 *
 * O HORIZONTE É PREMISSA, E É POR ISSO QUE ELE ENTRA POR PARÂMETRO. O contrato em vigor é por
 * **prazo indeterminado** — não há término em doze meses, e o que acontece no aniversário é o
 * reajuste. Quando a tela projeta doze faturas e para, ela está aplicando uma premissa do
 * operador (decisão de 2026-09-02), não lendo o contrato. `null` é o contrato como ele é.
 *
 * Puro: sem fetch, sem Supabase, sem React. Provado por `tests/api/finance-billing.test.ts`.
 */

import { DUE_DAY_OF_MONTH } from '@/lib/contract/template'

export { DUE_DAY_OF_MONTH }

/**
 * De onde saiu a data que inicia a cobrança, da mais firme para a menos.
 *
 * `publication` é o marco do contrato: `core.attractions.approved_at`, que `setApproved` carimba,
 * ou a trilha `PUBLISH_PARTNER_PLACE`.
 *
 * `liberation` é `partner.clients.approved_at` — o dia em que a parceria foi liberada. Ela existe
 * porque o carimbo de publicação NÃO EXISTE nos parceiros antigos: medido em 2026-09-02, os 7
 * pagantes estão com `approved = true` e `approved_at` nulo, e a trilha tem zero linhas de
 * publicação em 37.575. Decisão do operador na mesma data: *"eles já estão liberados no app desde
 * o cadastro e liberação, esses dias serão contados"*. É o marco mais próximo da publicação que
 * este banco guarda.
 *
 * `signature` é o último recurso, e ele é o pior dos três — o aceite vem DEPOIS da liberação, e
 * contar dele apagaria justamente os dias que já foram entregues. Ele existe só para o parceiro
 * que não tem nem liberação registrada.
 */
export type BillingStartSource = 'publication' | 'liberation' | 'signature'

export interface BillingStart {
  /** `YYYY-MM-DD`. */
  at: string
  /**
   * Qual das três fontes respondeu. Só `publication` é o marco que o contrato nomeia; as outras
   * duas viajam marcadas até a tela, porque um número aproximado com cara de exato é a única
   * coisa que este módulo não pode produzir.
   */
  source: BillingStartSource
}

/** Uma fatura do calendário. */
export interface Invoice {
  /** O mês do vencimento, `YYYY-MM`. */
  month: string
  /** `YYYY-MM-DD` — dia 20 daquele mês. */
  dueOn: string
  cents: number
  /** Verdadeira na primeira: ela carrega o proporcional da publicação junto do mês cheio. */
  proRata: boolean
}

function daysInMonth(year: number, monthIndex: number): number {
  // Dia 0 do mês seguinte é o último dia deste. `Date.UTC` e não `new Date(...)`: num fuso
  // negativo, o construtor local devolveria o mês anterior para o dia 1.
  return new Date(Date.UTC(year, monthIndex, 0)).getUTCDate()
}

function addMonths(month: string, count: number): string {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7)) - 1 + count
  return `${year + Math.floor(index / 12)}-${String((((index % 12) + 12) % 12) + 1).padStart(2, '0')}`
}

/** `YYYY-MM` de uma data. `null` quando a data não é uma data. */
export function monthOfDate(date: string): string | null {
  const month = String(date ?? '').slice(0, 7)
  return /^\d{4}-\d{2}$/.test(month) ? month : null
}

/**
 * O mês do PRIMEIRO vencimento: o seguinte ao da publicação.
 *
 * Publicar no dia 25 e publicar no dia 2 dão o mesmo primeiro vencimento — o que muda entre eles
 * é o proporcional, não a data. É o que a cláusula diz, e é o que evita a pergunta "publiquei dia
 * 19, pago dia 20?" ter duas respostas.
 */
export function firstDueMonth(start: string): string | null {
  const month = monthOfDate(start)
  return month === null ? null : addMonths(month, 1)
}

/**
 * A fração proporcional da primeira fatura — da publicação ao último dia daquele mês.
 *
 * Publicação no dia 1º devolve 1 (o mês inteiro); no último dia devolve um dia. Nunca zero: o dia
 * da publicação é dia de serviço prestado, e arredondá-lo para fora seria a Tuggi dar um dia.
 */
export function proRataFraction(start: string): number {
  const year = Number(start.slice(0, 4))
  const monthIndex = Number(start.slice(5, 7))
  const day = Number(start.slice(8, 10))
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) return 0

  const total = daysInMonth(year, monthIndex)
  if (!(total > 0) || day < 1 || day > total) return 0
  return (total - day + 1) / total
}

/**
 * O calendário de faturas de UM parceiro, dentro de uma janela.
 *
 * `horizonInvoices` corta o calendário em N faturas — a premissa de doze do operador. `null` não
 * corta, que é o contrato como ele é escrito.
 *
 * Devolve vazio quando não há data que inicie a cobrança: sem publicação e sem assinatura não
 * existe primeira fatura, e supor uma seria faturar contra um marco inventado.
 */
export function billingSchedule(input: {
  start: string | null
  feeCents: number | null
  horizonInvoices: number | null
  /** `YYYY-MM` — o primeiro mês da janela. */
  from: string
  months: number
}): Invoice[] {
  const fee = input.feeCents
  if (!input.start || fee === null || fee <= 0) return []

  const firstMonth = firstDueMonth(input.start)
  if (firstMonth === null) return []

  const proRataCents = Math.round(fee * proRataFraction(input.start))
  const span = Math.max(0, Math.round(input.months))
  const invoices: Invoice[] = []

  for (let offset = 0; offset < span; offset += 1) {
    const month = addMonths(input.from, offset)
    // Quantas faturas já correram até este mês, contando a primeira como número 1.
    const index = monthsBetween(firstMonth, month) + 1
    if (index < 1) continue
    if (input.horizonInvoices !== null && index > input.horizonInvoices) break

    invoices.push({
      month,
      dueOn: `${month}-${String(DUE_DAY_OF_MONTH).padStart(2, '0')}`,
      cents: index === 1 ? fee + proRataCents : fee,
      proRata: index === 1,
    })
  }

  return invoices
}

/** Quantos meses de `from` até `to`, ambos `YYYY-MM`. Negativo quando `to` é anterior. */
function monthsBetween(from: string, to: string): number {
  return (
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7)))
  )
}

/**
 * O QUE JÁ FOI FATURADO até uma data — a receita realizada por competência.
 *
 * Uma fatura só conta depois de VENCER. No dia 19 de setembro, o parceiro publicado em agosto
 * ainda não deve nada: contar o mês porque ele começou seria faturar adiantado, o mesmo erro que
 * `wholeMonthsBetween` cometia ao contar do dia da aprovação.
 *
 * `invoices` é a contagem de faturas vencidas — o que a tela chama de meses faturados. A primeira
 * conta como uma, embora carregue o proporcional junto: ela é uma cobrança, não duas.
 */
export function invoicedThrough(input: {
  start: string | null
  feeCents: number | null
  horizonInvoices: number | null
  /** `YYYY-MM-DD`. */
  asOf: string
}): { invoices: number; cents: number } {
  const empty = { invoices: 0, cents: 0 }
  const fee = input.feeCents
  if (!input.start || fee === null || fee <= 0) return empty

  const firstMonth = firstDueMonth(input.start)
  const asOfMonth = monthOfDate(input.asOf)
  if (firstMonth === null || asOfMonth === null) return empty

  // O mês corrente só conta se o dia 20 já passou. `slice(8, 10)` e não `getDate()`: a string é
  // o fato, e passá-la por `Date` num fuso negativo devolveria o dia anterior.
  const dayPassed = Number(input.asOf.slice(8, 10)) >= DUE_DAY_OF_MONTH
  const monthsElapsed = monthsBetween(firstMonth, asOfMonth)
  let due = monthsElapsed + (dayPassed ? 1 : 0)

  if (due <= 0) return empty
  if (input.horizonInvoices !== null) due = Math.min(due, input.horizonInvoices)

  const proRataCents = Math.round(fee * proRataFraction(input.start))
  return { invoices: due, cents: due * fee + proRataCents }
}
