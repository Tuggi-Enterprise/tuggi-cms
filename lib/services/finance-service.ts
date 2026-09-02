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
import { loadLiveContractTiers } from '@/lib/services/partner-contract-tier'
import type { FinanceProduct } from '@/lib/finance/catalog'
import type { FinancePurchase, StandardRate } from '@/lib/finance/unit-cost'
import type { OrderRecipeOverride, RecipeLine } from '@/lib/finance/recipe'
import type { PackagingRule } from '@/lib/finance/packaging'
import type { FixedCostRecord } from '@/lib/finance/structure'
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

export async function loadOrderOverrides(orderIds: string[]): Promise<OrderRecipeOverride[]> {
  if (orderIds.length === 0) return []
  const { data } = await finance()
    .from('order_recipe_override')
    .select('order_id, parent_product_id, component_product_id, quantity')
    .in('order_id', orderIds)

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

export async function loadFixedCosts(): Promise<FixedCostRecord[]> {
  const { data } = await finance()
    .from('fixed_costs')
    .select('id, label, kind, amount_cents, currency, incurred_at, period_months')
    .order('incurred_at', { ascending: false })

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    label: String(row.label),
    kind: row.kind === 'recurring' ? 'recurring' : 'one_off',
    amountCents: Number(row.amount_cents),
    currency: String(row.currency),
    incurredAt: String(row.incurred_at),
    periodMonths: row.period_months === null ? null : Number(row.period_months),
  }))
}

// ── Escritas ──────────────────────────────────────────────────────────────────────────────────

export type WriteOutcome = { ok: true; id: string } | { ok: false; reason: 'write_failed' }

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

export async function createFixedCost(input: {
  label: string
  kind: 'one_off' | 'recurring'
  amountCents: number
  currency: string
  incurredAt: string
  periodMonths: number | null
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
      notes: input.notes ?? null,
      created_by: input.createdBy ?? null,
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, reason: 'write_failed' }
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

interface CostEntryRow {
  clientId: string
  amountCents: number
  currency: string
}

async function loadCostEntries(): Promise<CostEntryRow[] | null> {
  const { data, error } = await finance()
    .from('client_cost_entries')
    .select('client_id, amount_cents, currency')

  if (error) return null
  return (data ?? []).map((row: Record<string, unknown>) => ({
    clientId: String(row.client_id),
    amountCents: Number(row.amount_cents),
    currency: String(row.currency ?? 'BRL'),
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

async function loadPartners(cap: number): Promise<PartnerRow[]> {
  const { data } = await getSupabaseService()
    .schema('partner')
    .from('clients')
    .select('id, name, company_name, approved_at, monthly_fee_cents, is_courtesy, courtesy_reason')
    .order('created_at', { ascending: false })
    .limit(cap)

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
   * Se o ledger de compras respondeu.
   *
   * Ele é um sinal SEPARADO do resto, e não um erro, porque `drive.time_credit_grants` nega
   * SELECT até ao `service_role` (medido em 2026-09-01) e não existe RPC com escopo por
   * parceiro. Enquanto for `false`, `usersWithPurchase` sobe como `null` e o veredito de quem
   * não paga é `unknown_return` — a tela diz "não sei" em vez de acusar por permissão.
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
 * A COMPRA VEM DO LEDGER E FICA EM MINUTOS. `drive.time_credit_grants.source = 'purchase'` diz
 * QUEM comprou e QUANTOS minutos; não existe valor em dinheiro em lugar nenhum do fluxo do
 * usuário do app (BR-MONETIZACAO-048, e o catálogo de preços é `drive.product_grant_map`, fora
 * deste repositório). Então o que sobe para a tela é contagem e minutos, rotulados como tal.
 *
 * Devolve `null` quando o banco recusa. Ver o cabeçalho: um erro aqui não pode virar zero.
 */
async function loadAppUserSide(partnerIds: string[]): Promise<AppUserSide | null> {
  const empty: AppUserSide = {
    byPartnerId: new Map(),
    byClientId: new Map(),
    purchasersByPartner: new Map(),
    minutesByPartner: new Map(),
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

  const acquiredBy = new Map<string, string>()
  for (const row of profiles) {
    const partnerId = row.partner_id
    const clientId = row.client_id
    if (partnerId) {
      empty.byPartnerId.set(partnerId, (empty.byPartnerId.get(partnerId) ?? 0) + 1)
      if (row.id) acquiredBy.set(row.id, partnerId)
    }
    if (clientId) empty.byClientId.set(clientId, (empty.byClientId.get(clientId) ?? 0) + 1)
  }

  const acquiredIds = Array.from(acquiredBy.keys())
  if (acquiredIds.length === 0) return empty

  const grants: Record<string, string | number | null>[] = []
  for (const batch of chunk(acquiredIds)) {
    const { data, error } = await drive
      .from('time_credit_grants')
      .select('user_id, minutes_granted')
      .eq('source', 'purchase')
      .in('user_id', batch)

    // Sem permissão no ledger a tela NÃO cai: ela perde a distinção entre "não trouxe ninguém"
    // e "trouxe quem comprou", e diz isso. O custo — que é o motivo do módulo — continua inteiro.
    if (error) return { ...empty, purchasesAnswered: false }
    grants.push(...((data ?? []) as Record<string, string | number | null>[]))
  }

  const purchasers = new Map<string, Set<string>>()
  for (const row of grants) {
    const userId = typeof row.user_id === 'string' ? row.user_id : null
    if (!userId) continue
    const partnerId = acquiredBy.get(userId)
    if (!partnerId) continue

    const seen = purchasers.get(partnerId) ?? new Set<string>()
    seen.add(userId)
    purchasers.set(partnerId, seen)

    const minutes = typeof row.minutes_granted === 'number' ? row.minutes_granted : 0
    empty.minutesByPartner.set(partnerId, (empty.minutesByPartner.get(partnerId) ?? 0) + minutes)
  }
  for (const [partnerId, users] of purchasers) {
    empty.purchasersByPartner.set(partnerId, users.size)
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
  /** Verdadeiro quando a leitura bateu no teto: todo número vira um piso, e a tela diz isso. */
  truncated: boolean
  /** Falso quando o ledger de compras não respondeu. A tela nomeia a lacuna em vez de escondê-la. */
  purchasesAnswered: boolean
}

/**
 * As duas maneiras de a leitura não acontecer, e elas são DIFERENTES para o operador.
 *
 * `finance_unavailable` é o schema `finance` fora do ar — sem ele não há custo nenhum, e desenhar
 * a tela diria que todo parceiro é de graça. `app_users_unavailable` é `drive.profiles` — sem ele
 * não há aquisição nem CAC. A falta de PERMISSÃO no ledger de compras não está aqui: ela não
 * derruba nada, vira `purchasesAnswered: false` e o veredito `unknown_return`.
 */
export type FinanceOverviewFailure = 'finance_unavailable' | 'app_users_unavailable'

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
  const [partners, consumption, costEntries] = await Promise.all([
    loadPartners(cap),
    loadConsumption(),
    loadCostEntries(),
  ])

  // Sem as linhas de custo não há tela: uma lista vazia por erro afirmaria que ninguém custou
  // nada, que é a única coisa que este módulo não pode dizer por engano.
  if (consumption === null || costEntries === null) return { ok: false, reason: 'finance_unavailable' }

  const partnerIds = partners.map((partner) => partner.id)
  const catalog = await loadCatalog()
  if (!catalog) return { ok: false, reason: 'finance_unavailable' }

  const [tiers, appUsers, awaitingShipment] = await Promise.all([
    loadLiveContractTiers(partnerIds),
    loadAppUserSide(partnerIds),
    loadOrdersAwaitingShipment(catalog.products),
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

  const clients = partners.map((partner) => {
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
      contractTier: tiers.get(partner.id) ?? null,
    })

    // `null` quando o ledger não respondeu — e `null` não é zero: é o que faz o veredito de um
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
    // acima pode escapar dela por ordem de código. Quando a RPC de 2.1 chegar com o piso DENTRO
    // dela, esta chamada vira redundante e inofensiva — ela nunca suprime o que já está suprimido.
    const facts: ClientFinanceFacts = suppressSmallCohortPurchases({
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
    })

    return assessClient(facts, now)
  })

  return {
    ok: true,
    overview: {
      clients,
      consumption,
      truncated: partners.length >= cap,
      purchasesAnswered: appUsers.purchasesAnswered,
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
  if (!catalog || !purchases || shipments === null) return null
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
  if (!catalog || !purchases || shipments === null) return null

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
