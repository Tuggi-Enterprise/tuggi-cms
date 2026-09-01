'use client'

import { useState, useEffect, useMemo } from 'react'
import { Users, Crown, Search, CheckCircle, Zap } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { dashboardService, AppUserDetailed } from '@/lib/services/dashboard-service'
import { StatCard } from '@/components/ui/StatCard'
import { AppUserLink } from '@/components/dashboard/AppUserLink'
import { appUserInitial } from '@/lib/format/user-identity'

const TUGGI_COLORS = { blue: '#00A8E8', purple: '#8B5CF6', orange: '#FF6F00', green: '#10B981' }

/**
 * The whole app base, one row per tourist.
 *
 * Identified by `nickname`, falling back to the first 8 characters of the `user_id` —
 * **BR-USUARIO-042**. The `nickname` used to be the subtitle under the full name; it is the
 * identifier now, and the subtitle keeps only the country. The search still matches name and
 * e-mail over the loaded array (item 3: filtering is not showing).
 *
 * The file opens from the nickname and from nothing else (#659). It used to open from an
 * `onClick` on the `<tr>` — reachable by mouse only, with no role and no focus — and the two
 * would have been two owners of the same state. `AppUserLink` is the door on all six
 * surfaces that print a tourist.
 */
export function UsersAll() {
  const [users, setUsers] = useState<AppUserDetailed[]>([])
  const [analytics, setAnalytics] = useState<{ totalUsers: number; activeUsers30d: number; totalPremiumUsers: number } | null>(null)
  const [countryOptions, setCountryOptions] = useState<string[]>([])
  const [country, setCountry] = useState('')
  const [platform, setPlatform] = useState('')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale()

  // KPIs autoritativos (total real 209, MAU 30d por login, premium) — mesma fonte da Overview.
  // Independem do limite/filtro da lista abaixo.
  useEffect(() => {
    dashboardService.getUserAnalytics().then((res) => {
      if (res.success && res.data) setAnalytics(res.data)
    })
  }, [])

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      // limite alto pra trazer toda a base (não capar a lista em 200).
      const res = await dashboardService.getAppUsersDetailed(1000, country || undefined, platform || undefined)
      if (res.success && res.data) {
        setUsers(res.data)
        if (!country && !platform) {
          const countries = Array.from(new Set(res.data.map(u => u.country).filter(Boolean))) as string[]
          setCountryOptions(countries.sort())
        }
      }
      setIsLoading(false)
    }
    load()
  }, [country, platform])

  const filtered = useMemo(() => {
    if (!search) return users
    const s = search.toLowerCase()
    return users.filter(u => u.full_name?.toLowerCase().includes(s) || u.email?.toLowerCase().includes(s) || u.nickname?.toLowerCase().includes(s))
  }, [users, search])

  // Onboarding % calculado sobre a base carregada (lista completa); total/premium/ativo vêm do analytics.
  const onboardedPct = useMemo(() => {
    if (users.length === 0) return 0
    return Math.round((users.filter(u => u.onboarding_completed).length / users.length) * 100)
  }, [users])

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard size="compact" icon={Users} title={t('labels.users')} value={analytics?.totalUsers ?? 0} color={TUGGI_COLORS.purple} isLoading={!analytics} />
        <StatCard size="compact" icon={Crown} title={t('labels.premium')} value={analytics?.totalPremiumUsers ?? 0} color={TUGGI_COLORS.orange} isLoading={!analytics} />
        <StatCard size="compact" icon={Zap} title={t('labels.active_30d')} value={analytics?.activeUsers30d ?? 0} color={TUGGI_COLORS.green} isLoading={!analytics} />
        <StatCard size="compact" icon={CheckCircle} title={t('labels.onboarding_completed')} value={`${onboardedPct}%`} color={TUGGI_COLORS.blue} isLoading={isLoading} />
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input type="text" placeholder={t('labels.search_user')} className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-sm focus:ring-2 focus:ring-tuggi-blue outline-none shadow-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-sm font-medium outline-none shadow-sm">
          <option value="">{t('labels.country')}: {t('labels.all')}</option>
          {countryOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-sm font-medium outline-none shadow-sm">
          <option value="">{t('table.platform')}: {t('labels.all')}</option>
          <option value="ios">iOS</option>
          <option value="android">Android</option>
        </select>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-xs font-bold text-gray-500 uppercase tracking-widest">
                <th className="p-4 text-left">{t('table.user')}</th>
                <th className="p-4 text-left">{t('labels.tier')}</th>
                <th className="p-4 text-left">{t('table.platform')}</th>
                <th className="p-4 text-right">{t('table.trips')}</th>
                <th className="p-4 text-right">{t('table.visits')}</th>
                <th className="p-4 text-right">{t('table.km')}</th>
                <th className="p-4 text-left">{t('table.last_active')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
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
              ) : filtered.map((user) => (
                <tr key={user.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center">
                      <div className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold mr-3 shrink-0" style={{ background: `linear-gradient(135deg, ${TUGGI_COLORS.blue}, ${TUGGI_COLORS.purple})` }}>
                        {appUserInitial(user)}
                      </div>
                      <div className="min-w-0">
                        <AppUserLink
                          user={user}
                          className="block font-bold text-gray-900 dark:text-white truncate max-w-full"
                        />
                        <p className="text-xs text-gray-500 truncate">{user.country || 'Global'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    {user.is_premium ? (
                      <span className="px-2 py-1 bg-orange-50 dark:bg-orange-900/20 text-orange-600 rounded text-[10px] font-black uppercase tracking-wider flex items-center gap-1 w-fit">
                        <Crown className="h-3 w-3" /> {user.subscription_tier_display_name || 'Premium'}
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-[10px] font-bold text-gray-500 uppercase">Free</span>
                    )}
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
                  <td className="p-4 text-right"><span className="font-bold text-gray-900 dark:text-white">{user.trip_count || 0}</span></td>
                  <td className="p-4 text-right"><span className="font-bold text-tuggi-blue">{user.poi_visits_count || 0}</span></td>
                  <td className="p-4 text-right"><span className="font-medium text-gray-600 dark:text-gray-400">{Math.round(user.total_km || 0)}</span></td>
                  <td className="p-4 text-sm text-gray-500">
                    {user.last_trip_at ? new Date(user.last_trip_at).toLocaleDateString(locale) :
                     user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString(locale) : 'Never'}
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

export default UsersAll
