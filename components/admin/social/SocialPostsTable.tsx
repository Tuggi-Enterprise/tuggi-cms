'use client'

/**
 * "Nossos posts" (#1059, spec 3): one post per row with the numbers of its LAST collection (a
 * snapshot, not a sum of days), the dense table of the CMS (DS-COMPONENTE-081), newest first,
 * sortable on every numeric column, with one filter chip per format present.
 *
 * A null cell is a measure Meta does not return for that post (a reel has no profile visits): it
 * prints the copy's "sem dado", dimmed, never a zero. A zero is "0".
 */

import { useMemo, useState } from 'react'
import { ExternalLink, ImageIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  CELL,
  DIM,
  DenseTableScroller,
  FilterChip,
  HEAD_SOLO,
  HEAD_SOLO_NUM,
  NUM,
  SortHead,
  type SortState,
} from '@/components/ui/dense-table'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { fmtDateTime, fmtDay, fmtInt } from '@/lib/social/format'
import { formatKey, themeKey, type FormatKey } from '@/lib/social/labels'
import type { PostMetric, SocialPostRow } from '@/lib/social/repository'
import { CardError, RawValue, SocialCard, socialQueries } from './shared'

type SortKey = 'date' | PostMetric

const METRIC_COLUMNS: Array<{ key: PostMetric; label: string }> = [
  { key: 'reach', label: 'col_reach' },
  { key: 'likes', label: 'col_likes' },
  { key: 'comments', label: 'col_comments' },
  { key: 'saved', label: 'col_saved' },
  { key: 'shares', label: 'col_shares' },
  { key: 'profile_visits', label: 'col_profile_visits' },
  { key: 'follows', label: 'col_follows' },
]

/** The look of `Button ghost size="icon"` on a link, which `Button` cannot render. */
export const ICON_LINK =
  'inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-700 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-gray-300'

const FORMAT_ORDER: FormatKey[] = ['carousel', 'reels', 'image', 'other']

function firstLine(caption: string | null): string | null {
  const line = caption?.split('\n').find((l) => l.trim().length > 0)?.trim()
  return line || null
}

/** Sorted copy; a null value always sinks, whatever the direction. */
export function sortPosts(posts: SocialPostRow[], sort: SortState<SortKey>): SocialPostRow[] {
  const value = (p: SocialPostRow): number | null =>
    sort.key === 'date' ? (p.posted_at ? Date.parse(p.posted_at) : null) : (p.metrics?.[sort.key] ?? null)
  return [...posts].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    return (va - vb) * sort.dir
  })
}

export function SocialPostsTable() {
  const t = useTranslations('Pages.Social')
  const tp = useTranslations('Pages.Social.posts')
  const query = useQuery(socialQueries.posts())
  const [filter, setFilter] = useState<FormatKey | null>(null)
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'date', dir: -1 })

  const posts = useMemo(() => query.data?.posts ?? [], [query.data])
  const counts = useMemo(() => {
    const c = new Map<FormatKey, number>()
    for (const p of posts) {
      const k = formatKey(p.media_type, p.media_product_type)
      c.set(k, (c.get(k) ?? 0) + 1)
    }
    return c
  }, [posts])
  const visible = useMemo(
    () => sortPosts(filter ? posts.filter((p) => formatKey(p.media_type, p.media_product_type) === filter) : posts, sort),
    [posts, filter, sort]
  )
  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }))

  const lastDay = query.data?.collection.last_day ?? null

  return (
    <SocialCard title={tp('title')} icon={ImageIcon} note={tp('caption')}>
      {query.isError ? (
        <CardError onRetry={() => void query.refetch()} />
      ) : query.data && posts.length === 0 ? (
        <div className="py-6">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{tp('empty_title')}</p>
          <p className="mt-1 text-sm text-gray-600">{tp('empty_body')}</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void query.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : (
        <>
          {query.data && (
            <div className="mb-3 flex flex-wrap gap-2">
              <FilterChip active={filter === null} count={posts.length} onClick={() => setFilter(null)}>
                {tp('filter_all')}
              </FilterChip>
              {FORMAT_ORDER.filter((k) => counts.has(k)).map((k) => (
                <FilterChip key={k} active={filter === k} count={counts.get(k)} onClick={() => setFilter(k)}>
                  {t(`format.${k}`)}
                </FilterChip>
              ))}
            </div>
          )}
          <DenseTableScroller label={tp('table_label')} maxHeightClassName="max-h-[calc(100vh-16rem)]">
            <table className="w-max min-w-full border-collapse">
              <thead>
                <tr>
                  <SortHead
                    column="date"
                    label={tp('col_date')}
                    className={`${HEAD_SOLO} w-[110px]`}
                    sort={sort}
                    onToggle={toggle}
                    title={tp('sort_aria', { column: tp('col_date') })}
                  />
                  <th scope="col" className={`${HEAD_SOLO} w-[260px]`}>
                    {tp('col_post')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO} w-[90px]`}>
                    {tp('col_format')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO} w-[100px]`}>
                    {tp('col_theme')}
                  </th>
                  {METRIC_COLUMNS.map((c) => (
                    <SortHead
                      key={c.key}
                      column={c.key}
                      label={tp(c.label)}
                      className={`${HEAD_SOLO_NUM} w-[76px] whitespace-normal`}
                      sort={sort}
                      onToggle={toggle}
                      title={tp('sort_aria', { column: tp(c.label) })}
                    />
                  ))}
                  <th scope="col" className={`${HEAD_SOLO} w-[44px]`}>
                    <span className="sr-only">{tp('col_open')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {!query.data
                  ? [0, 1, 2].map((i) => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={12} className={CELL}>
                          <span className="block h-4 rounded bg-gray-100 dark:bg-gray-800" />
                        </td>
                      </tr>
                    ))
                  : visible.map((p) => {
                      const line = firstLine(p.caption)
                      const theme = themeKey(p.theme)
                      return (
                        <tr key={p.id} className="border-t border-gray-100 dark:border-gray-800">
                          <td className={`${CELL} whitespace-nowrap`}>{p.posted_at ? fmtDateTime(p.posted_at) : UNKNOWN_VALUE}</td>
                          <td className={`${CELL} max-w-[260px]`}>
                            <span className="block truncate" title={p.caption ?? undefined}>
                              {line ?? <span className={DIM}>{UNKNOWN_VALUE}</span>}
                            </span>
                          </td>
                          <td className={`${CELL} whitespace-nowrap`}>{t(`format.${formatKey(p.media_type, p.media_product_type)}`)}</td>
                          <td className={`${CELL} whitespace-nowrap`}>
                            {theme === null ? (
                              <RawValue value={String(p.theme)} />
                            ) : theme === 'pending' ? (
                              <span className={DIM}>{t('theme.pending')}</span>
                            ) : (
                              t(`theme.${theme}`)
                            )}
                          </td>
                          {METRIC_COLUMNS.map((c) => {
                            const v = p.metrics?.[c.key] ?? null
                            return (
                              <td key={c.key} className={NUM}>
                                {v === null ? (
                                  <span className={DIM} title={tp('na_hint')}>
                                    {tp('na')}
                                  </span>
                                ) : (
                                  fmtInt(v)
                                )}
                              </td>
                            )
                          })}
                          <td className={`${CELL} py-1`}>
                            {p.permalink && (
                              <a
                                href={p.permalink}
                                target="_blank"
                                rel="noopener"
                                aria-label={tp('open_aria', { date: p.posted_at ? fmtDateTime(p.posted_at) : '' })}
                                className={ICON_LINK}
                              >
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
          {query.data && (
            <p className={`mt-2 text-[11px] ${DIM}`}>
              {tp('footer', { count: posts.length })}
              {lastDay ? ` ${t('data_until', { date: fmtDay(lastDay) })}` : ''}
            </p>
          )}
        </>
      )}
    </SocialCard>
  )
}
