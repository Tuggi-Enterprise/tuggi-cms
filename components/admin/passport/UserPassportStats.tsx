'use client'

import { useTranslations } from 'next-intl'
import { Trophy, Map, Navigation, Award, type LucideIcon } from 'lucide-react'
import type { PassportStats } from '@/lib/core/passport-service'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'

interface UserPassportStatsProps {
  stats: PassportStats | null
}

/**
 * The four lifetime numbers of the Passaporte. Only the stamps card keeps a hint: the decorative
 * subtitles the others had said nothing the number beside them did not (copy, #976).
 */
export function UserPassportStats({ stats }: UserPassportStatsProps) {
  const t = useTranslations('Pages.AppUsers.passport')
  if (!stats) return null

  const cards: Array<{ key: string; label: string; value: string; hint?: string; icon: LucideIcon; tone: string }> = [
    {
      key: 'stamps',
      label: t('stamps'),
      value: String(stats.total_passed_lifetime),
      hint: t('stamps_hint'),
      icon: Trophy,
      tone: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600',
    },
    { key: 'trips', label: t('trips'), value: String(stats.total_trips), icon: Map, tone: 'bg-tuggi-blue/10 text-tuggi-blue' },
    {
      key: 'distance',
      label: t('distance'),
      value: `${stats.total_distance_km.toFixed(1)} km`,
      icon: Navigation,
      tone: 'bg-green-100 dark:bg-green-900/30 text-green-600',
    },
    {
      key: 'category',
      label: t('top_category'),
      value: stats.top_categories[0]?.category || UNKNOWN_VALUE,
      icon: Award,
      tone: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div key={card.key} className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl shrink-0 ${card.tone}`}>
              <card.icon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest leading-none mb-1">{card.label}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white leading-tight truncate">{card.value}</p>
            </div>
          </div>
          {card.hint ? <p className="mt-2 text-xs text-gray-500">{card.hint}</p> : null}
        </div>
      ))}
    </div>
  )
}
