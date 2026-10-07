/**
 * The line that says the partnership was approved — #909.
 *
 * IT LIVES IN A MODULE OF ITS OWN because band 3 and the trail both print it, and they used to
 * print two different sentences for the same act: the band named the approver when the client
 * came from the form, and the trail never did. One function, one sentence.
 *
 * Without a resolvable approver the sentence stays, without the name: the date is the fact
 * BR-B2B-010, item 4, starts the clock on, and it is worth showing on its own.
 */

import type { useTranslations } from 'next-intl'
import { formatDate } from '@/components/admin/partner-proposals/format'

export function clientApprovedText(
  approvedAt: string,
  approvedByLabel: string | null,
  t: ReturnType<typeof useTranslations>
): string {
  const date = formatDate(approvedAt)
  return approvedByLabel
    ? t('detail.clientApprovedBy', { date, person: approvedByLabel })
    : t('detail.clientApproved', { date })
}
