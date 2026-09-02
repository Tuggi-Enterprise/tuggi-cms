'use client'

/**
 * A ESTRUTURA — a impressora, as assinaturas, e quantos parceiros pagantes elas exigem.
 *
 * NADA DESTA TELA APARECE NA LINHA DE UM PARCEIRO, e essa é a decisão que ela existe para
 * proteger. A impressora não fica mais barata se cortarmos um parceiro; rateá-la por cliente
 * produziria um número que não serve para decidir sobre cliente nenhum e faria um parceiro
 * pequeno parecer caro só porque a estrutura existe. Ela cobre contra a SOMA das margens:
 *
 *   MC I  = receita do parceiro − custo direto do parceiro   → a tabela de Parceiros
 *   MC II = Σ MC I − fixo mensal da operação                 → aqui
 *
 * O PONTO DE EQUILÍBRIO USA SÓ O QUE VOLTA TODO MÊS. Uma impressora comprada uma vez não é uma
 * conta que chega todo mês, e dividi-la por uma vida útil estimada trocaria um fato (R$ 3.000 em
 * março) por um chute (R$ 0,03 por impressão, durante quantos anos?). Ela aparece aqui como o
 * desembolso datado que é.
 *
 * A TAXA PADRÃO MORA NESTA ABA E NÃO NO CATÁLOGO porque ela é a estrutura vestida de número por
 * peça. Cadastrá-la ao lado do custo de compra convidaria a lê-la como custo de compra, que é
 * exatamente o que ela não é — ela viaja em coluna própria até a tabela.
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { formatCount, formatMoney, parseMoneyToCents } from '@/lib/finance/money'
import type { FixedCostRecord, StructureSummary } from '@/lib/finance/structure'
import type { FinanceProduct } from '@/lib/finance/catalog'
import type { StandardRate } from '@/lib/finance/unit-cost'
import { Field } from './CatalogPanel'

interface Props {
  structure: StructureSummary
  fixedCosts: FixedCostRecord[]
  products: FinanceProduct[]
  rates: StandardRate[]
  onReload: () => void
}

const CARD =
  'rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70'
const HEAD =
  'px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400'
const CELL = 'px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200'
const INPUT =
  'min-h-[32px] w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'

export function StructurePanel({ structure, fixedCosts, products, rates, onReload }: Props) {
  const t = useTranslations('Finance')
  const money = (cents: number | null) => formatMoney(cents, structure.currency)

  return (
    <div className="space-y-6">
      <section className={CARD}>
        <header className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t('structure.title')}</h2>
          <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">{t('structure.hint')}</p>
        </header>

        <dl className="grid grid-cols-2 gap-5 px-5 py-5 lg:grid-cols-3">
          <Stat label={t('structure.monthlyFixed')} value={money(structure.monthlyFixedCents)} />
          <Stat label={t('structure.oneOff')} value={money(structure.oneOffCents)} />
          <Stat label={t('structure.contribution')} value={money(structure.contributionCents)} />
          <Stat label={t('structure.operatingMargin')} value={money(structure.operatingMarginCents)} />
          <Stat label={t('structure.avgFee')} value={money(structure.averageMonthlyFeeCents)} />
          <Stat
            label={t('structure.breakEven')}
            value={formatCount(structure.breakEvenPartners)}
            hint={`${t('structure.breakEvenHint')} · ${t('structure.paying')}: ${formatCount(structure.payingPartners)}`}
          />
        </dl>
      </section>

      <section className={CARD}>
        <h2 className="border-b border-gray-200 px-5 py-4 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-white">
          {t('structure.add')}
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse">
            <thead>
              <tr>
                <th scope="col" className={HEAD}>{t('structure.label')}</th>
                <th scope="col" className={HEAD}>{t('structure.kind')}</th>
                <th scope="col" className={HEAD}>{t('structure.amount')}</th>
                <th scope="col" className={HEAD}>{t('structure.periodMonths')}</th>
                <th scope="col" className={HEAD}>{t('structure.date')}</th>
              </tr>
            </thead>
            <tbody>
              {fixedCosts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-sm text-gray-600 dark:text-gray-400">
                    {t('structure.empty')}
                  </td>
                </tr>
              )}
              {fixedCosts.map((cost) => (
                <tr key={cost.id} className="border-t border-gray-100 dark:border-gray-800">
                  <th scope="row" className={`${CELL} text-left font-medium text-gray-900 dark:text-white`}>
                    {cost.label}
                  </th>
                  <td className={CELL}>
                    {cost.kind === 'recurring' ? t('structure.recurringKind') : t('structure.oneOffKind')}
                  </td>
                  <td className={`${CELL} tabular-nums`}>{formatMoney(cost.amountCents, cost.currency)}</td>
                  <td className={`${CELL} tabular-nums`}>{cost.periodMonths ?? '—'}</td>
                  <td className={`${CELL} tabular-nums`}>{cost.incurredAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <FixedCostForm onSaved={onReload} />
      </section>

      <RatePanel products={products} rates={rates} onSaved={onReload} />
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{value}</dd>
      {hint && <p className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-400">{hint}</p>}
    </div>
  )
}

function FixedCostForm({ onSaved }: { onSaved: () => void }) {
  const t = useTranslations('Finance')
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<'one_off' | 'recurring'>('one_off')
  const [amount, setAmount] = useState('')
  const [period, setPeriod] = useState('1')
  const [currency, setCurrency] = useState('BRL')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Mesmo motivo do formulário de compra: `Number(v.replace(',','.'))` lia `1.000` como um real.
  const amountCents = parseMoneyToCents(amount)
  const badAmount = amount.trim() !== '' && amountCents === null

  async function save() {
    if (amountCents === null) {
      setError(t('catalog.invalidAmount'))
      return
    }

    setSaving(true)
    setError(null)
    const response = await fetch('/api/finance/fixed-costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label,
        kind,
        amountCents,
        currency,
        incurredAt: date,
        // Só vai quando é `recurring`: a rota e o CHECK do banco recusam período num `one_off`,
        // porque uma impressora não chega a cada N meses.
        periodMonths: kind === 'recurring' ? Number(period) : undefined,
      }),
    })
    setSaving(false)
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      setError(body.error ? t('form.errorCode', { code: body.error }) : t('form.error'))
      return
    }
    setLabel('')
    setAmount('')
    onSaved()
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
      <Field label={t('structure.label')} id="fixed-label">
        <input id="fixed-label" value={label} onChange={(e) => setLabel(e.target.value)} className={INPUT} />
      </Field>
      <Field label={t('structure.kind')} id="fixed-kind">
        <select
          id="fixed-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'one_off' | 'recurring')}
          className={INPUT}
        >
          <option value="one_off">{t('structure.oneOffKind')}</option>
          <option value="recurring">{t('structure.recurringKind')}</option>
        </select>
      </Field>
      <Field label={t('structure.amount')} id="fixed-amount">
        <input id="fixed-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={INPUT} placeholder="0,00" />
      </Field>
      {kind === 'recurring' && (
        <Field label={t('structure.periodMonths')} id="fixed-period">
          <input id="fixed-period" type="number" min={1} value={period} onChange={(e) => setPeriod(e.target.value)} className={INPUT} />
        </Field>
      )}
      <Field label={t('catalog.currency')} id="fixed-currency">
        <input id="fixed-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className={`${INPUT} max-w-[5rem]`} />
      </Field>
      <Field label={t('structure.date')} id="fixed-date">
        <input id="fixed-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
      </Field>
      <Button variant="cta" onClick={save} disabled={saving || !label || amountCents === null}>
        {saving ? t('catalog.saving') : t('structure.add')}
      </Button>
      <div className="w-full space-y-1">
        {amountCents !== null && (
          <p className="text-[11px] text-gray-700 dark:text-gray-300">
            {formatMoney(amountCents, currency)}
          </p>
        )}
        {badAmount && <p className="text-[11px] text-red-700 dark:text-red-300">{t('catalog.invalidAmount')}</p>}
        {error && <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p>}
      </div>
    </div>
  )
}

function RatePanel({
  products,
  rates,
  onSaved,
}: {
  products: FinanceProduct[]
  rates: StandardRate[]
  onSaved: () => void
}) {
  const t = useTranslations('Finance')
  const [appliesTo, setAppliesTo] = useState(products[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('BRL')
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amountCents = parseMoneyToCents(amount)
  const badAmount = amount.trim() !== '' && amountCents === null

  async function save() {
    if (amountCents === null) {
      setError(t('catalog.invalidAmount'))
      return
    }

    setSaving(true)
    setError(null)
    const response = await fetch('/api/finance/catalog', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'rate',
        // Um id por produto: a taxa de impressão do QR é `qr_print` sobre `qr_code`, e a de
        // outro produto é outra linha. O `unique (rate_id, effective_from)` conta com isso.
        rateId: `print_${appliesTo}`,
        appliesTo,
        amountCents,
        currency,
        effectiveFrom: from,
      }),
    })
    setSaving(false)
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      setError(body.error ? t('form.errorCode', { code: body.error }) : t('form.error'))
      return
    }
    setAmount('')
    onSaved()
  }

  const name = (id: string) => products.find((product) => product.id === id)?.name ?? id

  return (
    <section className={CARD}>
      <header className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t('structure.rateTitle')}</h2>
        <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">{t('structure.rateHint')}</p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr>
              <th scope="col" className={HEAD}>{t('structure.appliesTo')}</th>
              <th scope="col" className={HEAD}>{t('structure.amount')}</th>
              <th scope="col" className={HEAD}>{t('catalog.effectiveFrom')}</th>
            </tr>
          </thead>
          <tbody>
            {rates.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-6 text-center text-sm text-gray-600 dark:text-gray-400">
                  {t('structure.empty')}
                </td>
              </tr>
            )}
            {[...rates]
              .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
              .map((rate) => (
                <tr key={`${rate.rateId}-${rate.effectiveFrom}`} className="border-t border-gray-100 dark:border-gray-800">
                  <th scope="row" className={`${CELL} text-left font-medium text-gray-900 dark:text-white`}>
                    {name(rate.appliesTo)}
                  </th>
                  <td className={`${CELL} tabular-nums`}>{formatMoney(rate.amountCents, rate.currency)}</td>
                  <td className={`${CELL} tabular-nums`}>{rate.effectiveFrom}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
        <Field label={t('structure.appliesTo')} id="rate-product">
          <select id="rate-product" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} className={INPUT}>
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('structure.amount')} id="rate-amount">
          <input id="rate-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={INPUT} placeholder="0,10" />
        </Field>
        <Field label={t('catalog.currency')} id="rate-currency">
          <input id="rate-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className={`${INPUT} max-w-[5rem]`} />
        </Field>
        <Field label={t('catalog.effectiveFrom')} id="rate-from">
          <input id="rate-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
        </Field>
        <Button variant="cta" onClick={save} disabled={saving || !appliesTo || amountCents === null}>
          {saving ? t('catalog.saving') : t('structure.rateAdd')}
        </Button>
        <div className="w-full space-y-1">
          {amountCents !== null && (
            <p className="text-[11px] text-gray-700 dark:text-gray-300">
              {formatMoney(amountCents, currency)}
            </p>
          )}
          {badAmount && <p className="text-[11px] text-red-700 dark:text-red-300">{t('catalog.invalidAmount')}</p>}
          {error && <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p>}
        </div>
      </div>
    </section>
  )
}
