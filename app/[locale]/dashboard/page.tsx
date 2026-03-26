'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LabelList
} from 'recharts'
import { 
  MapPin, CheckCircle, TrendingUp, AlertCircle, RefreshCw, 
  Database, Zap, Clock, Play, Eye, Headphones, Users
} from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl';
import { StatCard } from '@/components/ui/StatCard'
import { dashboardService, DashboardStats } from '@/lib/services/dashboard-service'
import { RecentVisitCard } from '@/components/dashboard/RecentVisitCard'

// ============================================================================
// CORES TUGGI BRAND
// ============================================================================

const TUGGI_COLORS = {
  blue: '#00A8E8',
  orange: '#FF6F00',
  green: '#10B981',
  purple: '#8B5CF6',
  red: '#EF4444',
  background: '#F7F9FA',
  text: '#1A1A1A',
  border: '#D9D9D9'
}

const FUNNEL_COLORS = {
  approved: TUGGI_COLORS.green,
  pending: TUGGI_COLORS.orange, 
  homolog: TUGGI_COLORS.purple
}

const EMPTY_STATS: DashboardStats = {
  totalPOIs: 0,
  approvedPOIs: 0,
  pendingPOIs: 0,
  homologPOIs: 0,
  totalInventory: 0,
  approvalRate: 0,
  languagesBreakdown: [],
  withAudio: 0,
  contentCoverage: 0,
  citiesCovered: 0,
  totalUsers: 0,
  activeUsers30d: 0,
  totalTrips: 0,
  totalKmDriven: 0,
  totalPOIVisits: 0,
  totalAudioPlays: 0,
  avgTripDuration: '0 min',
  tripsByPlatform: [],
  mauHistory: [],
  userGrowth: [],
  cityDistribution: [],
  mostVisitedCities: [],
  topVisitedPOIs: [],
  recentVisitedPOIs: [],
  visitsByLanguage: [],
  lastUpdated: new Date(),
  source: 'database'
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const t = useTranslations('Pages.Dashboard');
  const locale = useLocale();

  // Fetch dashboard data
  const fetchData = useCallback(async () => {
    try {
      setError(null)
      setIsLoading(true)
      
      const result = await dashboardService.getDashboardData()
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to load dashboard')
      }
      
      setStats(result.data)
      console.log('✅ Dashboard loaded:', result.data)
    } catch (err) {
      console.error('Dashboard error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial load + refresh interval
  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Prepare chart data
  const funnelData = [
    { name: t('kpi.approved_pois'), value: stats.approvedPOIs, color: FUNNEL_COLORS.approved },
    { name: t('kpi.pending'), value: stats.pendingPOIs, color: FUNNEL_COLORS.pending },
    { name: t('kpi.total_homolog'), value: stats.homologPOIs, color: FUNNEL_COLORS.homolog }
  ]

  // Error State
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-8 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('error')}</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">{error}</p>
          <button
            onClick={fetchData}
            className="px-6 py-3 bg-tuggi-blue text-white rounded-xl font-bold hover:bg-blue-600 transition-colors"
          >
            <RefreshCw className="h-4 w-4 inline mr-2" />
            {t('retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 lg:p-8 flex flex-col">
      {/* ================================================================ */}
      {/* OVERVIEW */}
      {/* ================================================================ */}
      <div className="space-y-8 animate-in fade-in duration-500">
        {/* KPI Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard icon={Database} title={t('kpi.total_inventory')} value={stats.totalInventory} subtitle={`${stats.totalPOIs} core + ${stats.homologPOIs} homolog`} color={TUGGI_COLORS.blue} isLoading={isLoading} />
          <StatCard icon={CheckCircle} title={t('kpi.approved_pois')} value={stats.approvedPOIs} subtitle={`${stats.approvalRate}% ${t('labels.approval_rate')}`} color={TUGGI_COLORS.green} isLoading={isLoading} />
          <StatCard icon={Users} title={t('kpi.active_users')} value={stats.activeUsers30d} subtitle={`${t('labels.of_total').replace('{count}', stats.totalUsers.toString())}`} color={TUGGI_COLORS.purple} isLoading={isLoading} />
          <StatCard icon={Zap} title={t('kpi.total_trips')} value={stats.totalTrips} subtitle={`${stats.totalKmDriven.toLocaleString()} ${t('labels.km_driven')}`} color={TUGGI_COLORS.orange} isLoading={isLoading} />
        </div>

        {/* Row: MAU + Funnel + Recent Visits (Grid 3) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* User Growth Chart */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
              <TrendingUp className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
              {t('charts.user_growth')}
            </h3>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.userGrowth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                    formatter={(value: any) => [`${value} usuários`, 'Total']}
                  />
                  <Bar dataKey="count" fill={TUGGI_COLORS.blue} radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="count" position="top" style={{ fill: '#9ca3af', fontSize: 10, fontWeight: 'bold' }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Inventory Funnel */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
              <Database className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
              {t('charts.funnel')}
            </h3>
            <div className="h-[160px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={funnelData} innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                    {funnelData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {funnelData.map((item) => (
                <div key={item.name} className="text-center">
                  <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ backgroundColor: item.color }} />
                  <p className="text-[9px] font-bold text-gray-500 uppercase">{item.name}</p>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{item.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Visits */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
              <Play className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.orange }} />
              {t('charts.recent_visits')}
            </h3>
            <div className="space-y-2 max-h-[280px] overflow-y-auto custom-scrollbar">
              {stats.recentVisitedPOIs.length > 0 ? (
                stats.recentVisitedPOIs.slice(0, 5).map((visit) => (
                  <RecentVisitCard key={visit.visit_id} visit={visit} locale={locale} />
                ))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Eye className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>{t('empty_visits')}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row: Engagement Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <StatCard icon={Eye} title={t('kpi.poi_visits')} value={stats.totalPOIVisits} color={TUGGI_COLORS.blue} />
          <StatCard icon={Headphones} title={t('kpi.audio_plays')} value={stats.totalAudioPlays} color={TUGGI_COLORS.green} />
          <StatCard icon={Clock} title={t('kpi.avg_duration')} value={stats.avgTripDuration} color={TUGGI_COLORS.purple} />
          <StatCard icon={MapPin} title={t('kpi.cities_covered')} value={stats.mostVisitedCities.length} color={TUGGI_COLORS.orange} />
        </div>
      </div>

      {/* ================================================================ */}
      {/* FOOTER */}
      {/* ================================================================ */}
      <footer className="mt-auto pt-10 pb-4 flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] text-gray-400 uppercase tracking-widest font-bold border-t border-gray-100 dark:border-gray-800">
        <div>
          {t('footer.copyright')}
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center px-3 py-1.5 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse mr-2" />
            <span className="text-gray-500 dark:text-gray-400">
              {stats.source === 'cache' ? t('cached') : t('live')}
            </span>
          </div>
          
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="flex items-center px-3 py-1.5 bg-tuggi-blue/5 border border-tuggi-blue/20 text-tuggi-blue rounded-lg transition-all disabled:opacity-50 hover:bg-tuggi-blue/10 hover:border-tuggi-blue/40"
          >
            <RefreshCw className={`h-3 w-3 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            {t('sync')}
          </button>
        </div>
      </footer>
    </div>
  )
}