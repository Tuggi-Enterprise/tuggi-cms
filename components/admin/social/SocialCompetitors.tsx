'use client'

/**
 * "Concorrentes" (#1059, spec 4): a photo of today. Our account is the first row, always, outside
 * the sorting and marked with a word; the others sort by followers. Growth needs days of collection:
 * until they exist the cell prints the copy's "sem dado" with the day it starts (never "+0").
 *
 * The engagement is `social.account_engagement` (per follower, the same ruler for every row,
 * because a competitor has no reach); this file never divides a like by anything.
 */

import { useMemo, useState } from 'react'
import { CircleAlert, ExternalLink, Trash2, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { ACCOUNT_WINDOW_DAYS, STALE_POST_DAYS } from '@/lib/social/constants'
import { fmtDay, fmtDecimal, fmtInt, fmtRate2, fmtSigned, fmtSignedRate } from '@/lib/social/format'
import type { Growth, SocialAccountRow } from '@/lib/social/repository'
import { addDays, brasiliaDay, expectedCollectDay } from '@/lib/social/time'
import { AddAccountForm } from './AddAccountForm'
import { RemoveAccountDialog } from './RemoveAccountDialog'
import { CardError, SocialCard, socialQueries } from './shared'

const accountsQueryKey = socialQueries.accounts().queryKey

type SortKey = 'followers' | 'growth_7d' | 'growth_30d' | 'engagement' | 'frequency'

const MIX = [
  { key: 'image', color: CHART_COLORS.blue },
  { key: 'carousel', color: CHART_COLORS.orange },
  { key: 'reels', color: CHART_COLORS.purple },
] as const

const WEEKS_IN_WINDOW = ACCOUNT_WINDOW_DAYS / 7

const sortValue = (a: SocialAccountRow, key: SortKey): number | null =>
  key === 'followers'
    ? a.followers
    : key === 'growth_7d'
      ? (a.growth_7d?.delta ?? null)
      : key === 'growth_30d'
        ? (a.growth_30d?.delta ?? null)
        : key === 'engagement'
          ? a.engagement
          : a.posts_30d

/** Our account first, always; the others by the chosen column, nulls at the end. */
export function orderAccounts(accounts: SocialAccountRow[], sort: SortState<SortKey>): SocialAccountRow[] {
  const own = accounts.filter((a) => a.is_own)
  const others = accounts
    .filter((a) => !a.is_own)
    .sort((x, y) => {
      const vx = sortValue(x, sort.key)
      const vy = sortValue(y, sort.key)
      if (vx === null && vy === null) return x.username.localeCompare(y.username)
      if (vx === null) return 1
      if (vy === null) return -1
      return (vx - vy) * sort.dir
    })
  return [...own, ...others]
}

function GrowthCell({ growth, from, days }: { growth: Growth | null; from: string | null; days: number }) {
  const t = useTranslations('Pages.Social.competitors')
  if (!growth) {
    return (
      <span className={DIM} title={`${t('na_hint', { days })}${from ? ` ${fmtDay(from)}` : ''}`}>
        {t('na')}
      </span>
    )
  }
  const up = growth.delta > 0
  const down = growth.delta < 0
  const Icon = up ? TrendingUp : down ? TrendingDown : null
  return (
    <span className={`inline-flex flex-col items-end ${up ? 'text-green-700' : down ? 'text-red-700' : DIM}`}>
      <span className="inline-flex items-center gap-1">
        {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
        {fmtSigned(growth.delta)}
      </span>
      {growth.ratio !== null && <span className="text-[11px]">{fmtSignedRate(growth.ratio)}</span>}
    </span>
  )
}

function MixCell({ account }: { account: SocialAccountRow }) {
  const t = useTranslations('Pages.Social.competitors')
  const total = account.posts_30d
  if (total === 0) return <span className={DIM}>{t('na')}</span>
  const pct = (n: number) => Math.round((n / total) * 100)
  return (
    <span className="flex flex-col gap-1">
      <span className="flex h-2 w-28 gap-[2px] overflow-hidden rounded" aria-hidden="true">
        {MIX.map((m) =>
          account.mix[m.key] > 0 ? (
            <span key={m.key} style={{ width: `${pct(account.mix[m.key])}%`, backgroundColor: m.color }} />
          ) : null
        )}
      </span>
      <span className="w-40 text-[11px] leading-tight text-gray-700 dark:text-gray-300">
        {t('mix_value', { carousel: pct(account.mix.carousel), reels: pct(account.mix.reels), image: pct(account.mix.image) })}
      </span>
    </span>
  )
}

export function SocialCompetitors() {
  const t = useTranslations('Pages.Social.competitors')
  const ts = useTranslations('Pages.Social')
  const queryClient = useQueryClient()
  const query = useQuery(socialQueries.accounts())
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'followers', dir: -1 })
  const [flash, setFlash] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ id: string; username: string } | null>(null)
  const [announce, setAnnounce] = useState('')

  const accounts = useMemo(() => orderAccounts(query.data?.accounts ?? [], sort), [query.data, sort])
  const own = accounts.find((a) => a.is_own) ?? null
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }))
  const blink = (id: string | null) => {
    if (!id) return
    setFlash(id)
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 2000)
  }

  const now = new Date()
  const expected = expectedCollectDay(now)
  const today = query.data?.today ?? brasiliaDay(now)
  const noGrowthYet = accounts.length > 0 && accounts.every((a) => !a.growth_7d)
  const growthFrom = accounts.map((a) => a.growth_7d_from).filter((d): d is string => !!d).sort()[0] ?? null
  const note = query.data?.collection.last_day
    ? noGrowthYet && growthFrom
      ? t('growth_from', { date: fmtDay(growthFrom) })
      : ts('data_until', { date: fmtDay(query.data.collection.last_day) })
    : undefined

  const headNum = (key: SortKey, label: string, width: string) => (
    <SortHead
      column={key}
      label={label}
      className={`${HEAD_SOLO_NUM} ${width}`}
      sort={sort}
      onToggle={toggle}
      title={ts('posts.sort_aria', { column: label })}
    />
  )

  return (
    <SocialCard title={t('title')} icon={Users} note={note}>
      <p className={`mb-3 text-xs ${DIM}`}>{t('caption')}</p>
      <AddAccountForm
        ownUsername={own?.username ?? null}
        onAdded={(id) => {
          void queryClient.invalidateQueries({ queryKey: accountsQueryKey }).then(() => blink(id))
        }}
        onDuplicate={(id) => blink(id)}
      />
      {query.isError ? (
        <CardError onRetry={() => void query.refetch()} />
      ) : query.data && accounts.length === 0 ? (
        <p className="text-sm text-gray-600">{t('empty')}</p>
      ) : (
        <>
          <DenseTableScroller maxHeightClassName="max-h-[calc(100vh-20rem)]">
            <table className="w-max min-w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={`${HEAD_SOLO} w-[200px]`}>
                    {t('col_account')}
                  </th>
                  {headNum('followers', t('col_followers'), 'w-[96px]')}
                  {headNum('growth_7d', `${t('growth_group')} ${t('col_growth_7d')}`, 'w-[96px]')}
                  {headNum('growth_30d', `${t('growth_group')} ${t('col_growth_30d')}`, 'w-[96px]')}
                  {headNum('engagement', t('col_engagement'), 'w-[110px] whitespace-normal')}
                  <th scope="col" className={`${HEAD_SOLO} w-[180px]`}>
                    {t('col_mix')}
                  </th>
                  {headNum('frequency', t('col_frequency'), 'w-[90px] whitespace-normal')}
                  <th scope="col" className={`${HEAD_SOLO_NUM} w-[96px]`}>
                    {t('col_last_post')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO_NUM} w-[96px]`}>
                    {t('col_last_collect')}
                  </th>
                  <th scope="col" className={`${HEAD_SOLO} w-[44px]`}>
                    <span className="sr-only">{t('remove')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {!query.data
                  ? [0, 1, 2].map((i) => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={10} className={CELL}>
                          <span className="block h-4 rounded bg-gray-100 dark:bg-gray-800" />
                        </td>
                      </tr>
                    ))
                  : accounts.map((a) => {
                      const stale = a.last_day !== null && a.last_day < expected
                      const oldPost = a.last_post !== null && brasiliaDay(new Date(a.last_post)) < addDays(today, -STALE_POST_DAYS)
                      return (
                        <tr
                          key={a.id}
                          data-account={a.username}
                          className={`border-t border-gray-100 transition-colors dark:border-gray-800 ${
                            a.is_own || flash === a.id ? 'bg-primary-800/5' : ''
                          }`}
                        >
                          <td className={`${CELL} whitespace-nowrap`}>
                            <a
                              href={`https://www.instagram.com/${a.username}/`}
                              target="_blank"
                              rel="noopener"
                              aria-label={t('open_aria', { username: a.username })}
                              className={`inline-flex items-center gap-1 hover:underline ${a.is_own ? 'font-semibold' : ''}`}
                            >
                              @{a.username}
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                            {a.is_own && (
                              <Badge variant="outline" className="ml-2 align-middle">
                                {t('own_badge')}
                              </Badge>
                            )}
                          </td>
                          <td className={NUM}>{a.followers === null ? <span className={DIM}>{t('na')}</span> : fmtInt(a.followers)}</td>
                          <td className={NUM}>
                            <GrowthCell growth={a.growth_7d} from={a.growth_7d_from} days={7} />
                          </td>
                          <td className={NUM}>
                            <GrowthCell growth={a.growth_30d} from={a.growth_30d_from} days={30} />
                          </td>
                          <td className={NUM} title={t('engagement_hint', { count: a.posts_30d })}>
                            {a.engagement === null ? <span className={DIM}>{t('na')}</span> : fmtRate2(a.engagement)}
                          </td>
                          <td className={CELL} title={t('mix_hint', { count: a.posts_30d })}>
                            <MixCell account={a} />
                          </td>
                          <td className={NUM} title={t('frequency_hint', { count: a.posts_30d })}>
                            {fmtDecimal(a.posts_30d / WEEKS_IN_WINDOW)}
                          </td>
                          <td className={NUM}>
                            {a.last_post === null ? (
                              <span className={DIM}>{UNKNOWN_VALUE}</span>
                            ) : (
                              <span className={oldPost ? 'text-amber-700' : ''} title={oldPost ? t('last_post_old') : undefined}>
                                {fmtDay(brasiliaDay(new Date(a.last_post)))}
                              </span>
                            )}
                          </td>
                          <td className={NUM}>
                            {a.last_day === null ? (
                              <span className={DIM}>{UNKNOWN_VALUE}</span>
                            ) : stale ? (
                              <span className="inline-flex items-center gap-1 text-amber-700" title={t('stale_hint', { date: fmtDay(a.last_day) })}>
                                <CircleAlert className="h-3 w-3" aria-hidden="true" />
                                {fmtDay(a.last_day)}
                              </span>
                            ) : (
                              <span className={DIM}>{fmtDay(a.last_day)}</span>
                            )}
                          </td>
                          <td className={ICON_CELL}>
                            {!a.is_own && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={t('remove_aria', { username: a.username })}
                                onClick={() => setRemoving({ id: a.id, username: a.username })}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
              </tbody>
            </table>
          </DenseTableScroller>
          <p className={`mt-2 flex flex-wrap items-center gap-3 text-[11px] ${DIM}`}>
            <span>{t('mix_legend')}</span>
            {MIX.map((m) => (
              <span key={m.key} className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: m.color }} aria-hidden="true" />
                {ts(`format.${m.key}`)}
              </span>
            ))}
          </p>
        </>
      )}
      <p role="status" className="sr-only">
        {announce}
      </p>
      <RemoveAccountDialog
        account={removing}
        onClose={() => setRemoving(null)}
        onRemoved={(username) => {
          setRemoving(null)
          setAnnounce(t('removed', { username }))
          void queryClient.invalidateQueries({ queryKey: accountsQueryKey })
        }}
      />
    </SocialCard>
  )
}
