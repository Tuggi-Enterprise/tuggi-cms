'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import {
  Activity, Globe, Smartphone, Download, Zap, Route, Headphones, Eye, Navigation, Users, Gauge,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { dashboardService, DashboardStats, EMPTY_DASHBOARD_STATS } from '@/lib/services/dashboard-service'
import { StatCard } from '@/components/ui/StatCard'

// recharts out of the initial JS: a single donut on this report needs it. See the same
// pattern on the dashboard page.
const PlatformPieChart = dynamic(
  () => import('@/components/dashboard/reports/PlatformPieChart').then(m => m.PlatformPieChart),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800/60" /> }
)

const TUGGI_COLORS = { blue: '#00A8E8', orange: '#FF6F00', green: '#10B981', purple: '#8B5CF6', red: '#EF4444' }

export default function EngagementReportPage() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_DASHBOARD_STATS)
  const [isLoading, setIsLoading] = useState(true)
  const t = useTranslations('Pages.Dashboard')

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      const result = await dashboardService.getDashboardData()
      if (result.success && result.data) setStats(result.data)
      setIsLoading(false)
    }
    fetchData()
  }, [])

  // Device access real (consolida tripsByPlatform em iOS/Android)
  const platformData = (() => {
    const consolidated = stats.tripsByPlatform.reduce((acc, curr) => {
      const platform = curr.platform.toLowerCase().includes('ios') ? 'iOS' : 'Android'
      const existing = acc.find(p => p.name === platform)
      if (existing) existing.value += curr.count
      else acc.push({ name: platform, value: curr.count, color: platform === 'iOS' ? TUGGI_COLORS.blue : TUGGI_COLORS.green })
      return acc
    }, [] as { name: string; value: number; color: string }[])
    return consolidated.length > 0 ? consolidated : [{ name: 'iOS', value: 0, color: TUGGI_COLORS.blue }, { name: 'Android', value: 0, color: TUGGI_COLORS.green }]
  })()

  // Razões de engajamento — TODAS com bases consistentes (all-time / all-time).
  const trips = stats.totalTrips || 0
  const visits = stats.totalPOIVisits || 0
  const users = stats.totalUsers || 0
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
  const ratio = (a: number, b: number) => (b > 0 ? (a / b).toFixed(1) : '0')

  const audioPlaythrough = pct(stats.totalAudioPlays, visits)        // % das visitas com áudio tocado
  const poisPerTrip = ratio(visits, trips)                            // profundidade: POIs ouvidas por viagem
  const kmPerTrip = ratio(stats.totalKmDriven, trips)                 // distância média por viagem
  const visitsPerUser = ratio(visits, users)                         // consumo médio por usuário (base total)

  return (
    <div className="cms-width p-6 lg:p-8 space-y-6 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
            <Activity className="mr-3 h-8 w-8 text-tuggi-blue" />
            {t('reports.engagement.title')}
          </h1>
          <p className="text-gray-500">{t('reports.engagement.subtitle')}</p>
        </div>
        <button className="flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <Download className="w-4 h-4 mr-2" />
          {t('kpi.export') || 'Export'}
        </button>
      </div>

      {/* Volume de uso (totais) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard size="compact" icon={Zap} title={t('labels.active_30d')} value={stats.activeUsers30d} color={TUGGI_COLORS.green} isLoading={isLoading} />
        <StatCard size="compact" icon={Route} title={t('kpi.total_trips')} value={stats.totalTrips} color={TUGGI_COLORS.orange} isLoading={isLoading} />
        <StatCard size="compact" icon={Eye} title={t('kpi.poi_visits')} value={stats.totalPOIVisits} color={TUGGI_COLORS.blue} isLoading={isLoading} />
        <StatCard size="compact" icon={Headphones} title={t('kpi.audio_plays')} value={stats.totalAudioPlays} color={TUGGI_COLORS.purple} isLoading={isLoading} />
        <StatCard size="compact" icon={Navigation} title={t('labels.km_driven')} value={Math.round(stats.totalKmDriven)} color={TUGGI_COLORS.blue} isLoading={isLoading} />
      </div>

      {/* Qualidade do engajamento (razões coerentes) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard size="compact" icon={Headphones} title={t('labels.audio_playthrough')} value={`${audioPlaythrough}%`} subtitle={`${stats.totalAudioPlays.toLocaleString()} / ${visits.toLocaleString()}`} color={TUGGI_COLORS.green} isLoading={isLoading} />
        <StatCard size="compact" icon={Activity} title={t('labels.pois_per_trip')} value={poisPerTrip} color={TUGGI_COLORS.blue} isLoading={isLoading} />
        <StatCard size="compact" icon={Gauge} title={t('labels.km_per_trip')} value={kmPerTrip} color={TUGGI_COLORS.orange} isLoading={isLoading} />
        <StatCard size="compact" icon={Users} title={t('labels.visits_per_user')} value={visitsPerUser} color={TUGGI_COLORS.purple} isLoading={isLoading} />
      </div>

      {/* Plataforma + Top POIs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <Smartphone className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
            {t('labels.device_access')}
          </h3>
          <div className="h-[250px] w-full">
            <PlatformPieChart data={platformData} />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <Activity className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.orange }} />
            {t('labels.top_visited_pois')}
          </h3>
          <div className="space-y-2.5 max-h-[250px] overflow-y-auto custom-scrollbar pr-1">
            {stats.topVisitedPOIs.length > 0 ? (
              Array.from(new Map(stats.topVisitedPOIs.map(item => [item.poi_id || '', item])).values()).slice(0, 8).map((poi, idx) => (
                <div key={poi.poi_id || idx} className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm shrink-0 ${idx === 0 ? 'bg-orange-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-400 border border-gray-100 dark:border-gray-700'}`}>
                    #{idx + 1}
                  </div>
                  <span className="text-sm font-bold text-gray-900 dark:text-white line-clamp-2 flex-1">{poi.poi_name}</span>
                  <div className="flex flex-col items-end shrink-0 leading-none">
                    <span className="text-sm font-black text-tuggi-blue">{poi.total_visits}</span>
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter mt-1">{t('table.visits')}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="h-full flex items-center justify-center py-10 opacity-30 text-[10px] font-black uppercase tracking-widest">{t('labels.waiting_interactions')}</div>
            )}
          </div>
        </div>
      </div>

      {/* Consumo por idioma + cidades mais visitadas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <Globe className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.purple }} />
            {t('charts.visits_by_lang')}
          </h3>
          <div className="space-y-2 max-h-[280px] overflow-y-auto custom-scrollbar pr-1">
            {stats.visitsByLanguage.length > 0 ? stats.visitsByLanguage.map((entry) => {
              const color = entry.language_code.startsWith('pt') ? TUGGI_COLORS.green : entry.language_code.startsWith('en') ? TUGGI_COLORS.blue : entry.language_code.startsWith('es') ? TUGGI_COLORS.orange : entry.language_code.startsWith('it') ? TUGGI_COLORS.red : TUGGI_COLORS.purple
              return (
                <div key={entry.language_code} className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-800/40 rounded-xl">
                  <span className="flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-300 uppercase">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                    {entry.language_code}
                  </span>
                  <div className="flex items-center gap-4 text-right">
                    <div className="leading-none">
                      <span className="text-sm font-black text-gray-900 dark:text-white">{entry.visit_count}</span>
                      <span className="text-[9px] text-gray-400 ml-1 uppercase">{t('table.visits')}</span>
                    </div>
                    <div className="leading-none border-l border-gray-100 dark:border-gray-800 pl-3">
                      <span className="text-sm font-black text-gray-900 dark:text-white">{entry.audio_played_count}</span>
                      <span className="text-[9px] text-gray-400 ml-1 uppercase">{t('labels.audios')}</span>
                    </div>
                  </div>
                </div>
              )
            }) : (<div className="text-center py-10 opacity-30 text-[10px] font-black uppercase tracking-widest">{t('labels.waiting_interactions')}</div>)}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <Navigation className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
            {t('charts.top_cities_visited')}
          </h3>
          <div className="space-y-3 max-h-[280px] overflow-y-auto custom-scrollbar pr-1">
            {stats.mostVisitedCities.length > 0 ? stats.mostVisitedCities.map((city, index) => (
              <div key={`${city.city}-${index}`} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full shrink-0 ${index < 3 ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' : 'text-gray-400 bg-gray-50 dark:bg-gray-800'}`}>{index + 1}</span>
                    <span className="font-bold text-gray-900 dark:text-white text-sm truncate">{city.city}</span>
                    <span className="text-[10px] text-gray-400 shrink-0">{city.country}</span>
                  </div>
                  <span className="text-sm font-bold shrink-0" style={{ color: TUGGI_COLORS.blue }}>{city.visit_count}</span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${Math.min(100, (city.visit_count / (stats.mostVisitedCities[0]?.visit_count || 1)) * 100)}%`, background: `linear-gradient(90deg, ${TUGGI_COLORS.blue}, #60A5FA)` }} />
                </div>
              </div>
            )) : (<div className="text-center py-10 opacity-30 text-[10px] font-black uppercase tracking-widest">{t('labels.waiting_interactions')}</div>)}
          </div>
        </div>
      </div>
    </div>
  )
}
