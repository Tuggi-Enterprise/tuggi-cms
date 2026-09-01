'use client'

import { useEffect, useMemo, useState } from 'react'
import { CreditCard, Gift, Hourglass, Infinity as InfinityIcon, Search, Timer, Wallet } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { StatCard } from '@/components/ui/StatCard'
import { dashboardService, MeteredUser, EntitlementOverview } from '@/lib/services/dashboard-service'
import {
  BALANCE_BANDS,
  BalanceBand,
  GRANT_SOURCES,
  balanceBand,
  grantOrigin,
} from '@/lib/credit/entitlement'
import { formatDuration } from '@/lib/format/duration'
import { cn } from '@/lib/utils'

const TUGGI_COLORS = { blue: '#00A8E8', purple: '#8B5CF6', orange: '#FF6F00', green: '#10B981', red: '#EF4444' }

/** How many people the report loads. It is the route's ceiling; past it this needs paging. */
const REPORT_LIMIT = 500

const BAND_STYLE: Record<BalanceBand, string> = {
  critical: 'bg-red-50 text-red-600 border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/50',
  attention: 'bg-orange-50 text-orange-600 border-orange-100 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-900/50',
  comfortable: 'bg-green-50 text-green-600 border-green-100 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/50',
}

/**
 * Hours per person — the paid-access report in the consumption model.
 *
 * The list arrives from `core.dashboard_metered_users()` **already ordered by ascending
 * balance**: the top is whoever runs out first, and re-sorting here would only create a
 * second ruler. The band filter is local on purpose — the operator flips between the three
 * constantly, and a server round trip per click would make the tool slower without
 * bringing back a single new row.
 *
 * The state (`unlimited`/`metered`/`free`) arrives resolved from the database —
 * BR-MONETIZACAO-046. Nothing here reads `ends_at` to decide whether someone has access.
 */
export function MeteredBalances() {
  const [users, setUsers] = useState<MeteredUser[]>([])
  const [overview, setOverview] = useState<EntitlementOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [band, setBand] = useState<BalanceBand | 'all'>('all')
  const [searchTerm, setSearchTerm] = useState('')

  const t = useTranslations('Pages.Dashboard')
  const tCredit = useTranslations('Pages.AppUsers.credit')
  const locale = useLocale()

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      // No balance ceiling: the report is the whole list, and the band filters afterwards.
      const res = await dashboardService.getPaidAccess(REPORT_LIMIT, null)
      setUsers(res.data?.meteredUsers ?? [])
      setOverview(res.data?.overview ?? null)
      setIsLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return users.filter((user) => {
      if (band !== 'all' && balanceBand(user.balance_minutes) !== band) return false
      if (!term) return true
      return (
        user.full_name?.toLowerCase().includes(term) ||
        user.nickname?.toLowerCase().includes(term) ||
        user.email?.toLowerCase().includes(term)
      )
    })
  }, [users, band, searchTerm])

  const sourceLabel = (source: string | null) => {
    if (!source) return t('labels.from_grant')
    return (GRANT_SOURCES as readonly string[]).includes(source) ? tCredit(`grants.source_${source}`) : source
  }

  return (
    <div className="space-y-6">
      {/* Composition of paid access: how it holds, and where it came from */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard size="compact" icon={InfinityIcon} title={t('labels.unlimited_access')} value={overview?.unlimited_users ?? '—'} color={TUGGI_COLORS.purple} isLoading={isLoading} />
        <StatCard size="compact" icon={Hourglass} title={t('labels.metered_access')} value={overview?.metered_users ?? '—'} color={TUGGI_COLORS.orange} isLoading={isLoading} />
        <StatCard size="compact" icon={CreditCard} title={t('labels.from_purchase')} value={overview?.purchased_users ?? '—'} color={TUGGI_COLORS.blue} isLoading={isLoading} />
        <StatCard size="compact" icon={Gift} title={t('labels.from_grant')} value={overview?.granted_users ?? '—'} color={TUGGI_COLORS.green} isLoading={isLoading} />
        <StatCard size="compact" icon={Timer} title={t('labels.low_balance')} value={overview?.low_balance_users ?? '—'} color={TUGGI_COLORS.red} isLoading={isLoading} />
        <StatCard size="compact" icon={Wallet} title={t('labels.total_balance')} value={overview ? formatDuration(overview.total_balance_minutes) : '—'} color={TUGGI_COLORS.green} isLoading={isLoading} />
      </div>

      {/* Band filter + search */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', ...BALANCE_BANDS] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setBand(option)}
              aria-pressed={band === option}
              className={cn(
                'px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-colors',
                band === option
                  ? 'bg-tuggi-orange text-white border-tuggi-orange'
                  : 'bg-white dark:bg-gray-900 text-gray-500 border-gray-200 dark:border-gray-800 hover:border-tuggi-orange'
              )}
            >
              {option === 'all' ? t('labels.all_bands') : t(`labels.band_${option}`)}
            </button>
          ))}
        </div>

        <div className="relative md:w-72 md:ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder={t('labels.search_user')}
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 outline-none shadow-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-2xl shadow-black/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('table.user')}</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{tCredit('panel.balance')}</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('labels.granted_total')}</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('labels.consumed_total')}</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{tCredit('grants.col_source')}</th>
                <th className="p-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">{tCredit('panel.state')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="p-6"><div className="h-10 w-40 bg-gray-100 dark:bg-gray-800 rounded-xl" /></td>
                    <td className="p-6"><div className="h-4 w-20 bg-gray-100 dark:bg-gray-800 rounded" /></td>
                    <td className="p-6"><div className="h-4 w-20 bg-gray-100 dark:bg-gray-800 rounded" /></td>
                    <td className="p-6"><div className="h-4 w-20 bg-gray-100 dark:bg-gray-800 rounded" /></td>
                    <td className="p-6"><div className="h-6 w-24 bg-gray-100 dark:bg-gray-800 rounded-lg" /></td>
                    <td className="p-6"><div className="h-6 w-16 bg-gray-100 dark:bg-gray-800 rounded-lg ml-auto" /></td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-20 text-center text-gray-400 font-medium italic">
                    {t('labels.no_metered_users')}
                  </td>
                </tr>
              ) : (
                filtered.map((user) => {
                  const userBand = balanceBand(user.balance_minutes)
                  const origin = grantOrigin(user.last_grant_source)
                  return (
                    <tr key={user.user_id} className="group hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="p-6">
                        <div className="flex items-center">
                          <div
                            className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold mr-4 shadow-lg overflow-hidden shrink-0"
                            style={{ background: `linear-gradient(135deg, ${TUGGI_COLORS.blue}, ${TUGGI_COLORS.purple})` }}
                          >
                            {(user.full_name || user.nickname || user.email || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-gray-900 dark:text-white truncate">
                              {user.full_name || user.nickname || t('labels.unknown_user')}
                            </p>
                            <p className="text-xs text-gray-500 truncate">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-6">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black font-mono text-gray-900 dark:text-white">
                            {formatDuration(user.balance_minutes)}
                          </span>
                          {userBand && (
                            <span className={cn('px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border', BAND_STYLE[userBand])}>
                              {t(`labels.band_${userBand}`)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-6 text-sm text-gray-500 font-medium font-mono">{formatDuration(user.minutes_granted_total)}</td>
                      <td className="p-6 text-sm text-gray-500 font-medium font-mono">{formatDuration(user.minutes_consumed_total)}</td>
                      <td className="p-6">
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-gray-300">
                            {origin === 'purchase' ? <CreditCard size={12} /> : <Gift size={12} />}
                            {sourceLabel(user.last_grant_source)}
                          </span>
                          {user.last_grant_at && (
                            <span className="text-[10px] text-gray-400 italic">
                              {new Date(user.last_grant_at).toLocaleDateString(locale)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-6 text-right">
                        <span className="inline-flex items-center px-3 py-1 rounded-xl text-[9px] font-bold uppercase tracking-widest bg-gray-100 dark:bg-gray-800 text-gray-500">
                          {tCredit(`panel.state_${user.state}`)}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default MeteredBalances
