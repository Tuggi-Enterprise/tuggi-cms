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
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { deriveTriageStatus, type TriageStatus } from '@/lib/partnerships/triage'
import { triageText } from '@/components/admin/partnerships/triage-text'
import {
  idleFor,
  placeLine,
  planDivergence,
  planLine,
  rowKey,
  stateUnlessColumnSaysIt,
  stepUnlessActSaysIt,
} from '@/components/admin/clients/board/row-text'
import { derivePartnerPlan, paymentStance, type PaymentStance } from '@/lib/clients/partner-plan'
import {
  isTerminalColumn,
  nextAct,
  type BoardAct,
  type BoardColumnId,
} from '@/lib/clients/board-transitions'
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
  /**
   * Where `Abrir` points. Handed in rather than built here, because the address has to carry
   * the filters the operator has applied and this card cannot see them — same reason
   * `seeAllHref` is a prop on `BoardColumn`. `lib/clients/record-href` is the composer.
   */
  hrefFor: (row: ClientDirectoryRow) => string
  /** The clock, derived once for the whole board so two cards cannot disagree about a deadline. */
  triage: TriageStatus
  onAct: (row: ClientDirectoryRow, act: BoardAct) => void
  /**
   * WHAT THE LAST ACT ON THIS CARD ANSWERED, and it lives here rather than in the drag layer
   * because the card is rendered in four places — the curation lane, a column, the drag overlay
   * and the phone's stacked column — and only one of those was ever wrapped by the draggable. A
   * refusal that only exists on a desktop column is a refusal the phone never sees.
   */
  notice?: { message: string; tone: 'refused' | 'done' } | null
  /** Takes the notice down. Only refusals offer it; a success clears itself. */
  onDismissNotice?: () => void
  /** Handed in by the drag layer. Absent while the board is a plain list of columns. */
  dragHandleProps?: React.HTMLAttributes<HTMLElement>
  dragging?: boolean
}

export function BoardCard({
  row,
  column,
  hrefFor,
  triage,
  onAct,
  notice,
  onDismissNotice,
  dragHandleProps,
  dragging,
}: BoardCardProps) {
  const t = useTranslations('Clients.board')
  const c = useTranslations('Clients.directory')
  const p = useTranslations('Partnerships')

  const act = nextAct(row, column)
  const name = row.name || c('noName')
  // Tied to the row and not to a counter: two cards on screen must never share the id that
  // `aria-describedby` points at.
  const noticeId = `board-notice-${rowKey(row)}`
  const where = placeLine(row)
  // `not_started` and `closed` are not news on a card: the first is a clock that has not begun,
  // the second is one that stopped. Printing either would make every card carry a triage line.
  const showClock = triage.kind !== 'not_started' && triage.kind !== 'closed'
  /**
   * WHAT THE COLUMN ALREADY SAYS IS NOT REPEATED HERE (DS-COMPONENTE-079). Both decisions are
   * MEASURED in `row-text` rather than hand-written: in 6 of the 8 columns the state label is
   * byte for byte the heading, and in 4 of the 7 steps the text is the label of the button below.
   */
  const stateLine = stateUnlessColumnSaysIt(row, column, p, t)
  const stepLine = stepUnlessActSaysIt(row, act, p, t)
  const plan = derivePartnerPlan(row)
  const divergence = planDivergence(plan, t)
  const stance = paymentStance(plan.kind)

  return (
    <article
      {...dragHandleProps}
      /*
       * THE STATE TRAVELS IN THE ACCESSIBLE NAME, always — including when the visible line goes
       * because the column already says it. That is point 2 of `DS-COMPONENTE-079`: somebody on a
       * screen reader does not walk the column to find out where the card sits, and position on
       * its own is not an answer.
       */
      aria-label={`${name} — ${p(`states.${row.state}`)}`}
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
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{where}</p>
      )}

      {/*
        THE STATE, where it discriminates. Gone from the 6 columns whose label is the heading — the
        card printed `Cliente criado` inside the `Cliente criado` column — and kept in
        `Conferência de documentos` (`Em conferência` is another text) and in `Encerrados`, which
        hosts two states.
      */}
      {stateLine && (
        <p className="mt-1 font-medium text-gray-900 dark:text-gray-100">{stateLine}</p>
      )}

      {/* THE STEP, when the button does not say it. `Criar o local` written here and drawn on the
          button right below is two lines for one decision. */}
      {stepLine && (
        <p className="mt-1 text-xs text-gray-800 dark:text-gray-300">{stepLine}</p>
      )}

      {/* WHO PAYS, AND WHO SAID SO. The source travels with the value because three people can
          answer this and they answer differently (`lib/clients/partner-plan`): `R$ 149,00 por
          mês` read off a proposal nobody has priced is a number an operator would plan around.
          A disagreement between the signed contract and the registration is the one thing here
          worth an accent, and it gets a border rather than colour alone (DS-A11Y-003). */}
      {/* The provenance travels INSIDE the line now (`planLine` composes the whole sentence)
          instead of spending a second line on `no cadastro`. It never leaves: the button beside it
          generates a contract with this number, so a value nobody priced is a pendency, not a fact. */}
      <p className="mt-1 text-xs text-gray-900 dark:text-gray-200">{planLine(row, t)}</p>

      {divergence && (
        <p className="mt-1 rounded-lg border border-secondary-700 px-2 py-1 text-xs text-gray-900 dark:text-gray-200">
          {divergence}
        </p>
      )}

      {/*
        ONE CLOCK PER CARD (DS-COMPONENTE-080, point 2).

        Two counters ran over the same item and the card printed both, plus the deadline's absolute
        instant on a third line. What wins is the one with a DEADLINE PROMISED TO SOMEBODY OUTSIDE
        the company — the triage, BR-B2B-010 item 4 — and the internal one (`Parado há`) goes while
        it runs. It is `DS-COPY-020` point 5 applied to the clock instead of to the step.

        WHAT THE OPERATOR LOSES IS MAGNITUDE, NOT RANKING: `compareRows` already orders the column
        by overdue triage and then by oldest `since`, and `buildBoardView` walks `directory.rows`
        in that order — so the queue still says which to pick first. The magnitude is in the table,
        with the absolute date under it, and `Abrir` is the control that leads there.

        THE ABSOLUTE INSTANT LEAVES THE CARD and `DS-COPY-025` point 5 stays whole: what it forbids
        is the instant living ONLY in a `title`, unreachable by keyboard. It is still on screen, in
        the table's `Triagem` column, which is the record view of this same queue.
      */}
      {showClock ? (
        <p className="mt-1 text-xs text-gray-900 dark:text-gray-200">
          {p('triage.headerLine', { value: triageText(triage, p) })}
        </p>
      ) : (
        // A terminal column has no clock at all: an archive ordered by recency has nothing to urge.
        !isTerminalColumn(column) && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('idleLine', { value: idleFor(row.since, p) })}
          </p>
        )
      )}

      {/*
        THE BADGE ONLY WHERE IT DISCRIMINATES, on the same proof from data as `DS-COMPONENTE-079`:
        `derivePipelineState` returns `proposal_received` and `in_conference` IF AND ONLY IF
        `clientId` is null, so across both proposal columns the badge is constant and was spending
        28px on every card. `Encerrados` hosts `discarded` and `refused_at_triage` — a discarded
        proposal and a refused client — and there it is the only thing telling the two apart.

        The border carries the accent: #CC5200 is 4.16:1, which clears SC 1.4.11's 3:1 as a border
        and misses SC 1.4.3's 4.5:1 as ink.
      */}
      {row.clientId === null && isTerminalColumn(column) && (
        <span className="mt-1 inline-block rounded-full border border-secondary-700 px-2 py-0.5 text-xs text-gray-900 dark:text-gray-200">
          {c('proposalBadge')}
        </span>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <Link
          href={hrefFor(row)}
          aria-label={c('openNamed', { name })}
          className="inline-flex min-h-[24px] items-center text-xs font-medium text-primary-800 underline underline-offset-4 dark:text-tuggi-blue"
        >
          {c('open')}
        </Link>

        {act && (
          <button
            type="button"
            onClick={() => onAct(row, act)}
            // The message stays reachable from the control that produced it: coming back with
            // `Tab` reads the reason again, without moving focus when it appeared.
            aria-describedby={notice ? noticeId : undefined}
            className="inline-flex min-h-[24px] items-center rounded-lg border border-primary-800 px-2 py-1 text-xs font-medium text-primary-800 transition-colors hover:bg-primary-800/5 dark:border-tuggi-blue dark:text-tuggi-blue"
          >
            {t(`acts.${act}`)}
          </button>
        )}
      </div>

      {/*
        WHAT THE ACT ANSWERED.

        `alert` for a refusal and `status` for a success, and the asymmetry is the point: a
        refusal answers a deliberate click and must not queue behind what the re-read announces,
        while a success is news the operator may read whenever. Neither moves focus.

        A refusal STAYS — it describes a state that is still true, and a pendency with an expiry
        date is the one that gets lost while the operator looks at another column. A success
        clears itself, which the board does by taking the notice away.
      */}
      {notice && (
        <div
          id={noticeId}
          role={notice.tone === 'refused' ? 'alert' : 'status'}
          className="mt-1 flex items-start justify-between gap-2 rounded-xl border border-secondary-700 px-2 py-1 text-xs text-gray-900 dark:text-gray-200"
        >
          <span>{notice.message}</span>
          {notice.tone === 'refused' && onDismissNotice && (
            <button
              type="button"
              onClick={onDismissNotice}
              aria-label={t('dismissRefusal')}
              className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
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
