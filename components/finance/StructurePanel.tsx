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
import { ArrowDown, Info } from 'lucide-react'
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

/** `overflow-hidden` pelo mesmo motivo do catálogo: a faixa de formulário pintada tem canto reto. */
const CARD =
  'overflow-hidden rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70'
const HEAD =
  'px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400'
const CELL = 'px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200'
const INPUT =
  'min-h-[32px] w-full rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'

export function StructurePanel({ structure, fixedCosts, products, rates, onReload }: Props) {
  const t = useTranslations('Finance')
  const money = (cents: number | null) => formatMoney(cents, structure.currency)

  /** Quantos pagantes ainda faltam. Subtração de dois fatos já publicados, com piso em zero. */
  const missing =
    structure.breakEvenPartners === null
      ? 0
      : Math.max(0, structure.breakEvenPartners - structure.payingPartners)

  return (
    <div className="space-y-6">
      {/* O EQUILÍBRIO É A FRASE, e não a sexta caixinha de uma grade de seis. Ele é o único
          número desta tela que manda alguém fazer alguma coisa — os outros cinco descrevem, este
          decide — e lido como `14` solto ao lado de `R$ 3.000,00` ele não dizia de quê.

          A FALTA É SUBTRAÇÃO DE DOIS FATOS JÁ PUBLICADOS, não uma segunda conta: `breakEven` é
          quantos pagantes cobrem o fixo mensal, `paying` é quantos pagam. Piso em zero porque
          `-2 parceiros` não quer dizer nada; quando não falta ninguém, a tela diz isso em
          palavras em vez de imprimir um zero que se lê como erro. */}
      <section className={CARD}>
        <header className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t('structure.title')}</h2>
          <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">{t('structure.hint')}</p>
        </header>

        {structure.breakEvenPartners !== null && (
          <div className="flex flex-col gap-5 border-b border-gray-200 px-5 py-5 dark:border-gray-800 sm:flex-row sm:items-center sm:gap-7">
            {missing > 0 ? (
              <>
                <div className="flex flex-shrink-0 items-baseline gap-2.5">
                  <span className="text-5xl font-extrabold leading-none tracking-tight text-secondary-700 tabular-nums dark:text-orange-300">
                    {formatCount(missing)}
                  </span>
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {t('structure.partnersUnit')}
                  </span>
                </div>
                <div className="hidden w-px self-stretch bg-gray-200 dark:bg-gray-800 sm:block" />
                <div className="min-w-0">
                  <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200">
                    {t('structure.breakEvenLead', { fee: money(structure.averageMonthlyFeeCents) })}
                  </p>
                  <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                    {t('structure.breakEvenMeta', {
                      paying: formatCount(structure.payingPartners),
                      fixed: money(structure.monthlyFixedCents),
                    })}
                  </p>
                </div>
              </>
            ) : (
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-relaxed text-emerald-800 dark:text-emerald-300">
                  {t('structure.breakEvenDone')}
                </p>
                <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                  {t('structure.breakEvenMeta', {
                    paying: formatCount(structure.payingPartners),
                    fixed: money(structure.monthlyFixedCents),
                  })}
                </p>
              </div>
            )}
          </div>
        )}

        {/* A CASCATA QUE O CÓDIGO JÁ FAZ, DESENHADA. `operatingMarginCents` É
            `contributionCents - monthlyFixedCents` — uma subtração, em `structure.ts`. Numa
            grade de seis Stat iguais, os três apareciam como três fatos sem relação, e a relação
            é justamente o assunto da tela: MC I é o que os parceiros deixam, MC II é o que sobra
            depois da operação. Aqui nada é recalculado; os mesmos três campos ganham a ordem em
            que se lêem. */}
        <div className="flex flex-col gap-1 px-5 py-5">
          <WaterfallRow
            label={t('structure.contribution')}
            hint={t('structure.mcOne')}
            value={money(structure.contributionCents)}
            negative={structure.contributionCents < 0}
          />

          <div className="flex items-center gap-2.5 px-3.5 py-1">
            <ArrowDown className="h-4 w-4 text-gray-400 dark:text-gray-600" aria-hidden="true" />
            <span className="text-[11px] text-gray-600 dark:text-gray-400">{t('structure.minus')}</span>
          </div>

          <WaterfallRow
            label={t('structure.monthlyFixed')}
            value={`-${money(structure.monthlyFixedCents)}`}
            tone="amber"
          />

          <div className="my-3 h-px bg-gray-200 dark:bg-gray-800" />

          <WaterfallRow
            label={t('structure.operatingMargin')}
            hint={t('structure.mcTwoHint')}
            value={money(structure.operatingMarginCents)}
            negative={structure.operatingMarginCents < 0}
            emphasis
          />

          {/* O DESEMBOLSO FICA FORA DA CASCATA, e a razão é escrita ao lado em vez de virar
              conhecimento tribal: o ponto de equilíbrio usa só o que volta todo mês. */}
          <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-gray-50 p-3.5 dark:bg-gray-950/40">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
            <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {t('structure.oneOff')}: {money(structure.oneOffCents)}.
              </span>{' '}
              {t('structure.oneOffAside')}
            </p>
          </div>
        </div>
      </section>

      <section className={CARD}>
        {/* O TÍTULO NOMEIA O CONTEÚDO, e antes nomeava o botão: o cartão lista os custos
            fixos e traz o formulário no rodapé, mas se chamava `Registrar custo fixo`. Quem
            olhava de cima lia um comando onde havia uma lista. */}
        <h2 className="border-b border-gray-200 px-5 py-4 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-white">
          {t('structure.fixedTitle')}
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

/**
 * UM DEGRAU DA CASCATA. Substituiu o `Stat` da grade de seis: a diferença é que aqui o rótulo e
 * o valor ficam nas duas pontas da MESMA faixa, e as faixas se empilham na ordem em que a conta
 * acontece. Numa grade, três números lidos em Z não têm ordem nenhuma.
 *
 * `negative` PINTA DE VERMELHO O QUE É NEGATIVO, e só isso — não decide o que é ruim. Uma MC II
 * negativa é a leitura normal de quem ainda não cobriu a estrutura, e o vermelho aqui diz
 * "abaixo de zero", não "você errou".
 */
function WaterfallRow({
  label,
  hint,
  value,
  tone,
  negative,
  emphasis,
}: {
  label: string
  hint?: string
  value: string
  tone?: 'amber'
  negative?: boolean
  emphasis?: boolean
}) {
  const shell = emphasis
    ? 'bg-tuggi-blue/[.06] ring-1 ring-tuggi-blue/25'
    : tone === 'amber'
      ? 'bg-amber-50 dark:bg-amber-950/30'
      : 'bg-gray-50 dark:bg-gray-950/40'
  const labelInk = emphasis
    ? 'text-primary-800 dark:text-tuggi-blue'
    : tone === 'amber'
      ? 'text-amber-800 dark:text-amber-300'
      : 'text-gray-500 dark:text-gray-400'
  const valueInk = negative
    ? 'text-red-700 dark:text-red-300'
    : tone === 'amber'
      ? 'text-amber-900 dark:text-amber-200'
      : 'text-gray-900 dark:text-white'

  return (
    <div className={`flex items-center justify-between gap-4 rounded-2xl px-3.5 py-3 ${shell}`}>
      <div className="min-w-0">
        <div className={`text-[10px] font-bold uppercase tracking-widest ${labelInk}`}>{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-gray-600 dark:text-gray-400">{hint}</div>}
      </div>
      <div
        className={`flex-shrink-0 tabular-nums ${valueInk} ${
          emphasis ? 'text-2xl font-extrabold tracking-tight' : 'text-xl font-bold'
        }`}
      >
        {value}
      </div>
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
    <div className="flex flex-wrap items-end gap-3 border-t border-gray-200 bg-gray-50/70 px-5 py-4 dark:border-gray-800 dark:bg-gray-950/40">
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
                  {t('structure.rateEmpty')}
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

      <div className="flex flex-wrap items-end gap-3 border-t border-gray-200 bg-gray-50/70 px-5 py-4 dark:border-gray-800 dark:bg-gray-950/40">
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
