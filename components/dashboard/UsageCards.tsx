'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { CalendarDays, Clock, TrendingUp, type LucideIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { ReportTabs } from '@/components/dashboard/ReportTabs'
import { MONTH_BARS_PX, drawnLegend, type MonthBarsRow, type MonthBarsSeries } from '@/components/dashboard/reports/engagement/question-charts'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { monthHeader, monthLong, monthShort } from '@/lib/format/month'
import { cn } from '@/lib/utils'
import {
  DAILY_PX,
  HOURLY_PX,
  MONTHLY_KEYS,
  MONTHLY_SERIES,
  USAGE_DAYS,
  busiestHour,
  compactGrowth,
  dailyPoints,
  fetchMonthlyReturningUsers,
  fetchUsageByHour,
  firstMonthShown,
  hourlyHasData,
  lastClosedPoint,
  monthlyHasData,
  monthlyPoints,
  monthlyRows,
  peakHour,
  type MonthlyReturningUsers,
  type UsageByHour,
  type UsageDays,
} from '@/lib/dashboard/usage'

/**
 * The usage cards of the dashboard Overview (#1204, spec-cms-dashboard-uso-2026-11): monthly use split
 * into first month and returning (A), the compact total base beside it (B), and use by hour and by day
 * (C). A and C have their own routes, outside the page's `fetchData`, so a failure takes down only its
 * own card, never the page (spec §5). Words from docs/design/copy/cms-dashboard-uso-2026-11.md.
 */

const SKELETON = 'animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800/60'

const MonthBars = dynamic(() => import('@/components/dashboard/reports/engagement/MonthBars').then((m) => m.MonthBars), {
  ssr: false,
  loading: () => <div className={SKELETON} style={{ height: MONTH_BARS_PX }} />,
})

const UsageByHourChart = dynamic(() => import('@/components/dashboard/UsageByHourChart').then((m) => m.UsageByHourChart), {
  ssr: false,
  loading: () => <div className={SKELETON} style={{ height: HOURLY_PX + DAILY_PX }} />,
})

const UserGrowthChart = dynamic(() => import('@/components/dashboard/UserGrowthChart').then((m) => m.UserGrowthChart), {
  ssr: false,
  loading: () => <div className={cn('h-full w-full', SKELETON)} />,
})

type Load<T> = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; data: T }

function CardEmpty({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center opacity-30 text-center" data-testid="usage-empty">
      <Icon className="h-10 w-10 mb-2" aria-hidden="true" />
      <p className="text-[10px] font-black uppercase">{text}</p>
    </div>
  )
}

function CardFailure({ text, retry, onRetry }: { text: string; retry: string; onRetry: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center" data-testid="usage-failed">
      <p className="text-xs text-gray-600 dark:text-gray-400">{text}</p>
      <button
        type="button"
        onClick={onRetry}
        className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs font-bold text-primary-800 dark:text-tuggi-blue"
      >
        {retry}
      </button>
    </div>
  )
}

function Legend({ children }: { children: ReactNode }) {
  return <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] leading-4 text-gray-500 dark:text-gray-400">{children}</ul>
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
}

// ---------------------------------------------------------------------------
// A. Monthly use
// ---------------------------------------------------------------------------

export function MonthlyUsageCard({ months, className }: { months: string[]; className?: string }) {
  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale()
  const [load, setLoad] = useState<Load<MonthlyReturningUsers>>({ status: 'loading' })

  // Bumped by "Try again": the effect refetches only this card's call.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    fetchMonthlyReturningUsers().then((res) => {
      if (alive) setLoad(res.data ? { status: 'ready', data: res.data } : { status: 'failed' })
    })
    return () => {
      alive = false
    }
  }, [attempt])

  const title = t('labels.monthly_usage_title')
  const number = new Intl.NumberFormat(locale)
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })

  const points = useMemo(() => (load.status === 'ready' ? monthlyPoints(load.data, months) : []), [load, months])
  const rows = useMemo(
    () =>
      monthlyRows(points, {
        label: (m) => monthHeader(m, locale),
        short: (m) => monthShort(m, locale),
        unmeasured: t('labels.monthly_usage_unmeasured'),
      }),
    [points, locale, t]
  )
  const seriesLabel = {
    [MONTHLY_KEYS.returning]: t('labels.monthly_usage_returning'),
    [MONTHLY_KEYS.first]: t('labels.monthly_usage_first'),
    [MONTHLY_KEYS.unsplit]: t('labels.monthly_usage_total'),
  }
  const series: MonthBarsSeries[] = MONTHLY_SERIES.map((s) => ({ key: s.key, color: s.color, label: seriesLabel[s.key] }))

  const share = (pct: number | null) => t('labels.monthly_usage_returning_share', { pct: pct === null ? UNKNOWN_VALUE : percent.format(pct / 100) })
  const since =
    load.status === 'ready' && load.data.first_ping_at && firstMonthShown(points)
      ? t('labels.monthly_usage_since', {
          date: new Date(load.data.first_ping_at).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }),
        })
      : null

  const tooltip = (row: MonthBarsRow) => {
    const p = points.find((x) => x.month === row.month)
    const head = monthLong(row.month, locale)
    const titleLine = row.partial ? `${head} · ${t('labels.monthly_usage_partial')}` : head
    if (!p || p.state === 'unmeasured') return { title: titleLine, lines: [`${UNKNOWN_VALUE} ${row.reason ?? ''}`.trim()] }
    if (p.state === 'first') {
      return { title: titleLine, lines: [`${t('labels.monthly_usage_total')}: ≥ ${number.format(p.active)}`, ...(since ? [since] : [])] }
    }
    return {
      title: titleLine,
      lines: [
        `${t('labels.monthly_usage_first')}: ${number.format(p.first)}`,
        `${t('labels.monthly_usage_returning')}: ${number.format(p.returning)}`,
        `${t('labels.monthly_usage_total')}: ${number.format(p.active)}`,
        share(p.sharePct),
      ],
    }
  }

  const closed = lastClosedPoint(points)
  const summary = closed
    ? `${title}. ${monthLong(closed.month, locale)}: ${t('labels.monthly_usage_total')} ${closed.state === 'first' ? '≥ ' : ''}${number.format(closed.active)}${closed.state === 'split' ? `, ${share(closed.sharePct)}` : ''}`
    : title

  return (
    <WidgetCard className={cn('h-[320px] lg:h-[300px]', className)}>
      <div data-testid="usage-monthly" className="contents">
        <SectionHeader title={title} icon={CalendarDays} iconColor={CHART_COLORS.blue} hint={t('labels.monthly_usage_hint')} />
        {load.status === 'loading' ? (
          <div className={SKELETON} style={{ height: MONTH_BARS_PX }} data-testid="usage-loading" />
        ) : load.status === 'failed' ? (
          <CardFailure text={t('labels.monthly_usage_failed')} retry={t('retry')} onRetry={() => {
              setLoad({ status: 'loading' })
              setAttempt((n) => n + 1)
            }} />
        ) : !monthlyHasData(points) ? (
          <CardEmpty icon={CalendarDays} text={t('labels.monthly_usage_empty')} />
        ) : (
          <>
            <MonthBars
              label={summary}
              rows={rows}
              series={series}
              mode="stack"
              format={(v) => number.format(v)}
              axis={(v) => number.format(v)}
              tooltip={tooltip}
              // The first measured month is a floor (spec §2, DS-COMPONENTE-084): its total reads "≥ N".
              values={(v, row) => (typeof row.values[MONTHLY_KEYS.unsplit] === 'number' ? `≥ ${number.format(v)}` : number.format(v))}
            />
            <Legend>
              {drawnLegend(series, rows).map((s) => (
                <li key={s.key} className="flex items-center gap-1.5" title={s.key === MONTHLY_KEYS.unsplit && since ? since : undefined}>
                  <Dot color={s.color} />
                  {s.label}
                </li>
              ))}
            </Legend>
          </>
        )}
      </div>
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// B. Total base, compact
// ---------------------------------------------------------------------------

export function TotalBaseCard({
  userGrowth,
  months,
  isLoading,
  className,
}: {
  userGrowth: Array<{ month: string; count: number }>
  months: string[]
  isLoading: boolean
  className?: string
}) {
  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale()
  const title = t('labels.total_base')
  const data = useMemo(() => compactGrowth(userGrowth, months), [userGrowth, months])
  const last = data.length > 0 ? data[data.length - 1] : null

  return (
    <WidgetCard className={cn('h-[220px] lg:h-[300px]', className)}>
      <SectionHeader
        title={title}
        icon={TrendingUp}
        iconColor={CHART_COLORS.blue}
        href="/dashboard/reports/users"
        linkLabel={t('labels.view_details')}
        hint={t('labels.total_base_hint')}
        className="flex-wrap gap-x-3 gap-y-1"
      />
      {isLoading ? (
        <div className={cn('flex-1 min-h-0', SKELETON)} data-testid="usage-loading" />
      ) : userGrowth.length === 0 ? (
        <CardEmpty icon={TrendingUp} text={t('labels.total_base_empty')} />
      ) : (
        <div
          className="flex-1 min-h-0"
          role="img"
          aria-label={last ? `${title}: ${new Intl.NumberFormat(locale).format(last.count)}` : title}
          data-testid="usage-total-base"
        >
          <UserGrowthChart
            data={data}
            monthShort={(m) => monthShort(m, locale)}
            monthLabel={(m) => monthLong(m, locale)}
            seriesLabel={t('labels.total_base_series')}
            locale={locale}
          />
        </div>
      )}
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// C. Use by hour and by day
// ---------------------------------------------------------------------------

export function UsageByHourCard({ className }: { className?: string }) {
  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale()
  const [days, setDays] = useState<UsageDays>(USAGE_DAYS[0])
  const [data, setData] = useState<UsageByHour | null>(null)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState(true)
  const [attempt, setAttempt] = useState(0)

  // One request per period switch or retry. The cleanup drops the answer to a request that is no
  // longer the latest: switching twice fast must not paint the first period.
  useEffect(() => {
    let alive = true
    fetchUsageByHour(days).then((res) => {
      if (!alive) return
      setPending(false)
      if (res.data) {
        setData(res.data)
        setFailed(false)
      } else {
        setFailed(true)
      }
    })
    return () => {
      alive = false
    }
  }, [days, attempt])

  const onPeriod = (key: string) => {
    const d = Number(key) as UsageDays
    if (d === days) return
    setPending(true)
    setDays(d)
  }

  const title = t('labels.hourly_usage_title')
  const tick = (hour: number) => t('labels.hourly_usage_hour_tick', { hour })
  const hours = data?.by_hour ?? []
  const peak = peakHour(hours)
  const busiest = busiestHour(hours)
  const shownDays = data?.days ?? days
  const summary = [
    `${title}, ${shownDays === 30 ? t('labels.hourly_usage_range_30d') : t('labels.hourly_usage_range_7d')}`,
    busiest ? `${t('labels.hourly_usage_avg')}: ${tick(busiest.hour)}` : null,
    peak ? `${t('labels.hourly_usage_peak')}: ${tick(peak.hour)}` : null,
    t('labels.hourly_usage_timezone'),
  ]
    .filter(Boolean)
    .join('. ')

  return (
    <WidgetCard className={cn('h-[404px] lg:h-[380px]', className)}>
      <div data-testid="usage-hourly" className="contents">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <SectionHeader title={title} icon={Clock} iconColor={CHART_COLORS.orange} className="mb-0" />
          <div role="group" aria-label={t('labels.hourly_usage_range')}>
            <ReportTabs
              tabs={[
                { key: '7', label: t('labels.hourly_usage_range_7d') },
                { key: '30', label: t('labels.hourly_usage_range_30d') },
              ]}
              active={String(days)}
              onChange={onPeriod}
            />
          </div>
        </div>
        {failed ? (
          <CardFailure text={t('labels.hourly_usage_failed')} retry={t('retry')} onRetry={() => {
              setFailed(false)
              setData(null)
              setPending(true)
              setAttempt((n) => n + 1)
            }} />
        ) : !data ? (
          <div className={SKELETON} style={{ height: HOURLY_PX + DAILY_PX }} data-testid="usage-loading" />
        ) : !hourlyHasData(data) ? (
          <CardEmpty icon={Clock} text={t('labels.hourly_usage_empty', { days: data.days })} />
        ) : (
          <div className={cn('transition-opacity', pending && 'opacity-60')} aria-busy={pending}>
            <div role="img" aria-label={summary} data-testid="usage-hourly-chart">
              <UsageByHourChart
                hours={hours}
                days={dailyPoints(data)}
                locale={locale}
                labels={{
                  hourTick: tick,
                  hourRange: (hour) => t('labels.hourly_usage_hour_range', { from: hour, to: hour + 1 }),
                  peak: t('labels.hourly_usage_peak'),
                  avg: t('labels.hourly_usage_avg'),
                  dayPeople: t('labels.hourly_usage_day_people'),
                  peakTime: t('labels.hourly_usage_peak_time'),
                  noPeak: t('labels.hourly_usage_no_peak'),
                  soFar: t('labels.hourly_usage_so_far'),
                }}
                middle={
                  <>
                    <Legend>
                      <li className="flex items-center gap-1.5" title={t('labels.hourly_usage_avg_hint')}>
                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: CHART_COLORS.blue }} />
                        {t('labels.hourly_usage_avg')}
                      </li>
                      <li className="flex items-center gap-1.5" title={t('labels.hourly_usage_peak_hint')}>
                        <span aria-hidden="true" className="relative flex h-2.5 w-4 shrink-0 items-center">
                          <span className="h-0.5 w-4" style={{ backgroundColor: CHART_COLORS.orange }} />
                          <span className="absolute left-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: CHART_COLORS.orange }} />
                        </span>
                        {t('labels.hourly_usage_peak')}
                      </li>
                      <li data-testid="usage-timezone">{t('labels.hourly_usage_timezone')}</li>
                    </Legend>
                    <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-gray-500">{t('labels.hourly_usage_by_day')}</p>
                  </>
                }
              />
            </div>
          </div>
        )}
      </div>
    </WidgetCard>
  )
}
