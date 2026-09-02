/**
 * A TAXONOMIA DO CUSTO DA OPERAÇÃO — categoria, natureza, e o que a folha tem de especial.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Até 2026-09-02 `finance.fixed_costs` tinha uma coluna de texto
 * livre (`label`) e mais nada: dois operadores digitando "Supabase" e "supabase (banco)" produzem
 * duas linhas que nenhum agrupamento reencontra, e a pergunta "para onde vai o dinheiro?" não
 * tinha resposta que não fosse ler a lista inteira. A planilha que o operador já mantinha
 * (`Tuggi_PL_Breakeven_12m`) respondia essa pergunta com SEIS categorias, e são elas que estão
 * aqui — o vocabulário não foi inventado, foi lido de quem já o usava.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * CATEGORIA E NATUREZA SÃO DOIS EIXOS, E CONFUNDI-LOS É O ERRO CARO
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `category` diz PARA ONDE o dinheiro vai (infraestrutura, pessoas, marketing…). `nature` diz
 * COMO ele se comporta quando a operação cresce: `fixed` chega igual com 10 ou com 500 parceiros,
 * `variable` acompanha o volume. A mesma categoria tem os dois — a Supabase é infraestrutura fixa
 * e a API de IA é infraestrutura variável — e é por isso que uma coluna só não serviria.
 *
 * SÓ O FIXO ENTRA NO PONTO DE EQUILÍBRIO. Um custo que cresce junto com a receita não é uma conta
 * que um número de parceiros "cobre": ele já está do outro lado, dentro da margem. Pôr o variável
 * no denominador do equilíbrio pediria parceiros para pagar um custo que só existe porque os
 * parceiros existem — a definição de circular. Quem garante isso é `lib/finance/structure.ts`.
 *
 * `kind` (`one_off` | `recurring`) É CADÊNCIA, NÃO NATUREZA, e continua sendo outra coluna. Uma
 * feira é variável e acontece uma vez; uma assinatura é fixa e volta todo mês; a impressora é
 * fixa e foi comprada uma vez. Os três casos existem, e um eixo só não os separa.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * A FOLHA É MARCADA PORQUE ELA DECIDE O IMPOSTO, NÃO PORQUE ELA É CARA
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `payroll` marca o que entra na base do FATOR R do Simples Nacional: folha (pró-labore, salários,
 * FGTS, provisão de férias e 13º) dividida pela receita bruta dos últimos 12 meses. Cruzando 28%,
 * a empresa migra do Anexo V (alíquota inicial de 15,5%) para o Anexo III (6%) — uma diferença que
 * muda o resultado mais do que quase qualquer corte de custo desta lista.
 *
 * Por isso a marca é do ITEM e não da categoria: benefícios (VR, VT, plano) são "Pessoas" e NÃO
 * entram na base; um estagiário sob a Lei 11.788 também não. Ler "categoria = Pessoas" como
 * "é folha" inflaria o fator R e faria a empresa se planejar para um anexo que ela não alcançou.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * O CATÁLOGO ABAIXO É SUGESTÃO, NUNCA CADASTRO
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `COST_ITEM_HINTS` é a lista de itens que a planilha do operador previa — inclusive os que ainda
 * custam zero (tráfego pago, freelancers, seguros). Eles NÃO viram linha no banco: um custo de
 * R$ 0,00 cadastrado afirma "esta conta existe e é zero", quando o fato é "esta conta ainda não
 * existe". A diferença é a mesma que este módulo inteiro defende entre `null` e zero.
 *
 * O que eles fazem é preencher o formulário: escolher "Tráfego pago" já traz categoria
 * `marketing` e natureza `variable`, e o operador não precisa decidir de novo o que a planilha
 * já decidiu. É também a resposta à pergunta "quais custos variáveis vamos ter?" — ela está aqui,
 * escrita, antes de o primeiro real ser gasto.
 *
 * OS RÓTULOS NÃO ESTÃO AQUI, e sim em `messages/*.json` sob `Finance.costItems.<id>`. O id é o
 * SSOT e não muda; a tradução é de quem lê a tela. Um rótulo em português neste arquivo apareceria
 * em espanhol para o operador que escolheu espanhol.
 *
 * Puro: sem fetch, sem Supabase, sem React.
 */

/**
 * PARA ONDE O DINHEIRO VAI. Seis, e são as da planilha do operador — não uma sétima nomenclatura
 * para ele reaprender.
 *
 * `other` EXISTE E É NECESSÁRIO. Sem ele, um custo que não cabe nas cinco primeiras seria forçado
 * para dentro da menos errada, e a categoria deixaria de significar alguma coisa. Uma linha em
 * `other` é um pedido de categoria nova, visível como tal.
 */
export const COST_CATEGORIES = [
  'infrastructure',
  'tools',
  'people',
  'marketing',
  'admin',
  'other',
] as const

export type CostCategory = (typeof COST_CATEGORIES)[number]

/** COMO O CUSTO SE COMPORTA QUANDO A OPERAÇÃO CRESCE. Só `fixed` entra no ponto de equilíbrio. */
export const COST_NATURES = ['fixed', 'variable'] as const

export type CostNature = (typeof COST_NATURES)[number]

/**
 * CUSTO OU CRÉDITO — e o crédito não é um custo negativo.
 *
 * A planilha do operador tem dois blocos: preço cheio em cima, descontos e créditos embaixo. Os
 * dois têm exatamente as mesmas colunas, e por isso moram na mesma tabela — mas com o sinal
 * declarado, nunca embutido no valor. `amount_cents >= 0` continua valendo para os dois: um
 * crédito de R$ 1.411,58 é lançado como 141158 com `entry_type = 'credit'`, e não como −141158.
 *
 * POR QUE NÃO UM VALOR NEGATIVO. Um total que soma tudo cru daria o número certo por acidente e
 * o errado assim que alguém perguntasse "quanto custa a preço cheio?" — que é a pergunta que
 * decide se a empresa sobrevive ao fim do crédito promocional. Com o sinal em coluna própria,
 * bruto, crédito e líquido são três leituras da mesma lista, e nenhuma delas é uma subtração
 * que alguém precisa lembrar de fazer.
 */
export const COST_ENTRY_TYPES = ['cost', 'credit'] as const

export type CostEntryType = (typeof COST_ENTRY_TYPES)[number]

export function isCostCategory(value: unknown): value is CostCategory {
  return typeof value === 'string' && (COST_CATEGORIES as readonly string[]).includes(value)
}

export function isCostNature(value: unknown): value is CostNature {
  return typeof value === 'string' && (COST_NATURES as readonly string[]).includes(value)
}

export function isCostEntryType(value: unknown): value is CostEntryType {
  return typeof value === 'string' && (COST_ENTRY_TYPES as readonly string[]).includes(value)
}

/**
 * Um item que a operação prevê ter — com a categoria e a natureza já decididas.
 *
 * `payroll` só é `true` no que entra na BASE DO FATOR R. Benefício e estagiário são "Pessoas" e
 * ficam de fora dela de propósito (ver o cabeçalho).
 */
export interface CostItemHint {
  /** Estável e nunca traduzido. É a chave de `Finance.costItems.<id>` nos três idiomas. */
  id: string
  category: CostCategory
  nature: CostNature
  /** Moeda em que a conta costuma chegar. Sugestão do formulário, jamais uma conversão. */
  currency: 'BRL' | 'USD'
  payroll?: true
}

/**
 * O QUE A OPERAÇÃO PREVÊ GASTAR — lido da planilha do operador em 2026-09-02.
 *
 * A ordem é a da planilha, por categoria, porque é a ordem em que o operador já lê estes itens.
 * Nenhum deles vira linha no banco por existir aqui.
 */
export const COST_ITEM_HINTS: readonly CostItemHint[] = [
  // ── Infraestrutura & Tecnologia ───────────────────────────────────────────────────────────
  { id: 'supabase', category: 'infrastructure', nature: 'fixed', currency: 'USD' },
  { id: 'hosting_cdn', category: 'infrastructure', nature: 'fixed', currency: 'USD' },
  // As duas linhas de IA são VARIÁVEIS e é o que as separa da assinatura dos assistentes: elas
  // são cobradas por token gerado, então um catálogo com o dobro de POIs custa o dobro.
  { id: 'ai_content_apis', category: 'infrastructure', nature: 'variable', currency: 'BRL' },
  { id: 'ai_tts_apis', category: 'infrastructure', nature: 'variable', currency: 'BRL' },
  { id: 'maps_platform', category: 'infrastructure', nature: 'variable', currency: 'USD' },
  { id: 'apple_developer', category: 'infrastructure', nature: 'fixed', currency: 'USD' },
  { id: 'google_play', category: 'infrastructure', nature: 'fixed', currency: 'USD' },
  // Comissão sobre assinatura: cresce com a receita do app, e por isso não é fixo.
  { id: 'revenuecat', category: 'infrastructure', nature: 'variable', currency: 'USD' },
  { id: 'domains', category: 'infrastructure', nature: 'fixed', currency: 'USD' },
  { id: 'workspace_email', category: 'infrastructure', nature: 'fixed', currency: 'BRL' },

  // ── Ferramentas & Software ────────────────────────────────────────────────────────────────
  { id: 'ai_assistants', category: 'tools', nature: 'fixed', currency: 'BRL' },
  { id: 'design_tools', category: 'tools', nature: 'fixed', currency: 'USD' },
  { id: 'video_audio_editing', category: 'tools', nature: 'fixed', currency: 'BRL' },
  { id: 'stock_assets', category: 'tools', nature: 'fixed', currency: 'USD' },

  // ── Pessoas ───────────────────────────────────────────────────────────────────────────────
  { id: 'pro_labore', category: 'people', nature: 'fixed', currency: 'BRL', payroll: true },
  { id: 'clt_salaries', category: 'people', nature: 'fixed', currency: 'BRL', payroll: true },
  { id: 'fgts', category: 'people', nature: 'fixed', currency: 'BRL', payroll: true },
  { id: 'vacation_13th', category: 'people', nature: 'fixed', currency: 'BRL', payroll: true },
  // Benefício NÃO entra na base do fator R. Marcá-lo inflaria o índice e faria a empresa se
  // planejar para o Anexo III sem ter alcançado os 28%.
  { id: 'benefits', category: 'people', nature: 'fixed', currency: 'BRL' },
  { id: 'freelancers', category: 'people', nature: 'variable', currency: 'BRL' },
  // Estagiário sob a Lei 11.788 não é folha para efeito de fator R.
  { id: 'intern', category: 'people', nature: 'fixed', currency: 'BRL' },

  // ── Marketing & Vendas ────────────────────────────────────────────────────────────────────
  { id: 'paid_traffic', category: 'marketing', nature: 'variable', currency: 'BRL' },
  { id: 'influencer_revshare', category: 'marketing', nature: 'variable', currency: 'BRL' },
  { id: 'qr_displays', category: 'marketing', nature: 'variable', currency: 'BRL' },
  { id: 'fairs_events', category: 'marketing', nature: 'variable', currency: 'BRL' },
  { id: 'business_travel', category: 'marketing', nature: 'variable', currency: 'BRL' },
  { id: 'content_production', category: 'marketing', nature: 'variable', currency: 'BRL' },

  // ── Administrativo & Financeiro ───────────────────────────────────────────────────────────
  { id: 'accounting', category: 'admin', nature: 'fixed', currency: 'BRL' },
  { id: 'bank_fees', category: 'admin', nature: 'fixed', currency: 'BRL' },
  { id: 'digital_certificate', category: 'admin', nature: 'fixed', currency: 'BRL' },
  { id: 'legal', category: 'admin', nature: 'fixed', currency: 'BRL' },
  { id: 'insurance', category: 'admin', nature: 'fixed', currency: 'BRL' },
  { id: 'consulting', category: 'admin', nature: 'variable', currency: 'BRL' },
]

/** Os itens previstos de uma categoria, na ordem da planilha. */
export function costItemsOf(category: CostCategory): CostItemHint[] {
  return COST_ITEM_HINTS.filter((item) => item.category === category)
}

/** O item pelo id, ou `undefined` — nunca um palpite de categoria. */
export function costItemById(id: string): CostItemHint | undefined {
  return COST_ITEM_HINTS.find((item) => item.id === id)
}
