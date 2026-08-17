/**
 * The five texts of the `Triagem` column — spec §3.1, and the promise behind them is BR-B2B-010,
 * item 4: within 72 straight hours of the partnership's approval, either the place is published
 * or the refusal was communicated.
 *
 * IT LIVES IN A MODULE OF ITS OWN because the queue column and the detail header both render it,
 * and the one thing this column may not do is say `venceu há 2 dias` in the list and something
 * else in the detail (DS-COMPONENTE-020, point 4).
 */

import type { useTranslations } from 'next-intl'
import { formatClockTime, formatDeadline } from '@/components/admin/partner-proposals/format'
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
      return t('triage.within', { deadline: formatDeadline(status.deadline) })
    case 'due_today':
      return t('triage.dueToday', { time: formatClockTime(status.deadline) })
    case 'overdue':
      return t('triage.overdue', { count: status.days })
    default:
      return t('triage.none')
  }
}
