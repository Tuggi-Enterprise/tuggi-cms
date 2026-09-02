'use client'

/**
 * A TELA DO FINANCEIRO — trilho de 18%, conteúdo em 82%, três seções.
 *
 * MORA EM `components/` E NÃO EM `app/` pelo mesmo motivo que `AdminMaterialsPageContent`: a
 * página localizada é uma casca de três linhas, e a árvore de cliente que chama
 * `useTranslations()` não pode ser pré-renderizada sem um provider de request-time.
 *
 * DUAS LEITURAS E NÃO SETE. `/api/finance/clients` traz parceiros, totais, coortes, estrutura,
 * custos fixos E as linhas de consumo; `/api/finance/purchases` traz compras, produtos e o custo
 * por peça. As três seções desenham sobre ESSAS listas — nenhum painel dispara uma consulta
 * própria, que é como um total acima passa a discordar das linhas abaixo.
 *
 * O 503 DIZ O QUE ACONTECEU. `app_users_unavailable` significa que a leitura dos usuários do app
 * não respondeu, e sem ela um parceiro que não paga não pode ser distinguido de um que trouxe
 * quem comprou. A tela diz isso em vez de desenhar vereditos que acusariam parceiros por causa
 * de uma falha de rede.
 *
 * O TRILHO É O MESMO DE `/places`, `/pois` E `/users`, classe por classe: casca
 * `p-6 lg:p-8`, linha `flex gap-8 flex-1 pt-6`, trilho `w-[18%] flex-shrink-0` com o cartão de
 * vidro `sticky top-24`, conteúdo `w-[82%]`. Antes esta tela tinha `mx-auto max-w-[1600px]` e um
 * trilho SEM cartão — o título e o menu ficavam soltos sobre o cinza, e era só esta tela no CMS
 * inteiro que fazia isso.
 *
 * `min-w-0` NA COLUNA DE CONTEÚDO NÃO É ENFEITE. Item de flex nasce com `min-width: auto`, que
 * é o tamanho mínimo do conteúdo — e o conteúdo aqui é uma tabela `min-w-[1100px]`. Sem
 * `min-w-0` a coluna se recusa a encolher, cresce até 1100px, e a tabela sai pela direita da
 * página levando o `overflow-x-auto` junto: o cartão nunca chega a rolar porque quem cedeu foi
 * a página. Era o vazamento que aparecia na tela de Parceiros.
 *
 * O CARTÃO DE TÍTULO DO CONTEÚDO NÃO É `sticky`, e é a única divergência de propósito com
 * `/places`. O `<thead>` da tabela de parceiros já é `sticky top-14` — dois grudados no topo
 * disputariam o mesmo lugar, e o que o operador precisa ver ao rolar 52 linhas é o nome das
 * colunas, não o nome da seção.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Coins, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ClientProfitability, ConsumptionRecord } from '@/lib/finance/profitability'
import type { FinanceSummary } from '@/lib/finance/summary'
import type { CohortReport } from '@/lib/finance/cohort'
import type { FixedCostRecord, StructureSummary } from '@/lib/finance/structure'
import type { FinanceProduct } from '@/lib/finance/catalog'
import type { StandardRate } from '@/lib/finance/unit-cost'
import type { FinancePurchaseRow } from '@/lib/services/finance-service'
import type { RecipeLine } from '@/lib/finance/recipe'
import type { PackagingRule } from '@/lib/finance/packaging'
import type { MonthlyCascade, MonthlyPoint, PlanMix } from '@/lib/finance/overview'
import { FinanceFigures } from './FinanceFigures'
import { OverviewPanel, type ProjectionBase } from './OverviewPanel'
import { ClientProfitabilityTable } from './ClientProfitabilityTable'
import { CatalogPanel, type UnitCostView } from './CatalogPanel'
import { StructurePanel } from './StructurePanel'

// A Visão geral entra PRIMEIRO, e é a única seção que junta os dois lados do negócio — a
// mensalidade do parceiro e a compra do turista. As outras três respondem por um parceiro, por um
// produto e pela operação; nenhuma respondia "quanto entra, quanto sai, e quando isso vira".
type Section = 'overview' | 'partners' | 'catalog' | 'structure'
const SECTIONS: readonly Section[] = ['overview', 'partners', 'catalog', 'structure']

interface ClientsPayload {
  clients: ClientProfitability[]
  consumption: ConsumptionRecord[]
  summary: FinanceSummary
  cohorts: CohortReport
  structure: StructureSummary
  fixedCosts: FixedCostRecord[]
  /** A cascata do mês fechado. Computada sobre a MESMA lista que a tabela desenha. */
  month: MonthlyCascade
  /** Dois meses para trás, o vigente e seis para a frente. */
  series: MonthlyPoint[]
  appOtherCurrencies: { currency: string; grossCents: number }[]
  mix: PlanMix
  projectionBase: ProjectionBase
  /** Parceiros marcados como teste e retirados de toda conta acima. Contados, não sumidos. */
  excludedPartners: number
  truncated: boolean
  purchasesAnswered: boolean
}

interface CatalogPayload {
  products: FinanceProduct[]
  recipes: RecipeLine[]
  packaging: PackagingRule[]
  rates: StandardRate[]
  unmappedMaterialKinds: string[]
}

interface PurchasesPayload {
  purchases: FinancePurchaseRow[]
  unitCosts: UnitCostView[]
}

export function FinancePageContent() {
  const t = useTranslations('Finance')
  const [section, setSection] = useState<Section>('overview')
  const [overview, setOverview] = useState<ClientsPayload | null>(null)
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null)
  const [purchases, setPurchases] = useState<PurchasesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [clientsResponse, catalogResponse, purchasesResponse] = await Promise.all([
        fetch('/api/finance/clients'),
        fetch('/api/finance/catalog'),
        fetch('/api/finance/purchases'),
      ])

      // As duas falhas mandam o operador para lugares diferentes: uma é o schema `finance` fora
      // da lista de schemas expostos da API; a outra é a leitura de perfis. Dizer "não carregou"
      // para as duas faria o operador procurar no lugar errado.
      if (clientsResponse.status === 503) {
        const body = await clientsResponse.json().catch(() => ({}))
        const reason = body?.error
        setError(
          reason === 'finance_unavailable'
            ? t('errors.finance')
            : reason === 'app_users_unavailable'
              ? t('errors.appUsers')
              : t('errors.load')
        )
        return
      }
      if (catalogResponse.status === 503 || purchasesResponse.status === 503) {
        setError(t('errors.finance'))
        return
      }
      if (!clientsResponse.ok || !catalogResponse.ok || !purchasesResponse.ok) {
        setError(t('errors.load'))
        return
      }

      setOverview(await clientsResponse.json())
      setCatalog(await catalogResponse.json())
      setPurchases(await purchasesResponse.json())
    } catch {
      setError(t('errors.load'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 p-6 dark:bg-gray-950 lg:p-8">
      <div className="flex flex-1 flex-col gap-8 pt-6 lg:flex-row">
        <aside className="w-full flex-shrink-0 lg:w-[18%]">
          {/* O cartão inteiro rola por dentro quando os números não cabem na janela: sem o
              `max-h`/`overflow`, `sticky` prenderia o topo e o rodapé do trilho ficaria
              inalcançável em telas baixas — e o rodapé é onde moram as pendências. */}
          {/* `custom-scrollbar` sem prefixo de breakpoint de propósito: é classe de
              `globals.css`, não utilitário do Tailwind, então `lg:custom-scrollbar` não geraria
              regra nenhuma. Sem `overflow-y-auto` abaixo de `lg` ela simplesmente não pinta nada. */}
          <div className="custom-scrollbar rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-tuggi-blue/10 p-2">
                  <Coins className="h-5 w-5 text-tuggi-blue" aria-hidden="true" />
                </div>
                <h1 className="min-w-0 text-xl font-semibold tracking-tight text-gray-900 dark:text-white">
                  {t('title')}
                </h1>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                {t('subtitle')}
              </p>

              <nav aria-label={t('title')} className="mt-5 flex flex-col gap-1">
                {SECTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSection(option)}
                    aria-current={section === option ? 'page' : undefined}
                    className={`min-h-[36px] rounded-2xl px-3 py-2 text-left text-sm font-medium transition-colors ${
                      section === option
                        ? 'bg-tuggi-blue/10 text-primary-800 ring-1 ring-tuggi-blue/20 dark:text-tuggi-blue'
                        : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/60'
                    }`}
                  >
                    {t(`sections.${option}`)}
                  </button>
                ))}
              </nav>
            </div>

            {overview && (
              <div className="border-t border-gray-200 dark:border-gray-800">
                <FinanceFigures summary={overview.summary} truncated={overview.truncated} />
              </div>
            )}
          </div>
        </aside>

        <main className="w-full min-w-0 lg:w-[82%]">
          <div className="mb-6 rounded-3xl border border-gray-200 bg-white/80 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/80">
            <div className="flex items-center justify-between gap-4 p-4 pl-6">
              <div className="min-w-0">
                <span className="mb-1 block text-[10px] font-bold uppercase leading-none tracking-widest text-gray-500 dark:text-gray-400">
                  {t('title')}
                </span>
                <h2 className="truncate text-lg font-bold leading-none text-gray-900 dark:text-white">
                  {t(`sections.${section}`)}
                </h2>
              </div>
              <Button
                variant="outline"
                onClick={() => void load()}
                disabled={loading}
                className="flex-shrink-0 gap-2"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {t('reload')}
              </Button>
            </div>
          </div>

          {loading && (
            <p className="rounded-3xl border border-gray-200 bg-white/70 px-5 py-8 text-center text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-400">
              {t('loading')}
            </p>
          )}

          {!loading && error && (
            <div
              role="alert"
              className="rounded-3xl border border-amber-300 bg-amber-50 px-5 py-6 dark:border-amber-900 dark:bg-amber-950/40"
            >
              <p className="text-sm text-amber-900 dark:text-amber-200">{error}</p>
              <Button variant="cta" className="mt-4" onClick={() => void load()}>
                {t('errors.retry')}
              </Button>
            </div>
          )}

          {!loading && !error && overview && (
            <>
              {overview.truncated && (
                <p role="status" className="mb-4 text-[11px] text-amber-800 dark:text-amber-300">
                  {t('truncated')}
                </p>
              )}

              {/* A lacuna é nomeada acima da tabela, e não escondida atrás de um travessão numa
                  coluna: ela muda o que o veredito de TODO parceiro não pagante significa. */}
              {!overview.purchasesAnswered && (
                <div
                  role="status"
                  className="mb-4 rounded-3xl border border-amber-300 bg-amber-50 px-5 py-3 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  {t('purchasesUnavailable')}
                </div>
              )}

              {section === 'overview' && (
                <OverviewPanel
                  month={overview.month}
                  series={overview.series}
                  appOtherCurrencies={overview.appOtherCurrencies}
                  mix={overview.mix}
                  projectionBase={overview.projectionBase}
                  summary={overview.summary}
                  cohorts={overview.cohorts}
                  structure={overview.structure}
                  excludedPartners={overview.excludedPartners}
                  truncated={overview.truncated}
                  purchasesAnswered={overview.purchasesAnswered}
                />
              )}

              {section === 'partners' && <ClientProfitabilityTable clients={overview.clients} />}

              {section === 'catalog' && catalog && purchases && (
                <CatalogPanel
                  products={catalog.products}
                  recipes={catalog.recipes}
                  packaging={catalog.packaging}
                  purchases={purchases.purchases}
                  unitCosts={purchases.unitCosts}
                  consumption={overview.consumption}
                  unmappedMaterialKinds={catalog.unmappedMaterialKinds}
                  onReload={() => void load()}
                />
              )}

              {section === 'structure' && catalog && (
                <StructurePanel
                  structure={overview.structure}
                  fixedCosts={overview.fixedCosts}
                  products={catalog.products}
                  rates={catalog.rates}
                  onReload={() => void load()}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
