'use client'

/**
 * How the account grew (#1063, spec "Crescimento acumulado da conta", G1 to G9): three strips on
 * one axis of days, the followers at the end of each day, the day's net (follows minus unfollows,
 * Meta's `follows_and_unfollows`) and the posts of the day. The whole history, never the period.
 * Above `GROWTH_WEEKLY_FROM_DAYS` days it groups by week from Monday.
 *
 * DS-COMPONENTE-084: a day without moves prints `UNKNOWN_VALUE` with its reason and draws a gap in
 * the line and no bar, never 0; a total the walk back cannot reach prints `UNKNOWN_VALUE` with
 * `no_total_hint`; the net total over days not all measured is a floor and says "in n of m days".
 * Posts are always measured (`social.media` keeps every post), so a day without one is 0.
 */

import dynamic from 'next/dynamic'
import { TrendingUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { DIM } from '@/components/ui/dense-table'
import { CHART_COLORS, CHART_NEUTRAL } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { GROWTH_WEEKLY_FROM_DAYS, META_FUNNEL_MAX_DAYS } from '@/lib/social/constants'
import { fmtDay, fmtInt, fmtSigned } from '@/lib/social/format'
import { bucketize, type DayBucket } from '@/lib/social/funnel'
import type { AccountGrowth, GrowthDay } from '@/lib/social/repository'
import { addDays } from '@/lib/social/time'
import { STRIP_AXIS_PX } from './FunnelBars'
import { GROWTH_PLOT_PX, type GrowthBandKey, type GrowthDatum } from './GrowthCharts'
import { SocialCard } from './shared'

const chartLoader = () => <div className="h-full w-full animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
const GrowthBand = dynamic(() => import('./GrowthCharts'), { ssr: false, loading: chartLoader })

/** Meta closes the numbers in up to 48 hours (copy `growth.latency_hint`): the last two days can change. */
const META_UNSETTLED_DAYS = 2

/** A bucket's sums. Gains, losses and net are null unless every day of it was measured. */
function sums(b: DayBucket<GrowthDay>) {
  const measured = b.days.filter((d) => d.net !== null)
  const whole = measured.length === b.days.length
  const add = (k: 'follows' | 'unfollows' | 'net') => (whole ? measured.reduce((n, d) => n + (d[k] as number), 0) : null)
  const totals = b.days.map((d) => d.total).filter((v): v is number => v !== null)
  return {
    total: totals.length > 0 ? totals[totals.length - 1] : null,
    follows: add('follows'),
    unfollows: add('unfollows'),
    net: add('net'),
    missing: b.days.length - measured.length,
    posts: b.days.reduce((n, d) => n + d.posts, 0),
  }
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" />
}

export function SocialGrowth({ growth }: { growth: AccountGrowth }) {
  const t = useTranslations('Pages.Social.growth')
  const tf = useTranslations('Pages.Social.overview.funnel')
  const weekly = growth.days.length > GROWTH_WEEKLY_FROM_DAYS

  if (growth.days.length === 0) {
    return (
      <SocialCard title={t('title')} icon={TrendingUp}>
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('empty_title')}</p>
        <p className="mt-1 text-sm italic text-gray-500">{t('empty_body')}</p>
      </SocialCard>
    )
  }

  const unsettled = new Set(Array.from({ length: META_UNSETTLED_DAYS }, (_, i) => addDays(growth.to, -i)))
  const buckets = bucketize(growth.days, weekly)
  const data: GrowthDatum[] = buckets.map((b) => {
    const s = sums(b)
    const last = b.days[b.days.length - 1].day
    const notes: string[] = []
    if (s.net === null) notes.push(weekly ? t('no_moves_week_hint', { missing: s.missing }) : t('no_moves_hint'))
    if (s.total === null) notes.push(t('no_total_hint'))
    const muted = b.days.some((d) => unsettled.has(d.day))
    if (muted) notes.push(t('latency_hint'))
    return {
      x: b.x,
      tick: fmtDay(b.x).slice(0, 5),
      total: weekly ? s.total : b.days[0].total,
      gain: s.net !== null && s.net > 0 ? s.net : null,
      loss: s.net !== null && s.net < 0 ? s.net : null,
      posts: s.posts,
      muted,
      tip: {
        title: weekly ? t('week', { from: fmtDay(b.x), to: fmtDay(last) }) : fmtDay(b.x),
        rows: [
          [t('band_total'), s.total === null ? UNKNOWN_VALUE : fmtInt(s.total)],
          [
            t('tip_moves'),
            s.follows === null || s.unfollows === null ? UNKNOWN_VALUE : t('moves_value', { gained: fmtInt(s.follows), lost: fmtInt(s.unfollows) }),
          ],
          [t('tip_net'), s.net === null ? UNKNOWN_VALUE : fmtSigned(s.net)],
          ['', t('tip_posts', { count: s.posts })],
        ],
        notes,
      },
    }
  })

  const lastWithTotal = [...growth.days].reverse().find((d) => d.total !== null) ?? null
  const measuredDays = growth.days.filter((d) => d.net !== null)
  const netSum = measuredDays.reduce((n, d) => n + (d.net as number), 0)
  const gained = measuredDays.reduce((n, d) => n + (d.follows as number), 0)
  const lost = measuredDays.reduce((n, d) => n + (d.unfollows as number), 0)
  const span = growth.days.length
  const postsSum = growth.days.reduce((n, d) => n + d.posts, 0)
  const anyMuted = data.some((d) => d.muted && (d.gain !== null || d.loss !== null))
  const aria = t(weekly ? 'chart_aria_week' : 'chart_aria_day', { from: fmtDay(growth.from), to: fmtDay(growth.to) })

  // The legends ride the header's note, so the card keeps to the first fold (spec G9, 380 px).
  const note = (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      <span>{t(weekly ? 'caption_week' : 'caption')}</span>
      <span className="inline-flex items-center gap-1.5">
        <Dot color={CHART_COLORS.green} />
        <Dot color={CHART_COLORS.red} />
        {t('legend_net')}
      </span>
      {anyMuted && (
        <span className="inline-flex items-center gap-1.5">
          <Dot color={CHART_NEUTRAL} />
          {t('latency_hint')}
        </span>
      )}
    </span>
  )

  const bands: Array<{ key: GrowthBandKey; label: string; hint: string; value: string; support?: string[] }> = [
    {
      key: 'total',
      label: t('band_total'),
      hint: t('band_total_hint'),
      value: lastWithTotal ? fmtInt(lastWithTotal.total as number) : UNKNOWN_VALUE,
      support: lastWithTotal ? [fmtDay(lastWithTotal.day)] : [t('no_total_hint')],
    },
    {
      key: 'net',
      label: t(weekly ? 'band_net_week' : 'band_net'),
      hint: t('band_net_hint'),
      value: fmtSigned(netSum),
      // One line, so the left column stays inside the 64 px strip: the moves, and the floor when partial.
      support: [
        [
          t('moves_value', { gained: fmtInt(gained), lost: fmtInt(lost) }),
          ...(growth.measured.net < span ? [tf('coverage', { measured: growth.measured.net, days: span })] : []),
        ].join(' · '),
      ],
    },
    { key: 'posts', label: t(weekly ? 'band_posts_week' : 'band_posts'), hint: t('band_posts_hint'), value: fmtInt(postsSum) },
  ]

  return (
    <SocialCard title={t('title')} icon={TrendingUp} note={note}>
      <div className="overflow-x-auto">
        <div role="group" aria-label={aria} className="min-w-[36rem] divide-y divide-gray-100 dark:divide-gray-800">
          {bands.map((band, i) => {
            const last = i === bands.length - 1
            return (
              <div key={band.key} data-growth-band={band.key} className="grid grid-cols-[12rem_1fr] items-start gap-3 py-2">
                <div title={band.hint}>
                  <p className="text-sm text-gray-800 dark:text-gray-200">{band.label}</p>
                  <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{band.value}</p>
                  {band.support?.map((line) => (
                    <p key={line} className={`text-[11px] ${DIM}`}>
                      {line}
                    </p>
                  ))}
                </div>
                <div style={{ height: GROWTH_PLOT_PX[band.key] + (last ? STRIP_AXIS_PX : 0) }}>
                  <GrowthBand band={band.key} data={data} showAxis={last} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <p className={`mt-2 text-xs ${DIM}`}>{t('meta_window', { days: META_FUNNEL_MAX_DAYS, date: fmtDay(growth.from) })}</p>
    </SocialCard>
  )
}
