'use client'

import { useState, useEffect } from 'react'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { 
  Activity, Clock, Globe, Smartphone, Download, Zap
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { dashboardService, DashboardStats, EMPTY_DASHBOARD_STATS } from '@/lib/services/dashboard-service'
import { StatCard } from '@/components/ui/StatCard'

const TUGGI_COLORS = {
  blue: '#00A8E8',
  orange: '#FF6F00',
  green: '#10B981',
  purple: '#8B5CF6',
  red: '#EF4444'
}

export default function EngagementReportPage() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_DASHBOARD_STATS)
  const [isLoading, setIsLoading] = useState(true)
  const t = useTranslations('Pages.Dashboard')

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      const result = await dashboardService.getDashboardData() 
      if (result.success && result.data) {
        setStats(result.data)
      }
      setIsLoading(false)
    }
    fetchData()
  }, [])

  const platformData = [
    { name: 'iOS', value: 65, color: '#007AFF' }, // Placeholder logic until backend updates
    { name: 'Android', value: 35, color: '#3DDC84' }
  ]

  return (
    <div className="p-6 lg:p-8 space-y-8 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex justify-between items-center mb-6">
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard icon={Clock} title={t('kpi.avg_duration')} value={stats.avgTripDuration} color={TUGGI_COLORS.purple} isLoading={isLoading} />
        <StatCard icon={Zap} title={t('kpi.total_trips')} value={stats.totalTrips} color={TUGGI_COLORS.orange} isLoading={isLoading} />
        <StatCard icon={Activity} title={t('kpi.engagement_score')} value="8.5" color={TUGGI_COLORS.blue} isLoading={isLoading} />
        <StatCard icon={Smartphone} title={t('table.platform')} value={stats.totalPOIVisits + stats.totalTrips} color={TUGGI_COLORS.green} isLoading={isLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Platform Breakdown */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <Smartphone className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.blue }} />
            {t('charts.community')}
          </h3>
           <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
               <PieChart margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <Pie 
                  data={platformData} 
                  cx="50%" 
                  cy="50%" 
                  innerRadius={60} 
                  outerRadius={80} 
                  paddingAngle={5} 
                  dataKey="value"
                >
                  {platformData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend layout="vertical" verticalAlign="middle" align="right" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
