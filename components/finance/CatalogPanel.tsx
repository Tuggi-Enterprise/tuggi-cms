'use client'

/**
 * CATÁLOGO E COMPRAS — onde o preço entra no módulo, e o único lugar onde ele entra.
 *
 * NÃO EXISTE CAMPO DE CUSTO UNITÁRIO NESTA TELA, e a ausência é o desenho. O operador tem a nota
 * — "2 bobinas por R$ 180" — e o custo por etiqueta é uma conta feita com o RENDIMENTO do
 * produto (`lib/finance/unit-cost.ts`). Um campo de preço unitário ao lado da nota seria a
 * promessa de que um dia os dois vão discordar, e o que decidiria o custo do parceiro seria o
 * número que alguém digitou por último.
 *
 * O RENDIMENTO É EDITÁVEL E O RESTO DO PRODUTO NÃO. `id`, `role` e `material_kind` são
 * identidade: mudar o tipo de material reescreveria o custo de todo pedido daquele tipo
 * consumido depois. Um produto novo é um produto novo.
 *
 * A RECEITA SÓ GANHA VIGÊNCIA, NUNCA EDIÇÃO. Trocar 2 QR por 3 é um fato novo a partir de uma
 * data; editar a linha antiga apagaria a única prova de quanto o display custava em agosto.
 *
 * `comprado − consumido` NÃO É A FILA DE MATERIAL. A fila conta o que falta IMPRIMIR; aqui se
 * conta o que já foi pago e ainda não saiu — capital parado, e a resposta a "comprei demais?".
 */

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCount, formatMoney, parseMoneyToCents } from '@/lib/finance/money'
import { summarizeStock } from '@/lib/finance/summary'
import { piecesFrom, type FinanceProduct } from '@/lib/finance/catalog'
import type { FinancePurchaseRow } from '@/lib/services/finance-service'
import type { RecipeLine } from '@/lib/finance/recipe'
import type { PackagingRule } from '@/lib/finance/packaging'
import type { ConsumptionRecord } from '@/lib/finance/profitability'

export interface UnitCostView {
  productId: string
  centsExact: number | null
  currency: string | null
  pieces: number
}

interface Props {
  products: FinanceProduct[]
  recipes: RecipeLine[]
  packaging: PackagingRule[]
  purchases: FinancePurchaseRow[]
  unitCosts: UnitCostView[]
  consumption: ConsumptionRecord[]
  unmappedMaterialKinds: string[]
  onReload: () => void
}

const CARD =
  'rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70'
const HEAD =
  'px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400'
const CELL = 'px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200'
const INPUT =
  'min-h-[32px] w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'

export function CatalogPanel(props: Props) {
  const t = useTranslations('Finance')
  const stock = useMemo(
    () => summarizeStock(props.products, props.purchases, props.consumption),
    [props.products, props.purchases, props.consumption]
  )
  const costOf = (productId: string) =>
    props.unitCosts.find((cost) => cost.productId === productId) ?? null

  return (
    <div className="space-y-6">
      {props.unmappedMaterialKinds.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-3xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden="true" />
          <div className="text-sm">
            <div className="font-semibold text-amber-900 dark:text-amber-200">
              {t('catalog.unmappedTitle')}: {props.unmappedMaterialKinds.join(', ')}
            </div>
            <p className="mt-1 text-amber-900/80 dark:text-amber-200/80">{t('catalog.unmappedHint')}</p>
          </div>
        </div>
      )}

      {/* UMA TABELA POR PRODUTO, E NÃO DUAS. O catálogo mostrava produto, papel e unidade de
          compra numa tabela, e comprado-consumido-estoque em outra — as duas com uma linha por
          produto. Papel e unidade de compra não respondem pergunta nenhuma que alguém faça
          olhando para elas; o custo por peça e o que sobrou, sim. Duas tabelas com a mesma chave
          são duas leituras do mesmo assunto, e o operador tinha de cruzá-las de olho. */}
      <section className={CARD}>
        <h2 className="border-b border-gray-200 px-5 py-4 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-white">
          {t('catalog.stockTitle')}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th scope="col" className={HEAD}>{t('catalog.product')}</th>
                <th scope="col" className={HEAD}>{t('catalog.unitCost')}</th>
                <th scope="col" className={HEAD}>{t('catalog.purchased')}</th>
                <th scope="col" className={HEAD}>{t('catalog.consumed')}</th>
                <th scope="col" className={HEAD}>{t('catalog.remaining')}</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((line) => {
                const cost = costOf(line.productId)
                return (
                  <tr key={line.productId} className="border-t border-gray-100 dark:border-gray-800">
                    <th scope="row" className={`${CELL} text-left font-medium text-gray-900 dark:text-white`}>
                      {line.name}
                    </th>
                    <td className={`${CELL} tabular-nums`}>
                      {/* `null` imprime a razão, não `R$ 0,00`: sem compra não há custo, e zero
                          diria que a peça saiu de graça. */}
                      {cost?.centsExact == null || !cost.currency ? (
                        <span className="text-gray-600 dark:text-gray-400">{t('catalog.noPrice')}</span>
                      ) : (
                        formatMoney(Math.round(cost.centsExact), cost.currency)
                      )}
                    </td>
                    <td className={`${CELL} tabular-nums`}>{formatCount(line.purchasedPieces)}</td>
                    <td className={`${CELL} tabular-nums`}>{formatCount(line.consumedPieces)}</td>
                    {/* Negativo é informação e não erro: saiu mais do que se registrou ter comprado. */}
                    <td
                      className={`${CELL} tabular-nums font-semibold ${
                        line.remainingPieces < 0 ? 'text-red-700 dark:text-red-300' : ''
                      }`}
                    >
                      {formatCount(line.remainingPieces)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      <RecipePanel products={props.products} recipes={props.recipes} onSaved={props.onReload} />

      <PackagingPanel
        products={props.products}
        packaging={props.packaging}
        onSaved={props.onReload}
      />

      <PurchasePanel products={props.products} purchases={props.purchases} onSaved={props.onReload} />

    </div>
  )
}

function RecipePanel({
  products,
  recipes,
  onSaved,
}: {
  products: FinanceProduct[]
  recipes: RecipeLine[]
  onSaved: () => void
}) {
  const t = useTranslations('Finance')
  const deliverables = products.filter((product) => product.role === 'deliverable')
  const components = products.filter((product) => product.role === 'component')

  const [parent, setParent] = useState(deliverables[0]?.id ?? '')
  const [component, setComponent] = useState(components[0]?.id ?? '')
  const [quantity, setQuantity] = useState('1')
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const response = await fetch('/api/finance/catalog', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'recipe',
        parentProductId: parent,
        componentProductId: component,
        quantity: Number(quantity),
        effectiveFrom: from,
      }),
    })
    setSaving(false)
    if (!response.ok) {
      setError(t('form.error'))
      return
    }
    onSaved()
  }

  const name = (id: string) => products.find((product) => product.id === id)?.name ?? id

  return (
    <section className={CARD}>
      <header className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t('catalog.recipeTitle')}</h2>
        {/* O QUE ELA FAZ vem antes de COMO ELA FUNCIONA. O título dizia "Receita" — jargão de
            fábrica — e a explicação abria falando de vigência, que é mecanismo. Quem lê a tela
            pela primeira vez precisa saber que sem esta linha o display custa só o plástico e o
            estoque de etiquetas nunca baixa; a data só importa no dia em que alguém muda. */}
        <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">{t('catalog.recipeHint')}</p>
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-500">
          {t('catalog.recipeVigencia')}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              <th scope="col" className={HEAD}>{t('catalog.parent')}</th>
              <th scope="col" className={HEAD}>{t('catalog.component')}</th>
              <th scope="col" className={HEAD}>{t('catalog.quantity')}</th>
              <th scope="col" className={HEAD}>{t('catalog.effectiveFrom')}</th>
              <th scope="col" className={HEAD}>{' '}</th>
            </tr>
          </thead>
          <tbody>
            {[...recipes]
              .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
              .map((line) => (
                <tr
                  key={`${line.parentProductId}-${line.componentProductId}-${line.effectiveFrom}`}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <th scope="row" className={`${CELL} text-left font-medium text-gray-900 dark:text-white`}>
                    {name(line.parentProductId)}
                  </th>
                  <td className={CELL}>{name(line.componentProductId)}</td>
                  <td className={`${CELL} tabular-nums`}>{line.quantity}</td>
                  <td className={`${CELL} tabular-nums`}>{line.effectiveFrom}</td>
                  <td className={CELL}>
                    <RuleDelete
                      query={new URLSearchParams({
                        kind: 'recipe',
                        parentProductId: line.parentProductId,
                        componentProductId: line.componentProductId,
                        effectiveFrom: line.effectiveFrom,
                      }).toString()}
                      onDone={onSaved}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
        <Field label={t('catalog.parent')} id="recipe-parent">
          <select id="recipe-parent" value={parent} onChange={(e) => setParent(e.target.value)} className={INPUT}>
            {deliverables.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('catalog.component')} id="recipe-component">
          <select id="recipe-component" value={component} onChange={(e) => setComponent(e.target.value)} className={INPUT}>
            {components.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('catalog.quantity')} id="recipe-quantity">
          <input id="recipe-quantity" type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t('catalog.effectiveFrom')} id="recipe-from">
          <input id="recipe-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
        </Field>
        <Button variant="cta" onClick={save} disabled={saving || !parent || !component}>
          {saving ? t('catalog.saving') : t('catalog.recipeAdd')}
        </Button>

        {/* A FRASE VIVA. O número sozinho é ambíguo para quem digita: em 2026-09-01 "1 envelope a
            cada 50 displays" foi cadastrado como quantidade 50, e virou "cada display leva 50
            envelopes" — R$ 1.500,00 num pedido de R$ 207,50. Lida em voz alta, a frase pega o
            erro antes de ele virar custo. */}
        <p className="w-full text-[11px] text-gray-700 dark:text-gray-300">
          {t('catalog.recipeSentence', {
            parent: name(parent),
            quantity: Number(quantity) || 0,
            component: name(component),
          })}
        </p>
        {error && <p className="w-full text-[11px] text-red-700 dark:text-red-300">{error}</p>}
      </div>
    </section>
  )
}

function PurchasePanel({
  products,
  purchases,
  onSaved,
}: {
  products: FinanceProduct[]
  purchases: FinancePurchaseRow[]
  onSaved: () => void
}) {
  const t = useTranslations('Finance')
  const [productId, setProductId] = useState(products[0]?.id ?? '')
  const [units, setUnits] = useState('1')
  const [unitsYield, setUnitsYield] = useState('1')
  const [total, setTotal] = useState('')
  const [freight, setFreight] = useState('')
  const [currency, setCurrency] = useState('BRL')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [supplier, setSupplier] = useState('')
  const [invoice, setInvoice] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // O formulário fala em reais e o módulo inteiro fala em centavos. A conversão acontece aqui,
  // uma vez, por `parseMoneyToCents` — que existe porque `Number(v.replace(',','.'))` lia
  // `1.000` como um real e aceitava R$ 0,01 em silêncio (2026-09-01).
  const totalCents = parseMoneyToCents(total)
  const freightCents = freight.trim() === '' ? 0 : parseMoneyToCents(freight)
  const unitsValue = Number.parseInt(units, 10)
  const yieldValue = Number.parseInt(unitsYield, 10)
  const product = products.find((candidate) => candidate.id === productId)

  const badTotal = total.trim() !== '' && totalCents === null
  const badFreight = freight.trim() !== '' && freightCents === null
  const badUnits =
    (units.trim() !== '' && (!Number.isInteger(unitsValue) || unitsValue < 1)) ||
    (unitsYield.trim() !== '' && (!Number.isInteger(yieldValue) || yieldValue < 1))

  /**
   * O custo por peça, ANTES de salvar.
   *
   * É a defesa que faltava: um valor digitado errado aparece aqui como um número absurdo, e o
   * operador vê antes de gravar. Sem ele, R$ 1.000,00 lido como R$ 0,01 só apareceria semanas
   * depois, como um parceiro estranhamente barato.
   */
  const pieces =
    Number.isInteger(unitsValue) && Number.isInteger(yieldValue) && unitsValue > 0 && yieldValue > 0
      ? piecesFrom(unitsValue, yieldValue)
      : 0
  const preview =
    totalCents !== null && freightCents !== null && pieces > 0
      ? (totalCents + freightCents) / pieces
      : null

  async function save() {
    if (totalCents === null || freightCents === null || badUnits) {
      setError(t('catalog.invalidAmount'))
      return
    }

    setSaving(true)
    setError(null)
    const response = await fetch('/api/finance/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId,
        units: unitsValue,
        unitsYield: yieldValue,
        totalCents,
        freightCents,
        currency,
        purchasedAt: date,
        supplier: supplier || null,
        invoiceRef: invoice || null,
      }),
    })
    setSaving(false)
    if (!response.ok) {
      // O código da rota sobe para a tela: `invalid_amount` e `unknown_product` mandam o
      // operador para campos diferentes, e um "não foi possível salvar" para os dois é o que
      // fez esta compra ser tentada três vezes seguidas.
      const body = (await response.json().catch(() => ({}))) as { error?: string; field?: string }
      setError(body.error ? t('form.errorCode', { code: body.error }) : t('form.error'))
      return
    }
    setTotal('')
    setFreight('')
    setInvoice('')
    onSaved()
  }

  const name = (id: string) => products.find((candidate) => candidate.id === id)?.name ?? id

  /**
   * O rendimento que a ÚLTIMA compra deste produto teve.
   *
   * Melhor que um cadastro por dois motivos: nunca envelhece — se o rolo passar a vir com 200, a
   * primeira compra já ensina o formulário — e não existe um segundo lugar para alguém lembrar de
   * manter atualizado. Produto sem compra nenhuma sugere 1, que é o caso da maioria.
   *
   * É SUGESTÃO E NÃO REGRA: quem decide é o que ficar no campo, porque é ele que a compra congela.
   */
  function suggestYield(id: string): number {
    // `reduce` e não `.at(-1)`: o `lib` do tsconfig deste projeto não alcança ES2022.
    const last = purchases
      .filter((buy) => buy.productId === id)
      .reduce<FinancePurchaseRow | null>(
        (latest, buy) => (!latest || buy.purchasedAt >= latest.purchasedAt ? buy : latest),
        null
      )
    return last?.unitsYield ?? 1
  }

  return (
    <section className={CARD}>
      <h2 className="border-b border-gray-200 px-5 py-4 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-white">
        {t('catalog.purchasesTitle')}
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              <th scope="col" className={HEAD}>{t('catalog.date')}</th>
              <th scope="col" className={HEAD}>{t('catalog.product')}</th>
              <th scope="col" className={HEAD}>{t('catalog.units')}</th>
              <th scope="col" className={HEAD}>{t('catalog.pieces')}</th>
              <th scope="col" className={HEAD}>{t('catalog.total')}</th>
              <th scope="col" className={HEAD}>{t('catalog.freight')}</th>
              <th scope="col" className={HEAD}>{t('catalog.supplier')}</th>
              <th scope="col" className={HEAD}>{' '}</th>
            </tr>
          </thead>
          <tbody>
            {purchases.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-6 text-center text-sm text-gray-600 dark:text-gray-400">
                  {t('catalog.empty')}
                </td>
              </tr>
            )}
            {[...purchases]
              .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))
              .map((purchase) => (
                <PurchaseRow
                  key={purchase.id}
                  purchase={purchase}
                  productName={name(purchase.productId)}
                  onSaved={onSaved}
                />
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
        <Field label={t('catalog.product')} id="purchase-product">
          <select
            id="purchase-product"
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value)
              setUnitsYield(String(suggestYield(e.target.value)))
            }}
            className={INPUT}
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({product.purchaseUnit})
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('catalog.units')} id="purchase-units">
          <input id="purchase-units" type="number" min={1} value={units} onChange={(e) => setUnits(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t('catalog.unitsYield')} id="purchase-yield">
          <input id="purchase-yield" type="number" min={1} value={unitsYield} onChange={(e) => setUnitsYield(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t('catalog.total')} id="purchase-total">
          <input id="purchase-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} className={INPUT} placeholder="0,00" />
        </Field>
        <Field label={t('catalog.freight')} id="purchase-freight">
          <input id="purchase-freight" inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} className={INPUT} placeholder="0,00" />
        </Field>
        <Field label={t('catalog.currency')} id="purchase-currency">
          <input id="purchase-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className={`${INPUT} max-w-[5rem]`} />
        </Field>
        <Field label={t('catalog.date')} id="purchase-date">
          <input id="purchase-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t('catalog.supplier')} id="purchase-supplier">
          <input id="purchase-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t('catalog.invoice')} id="purchase-invoice">
          <input id="purchase-invoice" value={invoice} onChange={(e) => setInvoice(e.target.value)} className={INPUT} />
        </Field>
        <Button
          variant="cta"
          onClick={save}
          disabled={saving || !productId || totalCents === null || freightCents === null || badUnits || pieces <= 0}
        >
          {saving ? t('catalog.saving') : t('catalog.purchaseAdd')}
        </Button>

        <div className="w-full space-y-1">
          {/* A prévia diz a multiplicação POR EXTENSO. É ela que teria mostrado, no dia em que
              300 adesivos viraram 45.000, que o número digitado estava no campo errado. */}
          {pieces > 0 && (
            <p className="text-[11px] text-gray-700 dark:text-gray-300">
              {t('catalog.piecesPreview', { units: unitsValue, yield: yieldValue, pieces })}
            </p>
          )}
          {preview !== null && (
            <p className="text-[11px] text-gray-700 dark:text-gray-300">
              {t('catalog.preview', {
                total: formatMoney((totalCents ?? 0) + (freightCents ?? 0), currency),
                pieces,
                unit: formatMoney(Math.round(preview), currency),
              })}
            </p>
          )}
          {(badTotal || badFreight || badUnits) && (
            <p className="text-[11px] text-red-700 dark:text-red-300">{t('catalog.invalidAmount')}</p>
          )}
          {error && <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p>}
        </div>
      </div>
    </section>
  )
}

export function Field({
  label,
  id,
  children,
}: {
  label: string
  id: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-[8rem] flex-1">
      <label
        htmlFor={id}
        className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * UMA COMPRA, EDITÁVEL E APAGÁVEL — a única linha de `finance` que aceita as duas coisas.
 *
 * As tabelas de LANÇAMENTO não apagam: um custo já apurado contra um parceiro que some faz o
 * total dele mudar sem nada explicar. Uma compra é outra coisa — é o registro de uma nota, ela
 * não tem oposto (não se compra menos uma bobina), e uma nota errada não erra uma linha: ela
 * envenena toda derivação futura do custo por peça. Ver `20260901_04_finance_purchase_edit.sql`.
 *
 * O AVISO É PARTE DA FUNÇÃO, e não decoração. Corrigir a nota muda o custo do que for calculado
 * DAQUI PARA FRENTE; o que já foi lançado congelou o preço do dia e não se mexe. Sem essa frase,
 * o operador corrigiria uma compra esperando ver o total do parceiro mudar, e não veria.
 */
function PurchaseRow({
  purchase,
  productName,
  onSaved,
}: {
  purchase: FinancePurchaseRow
  productName: string
  onSaved: () => void
}) {
  const t = useTranslations('Finance')
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [units, setUnits] = useState(String(purchase.units))
  const [unitsYield, setUnitsYield] = useState(String(purchase.unitsYield))
  const [total, setTotal] = useState((purchase.totalCents / 100).toFixed(2).replace('.', ','))
  const [freight, setFreight] = useState((purchase.freightCents / 100).toFixed(2).replace('.', ','))
  const [date, setDate] = useState(purchase.purchasedAt)
  const [supplier, setSupplier] = useState(purchase.supplier ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalCents = parseMoneyToCents(total)
  const freightCents = parseMoneyToCents(freight)
  const unitsValue = Number.parseInt(units, 10)
  const yieldValue = Number.parseInt(unitsYield, 10)
  const editedPieces =
    Number.isInteger(unitsValue) && Number.isInteger(yieldValue) && unitsValue > 0 && yieldValue > 0
      ? piecesFrom(unitsValue, yieldValue)
      : 0
  const invalid =
    totalCents === null ||
    freightCents === null ||
    !Number.isInteger(unitsValue) ||
    unitsValue < 1 ||
    !Number.isInteger(yieldValue) ||
    yieldValue < 1

  async function send(method: 'PATCH' | 'DELETE') {
    setBusy(true)
    setError(null)
    const response =
      method === 'DELETE'
        ? await fetch(`/api/finance/purchases?id=${encodeURIComponent(purchase.id)}`, {
            method: 'DELETE',
          })
        : await fetch('/api/finance/purchases', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: purchase.id,
              units: unitsValue,
              unitsYield: yieldValue,
              totalCents,
              freightCents,
              purchasedAt: date,
              supplier: supplier || null,
            }),
          })
    setBusy(false)

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      setError(body.error ? t('form.errorCode', { code: body.error }) : t('form.error'))
      return
    }
    setEditing(false)
    setConfirming(false)
    onSaved()
  }

  if (!editing) {
    return (
      <tr className="border-t border-gray-100 dark:border-gray-800">
        <td className={`${CELL} tabular-nums`}>{purchase.purchasedAt}</td>
        <th scope="row" className={`${CELL} text-left font-medium text-gray-900 dark:text-white`}>
          {productName}
        </th>
        {/* Os dois números lado a lado: "2 rolos de 150" é o que estava na nota, e as peças são
            a conta que o banco fez. Ler só o total é como 300 adesivos viraram 45.000. */}
        <td className={`${CELL} tabular-nums`}>
          {formatCount(purchase.units)}
          {purchase.unitsYield > 1 && (
            <span className="ml-1 text-[11px] text-gray-600 dark:text-gray-400">
              × {formatCount(purchase.unitsYield)}
            </span>
          )}
        </td>
        <td className={`${CELL} tabular-nums font-medium`}>{formatCount(purchase.pieces)}</td>
        <td className={`${CELL} tabular-nums`}>{formatMoney(purchase.totalCents, purchase.currency)}</td>
        <td className={`${CELL} tabular-nums`}>{formatMoney(purchase.freightCents, purchase.currency)}</td>
        <td className={CELL}>{purchase.supplier ?? '—'}</td>
        <td className={CELL}>
          {confirming ? (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-red-800 dark:text-red-300">{t('catalog.deleteWarning')}</span>
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" disabled={busy} onClick={() => void send('DELETE')}>
                  {busy ? t('catalog.saving') : t('catalog.deleteConfirm')}
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
                  {t('form.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="min-h-[24px] text-xs font-semibold text-primary-800 hover:underline dark:text-tuggi-blue"
              >
                {t('catalog.edit')}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="min-h-[24px] text-xs font-semibold text-red-800 hover:underline dark:text-red-300"
              >
                {t('catalog.delete')}
              </button>
            </div>
          )}
          {error && <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">{error}</p>}
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-t border-gray-100 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-800/30">
      <td className={CELL}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${INPUT} min-w-[9rem]`} />
      </td>
      <th scope="row" className={`${CELL} text-left font-medium text-gray-900 dark:text-white`}>
        {productName}
        {/* O produto não é editável: trocá-lo moveria peças de um estoque para outro sem nada
            registrar a saída, e o KPI de comprado-menos-consumido mentiria nos dois. */}
        <span className="mt-0.5 block text-[11px] font-normal text-gray-600 dark:text-gray-400">
          {t('catalog.productLocked')}
        </span>
      </th>
      <td className={CELL}>
        <input
          type="number"
          min={1}
          value={units}
          onChange={(e) => setUnits(e.target.value)}
          className={`${INPUT} max-w-[6rem]`}
          aria-label={t('catalog.units')}
        />
        <input
          type="number"
          min={1}
          value={unitsYield}
          onChange={(e) => setUnitsYield(e.target.value)}
          className={`${INPUT} mt-1 max-w-[6rem]`}
          aria-label={t('catalog.unitsYield')}
        />
      </td>
      <td className={`${CELL} tabular-nums font-medium`}>{formatCount(editedPieces)}</td>
      <td className={CELL}>
        <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} className={`${INPUT} max-w-[8rem]`} />
      </td>
      <td className={CELL}>
        <input inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} className={`${INPUT} max-w-[8rem]`} />
      </td>
      <td className={CELL}>
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={INPUT} />
      </td>
      <td className={CELL}>
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <Button variant="cta" size="sm" disabled={busy || invalid} onClick={() => void send('PATCH')}>
              {busy ? t('catalog.saving') : t('catalog.save')}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing(false)}>
              {t('form.cancel')}
            </Button>
          </div>
          <span className="text-[11px] text-gray-600 dark:text-gray-400">{t('catalog.editWarning')}</span>
          {invalid && <span className="text-[11px] text-red-700 dark:text-red-300">{t('catalog.invalidAmount')}</span>}
          {error && <span className="text-[11px] text-red-700 dark:text-red-300">{error}</span>}
        </div>
      </td>
    </tr>
  )
}

/**
 * CADASTRAR UM PRODUTO — a escrita que faltava.
 *
 * O catálogo nasceu semeado por SQL e não tinha porta de entrada: para acrescentar um envelope,
 * uma caixa ou um material novo era preciso pedir uma migration. Aqui ele entra pela tela.
 *
 * NÃO EXISTE EDIÇÃO, e a assimetria é deliberada: o `id` é derivado do nome e aparece em
 * `product_recipe`, `order_shipment`, `purchases` e em toda linha de custo já congelada. Mudá-lo
 * quebraria o elo com o que já foi apurado — um produto novo é um produto novo.
 *
 * O TIPO DA ESTEIRA SÓ APARECE PARA ENTREGÁVEL, e só os que ainda não têm dono. Um componente
 * (envelope, etiqueta) não é pedido por parceiro nenhum, e dois produtos no mesmo tipo tornariam
 * o custo de um pedido ambíguo — o banco recusa, e a tela nem oferece.
 */
function NewProductForm({
  unmappedMaterialKinds,
  onSaved,
}: {
  unmappedMaterialKinds: string[]
  onSaved: () => void
}) {
  const t = useTranslations('Finance')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState<'deliverable' | 'component'>('component')
  const [purchaseUnit, setPurchaseUnit] = useState('unidade')
  const [materialKind, setMaterialKind] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const response = await fetch('/api/finance/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        role,
        purchaseUnit,
        materialKind: role === 'deliverable' && materialKind ? materialKind : null,
      }),
    })
    setSaving(false)

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      setError(
        body.error === 'taken' ? t('catalog.productTaken') : t('form.errorCode', { code: body.error ?? '?' })
      )
      return
    }
    setName('')
    setOpen(false)
    onSaved()
  }

  if (!open) {
    return (
      <div className="border-t border-gray-200 px-5 py-4 dark:border-gray-800">
        <Button variant="cta" size="sm" onClick={() => setOpen(true)}>
          {t('catalog.productAdd')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
      <Field label={t('catalog.productName')} id="new-product-name">
        <input
          id="new-product-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={INPUT}
          placeholder={t('catalog.productNamePlaceholder')}
        />
      </Field>

      <Field label={t('catalog.productRole')} id="new-product-role">
        <select
          id="new-product-role"
          value={role}
          onChange={(e) => setRole(e.target.value as 'deliverable' | 'component')}
          className={INPUT}
        >
          <option value="component">{t('catalog.roleComponent')}</option>
          <option value="deliverable">{t('catalog.roleDeliverable')}</option>
        </select>
      </Field>

      <Field label={t('catalog.productPurchaseUnit')} id="new-product-unit">
        <input
          id="new-product-unit"
          value={purchaseUnit}
          onChange={(e) => setPurchaseUnit(e.target.value)}
          className={INPUT}
          placeholder={t('catalog.productUnitPlaceholder')}
        />
      </Field>

      {/* Só os tipos que ainda não têm produto: os demais já têm dono, e o banco recusaria. */}
      {role === 'deliverable' && unmappedMaterialKinds.length > 0 && (
        <Field label={t('catalog.productMaterialKind')} id="new-product-kind">
          <select
            id="new-product-kind"
            value={materialKind}
            onChange={(e) => setMaterialKind(e.target.value)}
            className={INPUT}
          >
            <option value="">{t('catalog.productNoKind')}</option>
            {unmappedMaterialKinds.map((kind) => (
              <option key={kind} value={kind}>{kind}</option>
            ))}
          </select>
        </Field>
      )}

      <Button variant="cta" onClick={save} disabled={saving || !name.trim()}>
        {saving ? t('catalog.saving') : t('catalog.productAdd')}
      </Button>
      <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
        {t('form.cancel')}
      </Button>
      {error && <p className="w-full text-[11px] text-red-700 dark:text-red-300">{error}</p>}
    </div>
  )
}

/**
 * A EMBALAGEM DO ENVIO — e por que ela não é a mesma tabela que "o que cada peça leva junto".
 *
 * A receita é POR PEÇA: 1 QR por display. A embalagem é do PEDIDO INTEIRO e sobe em degrau: o
 * teto das peças dividido pela capacidade. Cadastrar o envelope como receita significaria 1/50 =
 * 0,02 envelope por display, e dez displays consumiriam 0,2 envelope — um número que não existe
 * na gaveta.
 *
 * Duas seções e não uma porque são duas perguntas: "o que vai colado na peça" e "em que a peça
 * viaja". Juntá-las obrigaria uma coluna a significar coisas diferentes conforme a linha.
 */
function PackagingPanel({
  products,
  packaging,
  onSaved,
}: {
  products: FinanceProduct[]
  packaging: PackagingRule[]
  onSaved: () => void
}) {
  const t = useTranslations('Finance')
  const components = products.filter((product) => product.role === 'component')

  const [productId, setProductId] = useState(components[0]?.id ?? '')
  const [capacity, setCapacity] = useState('50')
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const capacityValue = Number.parseInt(capacity, 10)
  const invalid = !Number.isInteger(capacityValue) || capacityValue < 1

  async function save() {
    setSaving(true)
    setError(null)
    const response = await fetch('/api/finance/catalog', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'packaging',
        productId,
        capacity: capacityValue,
        effectiveFrom: from,
      }),
    })
    setSaving(false)
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      setError(body.error ? t('form.errorCode', { code: body.error }) : t('form.error'))
      return
    }
    onSaved()
  }

  const name = (id: string) => products.find((entry) => entry.id === id)?.name ?? id

  return (
    <section className={CARD}>
      <header className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('catalog.packagingTitle')}
        </h2>
        <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
          {t('catalog.packagingHint')}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse">
          <thead>
            <tr>
              <th scope="col" className={HEAD}>{t('catalog.packagingProduct')}</th>
              <th scope="col" className={HEAD}>{t('catalog.packagingCapacity')}</th>
              <th scope="col" className={HEAD}>{t('catalog.effectiveFrom')}</th>
              <th scope="col" className={HEAD}>{' '}</th>
            </tr>
          </thead>
          <tbody>
            {packaging.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-6 text-center text-sm text-gray-600 dark:text-gray-400">
                  {t('catalog.packagingEmpty')}
                </td>
              </tr>
            )}
            {[...packaging]
              .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
              .map((rule) => (
                <tr
                  key={`${rule.productId}-${rule.effectiveFrom}`}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <th scope="row" className={`${CELL} text-left font-medium text-gray-900 dark:text-white`}>
                    {name(rule.productId)}
                  </th>
                  <td className={`${CELL} tabular-nums`}>
                    {t('catalog.packagingEvery', { count: rule.capacity })}
                  </td>
                  <td className={`${CELL} tabular-nums`}>{rule.effectiveFrom}</td>
                  <td className={CELL}>
                    <RuleDelete
                      query={new URLSearchParams({
                        kind: 'packaging',
                        productId: rule.productId,
                        effectiveFrom: rule.effectiveFrom,
                      }).toString()}
                      onDone={onSaved}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
        <Field label={t('catalog.packagingProduct')} id="packaging-product">
          <select
            id="packaging-product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className={INPUT}
          >
            {components.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('catalog.packagingCapacityField')} id="packaging-capacity">
          <input
            id="packaging-capacity"
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field label={t('catalog.effectiveFrom')} id="packaging-from">
          <input id="packaging-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
        </Field>
        <Button variant="cta" onClick={save} disabled={saving || !productId || invalid}>
          {saving ? t('catalog.saving') : t('catalog.recipeAdd')}
        </Button>

        {/* A mesma frase viva da receita, na direção oposta — é justamente a direção que se
            confunde, e ler as duas lado a lado é o que as mantém distintas. */}
        <p className="w-full text-[11px] text-gray-700 dark:text-gray-300">
          {t('catalog.packagingSentence', {
            capacity: capacityValue || 0,
            product: name(productId),
          })}
        </p>
        {error && <p className="w-full text-[11px] text-red-700 dark:text-red-300">{error}</p>}
      </div>
    </section>
  )
}

/**
 * APAGAR UMA REGRA — de receita ou de embalagem.
 *
 * PERMITIDO, e pela mesma razão da compra: regra é CADASTRO, não custo apurado. Uma regra errada
 * não tem oposto. Em 2026-09-01 "1 envelope a cada 50 displays" foi cadastrado invertido, como
 * "cada display leva 50 envelopes", e sem este botão o único caminho de saída seria uma vigência
 * de quantidade zero — que o cadastro recusa, porque zero não é uma receita.
 *
 * CONFIRMA ANTES, E DIZ O QUE NÃO DESFAZ: o custo já lançado com esta regra continua onde está,
 * porque ele guarda o que a regra dizia no dia. Corrigi-lo é outro ato, deliberado, pelo
 * `--recompute` do backfill.
 */
function RuleDelete({ query, onDone }: { query: string; onDone: () => void }) {
  const t = useTranslations('Finance')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/finance/catalog?${query}`, { method: 'DELETE' })
    setBusy(false)
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      setError(body.error ? t('form.errorCode', { code: body.error }) : t('form.error'))
      return
    }
    setConfirming(false)
    onDone()
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="min-h-[24px] text-xs font-semibold text-red-800 hover:underline dark:text-red-300"
      >
        {t('catalog.delete')}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-red-800 dark:text-red-300">
        {t('catalog.ruleDeleteWarning')}
      </span>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>
          {busy ? t('catalog.saving') : t('catalog.deleteConfirm')}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
          {t('form.cancel')}
        </Button>
      </div>
      {error && <span className="text-[11px] text-red-700 dark:text-red-300">{error}</span>}
    </div>
  )
}
