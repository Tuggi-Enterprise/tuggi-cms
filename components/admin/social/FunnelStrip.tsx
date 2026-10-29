'use client'

/**
 * The daily funnel (spec 2.3): five small multiples on the same axis of days, read top to bottom in
 * the order the funnel walks (posts, profile views, bio link taps, Instagram sessions on the site,
 * installs). One axis per measure, never two on one chart. Six months become weeks (Monday to
 * Sunday): 180 bars do not read in 1000 px.
 *
 * A strip whose data is all null in the period (GA4 without credentials, a metric Meta stopped
 * answering) prints the "no data" word and no bars: never a row of zeros (DS-COMPONENTE-084). A strip
 * measured on part of the period prints its total with "in N of M days", a floor and not a total,
 * and no change: the change prints only when both periods are fully measured (`changeRatio`).
 * Posts come from the whole media history, so their periods are always fully measured.
 */

import dynamic from 'next/dynamic'
import { TrendingDown, TrendingUp, Workflow } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { DIM } from '@/components/ui/dense-table'
import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { fmtDay, fmtInt, fmtLongDay, fmtSignedRate } from '@/lib/social/format'
import { changeRatio, coverageOf, type Coverage } from '@/lib/social/funnel'
import type { FormatKey } from '@/lib/social/labels'
import type { FunnelDay, FunnelMeasured, FunnelSeries, FunnelTotals, OverviewPayload } from '@/lib/social/repository'
import { SOCIAL_PERIODS, addDays, mondayOf, type SocialPeriod } from '@/lib/social/time'
import { STRIP_AXIS_PX, STRIP_PLOT_PX, type FunnelBarDatum } from './FunnelBars'
import { SocialCard } from './shared'

const chartLoader = () => <div className="h-full w-full animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
const FunnelBars = dynamic(() => import('./FunnelBars'), { ssr: false, loading: chartLoader })

/** GA4 processes up to 48 h late (GA4 Help, "Data processing latency"): its last two days can change. */
const GA4_UNSETTLED_DAYS = 2

type StripKey = 'posts' | 'profile_views' | 'website_clicks' | 'site_sessions' | 'installs'

interface Bucket {
  x: string
  days: FunnelDay[]
}

/** Days, or weeks from Monday when the period is six months. */
export function bucketize(days: FunnelDay[], period: SocialPeriod): Bucket[] {
  if (period !== '6m') return days.map((d) => ({ x: d.day, days: [d] }))
  const weeks = new Map<string, FunnelDay[]>()
  for (const d of days) {
    const w = mondayOf(d.day)
    weeks.set(w, [...(weeks.get(w) ?? []), d])
  }
  return [...weeks].map(([x, list]) => ({ x, days: list }))
}

function sum(days: FunnelDay[], key: FunnelSeries): number | null {
  let total: number | null = null
  for (const d of days) if (d[key] !== null) total = (total ?? 0) + (d[key] as number)
  return total
}

function Change({ ratio }: { ratio: number | null }) {
  if (ratio === null) return null
  if (Math.abs(ratio) < 0.0005) return <span className={`text-xs ${DIM}`}>{fmtSignedRate(0)}</span>
  const up = ratio > 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${up ? 'text-green-700' : 'text-red-700'}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {fmtSignedRate(ratio)}
    </span>
  )
}

export function FunnelStrip({ funnel, period }: { funnel: OverviewPayload['funnel']; period: SocialPeriod }) {
  const t = useTranslations('Pages.Social')
  const tf = useTranslations('Pages.Social.overview.funnel')
  const buckets = bucketize(funnel.days, period)
  const unsettled = new Set(Array.from({ length: GA4_UNSETTLED_DAYS }, (_, i) => addDays(funnel.to, -i)))
  const weekly = period === '6m'

  const datum = (b: Bucket, a: number | null, opts: { b?: number | null; ga4?: boolean; detail?: string[] } = {}): FunnelBarDatum => ({
    x: b.x,
    tick: weekly ? fmtDay(b.x).slice(0, 5) : String(Number(b.x.slice(8, 10))),
    title: weekly ? fmtDay(b.x) : fmtLongDay(b.x),
    a,
    b: opts.b,
    muted: !!opts.ga4 && b.days.some((d) => unsettled.has(d.day)),
    detail: opts.detail,
  })
  const formatWord = (k: FormatKey) => t(`format.${k}`)

  const strips: Array<{
    key: StripKey
    label: string
    hint?: string
    total: number | null
    previous: number | null
    data: FunnelBarDatum[]
    stacked?: boolean
    /** The series whose measured days decide the coverage; posts have none (always measured). */
    measured?: keyof FunnelMeasured
  }> = [
    {
      key: 'posts',
      label: tf('posts'),
      total: funnel.totals.posts,
      previous: funnel.previous.posts,
      data: buckets.map((b) => {
        const posts = b.days.flatMap((d) => d.posts)
        return datum(b, posts.length, { detail: posts.map((p) => `${formatWord(p.format)}: ${p.caption ?? UNKNOWN_VALUE}`) })
      }),
    },
    {
      key: 'profile_views',
      measured: 'profile_views',
      label: tf('profile_views'),
      hint: tf('profile_views_hint'),
      total: funnel.totals.profile_views,
      previous: funnel.previous.profile_views,
      data: buckets.map((b) => datum(b, sum(b.days, 'profile_views'))),
    },
    {
      key: 'website_clicks',
      measured: 'website_clicks',
      label: tf('website_clicks'),
      hint: tf('website_clicks_hint'),
      total: funnel.totals.website_clicks,
      previous: funnel.previous.website_clicks,
      data: buckets.map((b) => datum(b, sum(b.days, 'website_clicks'))),
    },
    {
      key: 'site_sessions',
      measured: 'ig_site_sessions',
      label: tf('site_sessions'),
      hint: tf('site_sessions_hint'),
      total: funnel.totals.ig_site_sessions,
      previous: funnel.previous.ig_site_sessions,
      data: buckets.map((b) => datum(b, sum(b.days, 'ig_site_sessions'), { ga4: true })),
    },
    {
      key: 'installs',
      measured: 'installs',
      label: `${tf('installs_ios')} + ${tf('installs_android')}`,
      hint: tf('installs_hint'),
      total: combine(funnel.totals),
      previous: combine(funnel.previous),
      stacked: true,
      data: buckets.map((b) => datum(b, sum(b.days, 'installs_ios'), { b: sum(b.days, 'installs_android'), ga4: true })),
    },
  ]

  const span = funnel.days.length
  const coverage = (m: StripCoverageKey | undefined, which: 'now' | 'before'): Coverage => {
    if (!m) return 'full'
    const measured = which === 'now' ? funnel.measured?.[m] : funnel.previous_measured?.[m]
    return coverageOf(measured ?? 0, span)
  }
  const anyMuted = strips.some((s) => s.data.some((d) => d.muted && ((d.a ?? 0) > 0 || (d.b ?? 0) > 0)))

  return (
    <SocialCard title={tf('title')} icon={Workflow} note={tf('caption', { days: SOCIAL_PERIODS[period] })}>
      <p className={`mb-3 text-xs ${DIM}`}>{tf('note')}</p>
      <div className="overflow-x-auto">
        <div className="min-w-[36rem] divide-y divide-gray-100 dark:divide-gray-800">
          {strips.map((s, i) => {
            const last = i === strips.length - 1
            const now = coverage(s.measured, 'now')
            const ratio = changeRatio(s.total, s.previous, { now, before: coverage(s.measured, 'before') })
            const plot = STRIP_PLOT_PX + (last ? STRIP_AXIS_PX : 0)
            return (
              <div key={s.key} data-strip={s.key} className="grid grid-cols-[12rem_1fr] items-start gap-3 py-2">
                <div title={s.hint}>
                  <p className="text-sm text-gray-800 dark:text-gray-200">{s.label}</p>
                  <p className="flex items-baseline gap-2">
                    <span className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                      {s.total === null ? UNKNOWN_VALUE : fmtInt(s.total)}
                    </span>
                    <Change ratio={ratio} />
                  </p>
                  {s.total !== null && now === 'partial' && s.measured && (
                    <p className={`text-[11px] ${DIM}`}>{tf('coverage', { measured: funnel.measured[s.measured], days: span })}</p>
                  )}
                </div>
                <div style={{ height: plot }}>
                  {s.total === null ? (
                    <p className={`flex h-full items-center text-sm ${DIM}`}>{tf('no_data')}</p>
                  ) : (
                    <FunnelBars
                      data={s.data}
                      colorA={CHART_COLORS.blue}
                      labelA={s.stacked ? tf('installs_ios') : s.label}
                      colorB={s.stacked ? CHART_COLORS.orange : undefined}
                      labelB={s.stacked ? tf('installs_android') : undefined}
                      showAxis={last}
                      mutedNote={tf('latency_hint')}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <ul className={`mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-[12.75rem] text-[11px] ${DIM}`}>
          <LegendItem color={CHART_COLORS.blue} label={tf('installs_ios')} />
          <LegendItem color={CHART_COLORS.orange} label={tf('installs_android')} />
          {anyMuted && <LegendItem color={CHART_NEUTRAL} label={tf('legend_muted')} />}
        </ul>
      </div>
    </SocialCard>
  )
}

type StripCoverageKey = keyof FunnelMeasured

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" />
      {label}
    </li>
  )
}

function combine(t: FunnelTotals): number | null {
  if (t.installs_ios === null && t.installs_android === null) return null
  return (t.installs_ios ?? 0) + (t.installs_android ?? 0)
}
