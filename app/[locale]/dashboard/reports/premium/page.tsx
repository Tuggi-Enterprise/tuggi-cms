'use client'

import { useState, useEffect, useMemo } from 'react'
import { Crown, Download, Search, Clock, ArrowUpDown } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { getSupabaseClient } from '@/lib/core/supabase-client'

interface PremiumUser {
  user_id: string
  full_name: string
  nickname: string
  email: string
  country: string
  subscription_tier_name: string
  subscription_tier_display_name: string
  subscription_start_date: string
  subscription_end_date: string
  is_premium: boolean
  last_sign_in_at: string
}

const TUGGI_COLORS = {
  blue: '#00A8E8',
  purple: '#8B5CF6',
  orange: '#FF6F00',
}

export default function PremiumUsersReportPage() {
  const [users, setUsers] = useState<PremiumUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale();

  useEffect(() => {
    const loadPremiumUsers = async () => {
      setIsLoading(true)
      try {
        const supabase = getSupabaseClient()
        const { data, error } = await supabase
          .schema('core')
          .rpc('dashboard_app_users_detailed', { limit_count: 200 })

        if (error) throw error
        
        // Filter for premium users only
        const premiumUsers = (data as any[]).filter(u => u.is_premium)
        setUsers(premiumUsers)
      } catch (err) {
        console.error('Error loading premium users:', err)
      } finally {
        setIsLoading(false)
      }
    }
    loadPremiumUsers()
  }, [])

  const filteredUsers = useMemo(() => {
    return users.filter(u => 
      u.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.subscription_tier_display_name?.toLowerCase().includes(searchTerm.toLowerCase())
    ).sort((a, b) => new Date(a.subscription_end_date).getTime() - new Date(b.subscription_end_date).getTime())
  }, [users, searchTerm])

  return (
    <div className="p-6 lg:p-8 space-y-8 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center tracking-tight">
            <Crown className="mr-3 h-8 w-8 text-orange-500" />
            {t('premium.title')}
          </h1>
          <p className="text-gray-500 text-sm mt-1">{t('premium.subtitle')}</p>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
             <input 
               type="text" 
               placeholder="Buscar usuário ou plano..."
               className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 transition-all outline-none shadow-sm"
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
             />
          </div>
          <button className="flex items-center px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shadow-sm">
            <Download className="w-4 h-4 mr-2" />
            {t('kpi.export')}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-2xl shadow-black/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('table.user')}</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Plano</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Início</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  <div className="flex items-center">
                    Vencimento
                    <ArrowUpDown size={12} className="ml-2" />
                  </div>
                </th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="p-6"><div className="h-10 w-40 bg-gray-100 dark:bg-gray-800 rounded-xl" /></td>
                    <td className="p-6"><div className="h-6 w-20 bg-gray-100 dark:bg-gray-800 rounded-lg" /></td>
                    <td className="p-6"><div className="h-4 w-24 bg-gray-100 dark:bg-gray-800 rounded" /></td>
                    <td className="p-6"><div className="h-4 w-24 bg-gray-100 dark:bg-gray-800 rounded" /></td>
                    <td className="p-6"><div className="h-6 w-16 bg-gray-100 dark:bg-gray-800 rounded-lg ml-auto" /></td>
                  </tr>
                ))
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-20 text-center text-gray-400 font-medium italic">
                     Nenhum usuário premium encontrado.
                  </td>
                </tr>
              ) : filteredUsers.map((user) => {
                const diffDays = Math.ceil((new Date(user.subscription_end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                const isExpiringSoon = diffDays <= 7;
                const isExpired = diffDays <= 0;

                return (
                  <tr key={user.user_id} className="group hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="p-6">
                      <div className="flex items-center">
                        <div className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold mr-4 shadow-lg overflow-hidden shrink-0" 
                             style={{ background: `linear-gradient(135deg, ${TUGGI_COLORS.blue}, ${TUGGI_COLORS.purple})` }}>
                          {user.full_name?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900 dark:text-white truncate">{user.full_name || 'Anonymous'}</p>
                          <p className="text-xs text-gray-500 truncate">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-6">
                      <span className="px-3 py-1.5 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 rounded-xl text-[10px] font-bold uppercase tracking-wider border border-orange-100 dark:border-orange-900/50 flex items-center w-fit shadow-sm">
                        <Crown size={12} className="mr-1.5" />
                        {user.subscription_tier_display_name}
                      </span>
                    </td>
                    <td className="p-6 text-sm text-gray-500 font-medium">
                      {new Date(user.subscription_start_date).toLocaleDateString(locale)}
                    </td>
                    <td className="p-6">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-0.5">
                           <Clock size={12} className={isExpiringSoon ? 'text-red-500' : 'text-gray-400'} />
                           <span className={`text-sm font-bold ${isExpiringSoon ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
                              {new Date(user.subscription_end_date).toLocaleDateString(locale)}
                           </span>
                        </div>
                        <span className={`text-[10px] font-medium italic pl-5 ${isExpired ? 'text-red-600 font-bold' : isExpiringSoon ? 'text-red-400' : 'text-gray-400'}`}>
                           {isExpired ? 'Expirado' : `${diffDays} dias restantes`}
                        </span>
                      </div>
                    </td>
                    <td className="p-6 text-right">
                       <div className={`inline-flex items-center px-3 py-1 rounded-xl text-[9px] font-bold uppercase tracking-widest ${isExpired ? 'bg-gray-100 text-gray-400' : 'bg-green-50 text-green-600 border border-green-100 Shadow-sm'}`}>
                         <div className={`w-1.5 h-1.5 rounded-full mr-2 ${isExpired ? 'bg-gray-400' : 'bg-green-500 animate-pulse'}`} />
                         {isExpired ? 'Inativo' : 'Ativo'}
                       </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
