'use client'

/**
 * A TABELA DENSA INTERNA TEM UM DONO — `DS-COMPONENTE-081`.
 *
 * Densidade de célula, altura e deslocamento das duas faixas grudadas, tinta do valor recuado,
 * régua vertical de grupo, o degradê que promete coluna à direita e o cabeçalho que ordena são
 * UMA decisão só, e ela nasceu em `components/finance/ClientProfitabilityTable.tsx`. A segunda
 * instância (o placar de pontuação, #741) importa daqui em vez de copiar.
 *
 * POR QUE ISSO NÃO É ESTÉTICA: `HEAD` gruda em `top-7` e só funciona porque `GROUP` tem `h-7`.
 * São dois números que só estão certos juntos. Copiados, divergem no primeiro ajuste e produzem
 * 2px de sobreposição que ninguém consegue explicar depois — CLAUDE.md §6, SSOT antes de DRY.
 *
 * As strings são exatamente as que o financeiro já tinha: a extração não muda um pixel, e é
 * assim que o `qa` a prova (`ClientProfitabilityTable` renderiza idêntica antes e depois).
 */

import { useCallback, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'

/**
 * O `sticky` DESTAS FAIXAS NÃO FUNCIONAVA, e a causa é uma regra do CSS que não se vê lendo a
 * classe. A tabela vivia dentro de `overflow-x-auto`, e declarar overflow num eixo faz o OUTRO
 * computar de `visible` para `auto`: o wrapper virava container de rolagem TAMBÉM na vertical,
 * e `top-0` passou a se medir contra algo que não rola. Dar altura ao container é o que faz o
 * cabeçalho grudar de verdade — por isso `top-0` e não `top-14`: o vizinho de cima é o topo do
 * cartão, não o `Header` de `h-14` do CMS.
 *
 * São DUAS faixas grudadas, e por isso a de grupos tem altura fixa (`h-7` = 28px) e a de baixo
 * gruda em `top-7`.
 *
 * `whitespace-nowrap` É O QUE TORNA ESSES 28px VERDADE — `DS-COMPONENTE-081`, cláusula 2.
 * `h-7` numa célula de tabela é altura MÍNIMA, não teto: rótulo que quebra em duas linhas empurra
 * a faixa de grupos para baixo e deixa a de colunas grudada onde estava, POR BAIXO dela (`GROUP`
 * tem `z-20` e `HEAD` tem `z-10`). Medido em Chromium a 1280px com a tabela rolada, antes desta
 * classe: 38px de faixa em `pt` e 74px em `es` com o interruptor ligado, contra os 28px do
 * encaixe — os treze nomes de coluna do placar sumiram inteiros. Com `nowrap` a invariante é
 * estrutural, aqui, e não disciplina de quem escreve o rótulo; rótulo que não couber alarga a
 * tabela, que já rola na horizontal por decisão. `tests/ct/ranking-scoreboard.spec.tsx` mede a
 * faixa em `pt` e em `es` com o interruptor ligado — é o único jeito de isso não voltar calado.
 */
export const GROUP =
  'sticky top-0 z-20 h-7 whitespace-nowrap bg-white/95 px-3 text-left text-[10px] font-bold uppercase tracking-widest backdrop-blur dark:bg-gray-900/95'
export const HEAD =
  'sticky top-7 z-10 bg-white/95 px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-gray-500 backdrop-blur dark:bg-gray-900/95 dark:text-gray-400'
/** Dinheiro e contagem alinham à direita — é o que deixa a vírgula embaixo da vírgula. */
export const HEAD_NUM = `${HEAD} text-right`
export const CELL = 'px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 align-middle'
export const NUM = `${CELL} text-right tabular-nums whitespace-nowrap`
/**
 * A TINTA DO VALOR RECUADO — `text-gray-500`, e a primeira tentativa foi `text-gray-400`.
 *
 * #9CA3AF sobre o painel mede 2,51:1 e reprova SC 1.4.3; #6B7280 mede 4,83:1. O `axe` pegou em
 * dois nós na primeira passada com navegador. Recuar não é apagar: entre `text-gray-800` do
 * valor e `text-gray-500` do recuo ainda há degrau suficiente para o número que importa saltar
 * de uma coluna de zeros. No escuro o par inverte para `dark:text-gray-400`, que sobre gray-900
 * passa com folga.
 */
export const DIM = 'text-gray-500 dark:text-gray-400'
/** Onde um grupo começa, e o único lugar onde a régua vertical aparece. */
export const EDGE = 'border-l border-gray-200 dark:border-gray-800'

export interface SortState<K extends string> {
  key: K
  dir: 1 | -1
}

/**
 * UM CABEÇALHO QUE ORDENA. Mora no MÓDULO e nunca dentro do componente que o usa: um componente
 * declarado no corpo de outro é um tipo novo a cada render, e o React desmonta e remonta a
 * subárvore inteira em vez de atualizá-la — catorze botões recriados a cada clique de ordenação,
 * perdendo o foco do teclado no caminho.
 *
 * O ÍCONE DIZ O ESTADO E `aria-sort` DIZ O MESMO. Três estados, três desenhos: sem ordem, e as
 * duas direções. Cor sozinha não distinguiria as duas últimas.
 */
export function SortHead<K extends string>({
  column,
  label,
  className,
  sort,
  onToggle,
  title,
}: {
  column: K
  label: string
  className: string
  sort: SortState<K> | null
  onToggle: (key: K) => void
  title: string
}) {
  const active = sort !== null && sort.key === column
  const descending = active && sort.dir === -1
  const Icon = !active ? ChevronsUpDown : descending ? ArrowDown : ArrowUp

  return (
    <th
      scope="col"
      className={className}
      aria-sort={!active ? 'none' : descending ? 'descending' : 'ascending'}
    >
      {/* O ÍCONE INATIVO NÃO OCUPA LARGURA. Treze setas `ChevronsUpDown` sempre visíveis custavam
          ~20px de coluna cada — perto de 220px numa tabela que já não cabe em tela de notebook —
          e ainda enchiam o cabeçalho de ruído onde o operador procura o nome da coluna. Fora do
          hover e sem ordem ativa ele é `w-0 opacity-0`: some do fluxo em vez de só ficar
          transparente, que é a diferença entre recuperar a largura e não recuperar nada.

          `min-h-[24px]` é alvo de toque de WCAG 2.2 SC 2.5.8. */}
      <button
        type="button"
        onClick={() => onToggle(column)}
        title={title}
        className={`group inline-flex min-h-[24px] items-center gap-1 uppercase tracking-widest transition-colors hover:text-gray-900 dark:hover:text-white ${
          active ? 'text-gray-900 dark:text-white' : ''
        } ${className.includes('text-right') ? 'flex-row-reverse' : ''}`}
      >
        {label}
        <Icon
          className={`h-3 shrink-0 transition-all ${
            active
              ? 'w-3 text-primary-800 opacity-100 dark:text-tuggi-blue'
              : 'w-0 opacity-0 group-hover:w-3 group-hover:opacity-100 group-focus-visible:w-3 group-focus-visible:opacity-100'
          }`}
          aria-hidden="true"
        />
      </button>
    </th>
  )
}

/**
 * A CAIXA QUE ROLA NOS DOIS EIXOS, e a borda direita que diz que há mais.
 *
 * Existe tabela à direita do que se vê? O degradê responde isso, e responder errado é pior que
 * não responder: prometer coluna onde não há treina o operador a ignorar a pista. Encolher
 * coluna para caber não é alternativa — `R$ 1.934,59` não cabe em 62px, e `4.022 min` também
 * não. Rolagem horizontal é a decisão certa; o que estava errado era ela ser invisível.
 *
 * `useCallback` como ref MEDE NA MONTAGEM. Sem isso o degradê só apareceria depois do primeiro
 * scroll — exatamente o gesto que ele existe para provocar. A folga de 2px é do arredondamento
 * de zoom do navegador, que faz `scrollLeft + clientWidth` parar meio pixel antes do fim.
 */
export function DenseTableScroller({
  children,
  maxHeightClassName = 'max-h-[calc(100vh-19rem)]',
}: {
  children: ReactNode
  maxHeightClassName?: string
}) {
  const [more, setMore] = useState(false)

  const update = useCallback((el: HTMLDivElement) => {
    setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  const measure = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) update(el)
    },
    [update]
  )

  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 right-0 z-30 w-12 bg-gradient-to-l from-white/95 to-transparent transition-opacity dark:from-gray-900/95 ${
          more ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        ref={measure}
        onScroll={(event) => update(event.currentTarget)}
        className={`custom-scrollbar ${maxHeightClassName} overflow-auto`}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * O CHIP DE FILTRO TRAZ A CONTAGEM JUNTO, e é o que o torna melhor que o `<select>` que ele
 * substituiu: o operador vê quantos são ANTES de clicar, em vez de filtrar para descobrir que
 * são zero e voltar.
 */
export function FilterChip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean
  count: number
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-[28px] items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? 'border-tuggi-blue/35 bg-tuggi-blue/10 text-primary-800 dark:text-tuggi-blue'
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
      }`}
    >
      {children}
      <span className={active ? 'opacity-70' : 'text-gray-500 dark:text-gray-400'}>{count}</span>
    </button>
  )
}
