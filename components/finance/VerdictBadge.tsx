'use client'

/**
 * O VEREDITO, EM TEXTO.
 *
 * DS-A11Y-003: todo estado é texto, nunca cor sozinha. A cor aqui é reforço e nada mais — quem
 * não a enxerga lê `Só custo` e `Se paga` do mesmo jeito, e é por isso que não existe uma versão
 * "compacta" deste componente que devolva só um ponto colorido.
 *
 * `whitespace-nowrap` PORQUE A ALTURA DA LINHA É DELE. Numa tabela de catorze colunas o veredito
 * é o único texto livre, e sem isto `Sem dado de retorno` quebrava em três linhas e esticava a
 * linha inteira do parceiro para ~78px — as outras treze colunas ficavam com um número no meio
 * de um vazio de duas linhas. Uma coluna mais larga custa menos do que 52 linhas triplicadas.
 *
 * A DICA VIVE NO `title` E NO `aria-label` PORQUE A DIFERENÇA ENTRE DOIS VEREDITOS É CARA.
 * `Só custo` e `Retorno não medido em R$` parecem a mesma má notícia e mandam o operador para
 * atos opostos: um é um parceiro a rever, o outro é um parceiro que está funcionando por um
 * caminho que o CMS ainda não sabe medir em dinheiro.
 */

import { useTranslations } from 'next-intl'
import type { FinanceVerdict } from '@/lib/finance/profitability'

/**
 * A tinta de cada veredito.
 *
 * `text-primary-800` e não `text-tuggi-blue` de dia: a marca mede 2,70:1 sobre branco e reprova
 * SC 1.4.3 (D-001). No escuro ela mede 6,57:1 e passa, então o par é `dark:text-tuggi-blue` —
 * a mesma medição lida em duas superfícies, como na esteira de parcerias.
 */
const TONE: Record<FinanceVerdict, string> = {
  uncosted:
    'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900',
  undated:
    'bg-gray-100 text-gray-800 ring-gray-300 dark:bg-gray-800/60 dark:text-gray-200 dark:ring-gray-700',
  no_return:
    'bg-red-50 text-red-900 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900',
  // Cinza, como `undated`, e não vermelho: os dois são "não sei", e pintá-lo de má notícia
  // faria a tela acusar o parceiro pela permissão que falta.
  unknown_return:
    'bg-gray-100 text-gray-800 ring-gray-300 dark:bg-gray-800/60 dark:text-gray-200 dark:ring-gray-700',
  non_monetary_return:
    'bg-sky-50 text-primary-800 ring-sky-200 dark:bg-sky-950/40 dark:text-tuggi-blue dark:ring-sky-900',
  payback_pending:
    'bg-orange-50 text-gray-900 ring-secondary-700/50 dark:bg-orange-950/40 dark:text-orange-100 dark:ring-orange-900',
  profitable:
    'bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900',
}

export function VerdictBadge({ verdict }: { verdict: FinanceVerdict }) {
  const t = useTranslations('Finance')
  const label = t(`verdict.${verdict}`)
  const hint = t(`verdictHint.${verdict}`)

  return (
    <span
      className={`inline-flex min-h-[24px] items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${TONE[verdict]}`}
      title={hint}
    >
      {label}
      <span className="sr-only"> — {hint}</span>
    </span>
  )
}
