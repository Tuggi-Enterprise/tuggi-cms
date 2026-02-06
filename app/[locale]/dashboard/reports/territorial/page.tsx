'use client'

import { useState, useEffect } from 'react'
import { 
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend 
} from 'recharts'
import { 
  MapPin, Globe, Navigation, Play, Eye, Headphones, Download
} from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { dashboardService, DashboardStats } from '@/lib/services/dashboard-service'
import { StatCard } from '@/components/ui/StatCard'

const TUGGI_COLORS = {
  blue: '#00A8E8',
  orange: '#FF6F00',
  green: '#10B981',
  purple: '#8B5CF6',
  red: '#EF4444'
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

export default function TerritorialReportPage() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS)
  const [isLoading, setIsLoading] = useState(true)
  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale()

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      const result = await dashboardService.getDashboardData() // We might want a more specific endpoint later
      if (result.success && result.data) {
        setStats(result.data)
      }
      setIsLoading(false)
    }
    fetchData()
  }, [])

  return (
    <div className="p-6 lg:p-8 space-y-8 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
            <Globe className="mr-3 h-8 w-8 text-tuggi-purple" />
            {t('reports.territorial.title')}
          </h1>
          <p className="text-gray-500">{t('reports.territorial.subtitle')}</p>
        </div>
        <button className="flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <Download className="w-4 h-4 mr-2" />
          {t('kpi.export') || 'Export'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
        {/* LEFT COLUMN (4/12) - Visits by Language & Cities */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Visits by Language */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
              <Globe className="h-5 w-5 mr-2" style={{ color: '#8B5CF6' }} />
              {t('charts.visits_by_lang')}
            </h3>
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.visitsByLanguage}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="visit_count"
                    nameKey="language_code"
                  >
                    {stats.visitsByLanguage.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={
                          entry.language_code.startsWith('pt') ? '#10B981' : 
                          entry.language_code.startsWith('en') ? '#00A8E8' : 
                          entry.language_code.startsWith('es') ? '#FF6F00' : 
                          entry.language_code.startsWith('it') ? '#EF4444' : 
                          '#8B5CF6'
                        } 
                        strokeWidth={0}
                      />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(26, 26, 26, 0.95)', 
                      border: 'none', 
                      borderRadius: '12px',
                      color: 'white',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                    }}
                    itemStyle={{ color: 'white' }}
                    formatter={(value: any) => [`${value} ${t('labels.visitors').toLowerCase()}`, '']}
                  />
                  <Legend layout="vertical" verticalAlign="middle" align="right" />
                </PieChart>
              </ResponsiveContainer>
            </div>
            
            <div className="mt-2 space-y-2">
              {stats.visitsByLanguage.map((entry) => (
                <div key={entry.language_code} className="flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg transition-colors cursor-default">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-2 h-2 rounded-full" 
                      style={{ 
                        backgroundColor: 
                          entry.language_code.startsWith('pt') ? '#10B981' : 
                          entry.language_code.startsWith('en') ? '#00A8E8' : 
                          entry.language_code.startsWith('es') ? '#FF6F00' : 
                          entry.language_code.startsWith('it') ? '#EF4444' : 
                          '#8B5CF6'
                      }}
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 uppercase">{entry.language_code}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-sm font-bold block text-gray-900 dark:text-gray-100">{entry.visit_count}</span>
                      <span className="text-[10px] text-gray-400 capitalize">{t('table.visits')}</span>
                    </div>
                    <div className="text-right border-l border-gray-100 dark:border-gray-800 pl-3">
                      <span className="text-sm font-bold block text-gray-900 dark:text-gray-100">{entry.audio_played_count}</span>
                      <span className="text-[10px] text-gray-400 capitalize">{t('labels.audios')}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Most Visited Cities */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 flex-1">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center">
              <Navigation className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
              {t('charts.top_cities_visited')}
            </h3>
            <div className="space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
              {stats.mostVisitedCities.length > 0 ? (
                stats.mostVisitedCities.map((city, index) => (
                  <div key={`${city.city}-${index}`} className="group hover:bg-gray-50 dark:hover:bg-gray-800/30 p-2 rounded-xl transition-all -mx-2">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className={`
                          text-xs font-black w-6 h-6 flex items-center justify-center rounded-full
                          ${index < 3 ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400' : 'text-gray-400 bg-gray-50 dark:bg-gray-800'}
                        `}>
                          {index + 1}
                        </span>
                        <div>
                          <span className="font-bold text-gray-900 dark:text-white block text-sm">{city.city}</span>
                          <span className="text-[10px] text-gray-400">{city.country}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-black block" style={{ color: TUGGI_COLORS.blue }}>{city.visit_count}</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className="h-full rounded-full transition-all duration-1000"
                        style={{ 
                          width: `${Math.min(100, (city.visit_count / (stats.mostVisitedCities[0]?.visit_count || 1)) * 100)}%`,
                          background: `linear-gradient(90deg, ${TUGGI_COLORS.blue}, #60A5FA)`
                        }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                 <div className="text-center py-8 text-gray-500">Loading...</div>
              )}
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN (8/12) - Detailed Lists (Top POIs) */}
        <div className="lg:col-span-8">
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 h-full">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center">
              <Play className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.orange }} />
              {t('charts.top_pois_visited')}
            </h3>
            
            <div className="space-y-4 max-h-[800px] overflow-y-auto custom-scrollbar pr-2">
              {stats.topVisitedPOIs.length > 0 ? (
                stats.topVisitedPOIs.map((poi, index) => (
                  <div key={poi.poi_id} className="group flex items-start p-4 bg-gray-50 dark:bg-gray-800/30 rounded-2xl border border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:bg-white dark:hover:bg-gray-800 hover:shadow-sm transition-all duration-200">
                    
                    {/* Ranking Badge */}
                    <div className={`
                      flex-shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center mr-4 shadow-sm
                      ${index === 0 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 
                        index === 1 ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300' : 
                        index === 2 ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' : 
                        'bg-white text-gray-500 border border-gray-100 dark:bg-gray-800 dark:border-gray-700'}
                    `}>
                      <span className="text-lg font-black">{index + 1}</span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 pt-1">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="font-bold text-gray-900 dark:text-white text-base truncate pr-4 group-hover:text-tuggi-blue transition-colors">
                            {poi.poi_name}
                          </h4>
                          <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                            <MapPin className="w-3 h-3" />
                            <span>{poi.city}, {poi.country}</span>
                            {poi.category && (
                              <>
                                <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-700" />
                                <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700/50 text-xs font-medium">
                                  {poi.category}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        
                        {/* Metrics */}
                        <div className="flex items-center gap-6 text-right">
                          <div className="flex flex-col items-end">
                            <div className="flex items-center text-gray-900 dark:text-white font-black text-lg">
                              <Eye className="w-4 h-4 mr-1.5 text-tuggi-blue opacity-50" />
                              {poi.total_visits}
                            </div>
                            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">{t('table.visits')}</span>
                          </div>
                          
                          <div className="w-px h-8 bg-gray-200 dark:bg-gray-800" />
                          
                          <div className="flex flex-col items-end min-w-[60px]">
                            <div className="flex items-center text-gray-900 dark:text-white font-bold text-base">
                              <Headphones className="w-3.5 h-3.5 mr-1.5 text-tuggi-orange opacity-50" />
                              {poi.audio_plays}
                            </div>
                            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">{t('labels.audios')}</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Audio Conversion Bar */}
                      <div className="mt-4 flex items-center gap-3">
                        <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-tuggi-orange rounded-full opacity-80"
                            style={{ width: `${Math.min(100, (poi.audio_plays / (poi.total_visits || 1)) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-medium text-gray-400">
                          {Math.round((poi.audio_plays / (poi.total_visits || 1)) * 100)}% conv.
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-20">
                  <div className="w-16 h-16 bg-gray-50 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Play className="h-6 w-6 text-gray-400" />
                  </div>
                  <p className="text-gray-500 font-medium">{t('empty_visits')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
