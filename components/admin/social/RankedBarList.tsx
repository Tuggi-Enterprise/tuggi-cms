'use client'

/**
 * One ranking of the overview (spec 2.2), drawn by `RankRow` (#1061, R1 item 6): label with the post
 * count beside it, the rate on the right, a bar as wide as the value against the best below. The
 * number is the content and the bar is support (DS-A11Y-007).
 *
 * A group under the floor (`MIN_POSTS`) has no rate: `social.own_media_ranking` answers null, and
 * the row goes to the end with no bar and no number (DS-COMPONENTE-084). The value is never
 * computed here; it is the database's median.
 */

import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { DIM } from '@/components/ui/dense-table'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { fmtRate } from '@/lib/social/format'
import { MIN_POSTS } from '@/lib/social/constants'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { RankRow } from '@/components/dashboard/reports/acquisition/RankRow'
import { SocialCard } from './shared'

export interface RankedItem {
  key: string
  /** The label as `RankRow` prints it: plain text (an unknown enum arrives raw, as the database sent it). */
  text: string
  /** The label is a value the screen has no word for, printed raw (DS-COPY-021). */
  raw?: boolean
  posts: number
  rate: number | null
}

/** Ranked first, by value; the rows without a value after them, in the order they came. */
export function orderRanked(items: RankedItem[]): RankedItem[] {
  const ranked = items.filter((i) => i.rate !== null && i.posts >= MIN_POSTS)
  const rest = items.filter((i) => !ranked.includes(i))
  return [...ranked.sort((a, b) => (b.rate as number) - (a.rate as number)), ...rest]
}

export function RankedBarList({ title, icon, items }: { title: string; icon: LucideIcon; items: RankedItem[] }) {
  const t = useTranslations('Pages.Social.overview.ranking')
  const ts = useTranslations('Pages.Social')
  const ordered = orderRanked(items)
  const isRanked = (i: RankedItem) => i.rate !== null && i.posts >= MIN_POSTS
  const best = Math.max(0, ...ordered.map((i) => (isRanked(i) ? (i.rate as number) : 0)))

  return (
    <SocialCard title={title} icon={icon} as="h3">
      {!ordered.some(isRanked) ? (
        <p className="text-sm italic text-gray-500">{t('not_enough')}</p>
      ) : (
        <ul>
          {ordered.map((item) => {
            const ranked = isRanked(item)
            const hint = [item.raw ? ts('raw_value_hint', { value: item.text }) : null, ranked ? null : t('few_posts_hint', { min: MIN_POSTS })]
            return (
              <li key={item.key} title={hint.filter(Boolean).join(' ') || undefined}>
                <RankRow
                  label={item.text}
                  sub={ranked ? t('posts_count', { count: item.posts }) : undefined}
                  value={ranked ? (item.rate as number) : 0}
                  display={ranked ? fmtRate(item.rate as number) : UNKNOWN_VALUE}
                  max={best}
                  color={CHART_COLORS.blue}
                  muted={!ranked}
                  right={ranked ? undefined : <span className={`text-[11px] ${DIM}`}>{t('few_posts', { count: item.posts })}</span>}
                />
              </li>
            )
          })}
        </ul>
      )}
    </SocialCard>
  )
}
