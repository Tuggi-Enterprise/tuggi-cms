'use client'

import { Hourglass, Timer } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { MeteredUser } from '@/lib/services/dashboard-service'
import { GRANT_SOURCES, balanceBand, grantOrigin } from '@/lib/credit/entitlement'
import { formatDuration } from '@/lib/format/duration'
import { AppUserLink } from '@/components/dashboard/AppUserLink'

/**
 * One user about to run out of balance, next to the expiry-by-date card.
 *
 * Same box, same type scale and same urgency treatment as `UpcomingExpirationsCard`
 * — the right-hand list is the other half of the same paid-access block, and the
 * operator reads both in one sweep. What changes is the unit: there it is days left
 * on a term, here it is hours left on a balance.
 *
 * The tourist is identified by `nickname`, falling back to the first 8 characters of the
 * `user_id` — **BR-USUARIO-042**. Neither queue of this fold shows a name or an e-mail.
 * Since #659 that identifier is the door to the file: `AppUserLink` renders it and owns the
 * modal, so the operator acts from the queue where he spotted the problem.
 *
 * Nothing is computed here. The entitlement state arrives resolved from the database
 * (BR-MONETIZACAO-046), the balance is whatever the RPC returned, and the `5 h 20 min`
 * shape belongs to `lib/format/duration.ts`. The origin label is the credit panel's own
 * — two screens naming the same grant must not name it differently.
 */
export const LowBalanceCard = ({ user, locale }: { user: MeteredUser; locale: string }) => {
  const t = useTranslations('Pages.Dashboard.labels')
  const tGrants = useTranslations('Pages.AppUsers.credit.grants')

  const band = balanceBand(user.balance_minutes)
  const isCritical = band === 'critical'
  const origin = grantOrigin(user.last_grant_source)

  const source = user.last_grant_source
  const sourceLabel = source
    ? (GRANT_SOURCES as readonly string[]).includes(source)
      ? tGrants(`source_${source}`)
      : source
    : t('from_grant')

  return (
    <div
      className={cn(
        'group relative flex items-center p-3 mb-2 rounded-xl border transition-all duration-300',
        isCritical
          ? 'bg-red-50/50 dark:bg-red-900/10 border-red-100 dark:border-red-800/50'
          : 'bg-gray-50/50 dark:bg-gray-800/30 border-transparent hover:border-gray-100 dark:hover:border-gray-800'
      )}
    >
      {/* HOURGLASS ICON */}
      <div className="flex-shrink-0 mr-3">
        <div
          className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg shadow-sm border',
            isCritical
              ? 'bg-red-100 dark:bg-red-900/40 border-red-200 dark:border-red-800'
              : 'bg-orange-100 dark:bg-orange-900/40 border-orange-200 dark:border-orange-800'
          )}
        >
          <Hourglass
            className={cn('h-4 w-4', isCritical ? 'text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400')}
          />
        </div>
      </div>

      {/* USER INFO */}
      <div className="flex-1 min-w-0">
        <AppUserLink
          user={user}
          className="block text-xs font-black text-gray-900 dark:text-white truncate max-w-full"
        />
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className={cn(
              'text-[9px] font-black uppercase px-2 py-0.5 rounded-sm tracking-wider',
              origin === 'purchase'
                ? 'bg-tuggi-orange text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
            )}
          >
            {sourceLabel}
          </span>
          {user.last_grant_at && (
            <span className="text-[9px] font-bold text-gray-400 tabular-nums">
              {new Date(user.last_grant_at).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* BALANCE */}
      <div className="text-right shrink-0 ml-2 border-l border-gray-100 dark:border-gray-800 pl-3">
        <div className="flex items-center justify-end gap-1 mb-0.5">
          <Timer size={10} className={isCritical ? 'text-red-500' : 'text-gray-400'} />
          <span className={cn('text-[11px] font-black font-mono', isCritical ? 'text-red-600' : 'text-gray-500')}>
            {formatDuration(user.balance_minutes)}
          </span>
        </div>
        <p
          className={cn(
            'text-[10px] font-black uppercase tracking-tight',
            isCritical ? 'text-red-500 animate-pulse' : band === 'attention' ? 'text-orange-500' : 'text-gray-400'
          )}
        >
          {band ? t(`band_${band}`) : t('band_none')}
        </p>
      </div>
    </div>
  )
}
