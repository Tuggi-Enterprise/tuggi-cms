'use client'

/**
 * "O que rende em cada mercado" (#1064, spec M3): the competitors' posts of the last
 * `MARKET_WINDOW_DAYS`, by format, theme and weekday, in Brasil, EUA and Europa side by side. The
 * groups are the rows and the markets the columns, in a fixed order, so the same row reads across
 * the three markets. Every number is the server's median of interactions per follower; a cell with
 * no number prints `UNKNOWN_VALUE` with its reason in the title (DS-COMPONENTE-084), never 0.
 *
 * Without a tracked competitor the card does not show; with competitors but no market, it says
 * where to mark one.
 */

import { Globe } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { CELL, DIM, DenseTableScroller, HEAD_SOLO, HEAD_SOLO_NUM } from '@/components/ui/dense-table'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { MARKET_WINDOW_DAYS, MIN_POSTS } from '@/lib/social/constants'
import { fmtRate2, fmtWeekday } from '@/lib/social/format'
import { MARKETS, MARKET_KEY, formatBucketKey, themeKey, type Market } from '@/lib/social/labels'
import type { MarketDimension, MarketRow, MarketsPayload } from '@/lib/social/repository'
import { CardError, CardLoading, LOADING_HEIGHT, RawValue, SocialCard, socialQueries } from './shared'

const DIMENSIONS: Array<{ key: MarketDimension; title: 'by_format' | 'by_theme' | 'by_weekday' }> = [
  { key: 'format', title: 'by_format' },
  { key: 'theme', title: 'by_theme' },
  { key: 'weekday', title: 'by_weekday' },
]


function GroupLabel({ dimension, bucket }: { dimension: MarketDimension; bucket: string | null }) {
  const ts = useTranslations('Pages.Social')
  if (dimension === 'format') return <>{ts(`format.${formatBucketKey(bucket)}`)}</>
  if (dimension === 'weekday') return <>{fmtWeekday(Number(bucket))}</>
  const theme = themeKey(bucket)
  if (theme === null) return <RawValue value={String(bucket)} />
  return theme === 'pending' ? <span className={DIM}>{ts('theme.pending')}</span> : <>{ts(`theme.${theme}`)}</>
}

function MarketRateCell({ row, max, best }: { row: MarketRow; max: number; best: boolean }) {
  const t = useTranslations('Pages.Social.markets')
  const tc = useTranslations('Pages.Social.competitors')
  const tr = useTranslations('Pages.Social.overview.ranking')
  const market = tc(MARKET_KEY[row.market])
  const title =
    row.reason === 'no_account'
      ? t('no_account_hint', { market })
      : row.reason === 'no_posts'
        ? t('no_posts_hint', { market })
        : row.reason === 'few_posts'
          ? tr('few_posts_hint', { min: MIN_POSTS })
          : row.reason === 'no_followers'
            ? t('no_followers_hint')
            : undefined
  const showCount = row.reason === null || row.reason === 'few_posts' || row.reason === 'no_followers'
  return (
    <td className={CELL.replace('py-2.5', 'py-1.5')} title={title}>
      <span className="flex h-5 items-baseline justify-between gap-2">
        <span className={`text-[11px] ${DIM}`}>{showCount ? tr('posts_count', { count: row.posts }) : ''}</span>
        {row.rate === null ? (
          <span className={`text-sm ${DIM}`}>{UNKNOWN_VALUE}</span>
        ) : (
          <span className={`text-sm tabular-nums ${best ? 'font-semibold' : ''}`}>{fmtRate2(row.rate)}</span>
        )}
      </span>
      <span className="mt-0.5 block h-1 rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden="true">
        {row.rate !== null && max > 0 && (
          <span
            className="block h-1 rounded-full"
            style={{ width: `${Math.max(2, (row.rate / max) * 100)}%`, backgroundColor: CHART_COLORS.blue }}
          />
        )}
      </span>
    </td>
  )
}

function DimensionTable({ data, dimension, title }: { data: MarketsPayload; dimension: MarketDimension; title: string }) {
  const t = useTranslations('Pages.Social.markets')
  const tc = useTranslations('Pages.Social.competitors')
  const rows = data.rows.filter((r) => r.dimension === dimension)
  const buckets = [...new Set(rows.map((r) => r.bucket))]
  const rates = rows.map((r) => r.rate).filter((v): v is number => v !== null)
  const max = rates.length > 0 ? Math.max(...rates) : 0
  const bestOf = (market: Market) => {
    const list = rows.filter((r) => r.market === market && r.rate !== null).map((r) => r.rate as number)
    return list.length > 0 ? Math.max(...list) : null
  }
  const best = Object.fromEntries(MARKETS.map((m) => [m, bestOf(m)])) as Record<Market, number | null>
  return (
    <div data-market-dimension={dimension} className="min-w-0">
      <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-500">{title}</h3>
      <DenseTableScroller label={`${t('table_label')}: ${title}`}>
        <table className="w-full min-w-[492px] border-collapse">
          <thead>
            <tr>
              <th scope="col" className={`${HEAD_SOLO} w-[108px]`}>
                <span className="sr-only">{title}</span>
              </th>
              {MARKETS.map((m) => (
                <th key={m} scope="col" className={`${HEAD_SOLO_NUM} min-w-[128px]`}>
                  {tc(MARKET_KEY[m])}
                  <span className="block font-medium normal-case tracking-normal">
                    {t('accounts', { count: data.markets[m].accounts })}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket ?? 'null'} className="h-10 border-t border-gray-100 dark:border-gray-800">
                <th scope="row" className={`${CELL.replace('py-2.5', 'py-2')} whitespace-nowrap text-left font-normal`}>
                  <GroupLabel dimension={dimension} bucket={bucket} />
                </th>
                {MARKETS.map((m) => {
                  const row = rows.find((r) => r.bucket === bucket && r.market === m)
                  if (!row) return <td key={m} className={CELL} />
                  return <MarketRateCell key={m} row={row} max={max} best={row.rate !== null && row.rate === best[m]} />
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </DenseTableScroller>
    </div>
  )
}

export function MarketComparison() {
  const t = useTranslations('Pages.Social.markets')
  const tr = useTranslations('Pages.Social.overview.ranking')
  const accounts = useQuery(socialQueries.accounts())
  const query = useQuery(socialQueries.markets())
  const data = query.data
  const competitors = accounts.data?.accounts.filter((a) => !a.is_own) ?? null

  if (competitors && competitors.length === 0) return null
  const noMarket = data ? MARKETS.every((m) => data.markets[m].accounts === 0) : false

  return (
    <SocialCard title={t('title')} icon={Globe}>
      <p className={`mb-3 text-xs ${DIM}`}>{t('caption', { days: data?.window_days ?? MARKET_WINDOW_DAYS })}</p>
      {query.isError ? (
        <CardError onRetry={() => void query.refetch()} message={t('failed')} />
      ) : !data ? (
        <CardLoading height={LOADING_HEIGHT.markets} />
      ) : noMarket ? (
        <>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('empty_title')}</p>
          <p className="mt-1 text-sm italic text-gray-500">{t('empty_body')}</p>
        </>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {DIMENSIONS.map((d) => (
              <DimensionTable key={d.key} data={data} dimension={d.key} title={tr(d.title)} />
            ))}
          </div>
          <p className={`mt-3 text-[11px] ${DIM}`}>{t('note')}</p>
        </>
      )}
    </SocialCard>
  )
}
