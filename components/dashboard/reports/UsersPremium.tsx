'use client'

import { useState, useEffect, useMemo } from 'react'
import { Crown, Search, Clock, ArrowUpDown, Users, TrendingUp, TrendingDown, Apple, Smartphone, CreditCard } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { dashboardService, AppUserDetailed, SubscriptionStats } from '@/lib/services/dashboard-service'
import { StatCard } from '@/components/ui/StatCard'
import { MeteredBalances } from '@/components/dashboard/reports/MeteredBalances'
import { appUserInitial } from '@/lib/format/user-identity'
import { AppUserLink } from '@/components/dashboard/AppUserLink'

const TUGGI_COLORS = { blue: '#00A8E8', purple: '#8B5CF6', orange: '#FF6F00', green: '#10B981', red: '#EF4444' }

/**
 * Subscription by term — the half of paid access that still expires on a date.
 *
 * The subscriber is identified by `nickname`, falling back to the first 8 characters of the
 * `user_id` — **BR-USUARIO-042**. The search still matches name and e-mail (item 3:
 * filtering is not showing) over the payload the old RPC keeps returning; it just never
 * prints what matched. Since #659 the nickname opens the file (`AppUserLink`) — this table
 * had no way into it at all.
 */
export function UsersPremium() {
  const [users, setUsers] = useState<AppUserDetailed[]>([])
  const [subStats, setSubStats] = useState<SubscriptionStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale()

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      const [usersRes, statsRes] = await Promise.all([
        dashboardService.getAppUsersDetailed(200),
        dashboardService.getSubscriptionStats(),
      ])
      if (usersRes.success && usersRes.data) setUsers(usersRes.data.filter(u => u.is_premium))
      if (statsRes.success && statsRes.data) setSubStats(statsRes.data)
      setIsLoading(false)
    }
    load()
  }, [])

  const providerData = subStats ? [
    { name: 'Apple', value: subStats.apple_subscriptions, icon: Apple, color: '#1A1A1A' },
    { name: 'Google', value: subStats.google_subscriptions, icon: Smartphone, color: TUGGI_COLORS.green },
    { name: 'Stripe', value: subStats.stripe_subscriptions, icon: CreditCard, color: TUGGI_COLORS.purple },
  ] : []

  const filteredUsers = useMemo(() => {
    return users.filter(u =>
      u.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.subscription_tier_display_name?.toLowerCase().includes(searchTerm.toLowerCase())
    ).sort((a, b) => new Date(a.subscription_end_date || 0).getTime() - new Date(b.subscription_end_date || 0).getTime())
  }, [users, searchTerm])

  return (
    <div className="space-y-6">
      {/* Paid access in the hour model. Most of the paying base does not expire on a date
          any more — it holds a balance — so this comes first: it is where the operator acts. */}
      <MeteredBalances />

      {/* Subscription by term: the other half of paid access, the one that still expires. */}
      <h2 className="text-sm font-black uppercase tracking-widest text-gray-400 border-t border-gray-200 dark:border-gray-800 pt-8">
        {t('labels.subscriber_management')}
      </h2>
      {/* KPIs de assinatura */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard size="compact" icon={Crown} title={t('reports.premium.title')} value={subStats?.premium_users ?? 0} color={TUGGI_COLORS.orange} isLoading={isLoading} />
        <StatCard size="compact" icon={Users} title={t('labels.premium') + ' %'} value={`${subStats?.premium_percentage ?? 0}%`} color={TUGGI_COLORS.blue} isLoading={isLoading} />
        <StatCard size="compact" icon={TrendingUp} title={t('labels.new_subscriptions_7d')} value={subStats?.new_subscriptions_7d ?? 0} color={TUGGI_COLORS.green} isLoading={isLoading} />
        <StatCard size="compact" icon={TrendingDown} title={t('labels.churned_7d')} value={subStats?.churned_7d ?? 0} color={TUGGI_COLORS.red} isLoading={isLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Provider */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-5 flex items-center">
            <CreditCard className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.purple }} />
            {t('labels.subscription_provider')}
          </h3>
          <div className="space-y-4">
            {providerData.map((p) => {
              const total = providerData.reduce((acc, x) => acc + x.value, 0) || 1
              const ratio = (p.value / total) * 100
              return (
                <div key={p.name} className="space-y-1.5">
                  <div className="flex justify-between items-center text-xs font-black">
                    <span className="flex items-center gap-1.5 uppercase tracking-tight text-gray-900 dark:text-gray-100">
                      <p.icon className="h-3.5 w-3.5" style={{ color: p.color }} />
                      {p.name}
                    </span>
                    <span style={{ color: p.color }}>{p.value.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 w-full bg-gray-50 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${ratio}%`, backgroundColor: p.color }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Tiers */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-5 flex items-center">
            <Crown className="h-5 w-5 mr-2" style={{ color: TUGGI_COLORS.orange }} />
            {t('labels.tiers_breakdown')}
          </h3>
          <div className="space-y-2.5 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
            {(subStats?.tiers_breakdown || []).filter(tier => tier.count > 0).sort((a, b) => b.count - a.count).map((tier) => (
              <div key={tier.tier_id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl">
                <span className="text-sm font-bold text-gray-900 dark:text-white capitalize">{tier.tier_name}</span>
                <span className="text-sm font-black text-tuggi-orange">{tier.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Busca */}
      <div className="relative md:w-72">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input type="text" placeholder={t('labels.search_user')} className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 outline-none shadow-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-2xl shadow-black/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('table.user')}</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('labels.tier')}</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('labels.start')}</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  <div className="flex items-center">{t('labels.expiration')}<ArrowUpDown size={12} className="ml-2" /></div>
                </th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">{t('labels.status')}</th>
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
                <tr><td colSpan={5} className="p-20 text-center text-gray-400 font-medium italic">—</td></tr>
              ) : filteredUsers.map((user) => {
                const diffDays = Math.ceil((new Date(user.subscription_end_date || 0).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                const isExpiringSoon = diffDays <= 7
                const isExpired = diffDays <= 0
                return (
                  <tr key={user.user_id} className="group hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="p-6">
                      <div className="flex items-center">
                        <div className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold mr-4 shadow-lg overflow-hidden shrink-0" style={{ background: `linear-gradient(135deg, ${TUGGI_COLORS.blue}, ${TUGGI_COLORS.purple})` }}>
                          {appUserInitial(user)}
                        </div>
                        <div className="min-w-0">
                          <AppUserLink
                            user={user}
                            className="block font-bold text-gray-900 dark:text-white truncate max-w-full"
                          />
                        </div>
                      </div>
                    </td>
                    <td className="p-6">
                      <span className="px-3 py-1.5 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 rounded-xl text-[10px] font-bold uppercase tracking-wider border border-orange-100 dark:border-orange-900/50 flex items-center w-fit shadow-sm">
                        <Crown size={12} className="mr-1.5" />{user.subscription_tier_display_name}
                      </span>
                    </td>
                    <td className="p-6 text-sm text-gray-500 font-medium">{new Date(user.subscription_start_date || 0).toLocaleDateString(locale)}</td>
                    <td className="p-6">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Clock size={12} className={isExpiringSoon ? 'text-red-500' : 'text-gray-400'} />
                          <span className={`text-sm font-bold ${isExpiringSoon ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>{new Date(user.subscription_end_date || 0).toLocaleDateString(locale)}</span>
                        </div>
                        <span className={`text-[10px] font-medium italic pl-5 ${isExpired ? 'text-red-600 font-bold' : isExpiringSoon ? 'text-red-400' : 'text-gray-400'}`}>
                          {isExpired ? t('labels.expired') : `${diffDays} ${t('labels.days_remaining')}`}
                        </span>
                      </div>
                    </td>
                    <td className="p-6 text-right">
                      <div className={`inline-flex items-center px-3 py-1 rounded-xl text-[9px] font-bold uppercase tracking-widest ${isExpired ? 'bg-gray-100 text-gray-400' : 'bg-green-50 text-green-600 border border-green-100'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full mr-2 ${isExpired ? 'bg-gray-400' : 'bg-green-500 animate-pulse'}`} />
                        {isExpired ? t('labels.inactive') : t('labels.active')}
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

export default UsersPremium
