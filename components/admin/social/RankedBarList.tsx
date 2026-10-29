'use client'

/**
 * One ranking of the overview (spec 2.2): label, a bar as wide as the value against the best, and
 * the value with its post count. The number is the content and the bar is support (DS-A11Y-007).
 *
 * A group under the floor (`MIN_POSTS`) has no rate: `social.own_media_ranking` answers null, and
 * the row goes to the end with no bar and no number (DS-COMPONENTE-084). The value is never
 * computed here; it is the database's median.
 */

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { DIM } from '@/components/ui/dense-table'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { fmtRate } from '@/lib/social/format'
import { MIN_POSTS } from '@/lib/social/constants'
import { SocialCard } from './shared'

export interface RankedItem {
  key: string
  label: ReactNode
  /** Plain text of the label, for the `title` of a truncated cell. */
  text: string
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
  const ordered = orderRanked(items)
  const best = Math.max(0, ...ordered.map((i) => (i.rate !== null && i.posts >= MIN_POSTS ? i.rate : 0)))
  const anyRanked = ordered.some((i) => i.rate !== null && i.posts >= MIN_POSTS)

  return (
    <SocialCard title={title} icon={icon}>
      {!anyRanked ? (
        <p className="text-sm italic text-gray-500">{t('not_enough')}</p>
      ) : (
        <ul>
          {ordered.map((item) => {
            const ranked = item.rate !== null && item.posts >= MIN_POSTS
            return (
              <li
                key={item.key}
                className="grid grid-cols-[7rem_1fr_auto] items-center gap-2 py-1.5"
                title={ranked ? undefined : t('few_posts_hint', { min: MIN_POSTS })}
              >
                <span className="w-28 truncate text-sm text-gray-800 dark:text-gray-200" title={item.text}>
                  {item.label}
                </span>
                <span className="h-2 rounded bg-gray-100 dark:bg-gray-800" aria-hidden="true">
                  {ranked && best > 0 && (
                    <span
                      className="block h-2 rounded bg-primary-800"
                      style={{ width: `${Math.max(2, ((item.rate as number) / best) * 100)}%` }}
                    />
                  )}
                </span>
                <span className="text-right">
                  <span className="block text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {ranked ? fmtRate(item.rate as number) : UNKNOWN_VALUE}
                  </span>
                  <span className={`block text-[11px] ${DIM}`}>
                    {ranked ? t('posts_count', { count: item.posts }) : t('few_posts', { count: item.posts })}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </SocialCard>
  )
}
