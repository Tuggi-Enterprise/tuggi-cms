'use client'

/**
 * One partnership, as a card.
 *
 * IT CARRIES ITS STATE IN TEXT, not in the column it sits in. DS-A11Y-003: somebody reading
 * this with a screen reader, or with the board scrolled so the heading is off screen, gets the
 * same answer as somebody looking at it. The column is a convenience of layout, never the only
 * carrier of meaning.
 *
 * IT ALSO CARRIES ITS NEXT ACT AS A BUTTON, and that is not a duplicate of the drag — it is the
 * requirement. WCAG 2.2 SC 2.5.7 asks that anything achievable by dragging be achievable
 * without it, and the button is also the only path on a touch screen and by keyboard. The drag
 * is the shortcut; this is the path.
 *
 * The palette is the table's, for the same measured reasons: `text-primary-800` (#00719F,
 * 5.44:1) as ink and never `text-tuggi-blue` (#00A8E8, 2.70:1 on white, which fails SC 1.4.3).
 */

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { deriveTriageStatus, type TriageStatus } from '@/lib/partnerships/triage'
import { triageDeadlineText, triageText } from '@/components/admin/partnerships/triage-text'
import {
  idleFor,
  placeLine,
  planDivergence,
  planLine,
  planSource,
  whatIsMissing,
} from '@/components/admin/clients/board/row-text'
import { derivePartnerPlan, paymentStance, type PaymentStance } from '@/lib/clients/partner-plan'
import { nextAct, type BoardAct, type BoardColumnId } from '@/lib/clients/board-transitions'
import type { ClientDirectoryRow } from '@/lib/services/partnership-service'

/**
 * PAGA OU NÃO PAGA, ON THE LEFT EDGE OF THE CARD.
 *
 * A BORDER AND NOT INK, which is what makes these values usable at all. As a non-text element
 * the stripe answers to SC 1.4.11 (3:1) rather than SC 1.4.3 (4.5:1), and the four tokens below
 * were measured against every surface a card sits on — the white/`gray-900` fill it carries and
 * the `gray-50`/`gray-950` column behind it:
 *
 *   light   `emerald-600` #059669 → 3.77:1 on white, 3.61:1 on gray-50
 *           `gray-700`    #374151 → 10.31:1 on white, 9.86:1 on gray-50
 *   dark    `emerald-500` #10B981 → 6.99:1 on gray-900, 7.94:1 on gray-950
 *           `gray-500`    #6B7280 → 3.67:1 on gray-900, 4.16:1 on gray-950
 *
 * TWO TOKENS PER STANCE, one per mode, for the reason the rest of this screen already writes
 * down about `primary-800` and `tuggi-blue`: it is one measurement read on two surfaces, and
 * the token that works as an edge in daylight is not the one that works at night.
 *
 * THE PAIR ALSO SEPARATES WITHOUT HUE. Green against grey is the first thing to fail for a
 * reader with deuteranopia, so the two were chosen to differ in LIGHTNESS as well: 2.74:1
 * between them on light, 1.91:1 on dark. That is a supporting property and not the compliance
 * argument — DS-A11Y-003 is satisfied by the plan line in words, three lines further down, which
 * says `Plano: R$ 149,00 por mês` or `Plano: ninguém declarou` and never relies on this edge.
 *
 * IT CARRIES NO ACCESSIBLE NAME on purpose. The stripe is a SUMMARY of a line that is already
 * on the card in text; announcing `não pagante` beside `Plano: ninguém declarou` would read the
 * same fact twice and, worse, would flatten a pendency into an answer for the one reader who
 * cannot see that the two are the same mark.
 */
const STANCE_STRIPE: Record<PaymentStance, string> = {
  paying: 'border-l-emerald-600 dark:border-l-emerald-500',
  not_paying: 'border-l-gray-700 dark:border-l-gray-500',
}

interface BoardCardProps {
  row: ClientDirectoryRow
  column: BoardColumnId
  locale: string
  /** The clock, derived once for the whole board so two cards cannot disagree about a deadline. */
  triage: TriageStatus
  onAct: (row: ClientDirectoryRow, act: BoardAct) => void
  /** Handed in by the drag layer. Absent while the board is a plain list of columns. */
  dragHandleProps?: React.HTMLAttributes<HTMLElement>
  dragging?: boolean
}

export function BoardCard({
  row,
  column,
  locale,
  triage,
  onAct,
  dragHandleProps,
  dragging,
}: BoardCardProps) {
  const t = useTranslations('Clients.board')
  const c = useTranslations('Clients.directory')
  const p = useTranslations('Partnerships')

  const act = nextAct(row, column)
  const name = row.name || c('noName')
  const where = placeLine(row)
  const deadline = triageDeadlineText(triage)
  // `not_started` and `closed` are not news on a card: the first is a clock that has not begun,
  // the second is one that stopped. Printing either would make every card carry a triage line.
  const showClock = triage.kind !== 'not_started' && triage.kind !== 'closed'
  const overdue = deadline !== null && triage.kind.indexOf('overdue') === 0
  const plan = derivePartnerPlan(row)
  const planNote = planSource(plan, t)
  const divergence = planDivergence(plan, t)
  const stance = paymentStance(plan.kind)

  return (
    <article
      {...dragHandleProps}
      aria-label={name}
      className={`rounded-2xl border border-l-4 border-gray-200 bg-white p-3 text-sm shadow-sm transition-shadow dark:border-gray-800 dark:bg-gray-900 ${
        STANCE_STRIPE[stance]
      } ${dragging ? 'opacity-50' : 'hover:shadow-md'}`}
    >
      <h3 className="truncate font-medium text-gray-900 dark:text-white" title={row.name ?? ''}>
        {name}
      </h3>

      {/* A registration with no city printed `—` on a line of its own — a placeholder is only
          worth a line when its absence is news, and here it is not. */}
      {where !== '—' && (
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{where}</p>
      )}

      {/* The state in words — the card is readable with the column heading out of view. */}
      <p className="mt-2 font-medium text-gray-900 dark:text-gray-100">{p(`states.${row.state}`)}</p>
      <p className="text-xs text-gray-800 dark:text-gray-300">{whatIsMissing(row, p)}</p>

      {/* WHO PAYS, AND WHO SAID SO. The source travels with the value because three people can
          answer this and they answer differently (`lib/clients/partner-plan`): `R$ 149,00 por
          mês` read off a proposal nobody has priced is a number an operator would plan around.
          A disagreement between the signed contract and the registration is the one thing here
          worth an accent, and it gets a border rather than colour alone (DS-A11Y-003). */}
      <p className="mt-2 text-xs text-gray-900 dark:text-gray-200">
        {planLine(row, t)}
        {planNote && <span className="block text-gray-500 dark:text-gray-400">{planNote}</span>}
      </p>

      {divergence && (
        <p className="mt-1 rounded-lg border border-secondary-700 px-2 py-1 text-[11px] text-gray-900 dark:text-gray-200">
          {divergence}
        </p>
      )}

      {/* EVERY NUMBER IS NAMED. The table carries these under column headings; a card has none,
          and the first cut stacked `82 dias`, `venceu há 79 dias` and `04/06, 22h15` with
          nothing to say which was which. `Parado há` and `Triagem` are the same two words the
          table's headings use, so the two views read the same figure the same way. */}
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {t('idleLine', { value: idleFor(row.since, p) })}
      </p>

      {showClock && (
        <p className="mt-1 text-xs text-gray-900 dark:text-gray-200">
          {p('triage.headerLine', { value: triageText(triage, p) })}
          {deadline && (
            <span className="block text-gray-500 dark:text-gray-400">
              {t(overdue ? 'deadlineLine' : 'deadlineAheadLine', { deadline })}
            </span>
          )}
        </p>
      )}

      {/* A proposal nobody promoted has no registration behind it, and the card says so rather
          than looking like a client that lost its data. Border carries the accent: #CC5200 is
          4.16:1, which clears SC 1.4.11's 3:1 as a border and misses SC 1.4.3's 4.5:1 as ink. */}
      {row.clientId === null && (
        <span className="mt-2 inline-block rounded-full border border-secondary-700 px-2 py-0.5 text-xs text-gray-900 dark:text-gray-200">
          {c('proposalBadge')}
        </span>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <Link
          href={`/${locale}${row.href}`}
          aria-label={c('openNamed', { name })}
          className="text-xs font-medium text-primary-800 underline underline-offset-4 dark:text-tuggi-blue"
        >
          {c('open')}
        </Link>

        {act && (
          <button
            type="button"
            onClick={() => onAct(row, act)}
            className="rounded-lg border border-primary-800 px-2 py-1 text-xs font-medium text-primary-800 transition-colors hover:bg-primary-800/5 dark:border-tuggi-blue dark:text-tuggi-blue"
          >
            {t(`acts.${act}`)}
          </button>
        )}
      </div>
    </article>
  )
}

/**
 * The clock of every row, derived from ONE `now`.
 *
 * Exported so the board derives it once for the whole set rather than once per card: two rows
 * approved in the same minute must not disagree about the deadline because they rendered
 * milliseconds apart. Same reasoning the table wrote down.
 */
export function deriveTriageOf(rows: ClientDirectoryRow[]): Map<string, TriageStatus> {
  const now = new Date()
  const map = new Map<string, TriageStatus>()
  for (const row of rows) {
    map.set(row.clientId ?? row.submissionId ?? '', deriveTriageStatus(row.triage, now))
  }
  return map
}
