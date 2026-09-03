/**
 * O FINANCEIRO — o schema `finance` e as leituras que respondem "este parceiro se paga?".
 *
 * NADA AQUI DECIDE. Custo unitário, receita, veredito, ponto de equilíbrio: tudo é decidido em
 * `lib/finance/*`, que é puro e provado sem banco. Este módulo junta os dados, chama aquelas
 * funções e grava o que elas devolveram. É a mesma divisão que `material-order-service.ts` faz
 * com `order-queue.ts`, e é o que torna a regra inteira demonstrável sem subir Postgres.
 *
 * LEITURAS EM LOTE, NUNCA UMA POR PARCEIRO. PostgREST não embeda entre schemas — as compras
 * estão em `finance`, o parceiro em `partner` e o usuário do app em `drive` — então cada tabela
 * é lida uma vez para a tela inteira. Sete round trips para o quadro todo, não sete por linha.
 *
 * O LADO DO APP OU RESPONDE OU DERRUBA A LEITURA, e isso é decisão e não descuido. `no_return`
 * ("não paga e não trouxe ninguém") e `non_monetary_return` ("não paga mas trouxe quem comprou")
 * se distinguem SÓ por essa leitura. Se ela falhasse em silêncio, todo parceiro não pagante
 * viraria prejuízo na tela, e a tela estaria acusando parceiros por causa de uma falha de rede.
 * Então `loadFinanceOverview` devolve `null` e a rota responde 503: a tela diz que não carregou,
 * que é verdade, em vez de dizer um veredito, que não seria.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import { derivePartnerPlan, paymentStance } from '@/lib/clients/partner-plan'
import { loadLiveContractStates } from '@/lib/services/partner-contract-tier'
import type { FinanceProduct } from '@/lib/finance/catalog'
import type { FinancePurchase, StandardRate } from '@/lib/finance/unit-cost'
import type { OrderRecipeOverride, RecipeLine } from '@/lib/finance/recipe'
import type { PackagingRule } from '@/lib/finance/packaging'
import type { FixedCostRecord } from '@/lib/finance/structure'
import type { FxRate } from '@/lib/finance/fx'
import {
  isCostCategory,
  isCostEntryType,
  isCostNature,
  type CostCategory,
  type CostEntryType,
  type CostNature,
} from '@/lib/finance/cost-taxonomy'
import type { PartnerMixRow, PassPrice } from '@/lib/finance/overview'
import type { BillingStart } from '@/lib/finance/billing'
import { parseRcEvent, type RcEvent } from '@/lib/finance/app-revenue'
import { consumesCost, planConsumption, type OrderShipment } from '@/lib/finance/consumption'
import type { MaterialKind } from '@/lib/partner-form/fields'
import {
  assessClient,
  suppressSmallCohortPurchases,
  type ClientFinanceFacts,
  type ClientProfitability,
  type ConsumptionRecord,
} from '@/lib/finance/profitability'

const SCHEMA = 'finance'

function finance() {
  return getSupabaseService().schema(SCHEMA)
}

// ── O catálogo ────────────────────────────────────────────────────────────────────────────────

export interface FinanceCatalog {
  products: FinanceProduct[]
  recipes: RecipeLine[]
  rates: StandardRate[]
  /** A embalagem do envio — `ceil(peças / capacidade)`, com vigência. */
  packaging: PackagingRule[]
}

/**
 * O catálogo, ou `null`.
 *
 * `null` E NÃO UM CATÁLOGO VAZIO, e a diferença custa dinheiro de verdade: com o catálogo vazio,
 * `planConsumption` manda todo item para `skipped` e `recordConsumption` grava uma linha sem
 * preço — que o `unique (order_id, product_id)` torna PERMANENTE. Um erro de leitura passageiro
 * congelaria o custo daquele pedido em "não sei" para sempre.
 */
export async function loadCatalog(): Promise<FinanceCatalog | null> {
  const [products, recipes, rates, packaging] = await Promise.all([
    finance()
      .from('products')
      .select('id, name, role, material_kind, purchase_unit, is_active')
      .order('role')
      .order('name'),
    finance()
      .from('product_recipe')
      .select('parent_product_id, component_product_id, quantity, effective_from'),
    finance()
      .from('standard_rates')
      .select('rate_id, applies_to, amount_cents, currency, effective_from'),
    finance().from('packaging_rule').select('product_id, capacity, effective_from'),
  ])

  if (products.error || recipes.error || rates.error || packaging.error) return null

  return {
    products: (products.data ?? []).map(toProduct),
    recipes: (recipes.data ?? []).map((row: Record<string, unknown>) => ({
      parentProductId: String(row.parent_product_id),
      componentProductId: String(row.component_product_id),
      quantity: Number(row.quantity),
      effectiveFrom: String(row.effective_from),
    })),
    rates: (rates.data ?? []).map((row: Record<string, unknown>) => ({
      rateId: String(row.rate_id),
      appliesTo: String(row.applies_to),
      amountCents: Number(row.amount_cents),
      currency: String(row.currency),
      effectiveFrom: String(row.effective_from),
    })),
    packaging: (packaging.data ?? []).map((row: Record<string, unknown>) => ({
      productId: String(row.product_id),
      capacity: Number(row.capacity),
      effectiveFrom: String(row.effective_from),
    })),
  }
}

function toProduct(row: Record<string, unknown>): FinanceProduct {
  return {
    id: String(row.id),
    name: String(row.name),
    role: row.role === 'component' ? 'component' : 'deliverable',
    materialKind: (row.material_kind as FinanceProduct['materialKind']) ?? null,
    purchaseUnit: String(row.purchase_unit ?? 'unidade'),
    isActive: row.is_active !== false,
  }
}

/**
 * A compra como a TELA a lê — a de `unit-cost.ts` mais o que é papel de nota fiscal.
 *
 * `FinancePurchase` fica com o mínimo que o CÁLCULO precisa, e é só ele que `unitCost` recebe:
 * fornecedor e número de nota não entram numa conta de custo, e tê-los no tipo puro convidaria
 * alguém a decidir preço por fornecedor um dia.
 */
export interface FinancePurchaseRow extends FinancePurchase {
  supplier: string | null
  invoiceRef: string | null
  notes: string | null
}

/** As compras, ou `null`. Mesmo motivo do catálogo: sem elas, o custo gravado seria um `null` eterno. */
export async function loadPurchases(): Promise<FinancePurchaseRow[] | null> {
  const { data, error } = await finance()
    .from('purchases')
    .select(
      'id, product_id, units, units_yield, pieces, total_cents, freight_cents, currency, purchased_at, supplier, invoice_ref, notes'
    )
    .order('purchased_at', { ascending: true })

  if (error) return null
  const rows = (data ?? []) as unknown as Record<string, unknown>[]

  return rows.map((row) => ({
    id: String(row.id),
    productId: String(row.product_id),
    units: Number(row.units),
    unitsYield: Number(row.units_yield ?? 1),
    pieces: Number(row.pieces),
    totalCents: Number(row.total_cents),
    freightCents: Number(row.freight_cents ?? 0),
    currency: String(row.currency),
    purchasedAt: String(row.purchased_at),
    supplier: (row.supplier as string | null) ?? null,
    invoiceRef: (row.invoice_ref as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
  }))
}

export async function loadOrderOverrides(
  orderIds: string[]
): Promise<OrderRecipeOverride[] | null> {
  if (orderIds.length === 0) return []
  const { data, error } = await finance()
    .from('order_recipe_override')
    .select('order_id, parent_product_id, component_product_id, quantity')
    .in('order_id', orderIds)

  // `null` E NÃO `[]`, e aqui a diferença é PERMANENTE. Uma leitura recusada devolvia lista
  // vazia, `planConsumption` rodava com a receita PADRÃO em vez da específica do pedido, e a
  // linha era gravada em `material_consumption` com custo unitário e snapshot errados. O
  // `unique (order_id, product_id)` então a congela: a segunda transição não corrige, ela é
  // ignorada por `on conflict do nothing`.
  //
  // É exatamente o desastre que o cabeçalho de `loadCatalog` descreve para justificar o `null`
  // dele — e esta era a única das quatro leituras de `recordConsumption` que ficava de fora da
  // guarda. Apontado pelo QA em 2026-09-03.
  if (error) return null

  return (data ?? []).map((row: Record<string, unknown>) => ({
    orderId: String(row.order_id),
    parentProductId: String(row.parent_product_id),
    componentProductId: String(row.component_product_id),
    quantity: Number(row.quantity),
  }))
}

/** O que saiu de cada pedido. Ausência de linha é pendência, nunca zero e nunca o que foi pedido. */
export async function loadOrderShipments(orderIds?: string[]): Promise<OrderShipment[] | null> {
  let query = finance().from('order_shipment').select('order_id, product_id, quantity')
  if (orderIds && orderIds.length > 0) query = query.in('order_id', orderIds.slice(0, 200))

  const { data, error } = await query
  if (error) return null

  return (data ?? []).map((row: Record<string, unknown>) => ({
    orderId: String(row.order_id),
    productId: String(row.product_id),
    quantity: Number(row.quantity),
  }))
}

/**
 * Registra quanto saiu de um pedido.
 *
 * `upsert` e não `insert`: corrigir uma contagem é o caso normal — pessoas contam errado, e a
 * quantidade é um fato apurado por uma pessoa. O que NÃO se corrige por aqui é o custo unitário,
 * que fica congelado na linha de consumo.
 */
export async function saveOrderShipment(input: {
  orderId: string
  lines: { productId: string; quantity: number; requestedQuantity: number | null }[]
  createdBy?: string | null
}): Promise<boolean> {
  if (input.lines.length === 0) return false

  const { error } = await finance()
    .from('order_shipment')
    .upsert(
      input.lines.map((line) => ({
        order_id: input.orderId,
        product_id: line.productId,
        quantity: line.quantity,
        requested_quantity: line.requestedQuantity,
        updated_at: new Date().toISOString(),
        created_by: input.createdBy ?? null,
      })),
      { onConflict: 'order_id,product_id' }
    )

  return !error
}

export async function loadFixedCosts(): Promise<FixedCostRecord[] | null> {
  const { data, error } = await finance()
    .from('fixed_costs')
    // UMA STRING SÓ, e não uma concatenação: o tipo de `select` é inferido do LITERAL, e um
    // `'a' + 'b'` quebrado em duas linhas faz o supabase-js devolver `GenericStringError`.
    .select('id, label, kind, amount_cents, currency, incurred_at, period_months, category, nature, entry_type, is_payroll, ends_at')
    // A LINHA REMOVIDA SAI DE TODA CONTA, EM TODO MÊS. É o que a separa de `ends_at`: aquela diz
    // que um custo real acabou numa data e segue contando nos meses em que valeu; esta diz que a
    // linha foi um erro e nunca deveria ter contado. Filtrar aqui, na única leitura, é o que
    // garante que nenhuma superfície do módulo precise lembrar da regra.
    .is('voided_at', null)
    .order('incurred_at', { ascending: false })

  // `null` QUANDO O BANCO RECUSA — e nunca uma lista vazia. É a invariante nº 6 deste módulo, e
  // ela cobrou o preço em 2026-09-03: o `.is('voided_at', null)` acima subiu antes da migração
  // que cria a coluna, o PostgREST recusou a consulta, e `data ?? []` transformou "não consegui
  // ler" em "não há custo nenhum". A tela desenhou R$ 0,00 de custo estrutural, R$ 0,00 de
  // desembolso e "Nenhum custo fixo registrado" sobre um banco com dezesseis linhas.
  //
  // Uma lista vazia por erro AFIRMA que a operação não custa nada. É a única coisa que este
  // módulo não pode dizer por engano, e era a última leitura de custo que ainda podia dizê-la.
  if (error) return null

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    label: String(row.label),
    kind: row.kind === 'recurring' ? 'recurring' : 'one_off',
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    incurredAt: String(row.incurred_at),
    periodMonths: row.period_months === null ? null : Number(row.period_months),
    // O VOCABULÁRIO É CONFERIDO NA LEITURA, e não assumido. A coluna nasceu com `default 'other'`
    // e o CHECK do banco guarda o resto, mas uma linha escrita por fora (painel, script) não pode
    // virar uma categoria que o TypeScript jura existir. O que não bate cai em `other` — que se
    // lê como "ninguém classificou", e não como uma classificação.
    category: isCostCategory(row.category) ? row.category : 'other',
    // Já `nature` e `entryType` NÃO têm um valor neutro para onde cair: um crédito lido como
    // custo dobraria a conta em vez de zerá-la. O default do banco é o mesmo que o daqui, e a
    // igualdade entre os dois é o que torna a leitura previsível.
    nature: isCostNature(row.nature) ? row.nature : 'fixed',
    entryType: isCostEntryType(row.entry_type) ? row.entry_type : 'cost',
    isPayroll: row.is_payroll === true,
    endsAt: row.ends_at === null || row.ends_at === undefined ? null : String(row.ends_at),
  }))
}

// ── Escritas ──────────────────────────────────────────────────────────────────────────────────

/**
 * `not_found` é 404, `write_failed` é 503, e a diferença importa para quem lê o erro. Uma linha
 * que não existe — ou que não está no estado que a ação exige — não é um banco fora do ar, e
 * responder "serviço indisponível" manda o operador procurar uma falha que não houve.
 */
export type WriteOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: 'write_failed' | 'not_found' }

export async function createPurchase(input: {
  productId: string
  units: number
  unitsYield: number
  totalCents: number
  freightCents: number
  currency: string
  purchasedAt: string
  supplier?: string | null
  invoiceRef?: string | null
  notes?: string | null
  createdBy?: string | null
}): Promise<WriteOutcome> {
  const { data, error } = await finance()
    .from('purchases')
    .insert({
      product_id: input.productId,
      units: input.units,
      units_yield: input.unitsYield,
      total_cents: input.totalCents,
      freight_cents: input.freightCents,
      currency: input.currency,
      purchased_at: input.purchasedAt,
      supplier: input.supplier ?? null,
      invoice_ref: input.invoiceRef ?? null,
      notes: input.notes ?? null,
      created_by: input.createdBy ?? null,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, reason: 'write_failed' }
  return { ok: true, id: String((data as { id: string }).id) }
}

/**
 * Cadastra um produto.
 *
 * O `id` É DERIVADO DO NOME E NUNCA MUDA DEPOIS. Ele aparece em `product_recipe`,
 * `order_shipment`, `purchases` e em toda linha de `material_consumption` já congelada — trocá-lo
 * quebraria o elo com custo que já foi apurado. Por isso o cadastro é a única escrita do produto:
 * não existe edição, e um produto novo é um produto novo.
 *
 * `material_kind` só faz sentido em `deliverable`, e é único: dois produtos disputando o mesmo
 * tipo da esteira tornariam o custo de um pedido ambíguo, e o índice do banco recusa.
 */
export async function createProduct(input: {
  id: string
  name: string
  role: 'deliverable' | 'component'
  materialKind: string | null
  purchaseUnit: string
  createdBy?: string | null
}): Promise<{ ok: true } | { ok: false; reason: 'taken' | 'write_failed' }> {
  const { error } = await finance()
    .from('products')
    .insert({
      id: input.id,
      name: input.name,
      role: input.role,
      material_kind: input.role === 'deliverable' ? input.materialKind : null,
      purchase_unit: input.purchaseUnit,
      created_by: input.createdBy ?? null,
    })

  if (!error) return { ok: true }
  // 23505 é violação de unicidade: ou o id já existe, ou outro produto já responde por aquele
  // tipo da esteira. Os dois são "esse nome já está em uso", e não uma falha nossa.
  const taken = (error as { code?: string }).code === '23505'
  return { ok: false, reason: taken ? 'taken' : 'write_failed' }
}

/**
 * Cadastra uma vigência de receita. NUNCA edita a anterior.
 *
 * Trocar 2 QR por 3 é um fato NOVO a partir de uma data, e não uma correção do passado: o custo
 * já congelado nas linhas de consumo continua valendo, e `resolveRecipe` escolhe pela data. Um
 * `update` aqui apagaria a única prova de quanto o display custava em agosto.
 */
export async function addRecipeVersion(input: {
  parentProductId: string
  componentProductId: string
  quantity: number
  effectiveFrom: string
  createdBy?: string | null
}): Promise<WriteOutcome> {
  const { data, error } = await finance()
    .from('product_recipe')
    .upsert(
      {
        parent_product_id: input.parentProductId,
        component_product_id: input.componentProductId,
        quantity: input.quantity,
        effective_from: input.effectiveFrom,
        created_by: input.createdBy ?? null,
      },
      { onConflict: 'parent_product_id,component_product_id,effective_from' }
    )
    .select('id')
    .single()

  if (error || !data) return { ok: false, reason: 'write_failed' }
  return { ok: true, id: String((data as { id: string }).id) }
}

/**
 * Cadastra uma vigência de embalagem — quantas peças cabem numa.
 *
 * Mesma regra da receita: nova data, nunca `update`. O envelope de 50 de hoje não pode
 * reinterpretar o envio que saiu quando ele cabia 30, e o custo daquele envio está congelado.
 */
export async function addPackagingRule(input: {
  productId: string
  capacity: number
  effectiveFrom: string
  createdBy?: string | null
}): Promise<WriteOutcome> {
  const { data, error } = await finance()
    .from('packaging_rule')
    .upsert(
      {
        product_id: input.productId,
        capacity: input.capacity,
        effective_from: input.effectiveFrom,
        created_by: input.createdBy ?? null,
      },
      { onConflict: 'product_id,effective_from' }
    )
    .select('id')
    .single()

  if (error || !data) return { ok: false, reason: 'write_failed' }
  return { ok: true, id: String((data as { id: string }).id) }
}

/**
 * Apaga uma vigência de receita ou de embalagem.
 *
 * PERMITIDO, E PELA MESMA RAZÃO DA COMPRA: isto é CADASTRO DE REGRA, não lançamento de dinheiro.
 * Uma regra cadastrada errada não tem oposto — em 2026-09-01 alguém registrou "cada display leva
 * 50 envelopes" quando queria dizer "1 envelope a cada 50 displays", e o único caminho de saída
 * seria uma vigência de quantidade zero, que a rota recusa porque zero não é uma receita.
 *
 * APAGAR ≠ ENCERRAR. Apagar diz "esta linha nunca deveria ter existido"; cadastrar uma vigência
 * nova diz "a partir de tal data passou a ser outra coisa". Os dois existem porque são fatos
 * diferentes, e o custo já congelado em `material_consumption` não muda em nenhum dos dois casos.
 */
export async function deleteRecipeVersion(input: {
  parentProductId: string
  componentProductId: string
  effectiveFrom: string
}): Promise<boolean> {
  const { data, error } = await finance()
    .from('product_recipe')
    .delete()
    .eq('parent_product_id', input.parentProductId)
    .eq('component_product_id', input.componentProductId)
    .eq('effective_from', input.effectiveFrom)
    .select('id')

  return !error && Array.isArray(data) && data.length > 0
}

export async function deletePackagingRule(input: {
  productId: string
  effectiveFrom: string
}): Promise<boolean> {
  const { data, error } = await finance()
    .from('packaging_rule')
    .delete()
    .eq('product_id', input.productId)
    .eq('effective_from', input.effectiveFrom)
    .select('id')

  return !error && Array.isArray(data) && data.length > 0
}

/** Cadastra uma vigência de taxa padrão. Mesma regra da receita: nova data, nunca `update`. */
export async function addStandardRate(input: {
  rateId: string
  appliesTo: string
  amountCents: number
  currency: string
  effectiveFrom: string
  createdBy?: string | null
}): Promise<WriteOutcome> {
  const { data, error } = await finance()
    .from('standard_rates')
    .upsert(
      {
        rate_id: input.rateId,
        applies_to: input.appliesTo,
        amount_cents: input.amountCents,
        currency: input.currency,
        effective_from: input.effectiveFrom,
        created_by: input.createdBy ?? null,
      },
      { onConflict: 'rate_id,effective_from' }
    )
    .select('id')
    .single()

  if (error || !data) return { ok: false, reason: 'write_failed' }
  return { ok: true, id: String((data as { id: string }).id) }
}

/**
 * Corrige uma compra.
 *
 * ELA MUDA O QUE SERÁ DERIVADO, NÃO O QUE JÁ FOI LANÇADO. O custo por peça sai daqui
 * (`unit-cost.ts`), então corrigir uma nota corrige todo cálculo futuro; as linhas já gravadas em
 * `material_consumption` congelaram o preço que valia no dia e continuam como estão. É a mesma
 * separação que a vigência da receita faz — ver a migration 04.
 *
 * `product_id` NÃO é editável: trocar o produto de uma compra moveria peças de um estoque para
 * outro sem que nada registrasse a saída. Errou o produto? Apague e cadastre.
 */
export async function updatePurchase(
  id: string,
  patch: {
    units?: number
    unitsYield?: number
    totalCents?: number
    freightCents?: number
    currency?: string
    purchasedAt?: string
    supplier?: string | null
    invoiceRef?: string | null
    notes?: string | null
  }
): Promise<boolean> {
  const update: Record<string, unknown> = {}
  if (patch.units !== undefined) update.units = patch.units
  if (patch.unitsYield !== undefined) update.units_yield = patch.unitsYield
  if (patch.totalCents !== undefined) update.total_cents = patch.totalCents
  if (patch.freightCents !== undefined) update.freight_cents = patch.freightCents
  if (patch.currency !== undefined) update.currency = patch.currency
  if (patch.purchasedAt !== undefined) update.purchased_at = patch.purchasedAt
  if (patch.supplier !== undefined) update.supplier = patch.supplier
  if (patch.invoiceRef !== undefined) update.invoice_ref = patch.invoiceRef
  if (patch.notes !== undefined) update.notes = patch.notes
  if (Object.keys(update).length === 0) return false

  const { data, error } = await finance().from('purchases').update(update).eq('id', id).select('id')
  return !error && Array.isArray(data) && data.length > 0
}

/**
 * Apaga uma compra.
 *
 * Permitido aqui e proibido nas tabelas de lançamento, e a diferença é o que a linha É: esta é o
 * registro de uma nota, não um custo apurado contra um parceiro. Uma nota errada não tem oposto —
 * não existe comprar menos uma bobina — e deixá-la no lugar envenena toda derivação futura.
 *
 * Devolve `false` quando nada foi apagado, o que significa que a compra não existe (outra aba já
 * a apagou). O chamador transforma isso em 404, não em erro.
 */
export async function deletePurchase(id: string): Promise<boolean> {
  const { data, error } = await finance().from('purchases').delete().eq('id', id).select('id')
  return !error && Array.isArray(data) && data.length > 0
}

export async function createClientCostEntry(input: {
  clientId: string
  label: string
  amountCents: number
  currency: string
  incurredAt: string
  notes?: string | null
  createdBy?: string | null
}): Promise<WriteOutcome> {
  const { data, error } = await finance()
    .from('client_cost_entries')
    .insert({
      client_id: input.clientId,
      label: input.label,
      amount_cents: input.amountCents,
      currency: input.currency,
      incurred_at: input.incurredAt,
      notes: input.notes ?? null,
      created_by: input.createdBy ?? null,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, reason: 'write_failed' }
  return { ok: true, id: String((data as { id: string }).id) }
}

/**
 * AS TAXAS DECLARADAS — a premissa de câmbio, com procedência.
 *
 * UMA LINHA COM TAXA INVÁLIDA É DESCARTADA, e não corrigida. `numeric` volta do PostgREST como
 * texto, e um `Number()` que devolvesse `NaN` viraria uma conversão silenciosa para lixo: a
 * Supabase custaria `NaN` reais, e `NaN` soma com tudo sem estourar nada. Sem a linha, a moeda
 * volta nomeada em `ignoredCurrencies` — que é exatamente o que "não sei converter" quer dizer.
 */
export async function loadFxRates(): Promise<FxRate[] | null> {
  const { data, error } = await finance()
    .from('fx_rates')
    .select('currency, rate_to_brl, effective_from, source')
    .order('effective_from', { ascending: false })

  // `null` NÃO É LISTA VAZIA, e aqui os dois se pareciam demais. Lista vazia significa "ninguém
  // declarou taxa" — um estado legítimo e previsto: a moeda estrangeira volta nomeada em
  // `ignoredCurrencies` e a tela manda o operador declarar uma. `null` significa "não consegui
  // ler", e mandaria o mesmo operador declarar uma taxa numa tabela que pode nem existir.
  //
  // Foi o que aconteceu em 2026-09-03: `finance.fx_rates` ainda não tinha sido criada, este
  // `error` foi descartado, e o custo fixo mensal apareceu R$ 213,15 menor porque a Supabase em
  // dólar saiu calada da soma. O total não mentia — `ignoredCurrencies` nomeava o USD —, mas a
  // CAUSA estava trocada, e é ela que decide o que o operador faz a seguir.
  if (error) return null

  const rates: FxRate[] = []
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const rateToBrl = Number(row.rate_to_brl)
    if (!Number.isFinite(rateToBrl) || rateToBrl <= 0) continue
    rates.push({
      currency: String(row.currency),
      rateToBrl,
      effectiveFrom: String(row.effective_from),
      source: String(row.source ?? ''),
    })
  }
  return rates
}

export async function createFixedCost(input: {
  label: string
  kind: 'one_off' | 'recurring'
  amountCents: number
  currency: string
  incurredAt: string
  periodMonths: number | null
  category: CostCategory
  nature: CostNature
  entryType: CostEntryType
  isPayroll: boolean
  endsAt: string | null
  notes?: string | null
  createdBy?: string | null
}): Promise<WriteOutcome> {
  const { data, error } = await finance()
    .from('fixed_costs')
    .insert({
      label: input.label,
      kind: input.kind,
      amount_cents: input.amountCents,
      currency: input.currency,
      incurred_at: input.incurredAt,
      period_months: input.kind === 'recurring' ? input.periodMonths : null,
      category: input.category,
      nature: input.nature,
      entry_type: input.entryType,
      is_payroll: input.isPayroll,
      ends_at: input.endsAt,
      notes: input.notes ?? null,
      created_by: input.createdBy ?? null,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, reason: 'write_failed' }
  return { ok: true, id: String((data as { id: string }).id) }
}

/** O que uma correção pode tocar. `kind` e `entryType` NÃO estão aqui — ver `amendFixedCost`. */
export interface FixedCostAmendment {
  label?: string
  amountCents?: number
  currency?: string
  incurredAt?: string
  category?: CostCategory
  nature?: CostNature
  isPayroll?: boolean
  periodMonths?: number | null
  endsAt?: string | null
  notes?: string | null
}

/** O que mudou numa correção, campo a campo. É o que o log de auditoria escreve. */
export interface FixedCostDiff {
  field: string
  from: string
  to: string
}

/** As colunas do banco por campo da correção. Uma tabela em vez de dez `if`. */
const AMENDABLE: Record<keyof FixedCostAmendment, string> = {
  label: 'label',
  amountCents: 'amount_cents',
  currency: 'currency',
  incurredAt: 'incurred_at',
  category: 'category',
  nature: 'nature',
  isPayroll: 'is_payroll',
  periodMonths: 'period_months',
  endsAt: 'ends_at',
  notes: 'notes',
}

/**
 * CORRIGIR UM CUSTO — o valor estava errado, a data estava errada, a categoria estava errada.
 *
 * POR QUE CORRIGIR E NÃO LANÇAR O OPOSTO. Contra-lançamento é para FATO: ele afirma que
 * aconteceram duas coisas, o gasto e a devolução. Um erro de digitação não é um gasto que
 * aconteceu, e cancelá-lo com um crédito deixaria o PREÇO CHEIO errado para sempre — que é
 * exatamente a pergunta que o par custo/crédito existe para responder ("quanto isto custa quando
 * o benefício acabar?"). Além disso, trocaria um mês errado por dois: o erro em julho e a
 * correção em setembro.
 *
 * A regra que separa as duas está no fechamento do período: estorna-se quando alguém JÁ AGIU
 * sobre aquele mês — declarou ao contador, à Receita, a um sócio. Nada aqui é publicado para
 * terceiros a partir destas linhas, e por isso corrigir dá UM número certo em vez de dois
 * errados que se cancelam. Onde a regra é a outra, o schema já a impõe: `material_consumption`
 * registra fato do mundo e não tem `delete`.
 *
 * `kind` E `entryType` FICAM DE FORA, e a exclusão é a decisão. Trocar `cost` por `credit` inverte
 * o sinal da linha; trocar `recurring` por `one_off` muda a forma dela. Nos dois casos o que se
 * quer não é a mesma linha corrigida, é OUTRA linha — e para isso existem remover e cadastrar.
 * Uma correção que pode virar qualquer coisa deixa de ser correção e vira um `UPDATE` cru.
 *
 * DEVOLVE O DIFF, e é ele que torna a correção auditável: sem o ANTES, o log diria que alguém
 * mexeu sem dizer no quê, e um total que mudou entre duas leituras ficaria sem explicação.
 */
export async function amendFixedCost(
  id: string,
  patch: FixedCostAmendment
): Promise<
  { ok: true; id: string; diff: FixedCostDiff[] } | { ok: false; reason: string }
> {
  // A LEITURA VEM PRIMEIRO, e não é luxo: é a única chance de saber o ANTES. Depois do `update`
  // ele não existe em lugar nenhum — esta tabela não versiona linha.
  const { data: before, error: readError } = await finance()
    .from('fixed_costs')
    .select('label, amount_cents, currency, incurred_at, category, nature, is_payroll, period_months, ends_at, notes')
    .eq('id', id)
    .is('voided_at', null)
    .single()

  if (readError || !before) return { ok: false, reason: 'not_found' }

  const previous = before as Record<string, unknown>

  // A COERÊNCIA DE DATAS SÓ DÁ PARA CONFERIR AQUI, e é por isso que ela não mora na rota: a
  // comparação precisa do valor que a correção NÃO mandou. Trocar só a data de início pode
  // deixá-la depois de uma vigência já gravada, e trocar só a vigência pode deixá-la antes do
  // início — nos dois casos o `CHECK` do banco recusa, e sem esta guarda o erro voltava como 503,
  // isto é, "o banco caiu", quando o que houve foi um pedido incoerente. QA, 2026-09-03.
  const nextIncurred = patch.incurredAt ?? String(previous.incurred_at)
  const nextEnds = patch.endsAt !== undefined ? patch.endsAt : (previous.ends_at as string | null)
  if (nextEnds !== null && nextEnds < nextIncurred) {
    return { ok: false, reason: 'invalid_ends_at' }
  }

  const changes: Record<string, unknown> = {}
  const diff: FixedCostDiff[] = []

  for (const [field, column] of Object.entries(AMENDABLE)) {
    const asked = patch[field as keyof FixedCostAmendment]
    if (asked === undefined) continue

    // SÓ O QUE DE FATO MUDOU ENTRA NO DIFF. Um log que lista dez campos porque o formulário
    // reenviou todos é um log que ninguém lê — e o que importa é o campo que mudou.
    const was = previous[column] ?? null
    const now = asked ?? null
    if (String(was) === String(now)) continue

    changes[column] = now
    diff.push({ field, from: was === null ? '—' : String(was), to: now === null ? '—' : String(now) })
  }

  if (diff.length === 0) return { ok: true, id, diff }

  const { data, error } = await finance()
    .from('fixed_costs')
    .update(changes)
    .eq('id', id)
    .is('voided_at', null)
    .select('id')
    .single()

  if (error || !data) return { ok: false, reason: 'write_failed' }
  return { ok: true, id: String((data as { id: string }).id), diff }
}

/**
 * ENCERRAR UM CUSTO RECORRENTE — a assinatura acabou, e o histórico fica.
 *
 * É UM `UPDATE` DE UMA COLUNA SÓ, e de propósito. Encerrar não reescreve valor, moeda nem data de
 * início: o custo foi aquilo até aquele dia. Quem quer registrar que o PREÇO mudou não encerra —
 * encerra e abre linha nova, como a Supabase de US$ 32,49 para US$ 40,99.
 */
export async function endFixedCost(id: string, endsAt: string): Promise<WriteOutcome> {
  const { data, error } = await finance()
    .from('fixed_costs')
    .update({ ends_at: endsAt })
    .eq('id', id)
    // ENCERRAR SÓ ALCANÇA O RECORRENTE, e a guarda mora aqui porque o banco NÃO a tem: o único
    // CHECK sobre `ends_at` compara com `incurred_at`, e nada impede a coluna num `one_off`. O
    // comentário da rota afirmava o contrário — o QA conferiu as migrações em 2026-09-03 e
    // mostrou que não existe. Sem isto, um PATCH gravava "encerrado em X" num desembolso único e
    // o log afirmava um fato impossível.
    .eq('kind', 'recurring')
    // Uma linha já removida não se encerra: seriam dois estados contraditórios na mesma linha,
    // e o `voided_at` venceria em toda leitura de qualquer jeito.
    .is('voided_at', null)
    .select('id')
    .single()

  // `PGRST116` é "a consulta não devolveu linha": o id não existe, ou a linha não estava no
  // estado que esta ação exige. Isso é 404 e não 503 — devolver "serviço indisponível" mandaria
  // o operador procurar uma falha de banco que não houve.
  if (error?.code === 'PGRST116' || !data) return { ok: false, reason: 'not_found' }
  if (error) return { ok: false, reason: 'write_failed' }
  return { ok: true, id: String((data as { id: string }).id) }
}

/**
 * REMOVER UM CUSTO — a linha foi um erro, e sai de toda conta.
 *
 * NÃO APAGA, MARCA, pelo mesmo motivo de `finance.excluded_accounts`: uma linha de dinheiro que
 * some sem rastro é indistinguível de uma leitura que falhou pela metade. Quem reabrir o
 * relatório de agosto no mês que vem e achar outro total precisa poder ver que alguém corrigiu um
 * erro — com o nome de quem corrigiu e o motivo.
 *
 * A RAZÃO É OBRIGATÓRIA e o CHECK do banco a exige junto com a marca. "Por que esta linha não
 * conta" é a informação.
 */
export async function voidFixedCost(
  id: string,
  reason: string,
  voidedBy: string | null
): Promise<WriteOutcome> {
  const { data, error } = await finance()
    .from('fixed_costs')
    .update({ voided_at: new Date().toISOString(), voided_by: voidedBy, void_reason: reason })
    .eq('id', id)
    .is('voided_at', null)
    .select('id')
    .single()

  // `PGRST116` é "a consulta não devolveu linha": o id não existe, ou a linha não estava no
  // estado que esta ação exige. Isso é 404 e não 503 — devolver "serviço indisponível" mandaria
  // o operador procurar uma falha de banco que não houve.
  if (error?.code === 'PGRST116' || !data) return { ok: false, reason: 'not_found' }
  if (error) return { ok: false, reason: 'write_failed' }
  return { ok: true, id: String((data as { id: string }).id) }
}

/**
 * DESFAZER A REMOÇÃO — limpar a marca, e não inserir de novo.
 *
 * Existe para que remover não seja uma porta de mão única. Sem ele, um clique errado só se
 * conserta abrindo o banco — que é exatamente a fricção que este par de rotas veio tirar.
 *
 * O rastro do que aconteceu não se perde com a marca: as duas transições são auditadas.
 */
export async function restoreFixedCost(id: string): Promise<WriteOutcome> {
  const { data, error } = await finance()
    .from('fixed_costs')
    .update({ voided_at: null, voided_by: null, void_reason: null })
    .eq('id', id)
    // SÓ RESTAURA O QUE ESTAVA REMOVIDO. Sem esta linha, um PATCH numa linha VIVA fazia um
    // `update` que não mudava nada, devolvia sucesso, e o log gravava "Remoção desfeita: a linha
    // volta a contar" sobre uma linha que nunca saiu. Um log de auditoria que afirma um fato que
    // não aconteceu é pior do que log nenhum. Apontado pelo QA em 2026-09-03.
    .not('voided_at', 'is', null)
    .select('id')
    .single()

  // `PGRST116` é "a consulta não devolveu linha": o id não existe, ou a linha não estava no
  // estado que esta ação exige. Isso é 404 e não 503 — devolver "serviço indisponível" mandaria
  // o operador procurar uma falha de banco que não houve.
  if (error?.code === 'PGRST116' || !data) return { ok: false, reason: 'not_found' }
  if (error) return { ok: false, reason: 'write_failed' }
  return { ok: true, id: String((data as { id: string }).id) }
}

// ── A leitura que responde a tela ─────────────────────────────────────────────────────────────

export interface FinanceConsumptionRow extends ConsumptionRecord {
  id: string
  clientId: string
  orderId: string
  consumedAt: string
  reason: string
}

/**
 * As linhas de custo já gravadas, ou `null`.
 *
 * ESTA É A LEITURA QUE NÃO PODE MENTIR. Uma lista vazia devolvida por engano diz que nenhum
 * parceiro custou nada — que é exatamente a afirmação que este módulo existe para desmentir, e
 * ela chegaria à tela vestida de fato. Foi o que aconteceu em 2026-09-01, quando o schema
 * `finance` ainda não estava exposto ao PostgREST: todo parceiro aparecia de graça.
 */
export async function loadConsumption(cap = 2000): Promise<FinanceConsumptionRow[] | null> {
  const { data, error } = await finance()
    .from('material_consumption')
    .select(
      'id, order_id, client_id, product_id, quantity, unit_cost_cents, component_cost_cents, ' +
        'standard_cost_cents, components, currency, reason, consumed_at'
    )
    .order('consumed_at', { ascending: false })
    .limit(cap)

  if (error) return null
  // O cast existe porque o `select` desta leitura é montado por concatenação, e o supabase-js só
  // infere a forma da linha a partir de um literal. As demais leituras deste arquivo não precisam.
  const rows = (data ?? []) as unknown as Record<string, unknown>[]

  return rows.map((row) => ({
    id: String(row.id),
    orderId: String(row.order_id),
    clientId: String(row.client_id),
    productId: String(row.product_id),
    quantity: Number(row.quantity),
    unitCostCents: row.unit_cost_cents === null ? null : Number(row.unit_cost_cents),
    componentCostCents: Number(row.component_cost_cents ?? 0),
    standardCostCents: Number(row.standard_cost_cents ?? 0),
    currency: String(row.currency ?? 'BRL'),
    reason: String(row.reason ?? 'first_delivery'),
    consumedAt: String(row.consumed_at),
    components: Array.isArray(row.components)
      ? (row.components as Record<string, unknown>[]).map((component) => ({
          productId: String(component.productId ?? component.product_id ?? ''),
          quantityPerUnit: Number(component.quantityPerUnit ?? component.quantity_per_unit ?? 0),
        }))
      : [],
  }))
}

export interface CostEntryRow {
  clientId: string
  amountCents: number
  currency: string
  /**
   * `YYYY-MM-DD`. Sobe desde 2026-09-02 porque a cascata do mes precisa recortar o avulso pelo
   * mes em que ele foi incorrido — sem ela, uma feira de marco entraria no custo de agosto.
   */
  incurredAt: string
}

async function loadCostEntries(): Promise<CostEntryRow[] | null> {
  const { data, error } = await finance()
    .from('client_cost_entries')
    .select('client_id, amount_cents, currency, incurred_at')

  if (error) return null
  return (data ?? []).map((row: Record<string, unknown>) => ({
    clientId: String(row.client_id),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency ?? 'BRL'),
    incurredAt: String(row.incurred_at ?? ''),
  }))
}

interface PartnerRow {
  id: string
  name: string
  approvedAt: string | null
  monthlyFeeCents: number | null
  isCourtesy: boolean
  courtesyReason: string | null
}

/**
 * OS PARCEIROS, OU `null` — e nunca uma lista vazia por erro.
 *
 * É O GÊMEO DO DEFEITO DE CUSTO, do lado da receita. Com `[]` devolvido por engano, a rota
 * respondia 200 e a tela desenhava zero parceiros, MRR de R$ 0,00, coortes vazias e um ponto de
 * equilíbrio pedindo N parceiros — sobre uma base com sete pagantes. Nenhum aviso, nenhum erro:
 * só uma empresa que aparentemente não tem clientes.
 *
 * `loadFinanceOverview` já derrubava a resposta por consumo, avulsos, catálogo, envios e usuários
 * do app. Esta era a única leitura estrutural que faltava na guarda. Apontado pelo QA em
 * 2026-09-03.
 */
async function loadPartners(cap: number): Promise<PartnerRow[] | null> {
  const { data, error } = await getSupabaseService()
    .schema('partner')
    .from('clients')
    .select('id, name, company_name, approved_at, monthly_fee_cents, is_courtesy, courtesy_reason')
    .order('created_at', { ascending: false })
    .limit(cap)

  if (error) return null

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    // O que o operador reconhece: o nome fantasia, caindo para a razão social — a mesma ordem
    // que `loadMaterialOrderQueue` usa, para os dois quadros nomearem o mesmo parceiro igual.
    name: String(row.name ?? row.company_name ?? row.id),
    approvedAt: (row.approved_at as string | null) ?? null,
    monthlyFeeCents:
      typeof row.monthly_fee_cents === 'number' ? row.monthly_fee_cents : null,
    isCourtesy: row.is_courtesy === true,
    courtesyReason: (row.courtesy_reason as string | null) ?? null,
  }))
}

/**
 * Os ids em lotes, porque PostgREST recebe um `IN (...)` pela URL.
 *
 * Um `.in()` com 500 UUIDs monta uma query string de uns 18 KB, e servidores derrubam a
 * requisição bem antes disso. Hoje há 12 parceiros e nada quebraria; o dia em que houver
 * quinhentos, a tela do financeiro pararia inteira — e o sintoma seria um 400 do PostgREST, que
 * não se parece nem um pouco com "a lista ficou grande demais".
 */
const ID_BATCH = 100

function chunk(ids: string[]): string[][] {
  const batches: string[][] = []
  for (let index = 0; index < ids.length; index += ID_BATCH) {
    batches.push(ids.slice(index, index + ID_BATCH))
  }
  return batches
}

interface AppUserSide {
  byPartnerId: Map<string, number>
  byClientId: Map<string, number>
  purchasersByPartner: Map<string, number>
  minutesByPartner: Map<string, number>
  /**
   * Os parceiros cujo número a PRÓPRIA RPC já colapsou pelo piso de k.
   *
   * Ele sobe porque o piso de lá e o daqui podem divergir um dia: se o time `data` levantar o k
   * da função, este módulo continuaria achando que 1 é exato e imprimiria um piso com cara de
   * fato — que é a única coisa que a supressão inteira existe para impedir. Com o conjunto,
   * "foi omitido lá" é respeitado aqui sem este lado precisar adivinhar o k do outro.
   */
  suppressedPartners: Set<string>
  /**
   * Se a leitura de compras respondeu.
   *
   * Ele é um sinal SEPARADO do resto, e não um erro. Enquanto for `false`, `usersWithPurchase`
   * sobe como `null` e o veredito de quem não paga é `unknown_return` — a tela diz "não sei" em
   * vez de acusar por permissão.
   */
  purchasesAnswered: boolean
}

/**
 * O lado do app: quem chegou pelo QR, quem é da equipe, e quem comprou.
 *
 * DOIS VÍNCULOS E ELES NÃO SE SOMAM. `drive.profiles.partner_id` é quem chegou pelo link do
 * parceiro (aquisição, e é o denominador do CAC); `drive.profiles.client_id` é quem É do
 * estabelecimento — dono, gerente, garçom. Somá-los inflaria a aquisição com os próprios
 * funcionários do parceiro, e o CAC cairia exatamente nos parceiros que não adquiriram ninguém.
 *
 * A COMPRA VEM DE UMA RPC, E NÃO DO LEDGER — desde 2026-09-02, e a diferença é de permissão.
 * `drive.time_credit_grants` nega `SELECT` ao `service_role`, e a negação é deliberada: aquele
 * ledger registra QUEM concedeu cada crédito e foi desenhado para ser tocado por uma pessoa
 * nomeada, nunca por uma conta de serviço. Este módulo nasceu lendo `null` ali e dizendo
 * "não sei" no lugar de um veredito.
 *
 * `drive.partner_purchase_summary(uuid[])` é a janela em vez da chave: ela roda com o privilégio
 * do dono, lê o ledger por dentro e devolve DOIS NÚMEROS por parceiro. Nenhuma linha do ledger
 * atravessa. O pedido, com o porquê de cada decisão dela, está em
 * `supabase/requests/partner_purchase_summary.sql`; foi aplicada pelo time `data` em 2026-09-02.
 *
 * ELA DEVOLVE UMA LINHA POR PARCEIRO PEDIDO, INCLUSIVE OS DE ZERO, e é disso que depende a
 * distinção inteira: parceiro ausente da resposta seria "não sei", presente com `0` é "não trouxe
 * comprador". Conferido em 2026-09-02: 52 parceiros pedidos, 52 linhas de volta.
 *
 * FICA EM MINUTOS. Não existe valor em dinheiro em lugar nenhum do fluxo do usuário do app
 * (BR-MONETIZACAO-048, e o catálogo de preços é `drive.product_grant_map`, fora deste
 * repositório). Então o que sobe para a tela é contagem e minutos, rotulados como tal.
 *
 * Devolve `null` quando o banco recusa. Ver o cabeçalho: um erro aqui não pode virar zero.
 */
async function loadAppUserSide(partnerIds: string[]): Promise<AppUserSide | null> {
  const empty: AppUserSide = {
    byPartnerId: new Map(),
    byClientId: new Map(),
    purchasersByPartner: new Map(),
    minutesByPartner: new Map(),
    suppressedPartners: new Set(),
    purchasesAnswered: true,
  }
  if (partnerIds.length === 0) return empty

  const drive = getSupabaseService().schema('drive')

  const profiles: Record<string, string | null>[] = []
  for (const batch of chunk(partnerIds)) {
    const { data, error } = await drive
      .from('profiles')
      .select('id, partner_id, client_id')
      .or(`partner_id.in.(${batch.join(',')}),client_id.in.(${batch.join(',')})`)

    if (error) return null
    profiles.push(...((data ?? []) as Record<string, string | null>[]))
  }

  for (const row of profiles) {
    const partnerId = row.partner_id
    const clientId = row.client_id
    if (partnerId) {
      empty.byPartnerId.set(partnerId, (empty.byPartnerId.get(partnerId) ?? 0) + 1)
    }
    if (clientId) empty.byClientId.set(clientId, (empty.byClientId.get(clientId) ?? 0) + 1)
  }

  // A RPC É CHAMADA POR LOTE DE PARCEIROS, e não por usuário. É a mesma razão de `chunk` existir
  // no resto deste arquivo: uma lista longa de uuids na querystring estoura o limite do PostgREST.
  // Ela também é a leitura que substituiu uma chamada POR USUÁRIO — 40 idas ao banco viraram 1.
  const summaries: Record<string, unknown>[] = []
  for (const batch of chunk(partnerIds)) {
    const { data, error } = await drive.rpc('partner_purchase_summary', { p_partner_ids: batch })

    // Sem a RPC a tela NÃO cai: ela perde a distinção entre "não trouxe ninguém" e "trouxe quem
    // comprou", e diz isso. O custo — que é o motivo do módulo — continua inteiro.
    if (error) return { ...empty, purchasesAnswered: false }
    summaries.push(...((data ?? []) as Record<string, unknown>[]))
  }

  for (const row of summaries) {
    const partnerId = typeof row.partner_id === 'string' ? row.partner_id : null
    if (!partnerId) continue

    empty.purchasersByPartner.set(
      partnerId,
      typeof row.users_with_purchase === 'number' ? row.users_with_purchase : 0
    )

    // MINUTO SÓ ENTRA SE VEIO NÚMERO. `null` ali significa "omitido pelo piso de k", e o chamador
    // já traduz a AUSÊNCIA no mapa em `null` — escrever 0 aqui trocaria "omitido" por "nenhum
    // minuto", que é a confusão entre null e zero que este módulo inteiro recusa.
    if (typeof row.purchased_minutes === 'number') {
      empty.minutesByPartner.set(partnerId, row.purchased_minutes)
    }

    if (row.suppressed === true) empty.suppressedPartners.add(partnerId)
  }

  return empty
}

/**
 * Pedidos já despachados/entregues que ainda não têm quantidade enviada informada, por cliente.
 *
 * É A PENDÊNCIA QUE SUBSTITUI UMA SUPOSIÇÃO. Antes disto, o custo saía de
 * `material_order_items.quantity` — o que o parceiro PEDIU — e superestimava todo parceiro que
 * recebeu menos. Agora um pedido sem envio informado simplesmente não vira custo, e aparece aqui
 * para alguém responder.
 *
 * `null` quando a leitura falhou: sem ela não dá para saber se um custo está completo, e um
 * parceiro apareceria como apurado sem ser.
 */
async function loadOrdersAwaitingShipment(
  products: FinanceProduct[]
): Promise<Map<string, number> | null> {
  const { data, error } = await getSupabaseService()
    .schema('partner')
    .from('material_orders')
    .select('id, client_id, status, material_order_items(kind, quantity)')

  if (error) return null

  const orders = (data ?? []) as unknown as {
    id: string
    client_id: string
    status: string
    material_order_items: { kind: string; quantity: number }[] | null
  }[]

  const relevant = orders.filter((order) => consumesCost(order.status as never))
  const shipments = await loadOrderShipments(relevant.map((order) => order.id))
  if (shipments === null) return null

  const informed = new Set(shipments.map((s) => `${s.orderId}|${s.productId}`))
  const awaiting = new Map<string, number>()

  for (const order of relevant) {
    const pending = (order.material_order_items ?? []).some((item) => {
      if (item.quantity <= 0) return false
      const product = products.find((candidate) => candidate.materialKind === item.kind)
      // Sem produto no catálogo, a pendência é OUTRA (cadastro) e já é contada em `skipped`.
      if (!product) return false
      return !informed.has(`${order.id}|${product.id}`)
    })
    if (pending) awaiting.set(order.client_id, (awaiting.get(order.client_id) ?? 0) + 1)
  }

  return awaiting
}

export interface FinanceOverview {
  clients: ClientProfitability[]
  consumption: FinanceConsumptionRow[]
  /** Os avulsos, com a data — a cascata do mês recorta por ela. */
  costEntries: CostEntryRow[]
  /**
   * O que `summarizePlanMix` lê. Sai daqui e não de uma segunda leitura porque o plano de cada
   * parceiro já foi decidido uma vez neste laço, por `derivePartnerPlan` — decidi-lo de novo na
   * rota seria a segunda opinião que faz um total discordar da linha.
   */
  partnerMix: PartnerMixRow[]
  /** Verdadeiro quando a leitura bateu no teto: todo número vira um piso, e a tela diz isso. */
  truncated: boolean
  /** Falso quando o ledger de compras não respondeu. A tela nomeia a lacuna em vez de escondê-la. */
  purchasesAnswered: boolean
  /**
   * Parceiros marcados como teste e retirados de TODA conta acima.
   *
   * Sobe contado, e não some calado: uma base que encolhe sem dizer por quê é indistinguível de
   * uma leitura que falhou pela metade.
   */
  excludedPartners: number
}

/**
 * As duas maneiras de a leitura não acontecer, e elas são DIFERENTES para o operador.
 *
 * `finance_unavailable` é o schema `finance` fora do ar — sem ele não há custo nenhum, e desenhar
 * a tela diria que todo parceiro é de graça. `app_users_unavailable` é `drive.profiles` — sem ele
 * não há aquisição nem CAC. `partners_unavailable` é `partner.clients` — sem ele a tela diria que
 * a empresa não tem cliente nenhum, que é a mesma mentira pelo outro lado. A falta de PERMISSÃO no ledger de compras não está aqui: ela não
 * derruba nada, vira `purchasesAnswered: false` e o veredito `unknown_return`.
 */
export type FinanceOverviewFailure =
  | 'finance_unavailable'
  | 'app_users_unavailable'
  | 'partners_unavailable'

export type FinanceOverviewResult =
  | { ok: true; overview: FinanceOverview }
  | { ok: false; reason: FinanceOverviewFailure }

/**
 * A tela inteira, numa leitura por tabela.
 *
 * `now` é injetável para o teste não depender do relógio — o mesmo motivo pelo qual
 * `assessClient` o recebe em vez de chamar `new Date()` por dentro.
 */
export async function loadFinanceOverview(
  cap = 500,
  now = new Date().toISOString().slice(0, 10)
): Promise<FinanceOverviewResult> {
  const [allPartners, consumption, costEntries, excluded] = await Promise.all([
    loadPartners(cap),
    loadConsumption(),
    loadCostEntries(),
    loadExcludedAccounts('client'),
  ])

  // Sem as linhas de custo não há tela: uma lista vazia por erro afirmaria que ninguém custou
  // nada, que é a única coisa que este módulo não pode dizer por engano.
  if (consumption === null || costEntries === null) return { ok: false, reason: 'finance_unavailable' }

  // E sem os parceiros também não: zero parceiro por erro afirma que a empresa não tem cliente.
  if (allPartners === null) return { ok: false, reason: 'partners_unavailable' }

  // Nem sem a lista de exclusões: um conjunto vazio por erro faz as contas de teste voltarem para
  // dentro de TODO número, e uma base que cresce sozinha não parece defeito para ninguém.
  if (excluded === null) return { ok: false, reason: 'finance_unavailable' }

  // AS CONTAS DE TESTE SAEM AQUI, ANTES DE QUALQUER CONTA — e não na tela.
  //
  // Filtrar depois deixaria o parceiro de demonstração dentro de `summarizeFinance`, do CAC e da
  // coorte, e só sumindo da lista: a base pareceria menor do que os totais que a descrevem. Uma
  // leitura que falhou responde lista VAZIA de exclusões (ver `loadExcludedAccounts`), e então
  // nada é escondido — o oposto do modo de falha caro, que seria esconder parceiro por engano.
  const partners = excluded.size > 0 ? allPartners.filter((row) => !excluded.has(row.id)) : allPartners
  const excludedPartners = allPartners.length - partners.length

  const partnerIds = partners.map((partner) => partner.id)
  const catalog = await loadCatalog()
  if (!catalog) return { ok: false, reason: 'finance_unavailable' }

  const [contracts, appUsers, awaitingShipment, billingStarts] = await Promise.all([
    loadLiveContractStates(partnerIds),
    loadAppUserSide(partnerIds),
    loadOrdersAwaitingShipment(catalog.products),
    loadBillingStarts(partnerIds),
  ])

  if (awaitingShipment === null) return { ok: false, reason: 'finance_unavailable' }

  // `drive.profiles` não respondeu: sem ele não há aquisição, não há CAC, e a coluna `QR` seria
  // um zero inventado. Isto é diferente de o LEDGER não responder, que não derruba nada.
  if (!appUsers) return { ok: false, reason: 'app_users_unavailable' }

  const consumptionByClient = new Map<string, ConsumptionRecord[]>()
  for (const row of consumption) {
    const lines = consumptionByClient.get(row.clientId) ?? []
    lines.push(row)
    consumptionByClient.set(row.clientId, lines)
  }

  const entriesByClient = new Map<string, CostEntryRow[]>()
  for (const entry of costEntries) {
    const lines = entriesByClient.get(entry.clientId) ?? []
    lines.push(entry)
    entriesByClient.set(entry.clientId, lines)
  }

  const partnerMix: PartnerMixRow[] = []

  const clients = partners.map((partner) => {
    const contract = contracts.get(partner.id) ?? null
    // `derivePartnerPlan` é quem decide quem paga — três fontes numa ordem só, e esta é a quarta
    // superfície a lê-la em vez de comparar `monthlyFeeCents > 0` por conta própria.
    const plan = derivePartnerPlan({
      clientId: partner.id,
      fee: {
        monthlyFeeCents: partner.monthlyFeeCents,
        isCourtesy: partner.isCourtesy,
        courtesyReason: partner.courtesyReason,
      },
      planChoice: null,
      contractTier: contract?.tier ?? null,
    })

    // `null` quando a leitura não respondeu — e `null` não é zero: é o que faz o veredito de um
    // parceiro não pagante ser `unknown_return` em vez de uma acusação de prejuízo.
    const purchasedMinutes = appUsers.purchasesAnswered
      ? appUsers.minutesByPartner.get(partner.id) ?? null
      : null
    const usersWithPurchase = appUsers.purchasesAnswered
      ? appUsers.purchasersByPartner.get(partner.id) ?? 0
      : null

    // O PISO DE k É APLICADO AQUI, NO SERVIDOR, E NÃO NO COMPONENTE. Suprimir na tela deixaria o
    // valor exato viajando na resposta da API, onde qualquer um com o cookie de um editor o lê
    // com o DevTools aberto — a supressão só é supressão antes de sair da máquina.
    //
    // É a última coisa a acontecer antes do veredito, de propósito: assim nenhum campo montado
    // acima pode escapar dela por ordem de código.
    //
    // A RPC JÁ APLICA O MESMO PISO, e desde 2026-09-02 esta chamada é a SEGUNDA. Ela continua por
    // dois motivos: é defesa em profundidade se um dia a resposta vier de outra fonte, e ela é
    // idempotente — nunca suprime o que já está suprimido, porque só age sobre um valor maior que
    // zero numa coorte menor que k, e o que veio suprimido de lá já chega colapsado em 1.
    const cohort = suppressSmallCohortPurchases({
      clientId: partner.id,
      clientName: partner.name,
      approvedAt: partner.approvedAt,
      stance: paymentStance(plan.kind),
      monthlyFeeCents: partner.monthlyFeeCents,
      consumption: consumptionByClient.get(partner.id) ?? [],
      costEntries: entriesByClient.get(partner.id) ?? [],
      ordersAwaitingShipment: awaitingShipment.get(partner.id) ?? 0,
      linkedByPartnerId: appUsers.byPartnerId.get(partner.id) ?? 0,
      linkedByClientId: appUsers.byClientId.get(partner.id) ?? 0,
      usersWithPurchase,
      purchasedMinutes,
      billingStart: billingStarts.get(partner.id) ?? null,
      // A RECEITA REALIZADA NÃO TEM HORIZONTE, e é aqui que o contrato e a premissa se separam.
      // O instrumento é por prazo indeterminado: um parceiro com quatorze faturas vencidas
      // faturou quatorze, e cortá-lo em doze esconderia receita que de fato entrou. Os doze são
      // premissa do operador e vivem só na PROJEÇÃO (`projectRevenue`).
      horizonInvoices: null,
    })

    // O PISO DA RPC MANDA JUNTO COM O DAQUI, E NÃO NO LUGAR DELE. Os dois usam k=5 hoje e
    // concordam sempre; se o time `data` levantar o k de lá, este lado continuaria achando que
    // `1` é exato e a tela imprimiria um piso com cara de fato. O `||` é o que garante que
    // "omitido em algum lugar" chega à tela como omitido — que é a razão de `suppressed` viajar
    // na resposta da função.
    const facts: ClientFinanceFacts = {
      ...cohort,
      purchaseSuppressed:
        cohort.purchaseSuppressed || appUsers.suppressedPartners.has(partner.id),
    }

    const assessed = assessClient(facts, now)

    // A quebra por plano é montada no MESMO laço que produz a linha, com o MESMO `plan`. Um
    // segundo `derivePartnerPlan` na rota seria uma segunda opinião sobre quem paga.
    partnerMix.push({
      currency: assessed.currency,
      planKind: plan.kind,
      monthlyFeeCents: partner.monthlyFeeCents,
      contractStatus: contract?.status ?? null,
      // O marco sobe junto porque a projeção precisa do calendário de CADA parceiro: a linha
      // firme não é uma reta, é a soma de faturas que entram em meses diferentes.
      billingStartsAt: assessed.billingStartsAt,
      billingStartSource: assessed.billingStartSource,
    })

    return assessed
  })

  return {
    ok: true,
    overview: {
      clients,
      consumption,
      costEntries,
      partnerMix,
      // O teto é contado sobre a leitura CRUA: cortar contas de teste depois não devolve espaço
      // no `limit`, e dizer que a lista coube porque o filtro a encurtou seria mentira.
      truncated: allPartners.length >= cap,
      purchasesAnswered: appUsers.purchasesAnswered,
      excludedPartners,
    },
  }
}

// ── A gravação do custo, disparada pela esteira ───────────────────────────────────────────────

/**
 * O pedido virou custo — chamada de dentro de `setMaterialOrderStatus`, nunca da tela.
 *
 * POR QUE DE DENTRO DA ESCRITA E NÃO DA ROTA: existem duas rotas que avançam um pedido (a fila e
 * a ficha do parceiro) e o quadro arrasta cartões por uma delas. Pendurar a gravação nas rotas
 * seria dois lugares para esquecer, e o custo do parceiro passaria a depender de por qual tela o
 * operador moveu o cartão.
 *
 * NÃO DERRUBA A MUDANÇA DE STATUS. Mover o pedido é o ato do operador e ele já aconteceu no
 * banco; se o custo não puder ser gravado agora, o `unique (order_id, product_id)` deixa
 * `scripts/finance-backfill-consumption.ts` completá-lo depois sem duplicar nada. O contrário —
 * recusar o avanço porque o financeiro não respondeu — pararia a operação de material por causa
 * de um relatório.
 *
 * `at` é a data do consumo e por padrão é hoje. O backfill passa a data em que o pedido de fato
 * saiu, para que a receita e o preço vigentes daquele dia sejam os congelados.
 *
 * PREENCHE O QUE FALTA, E NUNCA REESCREVE O QUE EXISTE. Uma linha gravada antes de a compra ser
 * cadastrada carrega `unit_cost_cents` nulo, e o `on conflict do nothing` da RPC a deixaria assim
 * para sempre — em 2026-09-01 isso teria congelado "Custo incompleto" em 26 de 28 parceiros.
 * Nulo não é história: é a ausência dela. Então o segundo passo abaixo dá preço às linhas que
 * ainda não têm, com `is('unit_cost_cents', null)` no `WHERE` — e uma linha que JÁ tem custo é
 * intocável, porque aí sim seria reescrever o que alguém leu e decidiu.
 */
export async function recordConsumption(
  orderId: string,
  status: 'dispatched' | 'fulfilled',
  options: { at?: string; createdBy?: string | null } = {}
): Promise<{ inserted: number; repriced: number; awaitingShipment: number } | null> {
  const at = options.at ?? new Date().toISOString().slice(0, 10)

  const { data: order, error } = await getSupabaseService()
    .schema('partner')
    .from('material_orders')
    .select('id, client_id, material_order_items(kind, quantity)')
    .eq('id', orderId)
    .maybeSingle()

  if (error || !order) return null

  const row = order as {
    client_id: string
    material_order_items: { kind: string; quantity: number }[] | null
  }

  const [catalog, purchases, overrides, shipments] = await Promise.all([
    loadCatalog(),
    loadPurchases(),
    loadOrderOverrides([orderId]),
    loadOrderShipments([orderId]),
  ])

  // NÃO GRAVA NADA se o catálogo ou as compras não responderem. Gravar aqui produziria uma linha
  // com `unit_cost_cents` nulo, e o `unique (order_id, product_id)` a tornaria PERMANENTE: um
  // erro de leitura de dois segundos congelaria o custo daquele pedido em "não sei" para sempre.
  // O pedido já avançou de status; a linha entra depois, pelo backfill, que é repetível.
  // `overrides` ENTRA NA GUARDA. Sem ela, uma leitura recusada virava lista vazia, o plano
  // rodava com a receita PADRÃO e gravava um custo errado que o `unique (order_id, product_id)`
  // congela para sempre. Apontado pelo QA em 2026-09-03.
  if (!catalog || !purchases || shipments === null || overrides === null) return null
  const { products, recipes, rates, packaging } = catalog

  const plan = planConsumption({
    orderId,
    items: (row.material_order_items ?? []).map((item) => ({
      kind: item.kind as MaterialKind,
      quantity: item.quantity,
    })),
    products,
    purchases,
    recipes,
    overrides,
    rates,
    shipments,
    packaging,
    at,
  })

  // Nada a lançar: ou o pedido não tem item custeável, ou ninguém informou o que saiu. Os dois
  // sobem separados — "já tinha custo" e "falta dizer quanto saiu" mandam para atos diferentes.
  if (plan.lines.length === 0) {
    return { inserted: 0, repriced: 0, awaitingShipment: plan.awaitingShipment.length }
  }

  const { data, error: writeError } = await finance().rpc('record_material_consumption', {
    p_order_id: orderId,
    p_client_id: row.client_id,
    p_status: status,
    p_lines: plan.lines.map((line) => ({
      product_id: line.productId,
      quantity: line.quantity,
      unit_cost_cents: line.unitCostCents,
      component_cost_cents: line.componentCostCents,
      standard_cost_cents: line.standardCostCents,
      components: line.components,
      currency: line.currency,
      reason: line.reason,
    })),
    p_created_by: options.createdBy ?? null,
  })

  if (writeError) return null
  const inserted = typeof data === 'number' ? data : 0

  // O segundo passo: as linhas que já existiam SEM preço e agora têm um. O `.is(null)` é a
  // garantia inteira — sem ele isto viraria uma reescrita silenciosa do custo já apurado.
  let repriced = 0
  for (const line of plan.lines) {
    if (line.unitCostCents === null) continue
    const { data: updated } = await finance()
      .from('material_consumption')
      .update({
        unit_cost_cents: line.unitCostCents,
        component_cost_cents: line.componentCostCents,
        standard_cost_cents: line.standardCostCents,
        components: line.components,
        currency: line.currency,
      })
      .eq('order_id', orderId)
      .eq('product_id', line.productId)
      .is('unit_cost_cents', null)
      .select('id')

    if (Array.isArray(updated)) repriced += updated.length
  }

  return { inserted, repriced, awaitingShipment: plan.awaitingShipment.length }
}

/**
 * RECALCULA O CUSTO DE UM PEDIDO com as regras de hoje — o ato explícito de correção.
 *
 * POR QUE ELE É SEPARADO DE TUDO. `recordConsumption` grava o que valia no dia e só preenche o
 * que estava nulo; nunca reescreve um custo apurado, porque reescrever história em silêncio é o
 * defeito que a tabela de lançamento existe para impedir. Mas erro existe: em 2026-09-01 uma
 * receita invertida cobrou R$ 1.500,00 de envelope num pedido de R$ 207,50, e um preço semeado
 * ficou congelado em linhas depois de a compra que o originou ser apagada. Sem um caminho de
 * correção, o único conserto era eu abrir o banco à mão — que é pior do que uma função nomeada,
 * auditada e testada.
 *
 * NUNCA TROCA UM CUSTO CONHECIDO POR "NÃO SEI". Se as regras de hoje não conseguem precificar uma
 * linha que hoje TEM preço — porque a compra daquele produto foi apagada, por exemplo — o custo
 * unitário existente permanece. Recalcular é corrigir informação, não destruí-la, e um `null`
 * gravado por cima de 400 transformaria um número errado num número ausente.
 *
 * A DATA É A DO CONSUMO, não a de hoje: a receita e a compra vigentes são as daquele dia, que é o
 * que a vigência significa. Como toda compra atual é anterior aos consumos existentes, isso na
 * prática aplica os preços corretos de agora — sem abrir mão da regra.
 *
 * A LINHA ÓRFÃ É APAGADA, E SÓ AQUI. Uma linha que o plano de hoje não produz mais — o envio
 * daquele produto foi corrigido para zero — não é um custo errado: é um consumo que não houve.
 * Não há oposto a lançar, e mantê-la infla o parceiro para sempre. Em 2026-09-01 o Boteco não
 * recebeu display de balcão, e a linha de R$ 8,56 não tinha caminho de saída.
 *
 * É a ÚNICA porta: nenhuma rota apaga custo (`finance-surface.test.ts` trava), e as tabelas de
 * lançamento DIGITADO — `client_cost_entries`, `fixed_costs`, `standard_rates` — seguem sem
 * `delete`, porque para elas o argumento original vale inteiro.
 */
export async function recomputeConsumption(
  orderId: string
): Promise<{ updated: number; inserted: number; kept: number; orphans: string[] } | null> {
  const { data: order, error: orderError } = await getSupabaseService()
    .schema('partner')
    .from('material_orders')
    .select('id, client_id, status, material_order_items(kind, quantity)')
    .eq('id', orderId)
    .maybeSingle()

  if (orderError || !order) return null

  const row = order as {
    client_id: string
    status: string
    material_order_items: { kind: string; quantity: number }[] | null
  }
  if (!consumesCost(row.status as never)) return null

  const existing = await loadConsumption()
  if (existing === null) return null
  const lines = existing.filter((line) => line.orderId === orderId)
  if (lines.length === 0) return { updated: 0, inserted: 0, kept: 0, orphans: [] }

  // A data do consumo já gravado: é ela que a vigência da receita e o `<= at` da compra leem.
  const at = lines
    .map((line) => line.consumedAt.slice(0, 10))
    .sort()[0]

  const [catalog, purchases, overrides, shipments] = await Promise.all([
    loadCatalog(),
    loadPurchases(),
    loadOrderOverrides([orderId]),
    loadOrderShipments([orderId]),
  ])
  // `overrides` ENTRA NA GUARDA. Sem ela, uma leitura recusada virava lista vazia, o plano
  // rodava com a receita PADRÃO e gravava um custo errado que o `unique (order_id, product_id)`
  // congela para sempre. Apontado pelo QA em 2026-09-03.
  if (!catalog || !purchases || shipments === null || overrides === null) return null

  const plan = planConsumption({
    orderId,
    items: (row.material_order_items ?? []).map((item) => ({
      kind: item.kind as MaterialKind,
      quantity: item.quantity,
    })),
    products: catalog.products,
    purchases,
    recipes: catalog.recipes,
    overrides,
    rates: catalog.rates,
    shipments,
    packaging: catalog.packaging,
    at,
  })

  let updated = 0
  let inserted = 0
  let kept = 0

  for (const line of plan.lines) {
    const current = lines.find((entry) => entry.productId === line.productId)

    if (!current) {
      const { error } = await finance().rpc('record_material_consumption', {
        p_order_id: orderId,
        p_client_id: row.client_id,
        p_status: row.status,
        p_lines: [
          {
            product_id: line.productId,
            quantity: line.quantity,
            unit_cost_cents: line.unitCostCents,
            component_cost_cents: line.componentCostCents,
            standard_cost_cents: line.standardCostCents,
            components: line.components,
            currency: line.currency,
            reason: line.reason,
          },
        ],
        p_created_by: null,
      })
      if (!error) inserted += 1
      continue
    }

    // A guarda: um preço conhecido não vira `null`. Se hoje não dá para precificar, o unitário
    // que já está lá permanece, e o resto da linha é atualizado assim mesmo.
    const unitCostCents = line.unitCostCents ?? current.unitCostCents
    if (line.unitCostCents === null && current.unitCostCents !== null) kept += 1

    const { data, error } = await finance()
      .from('material_consumption')
      .update({
        quantity: line.quantity,
        unit_cost_cents: unitCostCents,
        component_cost_cents: line.componentCostCents,
        standard_cost_cents: line.standardCostCents,
        components: line.components,
        currency: line.currency,
      })
      .eq('order_id', orderId)
      .eq('product_id', line.productId)
      .select('id')

    if (!error && Array.isArray(data) && data.length > 0) updated += 1
  }

  const planned = new Set(plan.lines.map((line) => line.productId))
  const orphans: string[] = []

  for (const line of lines) {
    if (planned.has(line.productId)) continue

    // Nada foi consumido deste produto neste pedido: o envio foi corrigido para zero, ou o
    // produto saiu do plano. Apagar é o que devolve o parceiro ao custo real.
    const { error } = await finance()
      .from('material_consumption')
      .delete()
      .eq('order_id', orderId)
      .eq('product_id', line.productId)

    if (!error) orphans.push(line.productId)
  }

  return { updated, inserted, kept, orphans }
}

// ── O preço do passe, e as contas que não contam ──────────────────────────────────────────────

/**
 * Os preços declarados do passe.
 *
 * DEVOLVE LISTA VAZIA QUANDO A LEITURA FALHA, e aqui isso é seguro — o oposto de `loadConsumption`.
 * Sem preço não há estimativa de receita do app, e a tela mostra "não declarado": uma ausência
 * que ela já sabe desenhar. O modo de falha caro deste módulo é afirmar dinheiro que não existe,
 * e uma lista vazia afirma exatamente nada.
 */
/**
 * O CATÁLOGO DE PREÇOS DECLARADO, OU `null`.
 *
 * Sem ele a tela nomeia os produtos sem preço e a estimativa não sai — pendência visível, e não
 * número falso. Mas a CAUSA muda o que o operador faz: "ninguém declarou preço" manda cadastrar;
 * "não consegui ler" manda olhar a migração. Foi exatamente o que aconteceu com as taxas de
 * câmbio em 2026-09-03, e é o mesmo remédio.
 */
export async function loadPassPrices(): Promise<PassPrice[] | null> {
  const { data, error } = await finance()
    .from('pass_prices')
    .select('product_id, label, price_cents, currency, effective_from, minutes, kind')
    .order('effective_from', { ascending: false })

  if (error) return null
  return (data ?? []).map((row: Record<string, unknown>) => ({
    productId: String(row.product_id),
    label: String(row.label ?? row.product_id),
    priceCents: Number(row.price_cents),
    currency: String(row.currency ?? 'BRL'),
    effectiveFrom: String(row.effective_from),
    minutes: row.minutes === null || row.minutes === undefined ? null : Number(row.minutes),
    kind: row.kind === 'subscription' ? 'subscription' : 'pass',
  }))
}

/**
 * Declara um preço — INSERE, nunca reescreve.
 *
 * Mudar o preço é uma linha nova com vigência posterior, pelo mesmo motivo de `units_yield` ser
 * fato da compra: o passe de R$ 29,90 de hoje não pode reprecificar a compra de junho. O
 * `unique (product_id, effective_from)` recusa duas versões do mesmo dia, e é isso que o 409 da
 * rota traduz.
 */
export async function createPassPrice(input: {
  productId: string
  label: string
  priceCents: number
  currency: string
  effectiveFrom: string
  minutes: number | null
  notes?: string | null
  createdBy?: string | null
}): Promise<{ ok: boolean; conflict?: boolean }> {
  const { error } = await finance()
    .from('pass_prices')
    .insert({
      product_id: input.productId,
      label: input.label,
      price_cents: input.priceCents,
      currency: input.currency,
      effective_from: input.effectiveFrom,
      minutes: input.minutes,
      notes: input.notes ?? null,
      created_by: input.createdBy ?? null,
    })

  if (!error) return { ok: true }
  // 23505 é a violação de unicidade: já existe preço deste passe nesta data.
  return { ok: false, conflict: (error as { code?: string }).code === '23505' }
}

/** Uma marca viva de conta de teste, como a tela a lista. */
export interface ExcludedAccountRow {
  id: string
  kind: 'app_user' | 'client'
  subjectId: string
  reason: string
  createdAt: string
  createdBy: string | null
}

/**
 * Os ids marcados como teste, vivos.
 *
 * VAZIO QUANDO A LEITURA FALHA, e a direção da falha é escolhida. Uma exclusão que não carregou
 * faz um parceiro de teste voltar a contar — visível, conferível, corrigível. O contrário —
 * assumir que tudo está excluído — sumiria com a base inteira e pareceria uma empresa sem
 * clientes.
 */
/**
 * AS CONTAS QUE NÃO CONTAM, OU `null`.
 *
 * UM CONJUNTO VAZIO POR ERRO FAZ AS CONTAS DE TESTE VOLTAREM para dentro de todo número — base,
 * MRR, CAC, coortes — sem nada na tela dizendo por quê. A migração que criou esta tabela escreveu
 * a versão inversa deste raciocínio ("uma base que encolhe sem dizer por quê é indistinguível de
 * uma leitura que falhou pela metade"); uma base que CRESCE sozinha é a mesma coisa ao contrário,
 * e mais difícil de notar, porque número maior não parece defeito.
 */
export async function loadExcludedAccounts(
  kind: 'app_user' | 'client'
): Promise<Set<string> | null> {
  const { data, error } = await finance()
    .from('excluded_accounts')
    .select('subject_id')
    .eq('kind', kind)
    .is('removed_at', null)

  if (error) return null
  return new Set((data ?? []).map((row: Record<string, unknown>) => String(row.subject_id)))
}

/** As marcas vivas, com quem marcou e por quê — a lista que a tela mostra. */
/**
 * A LISTA DE CONTAS MARCADAS, OU `null` — a tela de gestão, não a do cálculo.
 *
 * `[]` por erro diria "nenhuma conta excluída" a quem está olhando exatamente para conferir
 * quais estão. Nenhum total muda, mas a resposta é falsa.
 */
export async function listExcludedAccounts(): Promise<ExcludedAccountRow[] | null> {
  const { data, error } = await finance()
    .from('excluded_accounts')
    .select('id, kind, subject_id, reason, created_at, created_by')
    .is('removed_at', null)
    .order('created_at', { ascending: false })

  if (error) return null
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    kind: row.kind === 'app_user' ? 'app_user' : 'client',
    subjectId: String(row.subject_id),
    reason: String(row.reason ?? ''),
    createdAt: String(row.created_at),
    createdBy: (row.created_by as string | null) ?? null,
  }))
}

/**
 * Marca uma conta como teste.
 *
 * O `unique` parcial de `excluded_accounts` só vale entre as marcas VIVAS, então marcar de novo
 * algo que já está marcado é 409 e não um segundo registro — e uma conta pode voltar à lista
 * depois de ter saído dela.
 */
export async function excludeAccount(input: {
  kind: 'app_user' | 'client'
  subjectId: string
  reason: string
  createdBy?: string | null
}): Promise<{ ok: boolean; conflict?: boolean }> {
  const { error } = await finance()
    .from('excluded_accounts')
    .insert({
      kind: input.kind,
      subject_id: input.subjectId,
      reason: input.reason,
      created_by: input.createdBy ?? null,
    })

  if (!error) return { ok: true }
  return { ok: false, conflict: (error as { code?: string }).code === '23505' }
}

/**
 * Desfaz uma marca — ESCREVE `removed_at`, não apaga a linha.
 *
 * Uma conta que volta a contar sem deixar rastro é a mesma classe de defeito que `delete` numa
 * tabela de lançamento: o total muda e ninguém consegue dizer por quê. Por isso a tabela nem tem
 * `grant delete`.
 */
export async function restoreAccount(
  id: string,
  removedBy?: string | null
): Promise<boolean> {
  const { data, error } = await finance()
    .from('excluded_accounts')
    .update({ removed_at: new Date().toISOString(), removed_by: removedBy ?? null })
    .eq('id', id)
    .is('removed_at', null)
    .select('id')

  return !error && (data ?? []).length > 0
}

// ── O marco que inicia a cobrança ─────────────────────────────────────────────────────────────

/**
 * A data que INICIA A COBRANÇA de cada parceiro — quatro fontes, da mais firme para a menos.
 *
 * O CONTRATO MANDA LER A PUBLICAÇÃO: *"a contraprestação mensal somente começa a correr na data
 * da publicação, no aplicativo"*. Assinar não cobra; aprovar o parceiro muito menos — e era de
 * `approved_at` que a receita saía até 2026-09-02, em meses corridos.
 *
 * MAS O CARIMBO DE PUBLICAÇÃO NÃO EXISTE NOS PARCEIROS ANTIGOS, e isso foi medido em 2026-09-02:
 * os 7 pagantes têm `attractions.approved = true` e `approved_at` NULO, e `core.audit_logs` tem
 * ZERO linhas de `PUBLISH_PARTNER_PLACE` em 37.575. `setApproved` carimba desde agosto de 2026;
 * quem subiu antes não deixou data.
 *
 * DAÍ A TERCEIRA FONTE, E ELA É DECISÃO DO OPERADOR (2026-09-02): *"eles já estão liberados no
 * app desde o cadastro e liberação, esses dias serão contados"*. `partner.clients.approved_at` é
 * o dia da liberação, e é o marco mais próximo da publicação que este banco guarda.
 *
 * A ASSINATURA CAIU PARA ÚLTIMO LUGAR, e a ordem importa. O aceite vem DEPOIS da liberação: com
 * ele à frente, um parceiro liberado em agosto que assinasse em outubro começaria a faturar em
 * novembro, apagando dois meses que a Tuggi já entregou. Ela sobra só para quem não tem nem
 * liberação registrada.
 *
 * AS CINCO LEITURAS ABAIXO DESCARTAM `error` DE PROPÓSITO, e esta é a única função de
 * `finance-service.ts` onde isso é seguro — conferido pelo QA em 2026-09-03 e travado por
 * `tests/api/finance-surface.test.ts`.
 *
 * O motivo: a ausência aqui NÃO VIRA NÚMERO. Sem marco de cobrança, `billingStart` fica `null`,
 * `assessClient` devolve o veredito `undated` e `summarizePlanMix` incrementa
 * `payingWithoutBillingStart` — ou seja, a falha aparece como PENDÊNCIA NOMEADA na tela, que é
 * o que se queria. Nas outras leituras do arquivo, a mesma omissão produziria um zero com cara
 * de fato, e por isso todas elas devolvem `null`.
 *
 * Se um dia esta função passar a alimentar um TOTAL, ela entra na regra das outras.
 */
export async function loadBillingStarts(
  clientIds: string[]
): Promise<Map<string, BillingStart>> {
  const starts = new Map<string, BillingStart>()
  if (clientIds.length === 0) return starts

  const core = getSupabaseService().schema('core')
  const partner = getSupabaseService().schema('partner')

  // 1 · O carimbo da publicação, e os lugares de cada parceiro. A trilha guarda o id do LUGAR,
  //     não o do parceiro, então este passo serve às duas primeiras fontes.
  const placeOwner = new Map<string, string>()
  for (const batch of chunk(clientIds)) {
    const { data } = await core
      .from('attractions')
      .select('id, partner_client_id, approved, approved_at')
      .in('partner_client_id', batch)

    for (const row of (data ?? []) as {
      id: string
      partner_client_id: string | null
      approved: boolean | null
      approved_at: string | null
    }[]) {
      if (!row.id || !row.partner_client_id) continue
      placeOwner.set(row.id, row.partner_client_id)

      // O MAIS ANTIGO de todos os lugares do parceiro. Um segundo ponto publicado depois não
      // recomeça a cobrança dele — a primeira vez que algo dele foi ao ar é que a começou.
      if (row.approved === true && row.approved_at) {
        const at = String(row.approved_at).slice(0, 10)
        const known = starts.get(row.partner_client_id)
        if (!known || at < known.at) {
          starts.set(row.partner_client_id, { at, source: 'publication' })
        }
      }
    }
  }

  // 2 · A trilha, para quem não tem carimbo. Ordem CRESCENTE: a primeira publicação é a que
  //     começou a cobrar, e um lugar tirado do ar e recolocado não reinicia o relógio.
  const withoutStamp = Array.from(placeOwner.entries())
    .filter(([, clientId]) => !starts.has(clientId))
    .map(([placeId]) => placeId)

  for (const batch of chunk(withoutStamp)) {
    const { data } = await core
      .from('audit_logs')
      .select('entity_id, created_at')
      .eq('action', 'PUBLISH_PARTNER_PLACE')
      .in('entity_id', batch)
      .order('created_at', { ascending: true })

    for (const row of (data ?? []) as { entity_id: string | null; created_at: string }[]) {
      const clientId = row.entity_id ? placeOwner.get(row.entity_id) : undefined
      if (!clientId || starts.has(clientId)) continue
      starts.set(clientId, { at: String(row.created_at).slice(0, 10), source: 'publication' })
    }
  }

  // 3 · A liberação do parceiro. É onde quase todo mundo cai hoje.
  const missing = clientIds.filter((id) => !starts.has(id))
  if (missing.length === 0) return starts

  for (const batch of chunk(missing)) {
    const { data } = await partner
      .from('clients')
      .select('id, approved_at')
      .in('id', batch)
      .not('approved_at', 'is', null)

    for (const row of (data ?? []) as { id: string; approved_at: string }[]) {
      if (!row.id || starts.has(row.id)) continue
      starts.set(row.id, { at: String(row.approved_at).slice(0, 10), source: 'liberation' })
    }
  }

  // 4 · O aceite do contrato vivo, para quem não tem nem liberação.
  const stillMissing = clientIds.filter((id) => !starts.has(id))
  if (stillMissing.length === 0) return starts

  const liveContract = new Map<string, string>()
  for (const batch of chunk(stillMissing)) {
    const { data } = await partner
      .from('partner_contracts')
      .select('id, client_id, created_at')
      .in('client_id', batch)
      .is('superseded_by', null)
      .order('created_at', { ascending: false })

    for (const row of (data ?? []) as { id: string; client_id: string }[]) {
      if (row.id && row.client_id && !liveContract.has(row.client_id)) {
        liveContract.set(row.client_id, row.id)
      }
    }
  }

  const contractOwner = new Map<string, string>()
  for (const [clientId, contractId] of liveContract) contractOwner.set(contractId, clientId)

  for (const batch of chunk(Array.from(contractOwner.keys()))) {
    const { data } = await partner
      .from('partner_contract_acceptances')
      .select('contract_id, accepted_at')
      .in('contract_id', batch)

    for (const row of (data ?? []) as { contract_id: string; accepted_at: string }[]) {
      const clientId = contractOwner.get(row.contract_id)
      if (!clientId || starts.has(clientId)) continue
      starts.set(clientId, { at: String(row.accepted_at).slice(0, 10), source: 'signature' })
    }
  }

  return starts
}

/**
 * OS EVENTOS DO REVENUECAT — a fonte da receita do app.
 *
 * LÊ O JSONB, E NÃO AS COLUNAS AO LADO DELE. `drive.subscription_history` tem `price_local`,
 * `price_local_currency` e `environment` como colunas próprias, e elas estão NULAS em 100% das
 * linhas (medido em 2026-09-02, 201 linhas). O que a EF `app-revenuecat-webhook` de fato grava é
 * o payload inteiro em `metadata.full_event` — e ali está tudo: valor, moeda, país, ambiente,
 * loja, produto e o parceiro que trouxe a pessoa.
 *
 * A LEITURA FOI CONFERIDA CONTRA O PAINEL DO REVENUECAT em 2026-09-02: 9 de 9 transações pagas,
 * US$ 77,44 bruto, valor idêntico linha a linha.
 *
 * Devolve lista vazia quando a leitura falha. Sem evento não há receita de app, e a tela mostra
 * zero — inventar transação é o que não pode acontecer.
 */
/**
 * OS EVENTOS DE VENDA DO APP, OU `null`.
 *
 * `[]` POR ERRO DESENHA RECEITA ZERO. Esta é a única fonte de receita do lado do turista: sem ela
 * o gráfico do mês perde a camada do app inteira, a projeção some, e a tela afirma que ninguém
 * comprou nada. É o defeito de `loadPartners` do outro lado do negócio.
 */
export async function loadRcEvents(limit = 5000): Promise<RcEvent[] | null> {
  const { data, error } = await getSupabaseService()
    .schema('drive')
    .from('subscription_history')
    .select('metadata')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return null

  const events: RcEvent[] = []
  for (const row of (data ?? []) as { metadata: unknown }[]) {
    const event = parseRcEvent(row.metadata)
    if (event) events.push(event)
  }
  return events
}

/**
 * A taxa de comissão de cada parceiro, como fração.
 *
 * `core.clients.commission_rate` é o único lugar onde ela existe, e o contrato a congela no
 * instrumento assinado. Parceiro sem taxa NÃO entra no mapa: `commissionByPartner` o nomeia em
 * vez de aplicar zero, porque zero sobre receita real é uma dívida que some.
 */
/**
 * A COMISSÃO POR CLIENTE, OU `null`.
 *
 * UM MAPA VAZIO POR ERRO SUPERESTIMA A RECEITA: comissão é o que se paga a quem trouxe a venda, e
 * sem ela o líquido volta a ser o bruto. O erro cai sempre para o lado otimista, que é o pior
 * lado para um erro cair.
 */
export async function loadCommissionRates(): Promise<Map<string, number> | null> {
  const rates = new Map<string, number>()
  const { data, error } = await getSupabaseService()
    .schema('core')
    .from('clients')
    .select('id, commission_rate')

  if (error) return null
  for (const row of (data ?? []) as { id: string; commission_rate: number | null }[]) {
    if (row.id && typeof row.commission_rate === 'number') rates.set(row.id, row.commission_rate)
  }
  return rates
}
