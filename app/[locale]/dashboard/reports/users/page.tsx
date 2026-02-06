'use client'

import { useState, useEffect } from 'react'
import { Users, Download } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { dashboardService, UserWithSessions } from '@/lib/services/dashboard-service'

const TUGGI_COLORS = {
  blue: '#00A8E8',
  purple: '#8B5CF6',
}

export default function UsersReportPage() {
  const [users, setUsers] = useState<UserWithSessions[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const t = useTranslations('Pages.Dashboard')

  useEffect(() => {
    const loadUsers = async () => {
      setIsLoading(true)
      const result = await dashboardService.getUsersWithSessions(50)
      if (result.success && result.data) {
        setUsers(result.data as UserWithSessions[])
      }
      setIsLoading(false)
    }
    loadUsers()
  }, [])

  return (
    <div className="p-6 lg:p-8 space-y-8 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
            <Users className="mr-3 h-8 w-8 text-tuggi-purple" />
            {t('reports.users.title')}
          </h1>
          <p className="text-gray-500">{t('reports.users.subtitle')}</p>
        </div>
        <button className="flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <Download className="w-4 h-4 mr-2" />
          {t('kpi.download_list') || 'Download List'}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-xs font-bold text-gray-500 uppercase tracking-widest">
                <th className="p-4 text-left">{t('table.user')}</th>
                <th className="p-4 text-left">{t('table.country')}</th>
                <th className="p-4 text-left">{t('table.platform')}</th>
                <th className="p-4 text-right">{t('table.trips')}</th>
                <th className="p-4 text-right">{t('table.visits')}</th>
                <th className="p-4 text-right">{t('table.km')}</th>
                <th className="p-4 text-left">{t('table.last_active')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="p-4"><div className="h-10 w-32 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className="p-4"><div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className="p-4"><div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                    <td className="p-4"><div className="h-4 w-8 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                    <td className="p-4"><div className="h-4 w-8 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                    <td className="p-4"><div className="h-4 w-12 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                    <td className="p-4"><div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                  </tr>
                ))
              ) : users.map((user) => (
                <tr key={user.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center">
                      <div className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold mr-3" style={{ background: `linear-gradient(135deg, ${TUGGI_COLORS.blue}, ${TUGGI_COLORS.purple})` }}>
                        {user.full_name?.charAt(0) || '?'}
                      </div>
                      <div>
                        <p className="font-bold text-gray-900 dark:text-white">{user.full_name || 'Anonymous'}</p>
                        <p className="text-xs text-gray-500">@{user.nickname || 'none'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-bold text-gray-600 dark:text-gray-400 uppercase">
                      {user.country || 'Global'}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                      user.last_platform === 'ios' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 
                      user.last_platform === 'android' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 
                      'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                    }`}>
                      {user.last_platform || 'Unknown'}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <span className="font-black text-gray-900 dark:text-white">{user.trip_count || 0}</span>
                  </td>
                  <td className="p-4 text-right">
                    <span className="font-black text-tuggi-blue">{user.poi_visits_count || 0}</span>
                  </td>
                  <td className="p-4 text-right">
                    <span className="font-medium text-gray-600 dark:text-gray-400">{Math.round(user.total_km || 0)}</span>
                  </td>
                  <td className="p-4 text-sm text-gray-500">
                    {user.last_trip_at ? new Date(user.last_trip_at).toLocaleDateString() : 
                     user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
