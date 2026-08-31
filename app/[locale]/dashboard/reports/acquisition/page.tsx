'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { MapPin, Users, CalendarDays, Handshake, AlertTriangle, Sparkles, Globe, Smartphone } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { RankRow } from '@/components/dashboard/reports/acquisition/RankRow'
import { useAcquisition, useAcquisitionMonths } from '@/lib/hooks/use-acquisition'
import type { AcquisitionCity, AcquisitionCountry } from '@/lib/services/acquisition-service'
import { splitCities, splitCountries, rankMax, dailyAverage, hasOriginCoverage } from '@/lib/acquisition/split'
import { CHART_COLORS } from '@/lib/constants/chart-colors'

// recharts é ~314 KB do JS inicial; nada acima da dobra depende dele.
const chartLoader = () => <div className="h-full w-full animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
const AcquisitionDailyChart = dynamic(
  () => import('@/components/dashboard/reports/acquisition/AcquisitionDailyChart'),
  { ssr: false, loading: chartLoader }
)
const AcquisitionCumulativeChart = dynamic(
  () => import('@/components/dashboard/reports/acquisition/AcquisitionCumulativeChart'),
  { ssr: false, loading: chartLoader }
)

const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const monthLabel = (iso: string, locale: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })

export default function AcquisitionReportPage() {
  const t = useTranslations('Pages.Dashboard')
  const router = useRouter()
  const params = useSearchParams()

  const [month, setMonth] = useState<string>(params.get('month') || currentMonth())
  const { data: monthsRes } = useAcquisitionMonths()
  const { data: res, isLoading, isFetching } = useAcquisition(month)

  const months: string[] = monthsRes?.data?.length ? monthsRes.data : [currentMonth()]
  const acq = res?.success ? res.data : undefined
  const s = acq?.summary

  const onMonthChange = (value: string) => {
    setMonth(value)
    const next = new URLSearchParams(Array.from(params.entries()))
    next.set('month', value)
    router.replace(`?${next.toString()}`, { scroll: false })
  }

  // Cidades reais e lacunas são coisas diferentes: a tela nunca as soma.
  // A régua vive em lib/acquisition/split.ts, coberta por tests/api/acquisition-split.test.ts.
  const { real: realCities, gaps } = useMemo(() => splitCities(acq?.cities ?? []), [acq])

  const gapLabel = (c: AcquisitionCity) =>
    c.status === 'outside_boundaries'
      ? c.country
        ? t('reports.acquisition.gap_outside_with_country', { country: c.country })
        : t('reports.acquisition.gap_outside')
      : t('reports.acquisition.gap_no_origin')

  // Países seguem a mesma regra, com outros nomes de status.
  const { real: realCountries, gaps: countryGaps } = useMemo(
    () => splitCountries(acq?.countries ?? []),
    [acq]
  )

  const countryGapLabel = (c: AcquisitionCountry) =>
    c.status === 'unidentified'
      ? t('reports.acquisition.country_unidentified')
      : t('reports.acquisition.gap_no_origin')

  const platformLabel = (p: string) =>
    p === 'ios' ? 'iOS' : p === 'android' ? 'Android' : t('reports.acquisition.platform_unknown')

  const maxCity = rankMax(realCities)
  const maxCountry = rankMax(realCountries)
  const maxPlatform = rankMax(acq?.platforms ?? [])
  const maxPartner = rankMax(acq?.partners ?? [])
  const maxCluster = rankMax(acq?.clusters ?? [])
  const coverage = hasOriginCoverage(month)

  return (
    <div className="p-6 lg:p-8 space-y-6 min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* cabeçalho + filtro de mês */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
            <MapPin className="mr-3 h-8 w-8 text-tuggi-purple" />
            {t('reports.acquisition.title')}
          </h1>
          <p className="text-gray-500">{t('reports.acquisition.subtitle')}</p>
        </div>

        <label className="flex items-center gap-2">
          <span className="sr-only">{t('reports.acquisition.month')}</span>
          <select
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-semibold text-gray-900 dark:text-white"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, 'pt-BR')}
              </option>
            ))}
          </select>
          {isFetching && !isLoading && (
            <span className="text-[11px] uppercase tracking-widest text-gray-400">{t('reports.acquisition.updating')}</span>
          )}
        </label>
      </div>

      {/* aviso de cobertura — antes de maio/2026 a origem não existe */}
      {!coverage && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-amber-900 dark:text-amber-200">{t('reports.acquisition.no_coverage')}</p>
        </div>
      )}

      <StatCardRow columns={4}>
        <StatCard icon={Users} label={t('reports.acquisition.stat_total')} value={s?.total ?? 0} isLoading={isLoading}
          subtitle={s ? t('reports.acquisition.stat_total_sub', { avg: dailyAverage(s).toFixed(1) }) : undefined}
          color={CHART_COLORS.blue} />
        <StatCard icon={MapPin} label={t('reports.acquisition.stat_located')} value={s?.located ?? 0} isLoading={isLoading}
          subtitle={s ? t('reports.acquisition.stat_located_sub', { cities: s.distinctCities, countries: s.distinctCountries }) : undefined}
          color={CHART_COLORS.green} />
        <StatCard icon={Handshake} label={t('reports.acquisition.stat_partner')} value={s?.withPartner ?? 0} isLoading={isLoading}
          subtitle={s && s.total > 0 ? `${Math.round((s.withPartner / s.total) * 100)}%` : undefined}
          color={CHART_COLORS.orange} />
        <StatCard icon={Sparkles} label={t('reports.acquisition.stat_clusters')} value={s?.inClusters ?? 0} isLoading={isLoading}
          subtitle={t('reports.acquisition.stat_clusters_sub')}
          color={CHART_COLORS.purple} />
      </StatCardRow>

      {/* quando: dia a dia + acumulado, eixos separados */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <WidgetCard>
          <SectionHeader title={t('reports.acquisition.by_day')} icon={CalendarDays} />
          <div className="h-72">
            {acq && (
              <AcquisitionDailyChart
                data={acq.daily}
                colorPartner={CHART_COLORS.green}
                colorRest={CHART_COLORS.blue}
                labels={{ withPartner: t('reports.acquisition.with_partner'), withoutPartner: t('reports.acquisition.without_partner') }}
              />
            )}
          </div>
        </WidgetCard>

        <WidgetCard>
          <SectionHeader title={t('reports.acquisition.cumulative')} icon={CalendarDays} />
          <div className="h-72">
            {acq && (
              <AcquisitionCumulativeChart data={acq.daily} color={CHART_COLORS.orange} label={t('reports.acquisition.cumulative')} />
            )}
          </div>
        </WidgetCard>
      </div>

      {/* onde + quem trouxe */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <WidgetCard>
          <SectionHeader title={t('reports.acquisition.by_city')} icon={MapPin} />
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {realCities.slice(0, 12).map((c) => (
              <RankRow key={`${c.city}-${c.country}`} label={c.city} sub={c.country} value={c.total}
                partOf={c.withPartner} max={maxCity} color={CHART_COLORS.blue} partColor={CHART_COLORS.green} />
            ))}
            {realCities.length === 0 && (
              <div className="text-center py-10 opacity-30 text-[10px] font-black uppercase tracking-widest">
                {t('reports.acquisition.empty')}
              </div>
            )}
          </div>

          {gaps.length > 0 && (
            <div className="mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-gray-800">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                {t('reports.acquisition.gaps')}
              </p>
              {gaps.map((c, i) => (
                <RankRow key={`gap-${i}`} label={gapLabel(c)} value={c.total} max={maxCity} color={CHART_COLORS.blue} muted />
              ))}
            </div>
          )}
        </WidgetCard>

        <WidgetCard>
          <SectionHeader title={t('reports.acquisition.by_partner')} icon={Handshake} />
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {(acq?.partners ?? []).map((p) => (
              <RankRow key={p.partnerId} label={p.name || p.partnerId} value={p.total} max={maxPartner} color={CHART_COLORS.green} />
            ))}
            {(acq?.partners.length ?? 0) === 0 && (
              <div className="text-center py-10 opacity-30 text-[10px] font-black uppercase tracking-widest">
                {t('reports.acquisition.empty')}
              </div>
            )}
          </div>
        </WidgetCard>
      </div>

      {/* países + sistema operacional */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <WidgetCard>
          <SectionHeader title={t('reports.acquisition.by_country')} icon={Globe} />
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {realCountries.map((c) => (
              <RankRow
                key={c.country}
                label={c.country}
                sub={`iOS ${c.ios} · Android ${c.android}`}
                value={c.total}
                partOf={c.withPartner}
                max={maxCountry}
                color={CHART_COLORS.blue}
                partColor={CHART_COLORS.green}
              />
            ))}
            {realCountries.length === 0 && (
              <div className="text-center py-10 opacity-30 text-[10px] font-black uppercase tracking-widest">
                {t('reports.acquisition.empty')}
              </div>
            )}
          </div>

          {countryGaps.length > 0 && (
            <div className="mt-3 pt-3 border-t border-dashed border-gray-200 dark:border-gray-800">
              {countryGaps.map((c, i) => (
                <RankRow key={`cgap-${i}`} label={countryGapLabel(c)} value={c.total} max={maxCountry} color={CHART_COLORS.blue} muted />
              ))}
              <p className="text-[11px] text-gray-400 mt-1">{t('reports.acquisition.country_hint')}</p>
            </div>
          )}
        </WidgetCard>

        <WidgetCard>
          <SectionHeader title={t('reports.acquisition.by_platform')} icon={Smartphone} />
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {(acq?.platforms ?? []).map((p) => (
              <RankRow
                key={p.platform || 'unknown'}
                label={platformLabel(p.platform)}
                value={p.total}
                partOf={p.withPartner}
                max={maxPlatform}
                color={CHART_COLORS.purple}
                partColor={CHART_COLORS.green}
                muted={!p.platform}
                right={
                  s && s.total > 0 ? (
                    <span className="text-[11px] text-gray-400 tabular-nums">
                      {Math.round((p.total / s.total) * 100)}%
                    </span>
                  ) : undefined
                }
              />
            ))}
            {(acq?.platforms.length ?? 0) === 0 && (
              <div className="text-center py-10 opacity-30 text-[10px] font-black uppercase tracking-widest">
                {t('reports.acquisition.empty')}
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-3">{t('reports.acquisition.platform_hint')}</p>
        </WidgetCard>
      </div>

      {/* clusters */}
      <WidgetCard>
        <SectionHeader title={t('reports.acquisition.clusters')} icon={Sparkles} />
        <p className="text-xs text-gray-400 -mt-1 mb-2">{t('reports.acquisition.clusters_hint')}</p>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {(acq?.clusters ?? []).map((c, i) => (
            <RankRow
              key={i}
              label={c.label || t('reports.acquisition.cluster_unlabeled')}
              sub={
                c.coordinateSuppressed
                  ? t('reports.acquisition.coordinate_hidden')
                  : c.lat != null
                    ? `${c.lat.toFixed(4)}, ${c.lng?.toFixed(4)}`
                    : undefined
              }
              value={c.total}
              partOf={c.withPartner}
              max={maxCluster}
              color={CHART_COLORS.purple}
              partColor={CHART_COLORS.green}
              muted={!c.label}
              right={
                c.labelSource === 'event_trigger_point' ? (
                  <span className="text-[10px] font-mono uppercase tracking-wider rounded border border-emerald-500 text-emerald-600 dark:text-emerald-400 px-1.5">
                    {t('reports.acquisition.badge_event')}
                  </span>
                ) : undefined
              }
            />
          ))}
          {(acq?.clusters.length ?? 0) === 0 && (
            <div className="text-center py-10 opacity-30 text-[10px] font-black uppercase tracking-widest">
              {t('reports.acquisition.empty')}
            </div>
          )}
        </div>
      </WidgetCard>

      {/* rodapé: como o número é apurado */}
      {s && (
        <p className="text-xs text-gray-400 max-w-3xl">
          {t('reports.acquisition.footnote', {
            within1h: s.originWithin1h,
            located: s.located,
            outside: s.outsideBoundaries,
            missing: s.withoutOrigin,
          })}
        </p>
      )}
    </div>
  )
}
