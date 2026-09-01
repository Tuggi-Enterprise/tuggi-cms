'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import {
  X, Crown, MapPin, Route, Headphones, LogIn, Building2, Smartphone, History, Loader2,
} from 'lucide-react'
import { dashboardService, UserDetail } from '@/lib/services/dashboard-service'
import { appUserInitial, appUserLabel } from '@/lib/format/user-identity'

const TUGGI = { blue: '#00A8E8', purple: '#8B5CF6', orange: '#FF6F00', green: '#10B981' }

/**
 * The tourist's file, opened from the base report.
 *
 * The header identified the same person three ways — full name in the title, its initial in
 * the avatar, and `@nickname · e-mail` underneath. It is one identifier now: the `nickname`,
 * falling back to the first 8 characters of the `user_id` (**BR-USUARIO-042**). What the file
 * is for — trips, kilometres, cities, device, subscription history — is untouched; the rule
 * decides nothing about country, language, platform or handset.
 */
export function UserDetailModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale()

  useEffect(() => {
    let active = true
    setIsLoading(true)
    dashboardService.getUserDetail(userId).then((res) => {
      if (!active) return
      if (res.success && res.data) setDetail(res.data)
      setIsLoading(false)
    })
    return () => { active = false }
  }, [userId])

  // Fecha no Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const stat = (icon: any, label: string, value: string | number, color: string) => {
    const Icon = icon
    return (
      <div className="bg-gray-50 dark:bg-gray-800/40 rounded-xl p-3 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" style={{ color }} />
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</span>
        </div>
        <span className="text-lg font-black text-gray-900 dark:text-white leading-none">{value}</span>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-widest text-gray-500">{t('labels.user_detail')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 text-tuggi-blue animate-spin" />
          </div>
        ) : !detail ? (
          <div className="flex-1 flex items-center justify-center py-20 text-gray-400 text-sm">—</div>
        ) : (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
            {/* Identidade */}
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-2xl flex items-center justify-center text-white font-black text-xl shrink-0" style={{ background: `linear-gradient(135deg, ${TUGGI.blue}, ${TUGGI.purple})` }}>
                {appUserInitial(detail)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-lg font-black text-gray-900 dark:text-white truncate">{appUserLabel(detail)}</h4>
                  {detail.is_premium && (
                    <span className="px-2 py-0.5 bg-orange-50 dark:bg-orange-900/20 text-orange-600 rounded-full text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                      <Crown className="h-3 w-3" /> {detail.subscription_tier_display_name || 'Premium'}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {detail.country || 'Global'} · {detail.language || '—'}
                </p>
              </div>
            </div>

            {/* LTV / engajamento */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {stat(Route, t('table.trips'), detail.trip_count.toLocaleString(), TUGGI.orange)}
              {stat(MapPin, t('labels.km_driven'), Math.round(detail.total_km).toLocaleString(), TUGGI.blue)}
              {stat(Headphones, t('table.visits'), detail.poi_visits_count.toLocaleString(), TUGGI.green)}
              {stat(Building2, t('labels.cities'), detail.unique_cities_visited.toLocaleString(), TUGGI.purple)}
              {stat(LogIn, t('labels.logins'), detail.login_count.toLocaleString(), TUGGI.blue)}
              {stat(Smartphone, t('table.platform'), detail.last_platform || '—', TUGGI.green)}
            </div>

            {/* Device */}
            <div className="text-[11px] text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
              <span>{detail.last_device_model || '—'}</span>
              <span>app {detail.last_app_version || '—'}</span>
              {detail.created_at && <span>{t('labels.member_since')}: {new Date(detail.created_at).toLocaleDateString(locale)}</span>}
            </div>

            {/* Timeline de assinatura */}
            <div>
              <h5 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-3 flex items-center gap-1.5">
                <History className="h-4 w-4 text-tuggi-purple" /> {t('labels.subscription_history')}
              </h5>
              {detail.subscription_history.length > 0 ? (
                <div className="space-y-2 border-l-2 border-gray-100 dark:border-gray-800 pl-4">
                  {detail.subscription_history.map((h, i) => (
                    <div key={i} className="relative">
                      <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-tuggi-purple border-2 border-white dark:border-gray-900" />
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-900 dark:text-white capitalize">
                          {h.action}{h.tier_name ? ` → ${h.tier_name}` : ''}
                        </span>
                        <span className="text-[10px] text-gray-400">{new Date(h.created_at).toLocaleDateString(locale)}</span>
                      </div>
                      {(h.previous_tier_name || h.provider) && (
                        <p className="text-[10px] text-gray-400">
                          {h.previous_tier_name ? `${h.previous_tier_name} → ` : ''}{h.provider || ''}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">{t('labels.no_subscription_history')}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default UserDetailModal
