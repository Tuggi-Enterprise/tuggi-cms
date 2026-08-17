/**
 * The texts of the `Triagem` column — spec §3.1 and DS-COPY-025, and the promise behind them is
 * BR-B2B-010, item 4: within 72 straight hours of the partnership's approval, either the place is
 * published or the refusal was communicated.
 *
 * IT LIVES IN A MODULE OF ITS OWN because the queue column and the detail header both render it,
 * and the one thing this column may not do is say `venceu há 8 h` in the list and something else
 * in the detail (DS-COMPONENTE-020, point 4).
 *
 * TWO LINES, AND BOTH ARE HERE. `triageText` is the line the operator scans; `triageDeadlineText`
 * is the absolute instant that goes under it whenever the first line is relative (DS-COPY-025,
 * point 5). The instant is never left only in a `title` attribute: it does not reach the keyboard,
 * and here it is the record of what was promised to a partner.
 *
 * NO CALENDAR WORD COMES OUT OF HERE. `hoje` derived from the deadline INSTANT lies every time the
 * window crosses midnight (DS-COPY-025, point 3), so the copy counts hours and whole days and the
 * band under the unit is named (`falta menos de 1 h`) instead of rounded to zero.
 */

import type { useTranslations } from 'next-intl'
import { formatDeadline } from '@/components/admin/partner-proposals/format'
import type { TriageStatus } from '@/lib/partnerships/triage'

/**
 * `—` COVERS TWO SITUATIONS, and that is the spec's decision: the clock has not started (no
 * `approved_at`) and the clock is closed (published, or the refusal communicated). Neither is
 * late, and neither is worth a word in a column the operator scans.
 *
 * NEVER A COLOUR AND NEVER AN ICON ON ITS OWN (DS-A11Y-003, criterion 6).
 */
export function triageText(
  status: TriageStatus,
  t: ReturnType<typeof useTranslations>
): string {
  switch (status.kind) {
    case 'within':
      // The only face that carries the instant IN the first line: far from the deadline the act
      // is to plan, and planning needs the date and the hour (DS-COPY-025, point 1).
      return t('triage.within', { deadline: formatDeadline(status.deadline) })
    case 'due_soon':
      return t('triage.dueSoon', { count: status.hours })
    case 'due_last_hour':
      return t('triage.dueLastHour')
    case 'overdue_first_hour':
      return t('triage.overdueFirstHour')
    case 'overdue_hours':
      return t('triage.overdueHours', { count: status.hours })
    case 'overdue_days':
      return t('triage.overdueDays', { count: status.days })
    default:
      return t('triage.none')
  }
}

/**
 * The second line — the instant of the deadline, formatted, or `null` when there is no second
 * line to draw.
 *
 * `null` for the three faces that need none: `not_started` and `closed` have no deadline to show,
 * and `within` already prints it in the first line. Returning the FORMATTED string and not the ISO
 * instant keeps the two lines out of disagreement about the format.
 */
export function triageDeadlineText(status: TriageStatus): string | null {
  switch (status.kind) {
    case 'due_soon':
    case 'due_last_hour':
    case 'overdue_first_hour':
    case 'overdue_hours':
    case 'overdue_days':
      return formatDeadline(status.deadline)
    default:
      return null
  }
}
