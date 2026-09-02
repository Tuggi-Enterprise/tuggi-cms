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
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
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
import { FinanceFigures } from './FinanceFigures'
import { ClientProfitabilityTable } from './ClientProfitabilityTable'
import { CatalogPanel, type UnitCostView } from './CatalogPanel'
import { StructurePanel } from './StructurePanel'

type Section = 'partners' | 'catalog' | 'structure'
const SECTIONS: readonly Section[] = ['partners', 'catalog', 'structure']

interface ClientsPayload {
  clients: ClientProfitability[]
  consumption: ConsumptionRecord[]
  summary: FinanceSummary
  cohorts: CohortReport
  structure: StructureSummary
  fixedCosts: FixedCostRecord[]
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
  const [section, setSection] = useState<Section>('partners')
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
    <div className="min-h-screen bg-gray-50 p-6 dark:bg-gray-950 lg:p-8">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full lg:sticky lg:top-24 lg:w-[18%] lg:min-w-[15rem]">
          <div className="mb-4">
            <h1 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white lg:text-xl">
              {t('title')}
            </h1>
            <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-400">{t('subtitle')}</p>
          </div>

          <nav aria-label={t('title')} className="mb-4 flex flex-col gap-1">
            {SECTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSection(option)}
                aria-current={section === option ? 'page' : undefined}
                className={`min-h-[32px] rounded-2xl px-3 py-2 text-left text-sm font-medium transition-colors ${
                  section === option
                    ? 'bg-tuggi-blue/10 text-primary-800 ring-1 ring-tuggi-blue/20 dark:text-tuggi-blue'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/60'
                }`}
              >
                {t(`sections.${option}`)}
              </button>
            ))}
          </nav>

          {overview && <FinanceFigures summary={overview.summary} truncated={overview.truncated} />}
        </aside>

        <main className="w-full lg:w-[82%]">
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
