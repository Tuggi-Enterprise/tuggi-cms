'use client'

import { useLocale, useTranslations } from 'next-intl'
import { MapPin, ExternalLink, User } from 'lucide-react'
import { WaitlistPin } from '@/lib/services/dashboard-service'

/**
 * Lista de pontos de demanda (region_waitlist). Cada item leva o nickname do usuário
 * e abre o ponto EXATO no Google Maps (lat/lng) — já que o país é quase sempre nulo.
 */
export function WaitlistDemandList({ pins }: { pins: WaitlistPin[] }) {
  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale()

  if (pins.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center opacity-30 text-center py-8">
        <MapPin className="h-10 w-10 mb-2" />
        <p className="text-[10px] font-black uppercase">{t('labels.no_demand')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {pins.map((p) => {
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`
        return (
          <a
            key={p.id}
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl hover:bg-white dark:hover:bg-gray-800 hover:shadow-sm border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition-all"
          >
            <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0">
              <User className="h-4 w-4 text-red-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 dark:text-white truncate group-hover:text-tuggi-blue transition-colors">
                {p.nickname || 'Viajante'}
              </p>
              <p className="text-[10px] text-gray-400 font-mono truncate">
                {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                {p.created_at ? ` · ${new Date(p.created_at).toLocaleDateString(locale)}` : ''}
              </p>
            </div>
            <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-gray-400 group-hover:text-tuggi-blue transition-colors shrink-0">
              Maps <ExternalLink className="h-3.5 w-3.5" />
            </span>
          </a>
        )
      })}
    </div>
  )
}

export default WaitlistDemandList
