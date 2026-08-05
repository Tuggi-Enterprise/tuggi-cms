'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import {
  Database, CheckCircle, Clock, Layers, Volume2, FileText, Globe, Flag, Users,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { StatCard } from '@/components/ui/StatCard'
import { dashboardService, ContentQuality, DashboardStats } from '@/lib/services/dashboard-service'

// recharts out of the initial JS: a single widget on this report needs it. See the same
// pattern on the dashboard page.
const MigrationSpeedChart = dynamic(
  () => import('@/components/dashboard/reports/MigrationSpeedChart').then(m => m.MigrationSpeedChart),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800/60" /> }
)

const TUGGI_COLORS = { blue: '#00A8E8', orange: '#FF6F00', green: '#10B981', purple: '#8B5CF6', red: '#EF4444' }

type Funnel = { coreApproved: number; corePending: number; homologRaw: number; totalInventory: number }

const getLangName = (code: string) => {
  const c = code.toLowerCase()
  const map: Record<string, string> = {
    'pt-br': 'Português (BR)', 'pt-pt': 'Português (PT)', 'pt': 'Português',
    'en-us': 'English (US)', 'en-gb': 'English (UK)', 'en': 'English',
    'es-es': 'Español (ES)', 'es': 'Español', 'it': 'Italiano', 'fr': 'Français', 'de': 'Deutsch',
  }
  return map[c] || code.toUpperCase()
}

export default function CatalogReportPage() {
  const t = useTranslations('Pages.Dashboard')
  const [funnel, setFunnel] = useState<Funnel | null>(null)
  const [content, setContent] = useState<ContentQuality | null>(null)
  const [migration, setMigration] = useState<DashboardStats['migrationMetrics'] | null>(null)
  const [countries, setCountries] = useState<Array<{ country: string; poi_count: number; city_count: number; approved_count: number }>>([])
  const [generators, setGenerators] = useState<Array<{ user_id: string; nickname: string; content_count: number }>>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      // Tudo via MV/RPCs rápidas — SEM o getInventoryDetails pesado (que dava timeout).
      const [fn, cq, mig, ctry, gen] = await Promise.all([
        dashboardService.getInventoryFunnel(),
        dashboardService.getContentQuality(),
        dashboardService.getMigrationMetrics(),
        dashboardService.getCountryStats(),
        dashboardService.getTopGenerators(10),
      ])
      if (fn.success && fn.data) setFunnel(fn.data)
      if (cq.success && cq.data) setContent(cq.data)
      if (mig.success && mig.data) setMigration(mig.data)
      if (ctry.success && ctry.data) setCountries(ctry.data)
      if (gen.success && gen.data) setGenerators(gen.data)
      setIsLoading(false)
    }
    load()
  }, [])

  const migration2026 = (migration?.monthly || []).filter(i => i.month.startsWith('2026')).sort((a, b) => a.month.localeCompare(b.month))
  const languagesBreakdown = content?.languagesBreakdown || []

  return (
    <div className="p-4 lg:p-6 space-y-4 min-h-screen bg-[#F0F2F5] dark:bg-gray-950">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
          <Database className="mr-3 h-8 w-8 text-tuggi-blue" />
          {t('reports.catalog.title')}
        </h1>
        <p className="text-gray-500">{t('reports.catalog.subtitle')}</p>
      </div>

      {/* KPI row (6) — volume + qualidade */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard size="compact" icon={Database} title={t('labels.catalog')} value={funnel?.totalInventory ?? 0} color={TUGGI_COLORS.blue} isLoading={isLoading} />
        <StatCard size="compact" icon={CheckCircle} title={t('kpi.approved_pois')} value={funnel?.coreApproved ?? 0} color={TUGGI_COLORS.green} isLoading={isLoading} />
        <StatCard size="compact" icon={Clock} title={t('kpi.pending')} value={funnel?.corePending ?? 0} color={TUGGI_COLORS.orange} isLoading={isLoading} />
        <StatCard size="compact" icon={Layers} title={t('kpi.total_homolog')} value={funnel?.homologRaw ?? 0} color={TUGGI_COLORS.purple} isLoading={isLoading} />
        <StatCard size="compact" icon={Volume2} title={t('kpi.with_audio')} value={content?.totalWithAudio ?? 0} color={TUGGI_COLORS.blue} isLoading={isLoading} />
        <StatCard size="compact" icon={FileText} title={t('kpi.optimized')} value={`${content?.coveragePercentage ?? 0}%`} color={TUGGI_COLORS.green} isLoading={isLoading} />
      </div>

      {/* Linha 1: Países · Idiomas · Lacunas de conteúdo (3 colunas) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top Countries */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm flex flex-col h-[360px]">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
            <Flag className="h-4 w-4 text-tuggi-green" /> {t('labels.country_footprint')}
          </h3>
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-2.5">
            {countries.length > 0 ? countries.slice(0, 12).map((c, index) => (
              <div key={c.country} className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-bold text-gray-400 w-4">{index + 1}</span>
                  <Globe className="h-3.5 w-3.5 text-tuggi-blue opacity-50 shrink-0" />
                  <span className="font-medium text-gray-900 dark:text-white uppercase tracking-tight text-sm truncate">{c.country}</span>
                </div>
                <span className="text-[11px] font-black bg-tuggi-green/10 text-tuggi-green border border-tuggi-green/20 px-2.5 py-0.5 rounded-full shrink-0">{c.poi_count.toLocaleString()}</span>
              </div>
            )) : (<div className="text-center py-8 text-gray-400 text-sm">—</div>)}
          </div>
        </div>

        {/* Language Inventory */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm flex flex-col h-[360px]">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 mb-5 flex items-center gap-2">
            <Globe className="h-4 w-4 text-tuggi-blue" /> {t('labels.catalog_languages')}
          </h3>
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-4">
            {languagesBreakdown.slice(0, 7).map((lang, idx) => {
              const maxCount = languagesBreakdown[0]?.count || 1
              const ratio = (lang.count / maxCount) * 100
              return (
                <div key={idx} className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs font-black">
                    <span className="uppercase tracking-tight text-gray-900 dark:text-gray-100">{getLangName(lang.language)}</span>
                    <span className="text-tuggi-blue">{lang.count.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 w-full bg-gray-50 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-tuggi-blue rounded-full transition-all duration-1000 opacity-60" style={{ width: `${ratio}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Top Content Generators */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm flex flex-col h-[360px]">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-tuggi-blue" /> {t('labels.top_generators')}
          </h3>
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-2">
            {generators.length > 0 ? generators.map((gen, idx) => (
              <div key={gen.user_id} className="flex items-center gap-3 p-2.5 bg-gray-50 dark:bg-gray-800/40 rounded-xl">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs shrink-0 ${idx === 0 ? 'bg-tuggi-blue text-white' : 'bg-white dark:bg-gray-800 text-gray-400 border border-gray-100 dark:border-gray-700'}`}>
                  #{idx + 1}
                </div>
                <span className="text-xs font-bold text-gray-900 dark:text-white line-clamp-1 flex-1">{gen.nickname}</span>
                <span className="text-sm font-black text-tuggi-blue shrink-0">{gen.content_count}</span>
              </div>
            )) : (
              <div className="h-full flex items-center justify-center opacity-30 text-[10px] font-black uppercase tracking-widest">{t('labels.waiting_interactions')}</div>
            )}
          </div>
        </div>
      </div>

      {/* Migração (full-width) */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm flex flex-col h-[320px]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Clock className="h-4 w-4 text-tuggi-green" /> {t('labels.migration_speed')}
          </h3>
          <span className="text-2xl font-black text-tuggi-green leading-none">
            {(() => {
              const totalVol = migration2026.reduce((acc, c) => acc + c.volume, 0)
              return totalVol > 0 ? (migration2026.reduce((acc, c) => acc + (c.avg_seconds * c.volume), 0) / totalVol).toFixed(2) : '0.00'
            })()}s
          </span>
        </div>
        <div className="flex-1 min-h-0 w-full">
          <MigrationSpeedChart data={migration2026} color={TUGGI_COLORS.green} />
        </div>
      </div>
    </div>
  )
}
