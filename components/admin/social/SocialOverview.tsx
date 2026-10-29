'use client'

/**
 * The overview of `/admin/social` (#1059, spec 2): the answer (the week's recommendations), the
 * evidence (four rankings by interactions per reach) and the result (the daily funnel), in the order
 * the operator asks. The period governs rankings and funnel, never the recommendations.
 */

import { BarChart3, CalendarDays, Clock, LayoutGrid, Sparkles, Tags } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { DIM } from '@/components/ui/dense-table'
import { fmtDay, fmtWeekday } from '@/lib/social/format'
import { formatBucketKey, themeKey } from '@/lib/social/labels'
import type { OverviewPayload, RankingRow } from '@/lib/social/repository'
import { mondayOf, type SocialPeriod } from '@/lib/social/time'
import { RankedBarList, type RankedItem } from './RankedBarList'
import { FunnelStrip } from './FunnelStrip'
import { CardError, CardLoading, RawValue, SocialCard, socialQueries } from './shared'


function Recommendations({ data }: { data: OverviewPayload }) {
  const t = useTranslations('Pages.Social.overview.recs')
  const rec = data.recommendations
  const thisWeek = mondayOf(data.today)
  const items = rec?.items ?? []
  const current = rec?.week_start === thisWeek

  return (
    <SocialCard
      title={t('title')}
      icon={Sparkles}
      note={rec && items.length > 0 ? (current ? t('caption', { date: fmtDay(rec.week_start) }) : t('stale', { date: fmtDay(rec.week_start) })) : undefined}
    >
      {items.length === 0 ? (
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('empty_title')}</p>
          <p className="mt-1 text-sm italic text-gray-500">{t('empty_body')}</p>
        </div>
      ) : (
        <>
          <ol className="grid gap-4 lg:grid-cols-3">
            {items.map((item, i) => (
              <li key={i} className="rounded-lg border border-gray-100 p-4 dark:border-gray-800">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-800 text-xs font-bold text-white"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{item.title}</p>
                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{item.why}</p>
                    <p className={`mt-2 flex gap-1.5 text-xs ${DIM}`}>
                      <BarChart3 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{item.evidence}</span>
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {rec?.model && <p className={`mt-3 text-[11px] ${DIM}`}>{t('model', { model: rec.model })}</p>}
        </>
      )}
    </SocialCard>
  )
}

function useRankingItems(rows: RankingRow[]) {
  const t = useTranslations('Pages.Social')
  const of = (dimension: RankingRow['dimension']) => rows.filter((r) => r.dimension === dimension)
  const item = (r: RankingRow, label: React.ReactNode, text: string): RankedItem => ({
    key: `${r.dimension}:${r.bucket ?? 'null'}`,
    label,
    text,
    posts: r.posts,
    rate: r.rate,
  })

  const format = of('format').map((r) => {
    const word = t(`format.${formatBucketKey(r.bucket)}`)
    return item(r, word, word)
  })
  const theme = of('theme').map((r) => {
    const raw = String(r.bucket)
    const k = r.bucket === null ? null : themeKey(r.bucket)
    if (k === null) return item(r, <RawValue value={raw} />, raw)
    const word = t(`theme.${k}`)
    return item(r, word, word)
  })
  const weekday = of('weekday').map((r) => {
    const n = r.bucket === null ? NaN : Number(r.bucket)
    if (!(n >= 1 && n <= 7)) return item(r, <RawValue value={String(r.bucket)} />, String(r.bucket))
    const word = fmtWeekday(n)
    return item(r, word, word)
  })
  const slot = of('slot').map((r) => {
    const n = r.bucket === null ? NaN : Number(r.bucket)
    if (!(n >= 0 && n <= 7)) return item(r, <RawValue value={String(r.bucket)} />, String(r.bucket))
    const word = t('overview.ranking.hour_value', { from: n * 3, to: n * 3 + 3 })
    return item(r, word, word)
  })
  return { format, theme, weekday, slot }
}

function Rankings({ data }: { data: OverviewPayload }) {
  const t = useTranslations('Pages.Social.overview.ranking')
  const { format, theme, weekday, slot } = useRankingItems(data.ranking.rows)
  const days = Math.round((Date.parse(`${data.today}T12:00:00Z`) - Date.parse(`${data.ranking.since}T12:00:00Z`)) / 86_400_000)
  return (
    <section aria-labelledby="social-ranking-title">
      <div className="mb-3">
        <h2 id="social-ranking-title" className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
          {t('title')}
        </h2>
        <p className={`mt-1 text-xs ${DIM}`}>
          {t('caption', { days })}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <RankedBarList title={t('by_format')} icon={LayoutGrid} items={format} />
        <RankedBarList title={t('by_theme')} icon={Tags} items={theme} />
        <RankedBarList title={t('by_weekday')} icon={CalendarDays} items={weekday} />
        <RankedBarList title={t('by_hour')} icon={Clock} items={slot} />
      </div>
    </section>
  )
}

export function SocialOverview({ period }: { period: SocialPeriod }) {
  const t = useTranslations('Pages.Social')
  const query = useQuery(socialQueries.overview(period))

  if (query.isError) {
    return (
      <SocialCard title={t('overview.recs.title')} icon={Sparkles}>
        <CardError onRetry={() => void query.refetch()} />
      </SocialCard>
    )
  }
  if (!query.data) {
    return (
      <div className="space-y-4">
        <SocialCard title={t('overview.recs.title')} icon={Sparkles}>
          <CardLoading />
        </SocialCard>
        <SocialCard title={t('overview.ranking.title')} icon={BarChart3}>
          <CardLoading />
        </SocialCard>
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <Recommendations data={query.data} />
      <Rankings data={query.data} />
      <FunnelStrip funnel={query.data.funnel} period={period} />
    </div>
  )
}
