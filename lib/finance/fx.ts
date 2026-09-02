/**
 * A TAXA DECLARADA — porque o dólar é volátil e o custo da operação não pode ser.
 *
 * O PEDIDO, 2026-09-02: *"o problema do dólar é que ele é volátil. Vamos pegar a média dos
 * últimos meses e previsões para poder fixar um valor médio, assim não precisamos calcular dólar
 * todos os meses. Os valores em dólar, euro ou outras moedas precisam ser convertidas para
 * reais."*
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * ESTA É UMA TAXA DE PLANEJAMENTO, E NÃO A COTAÇÃO DO DIA
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A diferença não é semântica, é de uso. Uma cotação de mercado responde "quanto custa comprar
 * dólar agora"; esta taxa responde "com que número a empresa planeja". Ela é FIXA de propósito:
 * se o custo fixo mensal mudasse toda vez que o câmbio se mexesse, o ponto de equilíbrio mudaria
 * junto, e um KPI que oscila sozinho para de ser lido. O operador prefere um número estável e
 * levemente conservador a um número exato e inútil — e essa é uma decisão de negócio, não de
 * engenharia.
 *
 * POR ISSO O NÚMERO NÃO É BUSCADO EM LUGAR NENHUM. Não há API de câmbio neste módulo, e não deve
 * haver: uma taxa que muda sozinha entre duas leituras faria dois relatórios do MESMO mês
 * discordarem, e ninguém saberia dizer qual dos dois estava certo. A taxa é uma LINHA DIGITADA,
 * com procedência escrita ao lado, e trocá-la é um ato datado — não um efeito colateral.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * TROCAR A TAXA É INSERIR LINHA NOVA, NUNCA UM UPDATE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * O mesmo desenho de `pass_prices` e de `standard_rates`, pela mesma razão: a taxa de hoje não
 * pode reprecificar o custo de julho. Se em janeiro o operador declarar R$ 5,40, a conta da
 * Supabase de julho continua convertida pela taxa que valia em julho — o histórico não se move
 * porque alguém mudou a premissa de hoje. Por isso `rateOn` procura a MAIOR vigência que já
 * começou, e nunca a mais recente da lista.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * SEM TAXA DECLARADA, NADA É CONVERTIDO — e a tela diz qual moeda ficou de fora
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `convertCents` devolve `null`, e quem chama soma zero em lugar nenhum. Um custo em libra que
 * virasse real por um palpite entraria no ponto de equilíbrio como se fosse fato — a mesma classe
 * de mentira que este módulo inteiro existe para impedir. `null` é ausência de taxa, nunca zero.
 *
 * A CONVERSÃO É POR LINHA, E DEPOIS SE SOMA. O contrário (somar em dólar e converter o total)
 * daria um número diferente assim que existirem duas vigências, porque cada linha tem a sua data.
 *
 * Puro: sem fetch, sem Supabase, sem React. Provado por `tests/api/finance-fx.test.ts`.
 */

/** A moeda da empresa. Toda taxa é declarada CONTRA ela, e ela nunca tem taxa própria. */
export const BASE_CURRENCY = 'BRL'

export interface FxRate {
  /** ISO 4217 da moeda de ORIGEM. Nunca `BRL`. */
  currency: string
  /** Quantos reais vale UMA unidade da moeda. `5.20` = US$ 1,00 vale R$ 5,20. */
  rateToBrl: number
  /** `YYYY-MM-DD`. A partir de quando esta taxa vale. */
  effectiveFrom: string
  /** De onde o número veio. Uma taxa sem procedência é um chute com cara de fato. */
  source: string
}

/**
 * A taxa que valia NAQUELA data, ou `null`.
 *
 * A MAIOR VIGÊNCIA JÁ COMEÇADA, e nunca a última da lista. Uma taxa declarada para janeiro que
 * fosse aplicada ao custo de julho reescreveria o passado toda vez que o operador revisasse a
 * premissa — e o relatório de julho passaria a discordar do que já foi lido em julho.
 */
export function rateOn(
  rates: readonly FxRate[],
  currency: string,
  on: string
): FxRate | null {
  let best: FxRate | null = null
  for (const rate of rates) {
    if (rate.currency !== currency) continue
    if (rate.effectiveFrom > on) continue
    if (best === null || rate.effectiveFrom > best.effectiveFrom) best = rate
  }
  return best
}

/**
 * Um valor em centavos, de uma moeda para outra, ou `null` quando falta taxa.
 *
 * `null` NÃO É ZERO, e é por isso que esta função não tem valor de fallback. Quem chama decide o
 * que fazer com a ausência — e em todo este módulo a decisão é a mesma: nomear a moeda que ficou
 * de fora, nunca somar zero por ela.
 *
 * A TRAVESSIA PASSA PELO REAL porque é contra ele que toda taxa é declarada: de USD para EUR são
 * duas conversões, e as duas precisam de taxa. Uma delas faltando devolve `null` — meia conversão
 * não é uma conversão.
 */
export function convertCents(
  cents: number,
  from: string,
  to: string,
  rates: readonly FxRate[],
  on: string
): number | null {
  if (!Number.isFinite(cents)) return null
  if (from === to) return cents

  let inBase = cents
  if (from !== BASE_CURRENCY) {
    const rate = rateOn(rates, from, on)
    if (rate === null) return null
    inBase = cents * rate.rateToBrl
  }

  if (to === BASE_CURRENCY) return Math.round(inBase)

  const target = rateOn(rates, to, on)
  if (target === null) return null
  return Math.round(inBase / target.rateToBrl)
}
