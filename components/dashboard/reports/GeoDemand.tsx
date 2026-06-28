'use client'

import { useState, useEffect, useMemo } from 'react'
import { MapPin, Globe, Users, RefreshCw, Bell, CheckCircle2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { dashboardService, WaitlistStats, WaitlistPin, UserLocationPin } from '@/lib/services/dashboard-service'
import { StatCard } from '@/components/ui/StatCard'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'
import { WaitlistDemandList } from '@/components/dashboard/WaitlistDemandList'

const TUGGI_COLORS = { blue: '#00A8E8', orange: '#FF6F00', green: '#10B981', purple: '#8B5CF6', red: '#EF4444' }

type Layer = 'demand' | 'base' | 'both'

export function GeoDemand() {
  const [waitlist, setWaitlist] = useState<WaitlistStats | null>(null)
  const [demandPins, setDemandPins] = useState<WaitlistPin[]>([])
  const [userPins, setUserPins] = useState<UserLocationPin[]>([])
  const [layer, setLayer] = useState<Layer>('demand')
  const [isLoading, setIsLoading] = useState(true)
  const t = useTranslations('Pages.Dashboard')

  const fetchData = async () => {
    setIsLoading(true)
    const [stats, dPins, uPins] = await Promise.all([
      dashboardService.getWaitlistStats(),
      dashboardService.getWaitlistPins(5000, true),
      dashboardService.getUserLocationPins(5000),
    ])
    if (stats.success && stats.data) setWaitlist(stats.data)
    if (dPins.success && dPins.data) setDemandPins(dPins.data)
    if (uPins.success && uPins.data) setUserPins(uPins.data)
    setIsLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const markers = useMemo(() => {
    const demand = demandPins.map(p => ({ id: `w-${p.id}`, position: { lat: p.latitude, lng: p.longitude }, title: `${t('labels.demand')}${p.country ? ` · ${p.country}` : ''}`, color: TUGGI_COLORS.red }))
    const base = userPins.map(p => ({ id: `u-${p.user_id}`, position: { lat: p.latitude, lng: p.longitude }, title: p.nickname || 'User', color: p.is_premium ? TUGGI_COLORS.orange : TUGGI_COLORS.blue }))
    if (layer === 'demand') return demand
    if (layer === 'base') return base
    return [...base, ...demand]
  }, [layer, demandPins, userPins, t])

  const mapCenter = markers.length > 0 ? markers[0].position : { lat: -14.235, lng: -51.925 }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard size="compact" icon={MapPin} title={t('labels.demand_pending')} value={waitlist?.pending ?? 0} color={TUGGI_COLORS.red} isLoading={isLoading} />
        <StatCard size="compact" icon={Bell} title={t('labels.notified')} value={waitlist?.notified ?? 0} color={TUGGI_COLORS.green} isLoading={isLoading} />
        <StatCard size="compact" icon={CheckCircle2} title={t('labels.conversion')} value={`${waitlist?.conversion_rate ?? 0}%`} color={TUGGI_COLORS.blue} isLoading={isLoading} />
        <StatCard size="compact" icon={Users} title={t('labels.demand')} value={waitlist?.total ?? 0} color={TUGGI_COLORS.purple} isLoading={isLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm flex flex-col h-[560px]">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
                <button onClick={() => setLayer('demand')} className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-md transition-colors ${layer === 'demand' ? 'bg-white dark:bg-gray-900 text-red-500 shadow-sm' : 'text-gray-400'}`}>{t('labels.demand')}</button>
                <button onClick={() => setLayer('base')} className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-md transition-colors ${layer === 'base' ? 'bg-white dark:bg-gray-900 text-tuggi-blue shadow-sm' : 'text-gray-400'}`}>{t('labels.users')}</button>
                <button onClick={() => setLayer('both')} className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-md transition-colors ${layer === 'both' ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'}`}>{t('labels.both')}</button>
              </span>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{markers.length} pins</span>
            </div>
            <button onClick={fetchData} disabled={isLoading} title={t('realtime.refresh_btn')} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 text-gray-500 ${isLoading ? 'animate-spin text-tuggi-blue' : ''}`} />
            </button>
          </div>
          <div className="flex-1 relative">
            <div className="absolute inset-0">
              <GoogleMapComponent center={mapCenter} zoom={4} markers={markers} className="w-full h-full" height="100%" enableDrawing={false} showDrawingButton={false} />
            </div>
            <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1.5 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 shadow-sm pointer-events-none">
              {(layer === 'base' || layer === 'both') && <LegendItem color={TUGGI_COLORS.blue} label={t('labels.users')} />}
              {(layer === 'base' || layer === 'both') && <LegendItem color={TUGGI_COLORS.orange} label={t('labels.premium')} />}
              {(layer === 'demand' || layer === 'both') && <LegendItem color={TUGGI_COLORS.red} label={t('labels.demand')} />}
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm flex flex-col h-[560px]">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center">
            <MapPin className="h-5 w-5 mr-2 text-red-500" />
            {t('labels.demand_points')}
          </h3>
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
            <WaitlistDemandList pins={demandPins} />
          </div>
        </div>
      </div>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[10px] font-black uppercase tracking-tight text-gray-600 dark:text-gray-300">{label}</span>
    </div>
  )
}

export default GeoDemand
