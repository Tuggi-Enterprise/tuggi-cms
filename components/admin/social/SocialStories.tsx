'use client'

/**
 * "Stories" (#1062, spec R2.6): our stories of the last 14 days, newest first, with the latest hourly
 * reading of each. A story is not a feed post and stays out of the posts table, the rankings and the
 * funnel. "No ar" marks a story younger than 24 hours, whose numbers still change. "Saída ÷ alcance"
 * is the database's `exit_rate`; nothing is divided here.
 *
 * Empty states, in order: the hourly job never ran (the sentence and a reload button, never an empty
 * table), or it ran and there is no story in the window.
 */

import { useMemo, useState } from 'react'
import { CirclePlay, ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  CELL,
  DIM,
  DenseTableScroller,
  HEAD_SOLO,
  HEAD_SOLO_NUM,
  ICON_CELL,
  NUM,
  SortHead,
  type SortState,
} from '@/components/ui/dense-table'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { fmtDateTime, fmtInt, fmtRate } from '@/lib/social/format'
import { safePermalink } from '@/lib/social/funnel'
import type { StoryMetric, StoryRow } from '@/lib/social/repository'
import { ICON_LINK } from './SocialPostsTable'
import { CardError, SocialCard, socialQueries } from './shared'

type SortKey = 'posted_at' | StoryMetric | 'exit_rate'

/** A story is live for 24 hours after it was posted (Instagram's own rule). */
const LIVE_MS = 24 * 3_600_000

const COLUMNS: Array<{ key: StoryMetric; label: string; full?: string; hint?: string; width: string }> = [
  { key: 'reach', label: 'col_reach', width: 'w-[76px]' },
  { key: 'views', label: 'col_views', full: 'col_views_full', width: 'w-[90px]' },
  { key: 'replies', label: 'col_replies', width: 'w-[76px]' },
  { key: 'tap_forward', label: 'col_forward', hint: 'forward_hint', width: 'w-[76px]' },
  { key: 'tap_back', label: 'col_back', hint: 'back_hint', width: 'w-[76px]' },
  { key: 'tap_exit', label: 'col_exit', hint: 'exit_hint', width: 'w-[76px]' },
  { key: 'swipe_forward', label: 'col_skip', hint: 'skip_hint', width: 'w-[76px]' },
]

/** Sorted copy; a null value always sinks, whatever the direction. */
export function sortStories(rows: StoryRow[], sort: SortState<SortKey>): StoryRow[] {
  const value = (r: StoryRow): number | null =>
    sort.key === 'posted_at' ? (r.posted_at ? Date.parse(r.posted_at) : null) : r[sort.key]
  return [...rows].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    return (va - vb) * sort.dir
  })
}

export function SocialStories() {
  const t = useTranslations('Pages.Social.stories')
  const tp = useTranslations('Pages.Social.posts')
  const query = useQuery(socialQueries.stories())
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'posted_at', dir: -1 })
  const rows = useMemo(() => sortStories(query.data?.stories ?? [], sort), [query.data, sort])
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }))
  const [now] = useState(() => Date.now())

  const head = (key: SortKey, label: string, width: string, hint?: string) => (
    <SortHead
      key={key}
      column={key}
      label={label}
      className={`${HEAD_SOLO_NUM} ${width} whitespace-normal`}
      sort={sort}
      onToggle={toggle}
      title={hint ? `${tp('sort_aria', { column: label })}. ${hint}` : tp('sort_aria', { column: label })}
    />
  )
  const value = (v: number | null) =>
    v === null ? (
      <span className={DIM} title={t('na_hint')}>
        {t('na')}
      </span>
    ) : (
      fmtInt(v)
    )

  const neverRan = query.data && query.data.collection.last_run_at === null

  return (
    <SocialCard title={t('title')} icon={CirclePlay} note={t('note')}>
      {query.isError ? (
        <CardError onRetry={() => void query.refetch()} />
      ) : neverRan ? (
        <div className="py-2">
          <p className="text-sm italic text-gray-500">{t('no_collection')}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>
            {t('reload')}
          </Button>
        </div>
      ) : query.data && rows.length === 0 ? (
        <p className="text-sm italic text-gray-500">{t('empty')}</p>
      ) : (
        <>
          <DenseTableScroller label={t('table_label')} maxHeightClassName="max-h-[28rem]">
            <table className="w-max min-w-full border-collapse">
              <thead>
                <tr>
                  <SortHead
                    column="posted_at"
                    label={t('col_posted')}
                    className={`${HEAD_SOLO} w-[130px]`}
                    sort={sort}
                    onToggle={toggle}
                    title={tp('sort_aria', { column: t('col_posted') })}
                  />
                  <th scope="col" className={`${HEAD_SOLO} w-[80px]`}>
                    {t('col_type')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO} w-[90px]`}>
                    {t('col_state')}
                  </th>
                  {COLUMNS.map((c) => head(c.key, t(c.label), c.width, c.hint ? t(c.hint) : c.full ? t(c.full) : undefined))}
                  {head('exit_rate', t('col_exit_rate'), 'w-[90px]', t('exit_rate_hint'))}
                  <th scope="col" className={`${HEAD_SOLO} w-[36px]`}>
                    <span className="sr-only">{t('col_open')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {!query.data
                  ? [0, 1, 2].map((i) => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={COLUMNS.length + 5} className={CELL}>
                          <span className="block h-4 rounded bg-gray-100 dark:bg-gray-800" />
                        </td>
                      </tr>
                    ))
                  : rows.map((r) => {
                      const live = r.posted_at !== null && Date.parse(r.posted_at) + LIVE_MS > now
                      const link = safePermalink(r.permalink)
                      const when = r.posted_at ? fmtDateTime(r.posted_at) : UNKNOWN_VALUE
                      return (
                        <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                          <td className={`${CELL} whitespace-nowrap`}>{when}</td>
                          <td className={`${CELL} whitespace-nowrap`}>
                            {r.media_type === 'VIDEO' ? t('type_video') : r.media_type === 'IMAGE' ? t('type_image') : <span className={DIM}>{UNKNOWN_VALUE}</span>}
                          </td>
                          <td className={`${ICON_CELL} whitespace-nowrap`}>
                            {live && (
                              <Badge variant="outline" title={t('live_hint')}>
                                {t('live')}
                              </Badge>
                            )}
                          </td>
                          {COLUMNS.map((c) => (
                            <td key={c.key} className={NUM}>
                              {value(r[c.key])}
                            </td>
                          ))}
                          <td className={NUM}>
                            {r.exit_rate === null ? (
                              <span className={DIM} title={t('na_hint')}>
                                {t('na')}
                              </span>
                            ) : (
                              fmtRate(r.exit_rate)
                            )}
                          </td>
                          <td className={ICON_CELL}>
                            {link && (
                              <a href={link} target="_blank" rel="noopener" aria-label={t('open_aria', { date: when })} className={ICON_LINK}>
                                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                              </a>
                            )}
                          </td>
                        </tr>
                      )
                    })}
              </tbody>
            </table>
          </DenseTableScroller>
          <p className={`mt-2 text-[11px] ${DIM}`}>{t('footer')}</p>
        </>
      )}
    </SocialCard>
  )
}
