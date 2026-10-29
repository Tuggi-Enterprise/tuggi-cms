'use client'

/**
 * `/admin/social`: the agenda of posts on Instagram and Facebook (#1058, spec
 * `spec-cms-redes-sociais-agenda-2026-10.md` section 2). One read per month feeds the calendar, the
 * list and the filter counts. Every date is Brasília (`lib/social/time.ts`), wherever the browser is.
 *
 * Below `sm` the switch goes away and the page shows the list: seven columns with thumbnails do not
 * fit 358 px of content.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight, Film, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/Container'
import { CELL, DIM, DenseTableScroller, FilterChip, HEAD_SOLO, NUM } from '@/components/ui/dense-table'
import { ViewSwitch } from '@/components/admin/clients/ViewSwitch'
import { useMediaQuery } from '@/lib/hooks/use-media-query'
import { returnParams } from '@/lib/navigation/return-to'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import {
  CAROUSEL_MAX,
  mediaKindOf,
  postFilterOf,
  type MediaType,
  type PostFilter,
  type SocialPost,
} from '@/lib/social/post'
import {
  calendarWeeks,
  dayKeyOf,
  formatDateTime,
  formatDayKey,
  formatMonth,
  formatTime,
  monthKeyOf,
  parseMonthKey,
  shiftMonth,
  wallTimeAt,
  weekdayLabels,
} from '@/lib/social/time'
import { Monogram, StatusGlyph, useNetworkName } from './status'

const SM_QUERY = '(min-width: 640px)'
export const LIST_VIEW = 'list'
export const SCHEDULED_PARAM = 'scheduled'

/** Links that look like the `cta` and `outline` buttons: a `<button>` inside an `<a>` is nested interactive. */
export const LINK_CTA =
  'inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md bg-primary-800 px-4 text-sm font-medium text-white hover:brightness-90'
export const LINK_OUTLINE =
  'inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground'

type Filter = 'all' | PostFilter
const FILTERS: Filter[] = ['all', 'scheduled', 'published', 'failed', 'canceled']

export function useMediaTypeName() {
  const t = useTranslations('Pages.Social.form')
  return (type: MediaType) =>
    t(type === 'IMAGE' ? 'type_image' : type === 'CAROUSEL' ? 'type_carousel' : 'type_reels')
}

export function SocialAgendaPageContent() {
  const t = useTranslations('Pages.Social')
  const tStatus = useTranslations('Common.status')
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'pt'
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const wide = useMediaQuery(SM_QUERY)

  const today = wallTimeAt(new Date())
  const month = parseMonthKey(search.get('month')) ?? { year: today.year, month: today.month }
  const monthKey = monthKeyOf(month)
  const showList = !wide || search.get('view') === LIST_VIEW
  const scheduledFlash = search.get(SCHEDULED_PARAM)

  const [posts, setPosts] = useState<SocialPost[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async () => {
    setPosts(null)
    setFailed(false)
    try {
      const response = await fetch(`/api/admin/social/posts?month=${monthKey}`, { cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const body = await response.json()
      setPosts(body.posts as SocialPost[])
    } catch {
      setFailed(true)
    }
  }, [monthKey])

  useEffect(() => {
    void load()
  }, [load])

  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString())
    next.delete(SCHEDULED_PARAM)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  const goMonth = (delta: number) => navigate({ month: monthKeyOf(shiftMonth(month, delta)) })

  const listHref = `/${locale}/admin/social?month=${monthKey}${showList && wide ? `&view=${LIST_VIEW}` : ''}`
  const backLabel = t('title')
  const postHref = (id: string) =>
    `/${locale}/admin/social/${id}?${new URLSearchParams(returnParams(listHref, backLabel)).toString()}`
  const newHref = (day?: string) =>
    `/${locale}/admin/social/new?${new URLSearchParams({
      ...(day ? { date: day } : {}),
      ...returnParams(listHref, backLabel),
    }).toString()}`

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, scheduled: 0, published: 0, failed: 0, canceled: 0 }
    for (const p of posts ?? []) {
      c.all += 1
      c[postFilterOf(p.post_targets)] += 1
    }
    return c
  }, [posts])

  const monthLabel = formatMonth(month)

  return (
    <div className="cms-width min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {t('subtitle')} {t('tz_note')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {wide ? (
              <ViewSwitch
                board={!showList}
                onChange={(calendar) => navigate({ view: calendar ? null : LIST_VIEW })}
                labels={{ group: t('view.label'), first: t('view.calendar'), second: t('view.list') }}
              />
            ) : null}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => goMonth(-1)}
                aria-label={t('calendar.prev_month')}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <span className="min-w-[9rem] text-center text-sm font-semibold text-gray-900 dark:text-gray-100">
                {monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}
              </span>
              <button
                type="button"
                onClick={() => goMonth(1)}
                aria-label={t('calendar.next_month')}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
              <Button variant="outline" size="sm" onClick={() => navigate({ month: null })}>
                {t('calendar.today')}
              </Button>
            </div>
            <Link href={newHref()} className={LINK_CTA}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              {t('new_post')}
            </Link>
          </div>
        </header>

        {scheduledFlash ? (
          <p role="status" className="mb-3 text-sm text-green-700 dark:text-green-400">
            {t('toast.scheduled', { date: formatDateTime(scheduledFlash) })}
          </p>
        ) : null}

        {failed ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          >
            <span>{t('load_failed')}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t('retry')}
            </Button>
          </div>
        ) : posts === null ? (
          <p className={`text-sm ${DIM}`}>{tStatus('loading')}</p>
        ) : posts.length === 0 ? (
          <EmptyMonth monthLabel={monthLabel} href={newHref()} />
        ) : showList ? (
          <PostList posts={posts} filter={filter} onFilter={setFilter} counts={counts} postHref={postHref} />
        ) : (
          <Calendar
            month={month}
            todayKey={dayKeyOf(today)}
            posts={posts}
            postHref={postHref}
            newHref={newHref}
            monthLabel={monthLabel}
          />
        )}
      </Container>
    </div>
  )
}

function EmptyMonth({ monthLabel, href }: { monthLabel: string; href: string }) {
  const t = useTranslations('Pages.Social')
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm italic text-gray-500 dark:text-gray-400">
        {t('empty.month_title', { month: monthLabel })}. {t('empty.month_body')}
      </p>
      <Link href={href} className={LINK_CTA}>
        <Plus className="mr-1.5 h-4 w-4" aria-hidden />
        {t('new_post')}
      </Link>
    </div>
  )
}

function Thumb({ post, size }: { post: SocialPost; size: 28 | 40 }) {
  const first = post.post_media[0]
  const box = size === 28 ? 'h-7 w-7' : 'h-10 w-10'
  if (first && mediaKindOf(first.mime_type) === 'image' && first.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={first.url} alt="" className={`${box} shrink-0 rounded object-cover`} loading="lazy" />
  }
  return (
    <span className={`${box} inline-flex shrink-0 items-center justify-center rounded bg-gray-100 dark:bg-gray-800`}>
      <Film className="h-3.5 w-3.5 text-gray-500" aria-hidden />
    </span>
  )
}

function usePostAria() {
  const t = useTranslations('Pages.Social')
  const networkName = useNetworkName()
  const typeName = useMediaTypeName()
  return (post: SocialPost) =>
    t('calendar.post_aria', {
      time: formatTime(post.scheduled_at),
      type: typeName(post.media_type),
      networks: post.post_targets.map((x) => networkName(x.network)).join(', '),
      status: post.post_targets
        .map((x) => t('status.aria', { network: networkName(x.network), status: t(`status.${x.status}`) }))
        .join(', '),
    })
}

function Calendar({
  month,
  todayKey,
  posts,
  postHref,
  newHref,
  monthLabel,
}: {
  month: { year: number; month: number }
  todayKey: string
  posts: SocialPost[]
  postHref: (id: string) => string
  newHref: (day?: string) => string
  monthLabel: string
}) {
  const t = useTranslations('Pages.Social')
  const aria = usePostAria()
  const weeks = calendarWeeks(month)
  const prefix = monthKeyOf(month)
  const byDay = useMemo(() => {
    const map = new Map<string, SocialPost[]>()
    for (const p of posts) {
      const key = dayKeyOf(wallTimeAt(new Date(p.scheduled_at)))
      map.set(key, [...(map.get(key) ?? []), p])
    }
    return map
  }, [posts])

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">{monthLabel}</caption>
        <thead>
          <tr>
            {weekdayLabels().map((d) => (
              <th key={d} scope="col" className={`px-2 py-2 text-left text-xs font-semibold uppercase ${DIM}`}>
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const inMonth = day.startsWith(prefix)
                const isToday = day === todayKey
                const future = day >= todayKey
                const dayPosts = byDay.get(day) ?? []
                return (
                  <td
                    key={day}
                    aria-current={isToday ? 'date' : undefined}
                    className={`group align-top border border-gray-200 p-1.5 dark:border-gray-800 lg:h-[112px] ${
                      isToday ? 'bg-tuggi-blue/10' : inMonth ? '' : 'bg-gray-50 dark:bg-gray-950'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={`text-xs tabular-nums ${isToday ? 'font-semibold text-gray-900 dark:text-white' : inMonth ? 'text-gray-700 dark:text-gray-300' : DIM}`}
                      >
                        {Number(day.slice(8))}
                      </span>
                      {future ? (
                        <Link
                          href={newHref(day)}
                          aria-label={t('calendar.add_on_day', { date: formatDayKey(day) })}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-primary-800 opacity-0 hover:bg-gray-100 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:text-tuggi-blue dark:hover:bg-gray-800"
                        >
                          <Plus className="h-4 w-4" aria-hidden />
                        </Link>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1">
                      {dayPosts.map((post) => {
                        const canceled = postFilterOf(post.post_targets) === 'canceled'
                        return (
                          <Link
                            key={post.id}
                            href={postHref(post.id)}
                            aria-label={aria(post)}
                            title={post.caption.split('\n')[0]}
                            className={`flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-200 px-1.5 py-1 hover:border-gray-300 dark:border-gray-700 ${
                              canceled ? `bg-gray-50 dark:bg-gray-950 ${DIM}` : 'bg-white dark:bg-gray-900'
                            }`}
                          >
                            <Thumb post={post} size={28} />
                            <span className="text-xs font-semibold tabular-nums">{formatTime(post.scheduled_at)}</span>
                            <span className="flex flex-wrap items-center gap-1 text-[11px]">
                              {post.post_targets.map((target) => (
                                <span key={target.network} className="inline-flex items-center gap-0.5">
                                  <Monogram network={target.network} />
                                  <StatusGlyph status={target.status} />
                                </span>
                              ))}
                            </span>
                          </Link>
                        )
                      })}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PostList({
  posts,
  filter,
  onFilter,
  counts,
  postHref,
}: {
  posts: SocialPost[]
  filter: Filter
  onFilter: (f: Filter) => void
  counts: Record<Filter, number>
  postHref: (id: string) => string
}) {
  const t = useTranslations('Pages.Social')
  const networkName = useNetworkName()
  const typeName = useMediaTypeName()
  const shown = filter === 'all' ? posts : posts.filter((p) => postFilterOf(p.post_targets) === filter)

  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('filter.label')} className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <FilterChip key={f} active={filter === f} count={counts[f]} onClick={() => onFilter(f)}>
            {t(`filter.${f}`)}
          </FilterChip>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm italic text-gray-500 dark:text-gray-400">{t('empty.filter')}</p>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <DenseTableScroller>
            <table className="w-full min-w-[1000px] border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={`${HEAD_SOLO} w-[150px]`}>{t('list.when')}</th>
                  <th scope="col" className={`${HEAD_SOLO} w-[140px]`}>{t('list.type')}</th>
                  <th scope="col" className={HEAD_SOLO}>{t('list.caption')}</th>
                  <th scope="col" className={`${HEAD_SOLO} w-[130px]`}>{networkName('instagram')}</th>
                  <th scope="col" className={`${HEAD_SOLO} w-[130px]`}>{networkName('facebook')}</th>
                  <th scope="col" className={`${HEAD_SOLO} w-[90px]`}>
                    <span className="sr-only">{t('list.open')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((post) => {
                  const firstLine = post.caption.split('\n')[0].trim()
                  const when = formatDateTime(post.scheduled_at)
                  return (
                    <tr key={post.id} className="border-t border-gray-100 dark:border-gray-800">
                      <td className={`${NUM} text-left`}>{when}</td>
                      <td className={CELL}>
                        <span className="flex items-center gap-2">
                          <Thumb post={post} size={40} />
                          <span>
                            {typeName(post.media_type)}
                            {post.media_type === 'CAROUSEL' ? (
                              <span className={DIM}> {t('media.count', { count: post.post_media.length, max: CAROUSEL_MAX })}</span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td className={`${CELL} max-w-[480px] truncate`}>{firstLine || UNKNOWN_VALUE}</td>
                      {(['instagram', 'facebook'] as const).map((network) => {
                        const target = post.post_targets.find((x) => x.network === network)
                        return (
                          <td key={network} className={CELL}>
                            {target ? (
                              <StatusGlyph status={target.status} withWord />
                            ) : (
                              UNKNOWN_VALUE
                            )}
                          </td>
                        )
                      })}
                      <td className={CELL}>
                        <Link href={postHref(post.id)} aria-label={`${t('list.open')} ${when}`} className={LINK_OUTLINE}>
                          {t('list.open')}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </DenseTableScroller>
        </div>
      )}
    </div>
  )
}
