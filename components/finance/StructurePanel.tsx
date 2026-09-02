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
import {
  COST_CATEGORIES,
  COST_ITEM_HINTS,
  costItemById,
  type CostCategory,
  type CostEntryType,
  type CostNature,
} from '@/lib/finance/cost-taxonomy'
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

          {/* O QUE ENTRA NA CASCATA É O CUSTO ESTRUTURAL, e não o que sai do caixa este mês. Um
              crédito promocional que expira em três meses não é estrutura: contar com ele diria
              "a operação já se paga" para uma empresa que ficaria no vermelho no dia em que o
              crédito acabasse. A leitura de caixa está publicada logo abaixo, em `monthlyNet`. */}
          <WaterfallRow
            label={t('structure.monthlyFixed')}
            hint={
              structure.monthlyFixedCreditCents > 0 ? t('structure.structuralHint') : undefined
            }
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

      <OperationCost structure={structure} />

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
              {/* OS QUATRO EIXOS VIAJAM COMO ETIQUETA SOB O RÓTULO, e não como quatro colunas
                  novas. Nove colunas numa tabela de 600px viram rolagem horizontal, e o eixo que
                  decide (crédito ou custo) seria o primeiro a sair da tela. Só o que difere do
                  comum ganha tinta: crédito e folha são exceção e aparecem pintados; custo fixo
                  é o caso normal e fica em cinza. */}
              {fixedCosts.map((cost) => (
                <tr key={cost.id} className="border-t border-gray-100 dark:border-gray-800">
                  <th scope="row" className={`${CELL} text-left font-medium text-gray-900 dark:text-white`}>
                    <div>{cost.label}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
                      <span className="text-gray-500 dark:text-gray-400">
                        {t(`costCategories.${cost.category}`)}
                      </span>
                      <span className="text-gray-300 dark:text-gray-700" aria-hidden="true">·</span>
                      <span className="text-gray-500 dark:text-gray-400">
                        {cost.nature === 'variable'
                          ? t('structure.natureVariable')
                          : t('structure.natureFixed')}
                      </span>
                      {cost.entryType === 'credit' && (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                          {t('structure.entryCredit')}
                        </span>
                      )}
                      {cost.isPayroll && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                          {t('structure.payrollShort')}
                        </span>
                      )}
                    </div>
                  </th>
                  <td className={CELL}>
                    {cost.kind === 'recurring' ? t('structure.recurringKind') : t('structure.oneOffKind')}
                  </td>
                  <td className={`${CELL} tabular-nums`}>{formatMoney(cost.amountCents, cost.currency)}</td>
                  <td className={`${CELL} tabular-nums`}>{cost.periodMonths ?? '—'}</td>
                  <td className={`${CELL} tabular-nums`}>
                    {cost.incurredAt}
                    {/* A VIGÊNCIA APARECE SÓ QUANDO EXISTE. `null` aqui é "ainda vale", e escrever
                        uma seta para o vazio faria parecer que a linha terminou. */}
                    {cost.endsAt && (
                      <span className="text-gray-500 dark:text-gray-400"> → {cost.endsAt}</span>
                    )}
                  </td>
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
 * O CUSTO DA OPERAÇÃO — duas colunas, porque são duas perguntas.
 *
 * "TODO MÊS" É UMA TAXA; "NO PERÍODO" É UM DESEMBOLSO. Somar as duas daria um número que não é
 * nenhum dos dois, e ninguém conseguiria dizer qual leu — a mesma razão de o `one_off` ficar fora
 * da cascata. Elas ficam lado a lado, cada uma com o seu nome, e nenhuma soma com a outra.
 *
 * O PREÇO CHEIO E O CRÉDITO SÓ APARECEM QUANDO EXISTE CRÉDITO. Numa operação sem desconto
 * nenhum, três linhas com o mesmo valor (cheio, abatido zero, líquido) não informam nada e fazem
 * o operador procurar a diferença entre elas. Com crédito, é a leitura mais importante da tela:
 * ela responde quanto a empresa vai pagar no dia em que o benefício acabar.
 */
function OperationCost({ structure }: { structure: StructureSummary }) {
  const t = useTranslations('Finance')
  const money = (cents: number) => formatMoney(cents, structure.currency)
  const hasCredit = structure.monthlyFixedCreditCents > 0

  return (
    <section className={CARD}>
      <header className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('structure.whereTitle')}
        </h2>
        <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
          {t('structure.whereHint')}
        </p>
      </header>

      <div className="grid gap-6 px-5 py-5 sm:grid-cols-2">
        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {t('structure.monthlyTitle')}
          </h3>
          <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
            {t('structure.monthlyHint')}
          </p>
          <div className="mt-3 space-y-px">
            {hasCredit && (
              <>
                <Reading label={t('structure.monthlyGross')} value={money(structure.monthlyFixedGrossCents)} />
                <Reading
                  label={t('structure.monthlyCredits')}
                  value={`-${money(structure.monthlyFixedCreditCents)}`}
                  tone="emerald"
                />
                <Reading label={t('structure.monthlyNet')} value={money(structure.monthlyFixedNetCents)} />
              </>
            )}
            <Reading
              label={t('structure.monthlyStructural')}
              hint={hasCredit ? t('structure.structuralHint') : undefined}
              value={money(structure.monthlyFixedCents)}
              emphasis
            />
            {structure.monthlyVariableCents > 0 && (
              <Reading
                label={t('structure.variableMonthly')}
                value={money(structure.monthlyVariableCents)}
              />
            )}
            {/* A FOLHA SÓ APARECE QUANDO EXISTE. Um "R$ 0,00" na base do fator R numa empresa sem
                folha não é informação — é uma linha que o operador lê toda vez e descarta. */}
            {structure.payrollMonthlyCents > 0 && (
              <Reading
                label={t('structure.payrollBase')}
                hint={t('structure.payrollHint')}
                value={money(structure.payrollMonthlyCents)}
              />
            )}
          </div>
        </div>

        <div>
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
            {t('structure.windowTitle')}
          </h3>
          <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">
            {t('structure.windowHint')}
          </p>
          <div className="mt-3 space-y-px">
            <Reading label={t('structure.oneOff')} value={money(structure.oneOffCents)} />
            <Reading
              label={t('structure.variableWindow')}
              hint={structure.variableCents > 0 ? t('structure.variableAside') : undefined}
              value={money(structure.variableCents)}
            />
            {structure.windowCreditCents > 0 && (
              <Reading
                label={t('structure.creditsWindow')}
                value={`-${money(structure.windowCreditCents)}`}
                tone="emerald"
              />
            )}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto border-t border-gray-200 dark:border-gray-800">
        <table className="w-full min-w-[480px] border-collapse">
          <thead>
            <tr>
              <th scope="col" className={HEAD}>{t('structure.category')}</th>
              <th scope="col" className={`${HEAD} text-right`}>{t('structure.colMonthly')}</th>
              <th scope="col" className={`${HEAD} text-right`}>{t('structure.colWindow')}</th>
            </tr>
          </thead>
          <tbody>
            {structure.byCategory.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-6 text-center text-sm text-gray-600 dark:text-gray-400">
                  {t('structure.whereEmpty')}
                </td>
              </tr>
            )}
            {structure.byCategory.map((line) => (
              <tr key={line.category} className="border-t border-gray-100 dark:border-gray-800">
                <th scope="row" className={`${CELL} text-left font-medium text-gray-900 dark:text-white`}>
                  {t(`costCategories.${line.category}`)}
                </th>
                <td className={`${CELL} text-right tabular-nums`}>
                  {formatMoney(line.monthlyGrossCents, structure.currency)}
                  {/* O CRÉDITO VIAJA AO LADO DO PREÇO CHEIO, nunca dentro dele. Uma coluna só,
                      já líquida, esconderia justamente o que se precisa ver: de onde vem o
                      desconto e o que acontece quando ele acabar. */}
                  {line.monthlyCreditCents > 0 && (
                    <span className="ml-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      −{formatMoney(line.monthlyCreditCents, structure.currency)}
                    </span>
                  )}
                </td>
                <td className={`${CELL} text-right tabular-nums`}>
                  {formatMoney(line.windowGrossCents, structure.currency)}
                  {line.windowCreditCents > 0 && (
                    <span className="ml-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      −{formatMoney(line.windowCreditCents, structure.currency)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* UM TOTAL CONVERTIDO PRECISA DIZER QUE FOI CONVERTIDO. Os números acima embutem contas em
          dólar e euro a uma PREMISSA declarada — não à cotação de hoje — e sem esta faixa eles
          passariam por fatos apurados em reais. A procedência vem junto: daqui a seis meses
          ninguém lembra se 5,20 veio do Focus ou de um palpite.

          E O QUE NÃO TEM TAXA CONTINUA NOMEADO, nunca somado: `ignoredCurrencies` é a moeda que
          ninguém declarou, e ela fica de fora de todo número desta tela. */}
      {(structure.appliedRates.length > 0 || structure.ignoredCurrencies.length > 0) && (
        <div className="flex flex-col gap-1.5 border-t border-gray-200 px-5 py-3 dark:border-gray-800">
          {structure.appliedRates.length > 0 && (
            <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {t('structure.fxTitle')}
              </span>{' '}
              {structure.appliedRates
                .map((rate) =>
                  t('structure.fxPair', {
                    currency: rate.currency,
                    value: formatMoney(Math.round(rate.rateToBrl * 100), 'BRL'),
                  })
                )
                .join(' · ')}
              . {t('structure.fxAside')}
            </p>
          )}
          {structure.appliedRates.map((rate) => (
            <p key={rate.currency} className="text-[10px] text-gray-500 dark:text-gray-500">
              {rate.currency} · {rate.effectiveFrom} · {rate.source}
            </p>
          ))}
          {structure.ignoredCurrencies.length > 0 && (
            <p className="text-[11px] text-amber-800 dark:text-amber-300">
              {t('structure.fxMissing', { currencies: structure.ignoredCurrencies.join(', ') })}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/** Uma leitura compacta: rótulo à esquerda, número à direita, e a razão embaixo quando há uma. */
function Reading({
  label,
  hint,
  value,
  tone,
  emphasis,
}: {
  label: string
  hint?: string
  value: string
  tone?: 'emerald'
  emphasis?: boolean
}) {
  return (
    <div
      className={`flex items-start justify-between gap-4 rounded-xl px-3 py-2 ${
        emphasis ? 'bg-tuggi-blue/[.06] ring-1 ring-tuggi-blue/25' : ''
      }`}
    >
      <div className="min-w-0">
        <div
          className={`text-[11px] font-semibold ${
            emphasis
              ? 'text-primary-800 dark:text-tuggi-blue'
              : 'text-gray-700 dark:text-gray-300'
          }`}
        >
          {label}
        </div>
        {hint && <div className="mt-0.5 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">{hint}</div>}
      </div>
      <div
        className={`flex-shrink-0 tabular-nums ${
          tone === 'emerald'
            ? 'text-emerald-700 dark:text-emerald-300'
            : 'text-gray-900 dark:text-white'
        } ${emphasis ? 'text-lg font-extrabold' : 'text-sm font-semibold'}`}
      >
        {value}
      </div>
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

/**
 * O FORMULÁRIO COMEÇA PELO ITEM PREVISTO, e não pela descrição em branco.
 *
 * A LISTA É A DA PLANILHA DO OPERADOR (`COST_ITEM_HINTS`), inclusive os itens que ainda custam
 * zero. Escolher "Tráfego pago" traz categoria `marketing`, natureza `variable` e moeda BRL de
 * uma vez — o operador não decide de novo o que a planilha já decidiu, e dois lançamentos do
 * mesmo item não saem em categorias diferentes por causa de um clique distraído.
 *
 * MAS O CAMPO CONTINUA LIVRE. "Outro" deixa tudo editável, porque um catálogo fechado obrigaria
 * a forçar um custo novo para dentro do item menos errado — e aí a categoria deixaria de
 * significar alguma coisa. O item é sugestão; o que vai para o banco são os quatro eixos.
 */
function FixedCostForm({ onSaved }: { onSaved: () => void }) {
  const t = useTranslations('Finance')
  const [item, setItem] = useState('')
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<'one_off' | 'recurring'>('one_off')
  const [amount, setAmount] = useState('')
  const [period, setPeriod] = useState('1')
  const [currency, setCurrency] = useState('BRL')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [endsAt, setEndsAt] = useState('')
  const [category, setCategory] = useState<CostCategory>('other')
  const [nature, setNature] = useState<CostNature>('fixed')
  const [entryType, setEntryType] = useState<CostEntryType>('cost')
  const [isPayroll, setIsPayroll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Escolher um item preenche os quatro eixos de uma vez. "Outro" não apaga o que já foi digitado. */
  function pickItem(id: string) {
    setItem(id)
    const hint = costItemById(id)
    if (!hint) return
    setLabel(t(`costItems.${id}`))
    setCategory(hint.category)
    setNature(hint.nature)
    setCurrency(hint.currency)
    setIsPayroll(hint.payroll === true)
  }

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
        category,
        nature,
        entryType,
        // Crédito não constrói base de fator R, e a rota recusa o par. A tela não oferece o par
        // errado em vez de deixar o operador descobrir por um 400.
        isPayroll: entryType === 'cost' && isPayroll,
        // Vigência só existe no recorrente, pelo mesmo motivo do período.
        endsAt: kind === 'recurring' && endsAt ? endsAt : undefined,
      }),
    })
    setSaving(false)
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      setError(body.error ? t('form.errorCode', { code: body.error }) : t('form.error'))
      return
    }
    setItem('')
    setLabel('')
    setAmount('')
    setEndsAt('')
    onSaved()
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-gray-200 bg-gray-50/70 px-5 py-4 dark:border-gray-800 dark:bg-gray-950/40">
      <Field label={t('structure.item')} id="fixed-item">
        <select id="fixed-item" value={item} onChange={(e) => pickItem(e.target.value)} className={INPUT}>
          <option value="">{t('structure.itemFree')}</option>
          {COST_CATEGORIES.map((group) => {
            const items = COST_ITEM_HINTS.filter((hint) => hint.category === group)
            if (items.length === 0) return null
            return (
              <optgroup key={group} label={t(`costCategories.${group}`)}>
                {items.map((hint) => (
                  <option key={hint.id} value={hint.id}>
                    {t(`costItems.${hint.id}`)}
                  </option>
                ))}
              </optgroup>
            )
          })}
        </select>
      </Field>
      <Field label={t('structure.label')} id="fixed-label">
        <input id="fixed-label" value={label} onChange={(e) => setLabel(e.target.value)} className={INPUT} />
      </Field>
      <Field label={t('structure.category')} id="fixed-category">
        <select
          id="fixed-category"
          value={category}
          onChange={(e) => setCategory(e.target.value as CostCategory)}
          className={INPUT}
        >
          {COST_CATEGORIES.map((option) => (
            <option key={option} value={option}>{t(`costCategories.${option}`)}</option>
          ))}
        </select>
      </Field>
      <Field label={t('structure.nature')} id="fixed-nature">
        <select
          id="fixed-nature"
          value={nature}
          onChange={(e) => setNature(e.target.value as CostNature)}
          className={INPUT}
        >
          <option value="fixed">{t('structure.natureFixed')}</option>
          <option value="variable">{t('structure.natureVariable')}</option>
        </select>
      </Field>
      <Field label={t('structure.entryType')} id="fixed-entry">
        <select
          id="fixed-entry"
          value={entryType}
          onChange={(e) => setEntryType(e.target.value as CostEntryType)}
          className={INPUT}
        >
          <option value="cost">{t('structure.entryCost')}</option>
          <option value="credit">{t('structure.entryCredit')}</option>
        </select>
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
      {/* A VIGÊNCIA SÓ APARECE NO RECORRENTE: um desembolso de uma vez só não tem "até quando". */}
      {kind === 'recurring' && (
        <Field label={t('structure.endsAt')} id="fixed-ends">
          <input
            id="fixed-ends"
            type="date"
            min={date}
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className={INPUT}
          />
        </Field>
      )}
      {/* A FOLHA NÃO É OFERECIDA A UM CRÉDITO: um desconto não constrói base de fator R, e a
          rota recusa o par. Esconder é melhor que deixar marcar e devolver 400. */}
      {entryType === 'cost' && (
        <label className="flex min-h-[32px] items-center gap-2 self-end pb-1 text-[11px] font-medium text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={isPayroll}
            onChange={(e) => setIsPayroll(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 dark:border-gray-700"
          />
          {t('structure.payroll')}
        </label>
      )}
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
