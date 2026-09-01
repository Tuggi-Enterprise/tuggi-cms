'use client'

import { Clock, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { UpcomingExpiration } from '@/lib/services/dashboard-service'
import { AppUserLink } from '@/components/dashboard/AppUserLink'

/**
 * One subscription about to expire, in the left-hand queue of the Overview.
 *
 * The tourist is identified by `nickname`, falling back to the first 8 characters of the
 * `user_id` — **BR-USUARIO-042**. This line used to fall back to the local part of the
 * e-mail, which is the exact cut the rule's item 2 closes.
 *
 * Since #659 the identifier is also the door: `AppUserLink` renders the label and opens the
 * file. The chain still has one owner — the link is what calls `appUserLabel`.
 */
export const UpcomingExpirationsCard = ({ expiration, locale }: { expiration: UpcomingExpiration, locale: string }) => {
  const diffDays = Math.ceil((new Date(expiration.end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  const isExpiringSoon = diffDays <= 7;
  const isExpired = diffDays <= 0;

  const t = useTranslations('Pages.Dashboard.labels');

  return (
    <div 
      className={cn(
        "group relative flex items-center p-3 mb-2 rounded-xl border transition-all duration-300",
        isExpiringSoon 
          ? "bg-red-50/50 dark:bg-red-900/10 border-red-100 dark:border-red-800/50" 
          : "bg-gray-50/50 dark:bg-gray-800/30 border-transparent hover:border-gray-100 dark:hover:border-gray-800"
      )}
    >
      {/* SHIELD ICON */}
      <div className="flex-shrink-0 mr-3">
        <div className={cn(
          "flex items-center justify-center w-9 h-9 rounded-lg shadow-sm border",
          isExpiringSoon ? "bg-red-100 dark:bg-red-900/40 border-red-200 dark:border-red-800" : "bg-orange-100 dark:bg-orange-900/40 border-orange-200 dark:border-orange-800"
        )}>
          <ShieldCheck className={cn("h-4 w-4", isExpiringSoon ? "text-red-600 dark:text-red-400" : "text-orange-600 dark:text-orange-400")} />
        </div>
      </div>

      {/* USER INFO */}
      <div className="flex-1 min-w-0">
        <AppUserLink
          user={expiration}
          className="block text-xs font-black text-gray-900 dark:text-white truncate max-w-full"
        />
        <div className="flex items-center gap-1.5 mt-0.5">
           <span className={cn(
             "text-[9px] font-black uppercase px-2 py-0.5 rounded-sm tracking-wider",
             expiration.tier_name?.toLowerCase() === 'premium' ? "bg-tuggi-orange text-white" : "bg-gray-200 dark:bg-gray-700 text-gray-500"
           )}>
             {expiration.tier_name || '---'}
           </span>
        </div>
      </div>

      {/* EXPIRATION DATA */}
      <div className="text-right shrink-0 ml-2 border-l border-gray-100 dark:border-gray-800 pl-3">
        <div className="flex items-center justify-end gap-1 mb-0.5">
          <Clock size={10} className={isExpiringSoon ? 'text-red-500' : 'text-gray-400'} />
          <span className={cn(
            "text-[11px] font-black font-mono",
            isExpiringSoon ? "text-red-600" : "text-gray-500"
          )}>
            {new Date(expiration.end_date).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })}
          </span>
        </div>
        <p className={cn(
          "text-[10px] font-black uppercase tracking-tight",
          isExpired ? "text-red-400 italic" : isExpiringSoon ? "text-red-500 animate-pulse" : "text-gray-400"
        )}>
          {isExpired ? t('expired') : t('days_remaining', { count: diffDays })}
        </p>
      </div>
    </div>
  );
}
