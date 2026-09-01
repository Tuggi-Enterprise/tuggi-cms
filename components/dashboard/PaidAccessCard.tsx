'use client'

import { CreditCard, Gift, Hourglass, Infinity as InfinityIcon, Wallet } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { EntitlementOverview } from '@/lib/services/dashboard-service'
import { formatDuration } from '@/lib/format/duration'

/**
 * The paid-access block of the Overview, in the hour model.
 *
 * Two axes, and they are not the same question: **how** the access holds (`unlimited`, a
 * term with a date · `metered`, a balance of minutes — BR-MONETIZACAO-046) and **where** it
 * came from (package purchase · grant — BR-MONETIZACAO-047). Adding the four does not give
 * the base: they are two cuts of the same population.
 *
 * With no aggregate — RPC missing or failing — the card shows an empty state instead of
 * zero. Zero is a claim, and it is not the one we have.
 */
export const PaidAccessCard = ({ overview }: { overview: EntitlementOverview | null }) => {
  const t = useTranslations('Pages.Dashboard.labels')

  if (!overview) {
    return (
      <div className="h-full flex flex-col items-center justify-center opacity-30 text-center">
        <Wallet className="h-10 w-10 mb-2" />
        <p className="text-[10px] font-black uppercase">{t('no_paid_access_data')}</p>
      </div>
    )
  }

  const paid = overview.unlimited_users + overview.metered_users

  const rows = [
    { key: 'unlimited', label: t('unlimited_access'), value: overview.unlimited_users, icon: InfinityIcon, color: '#8B5CF6' },
    { key: 'metered', label: t('metered_access'), value: overview.metered_users, icon: Hourglass, color: '#FF6F00' },
    { key: 'purchased', label: t('from_purchase'), value: overview.purchased_users, icon: CreditCard, color: '#00A8E8' },
    { key: 'granted', label: t('from_grant'), value: overview.granted_users, icon: Gift, color: '#10B981' },
  ]

  return (
    <div className="flex-1 flex flex-col justify-between gap-3">
      <div className="space-y-3">
        {rows.map((row) => {
          const ratio = paid > 0 ? Math.min(100, (row.value / paid) * 100) : 0
          return (
            <div key={row.key} className="space-y-1.5">
              <div className="flex justify-between items-center text-xs font-black">
                <span className="flex items-center gap-1.5 uppercase tracking-tight text-gray-900 dark:text-gray-100">
                  <row.icon className="h-3.5 w-3.5" style={{ color: row.color }} />
                  {row.label}
                </span>
                <span style={{ color: row.color }}>{row.value.toLocaleString()}</span>
              </div>
              <div className="h-1.5 w-full bg-gray-50 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${ratio}%`, backgroundColor: row.color }}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-800 pt-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t('total_balance')}</span>
        <span className="text-sm font-black font-mono text-gray-900 dark:text-white">
          {formatDuration(overview.total_balance_minutes)}
        </span>
      </div>
    </div>
  )
}
