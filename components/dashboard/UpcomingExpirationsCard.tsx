'use client'

import { Clock, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl';

export interface UpcomingExpiration {
  user_id: string
  full_name: string
  email: string
  tier_name: string
  end_date: string
}

export const UpcomingExpirationsCard = ({ expiration, locale }: { expiration: UpcomingExpiration, locale: string }) => {
  const diffDays = Math.ceil((new Date(expiration.end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  const isExpiringSoon = diffDays <= 7;

  const t = useTranslations('Pages.Dashboard.labels');

  return (
    <div className="flex items-center p-4 bg-white dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-orange-500/30 transition-all group shadow-sm mb-3 last:mb-0">
      <div className="flex-shrink-0 mr-4">
        <div className={`flex items-center justify-center w-10 h-10 rounded-full ${isExpiringSoon ? 'bg-red-100 dark:bg-red-900/30' : 'bg-orange-100 dark:bg-orange-900/30'}`}>
          <ShieldCheck className={`h-5 w-5 ${isExpiringSoon ? 'text-red-500' : 'text-orange-500'}`} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-gray-900 dark:text-white truncate">{expiration.full_name || expiration.email.split('@')[0]}</p>
        <p className="text-xs text-gray-500">{expiration.tier_name}</p>
      </div>
      <div className="text-right ml-4">
        <div className="flex items-center justify-end gap-1 mb-1">
          <Clock size={10} className={isExpiringSoon ? 'text-red-500 font-bold' : 'text-gray-400'} />
          <p className={`text-[10px] font-bold uppercase tracking-wider ${isExpiringSoon ? 'text-red-600' : 'text-orange-600 dark:text-orange-400'}`}>
            {new Date(expiration.end_date).toLocaleDateString(locale)}
          </p>
        </div>
        <p className={`text-[10px] font-medium italic ${isExpiringSoon ? 'text-red-400' : 'text-gray-400'}`}>
          {diffDays <= 0 ? t('expired') : t('days_remaining', { count: diffDays })}
        </p>
      </div>
    </div>
  );
}
