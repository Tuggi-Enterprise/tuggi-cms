'use client'

/**
 * The overview of `/admin/social` (#1059, spec 2): the row of indicators and, right under it, how
 * the account grew over its whole history (#1063); then the answer (the week's recommendations), the
 * evidence (four rankings by interactions per reach) and the result (the daily funnel, then the same
 * period by campaign), in the order the operator asks; the audience last, because it changes weekly. The period governs rankings and funnel, never the recommendations.
 */

import { BarChart3, CalendarDays, Clock, Download, Eye, LayoutGrid, Sparkles, Tags, TrendingUp, Users, Workflow } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { DIM } from '@/components/ui/dense-table'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { MIN_POSTS } from '@/lib/social/constants'
import { fmtDay, fmtInt, fmtRate, fmtSigned, fmtWeekday } from '@/lib/social/format'
import { formatBucketKey, themeKey } from '@/lib/social/labels'
import type { OverviewPayload, RankingRow } from '@/lib/social/repository'
import { mondayOf, type SocialPeriod } from '@/lib/social/time'
import { RankedBarList, type RankedItem } from './RankedBarList'
import { FunnelStrip } from './FunnelStrip'
import { SocialCampaigns } from './SocialCampaigns'
import { SocialAudience } from './SocialAudience'
import { SocialGrowth } from './SocialGrowth'
import { CardError, CardLoading, LOADING_HEIGHT, SocialCard, socialQueries } from './shared'

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
  const item = (r: RankingRow, text: string, raw = false): RankedItem => ({
    key: `${r.dimension}:${r.bucket ?? 'null'}`,
    text,
    raw,
    posts: r.posts,
    rate: r.rate,
  })

  const format = of('format').map((r) => item(r, t(`format.${formatBucketKey(r.bucket)}`)))
  const theme = of('theme').map((r) => {
    const k = r.bucket === null ? null : themeKey(r.bucket)
    return k === null ? item(r, String(r.bucket), true) : item(r, t(`theme.${k}`))
  })
  const weekday = of('weekday').map((r) => {
    const n = r.bucket === null ? NaN : Number(r.bucket)
    return n >= 1 && n <= 7 ? item(r, fmtWeekday(n)) : item(r, String(r.bucket), true)
  })
  const slot = of('slot').map((r) => {
    const n = r.bucket === null ? NaN : Number(r.bucket)
    return n >= 0 && n <= 7
      ? item(r, t('overview.ranking.hour_value', { from: n * 3, to: n * 3 + 3 }))
      : item(r, String(r.bucket), true)
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
        <h2 id="social-ranking-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {t('title')}
        </h2>
        <p className={`mt-1 text-sm ${DIM}`}>{t('caption', { days })}</p>
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

/**
 * The row of four (#1061, R1.1): followers (not governed by the period), reach and median engagement
 * of the period's posts, installs of the funnel. A missing value prints `UNKNOWN_VALUE` with "sem
 * dado"; a partial install count says how many days it measured, never in the cell (#1051).
 */
function Indicators({ data }: { data: OverviewPayload | undefined }) {
  const t = useTranslations('Pages.Social.indicators')
  const ind = data?.indicators
  const totals = data?.funnel.totals
  const ios = totals?.installs_ios ?? null
  const android = totals?.installs_android ?? null
  const installs = ios === null && android === null ? null : (ios ?? 0) + (android ?? 0)
  const days = data?.funnel.days.length ?? 0
  const measured = data?.funnel.measured.installs ?? 0
  const split = { ios: ios === null ? UNKNOWN_VALUE : fmtInt(ios), android: android === null ? UNKNOWN_VALUE : fmtInt(android) }
  const tiles = [
    {
      key: 'followers',
      icon: Users,
      color: CHART_COLORS.blue,
      label: t('followers'),
      value: ind?.followers ?? null,
      text: (v: number) => fmtInt(v),
      subtitle:
        ind?.followers_7d_delta != null
          ? t('followers_delta', { delta: fmtSigned(ind.followers_7d_delta) })
          : ind?.followers_since
            ? t('followers_since', { date: fmtDay(ind.followers_since) })
            : t('no_data'),
    },
    {
      key: 'reach',
      icon: Eye,
      color: CHART_COLORS.green,
      label: t('reach'),
      value: ind?.reach_sum ?? null,
      text: (v: number) => fmtInt(v),
      subtitle: ind?.reach_sum != null ? t('reach_posts', { count: ind.reach_posts }) : t('no_data'),
    },
    {
      key: 'engagement',
      icon: BarChart3,
      color: CHART_COLORS.purple,
      label: t('engagement'),
      value: ind?.engagement_median ?? null,
      text: (v: number) => fmtRate(v),
      subtitle:
        ind?.engagement_median != null
          ? t('engagement_posts', { count: ind.engagement_posts })
          : t('engagement_few', { min: MIN_POSTS }),
    },
    {
      key: 'installs',
      icon: Download,
      color: CHART_COLORS.orange,
      label: t('installs'),
      value: installs,
      text: (v: number) => fmtInt(v),
      subtitle:
        installs === null
          ? t('no_data')
          : measured < days
            ? t('installs_partial', { ...split, measured, days })
            : t('installs_split', split),
    },
  ]
  return (
    <StatCardRow columns={4}>
      {tiles.map((tile) => (
        <StatCard
          key={tile.key}
          size="compact"
          icon={tile.icon}
          color={tile.color}
          label={tile.label}
          value={tile.value === null ? UNKNOWN_VALUE : tile.text(tile.value)}
          subtitle={tile.subtitle}
          isLoading={!data}
        />
      ))}
    </StatCardRow>
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
      <div className="space-y-6">
        <Indicators data={undefined} />
        <SocialCard title={t('growth.title')} icon={TrendingUp}>
          <CardLoading height={LOADING_HEIGHT.growth} />
        </SocialCard>
        <SocialCard title={t('overview.recs.title')} icon={Sparkles}>
          <CardLoading height={LOADING_HEIGHT.recs} />
        </SocialCard>
        <SocialCard title={t('overview.ranking.title')} icon={BarChart3}>
          <CardLoading height={LOADING_HEIGHT.ranking} />
        </SocialCard>
        <SocialCard title={t('overview.funnel.title')} icon={Workflow}>
          <CardLoading height={LOADING_HEIGHT.funnel} />
        </SocialCard>
      </div>
    )
  }
  return (
    <div className="space-y-6">
      <Indicators data={query.data} />
      <SocialGrowth growth={query.data.growth} />
      <Recommendations data={query.data} />
      <Rankings data={query.data} />
      <FunnelStrip funnel={query.data.funnel} period={period} />
      <SocialCampaigns data={query.data} />
      <SocialAudience data={query.data} />
    </div>
  )
}
