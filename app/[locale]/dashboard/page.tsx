'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts'
import {
  CheckCircle, TrendingUp, AlertCircle, RefreshCw, Clock, Play, Users, ShieldCheck,
  Database, Zap, MapPin, Globe, Radar,
} from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import { getSupabaseClient } from '@/lib/core/supabase-client'
import { StatCard } from '@/components/ui/StatCard'
import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import {
  dashboardService, DashboardStats, EMPTY_DASHBOARD_STATS,
  UserLocationPin, WaitlistStats, WaitlistPin,
} from '@/lib/services/dashboard-service'
import { RecentVisitCard } from '@/components/dashboard/RecentVisitCard'
import { UpcomingExpirationsCard } from '@/components/dashboard/UpcomingExpirationsCard'
import { WaitlistDemandList } from '@/components/dashboard/WaitlistDemandList'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'

const TUGGI_COLORS = {
  blue: '#00A8E8',
  orange: '#FF6F00',
  green: '#10B981',
  purple: '#8B5CF6',
  red: '#EF4444',
}

// Janela de "online agora" em SEGUNDOS: usuário é ativo se teve ping nos últimos N seg.
// Ping de background ~30s → 90s tolera 2 pings perdidos sem falso-online, e derruba um
// app fechado em ~90s. NÃO há evento de "offline" — é inferência por recência do ping.
// O polling abaixo (60s) deve ser ≤ janela pra a UI refletir o offline a tempo.
const REALTIME_WINDOW_SEC = 90

type ActiveUser = { user_id: string; lat: number; lng: number; timestamp: string }

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_DASHBOARD_STATS)
  const [userPins, setUserPins] = useState<UserLocationPin[]>([])
  const [waitlistPins, setWaitlistPins] = useState<WaitlistPin[]>([])
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([])
  const [waitlist, setWaitlist] = useState<WaitlistStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isMounted, setIsMounted] = useState(false)

  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale()

  useEffect(() => { setIsMounted(true) }, [])

  const liveRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Carrega os dados pesados (KPIs, MAU, expirations, feed) + as fatias slim do mapa.
  const fetchData = useCallback(async (isBackground = false, force = false) => {
    try {
      if (!isBackground) setIsLoading(true)
      const [dash, pins, waitlistRes, wlPins] = await Promise.all([
        dashboardService.getDashboardData(undefined, force),
        dashboardService.getUserLocationPins(5000),
        dashboardService.getWaitlistStats(),
        dashboardService.getWaitlistPins(5000, true),
      ])
      if (!dash.success || !dash.data) throw new Error(dash.error || 'Failed to load dashboard')
      setStats(dash.data)
      if (pins.success && pins.data) setUserPins(pins.data)
      if (waitlistRes.success && waitlistRes.data) setWaitlist(waitlistRes.data)
      if (wlPins.success && wlPins.data) setWaitlistPins(wlPins.data)
      setError(null)
    } catch (err) {
      if (!isBackground) setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Refresh leve só do "ao vivo" (ativos no mapa + feed de POIs), sem recarregar o resto.
  const fetchRealtime = useCallback(async () => {
    const res = await dashboardService.getRealtimeActivity(REALTIME_WINDOW_SEC)
    if (res.success && res.data) setActiveUsers(res.data.active_users || [])
  }, [])

  useEffect(() => {
    fetchData(false)
    fetchRealtime()

    // ⚠️ Limite do Supabase Realtime: NÃO assinamos as tabelas de GPS
    // (user_location_history / route_trail) — elas inserem ~1 ping a cada 30s POR usuário,
    // o que estouraria a cota de mensagens. A presença no mapa vem de POLLING a cada 1 min.
    // O Realtime fica só em poi_visits (evento raro = "POI ouvida"), debounced, pro feed reagir na hora.
    const scheduleLiveRefresh = () => {
      if (liveRefreshTimer.current) return
      liveRefreshTimer.current = setTimeout(() => {
        liveRefreshTimer.current = null
        fetchRealtime()
        fetchData(true, true)
      }, 15000)
    }

    const supabase = getSupabaseClient()
    const channel = supabase.channel('dashboard_sync')
      .on('postgres_changes', { event: 'INSERT', schema: 'drive', table: 'poi_visits' }, scheduleLiveRefresh)
      .subscribe()

    // Mapa (presença): poll a cada 30s — RPC leve, NÃO consome cota de Realtime. Casa com o
    // ping ~30s, então um usuário que abre o app aparece em ≤30s (sem precisar recarregar).
    // Dashboard pesado segue em 60s (respeita cache de 2min).
    const realtimeInterval = setInterval(fetchRealtime, 30 * 1000)
    const interval = setInterval(() => fetchData(true), 60 * 1000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
      clearInterval(realtimeInterval)
      if (liveRefreshTimer.current) clearTimeout(liveRefreshTimer.current)
    }
  }, [fetchData, fetchRealtime])

  // Markers do mapa, com cores distintas por tipo:
  //   🔵 usuário · 🟠 premium · 🟢 ativo agora · 🔴 demanda (waitlist)
  const mapMarkers = useMemo(() => {
    // Índice dos ativos AGORA → posição AO VIVO (RPC de presença). Para um usuário ativo, essa é
    // a FONTE DA VERDADE da posição; o snapshot em userPins (última localização salva) envelhece
    // enquanto ele se move. Sem isto o pin trava na última posição salva (ex.: Atlanta) mesmo com
    // o usuário já a centenas de km — e "volta" pra lá quando userPins chega depois do realtime.
    const liveById = new Map(activeUsers.map(u => [u.user_id, u]))

    const markers = userPins.map(p => {
      const live = liveById.get(p.user_id)
      return {
        id: `u-${p.user_id}`,
        position: live ? { lat: live.lat, lng: live.lng } : { lat: p.latitude, lng: p.longitude },
        title: p.nickname || 'User',
        color: p.is_premium ? TUGGI_COLORS.orange : TUGGI_COLORS.blue,
        active: !!live,
      }
    })
    // Ativos sem pin de base (têm trail mas profiles.lat/lng nulo)
    const known = new Set(userPins.map(p => p.user_id))
    for (const u of activeUsers) {
      if (!known.has(u.user_id)) {
        markers.push({
          id: `a-${u.user_id}`,
          position: { lat: u.lat, lng: u.lng },
          title: 'Active User',
          color: TUGGI_COLORS.green,
          active: true,
        })
      }
    }
    // Demanda reprimida (waitlist) — vermelho, para diferenciar dos usuários
    for (const w of waitlistPins) {
      markers.push({
        id: `w-${w.id}`,
        position: { lat: w.latitude, lng: w.longitude },
        title: `${t('labels.demand')}${w.country ? ` · ${w.country}` : ''}`,
        color: TUGGI_COLORS.red,
        active: false,
      })
    }
    return markers
  }, [userPins, activeUsers, waitlistPins, t])

  const mapCenter = useMemo(() => {
    if (activeUsers.length > 0) return { lat: activeUsers[0].lat, lng: activeUsers[0].lng }
    if (userPins.length > 0) return { lat: userPins[0].latitude, lng: userPins[0].longitude }
    return { lat: -14.235, lng: -51.925 } // Brasil (fallback)
  }, [activeUsers, userPins])

  if (!isMounted) return null

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-8 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('error')}</h2>
          <button onClick={() => fetchData(false)} className="px-6 py-2 bg-tuggi-blue text-white rounded-lg font-bold hover:bg-blue-600 transition-colors">
            <RefreshCw className="h-4 w-4 inline mr-2" /> {t('retry')}
          </button>
        </div>
      </div>
    )
  }

  const activeCount = activeUsers.length

  return (
    <div className="min-h-screen bg-[#F0F2F5] dark:bg-gray-950 p-4 lg:p-6 flex flex-col gap-4 animate-in fade-in duration-500">

      {/* 1. HERO KPI ROW (6) — cada card é drill-down pro report */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Link href="/dashboard/reports/catalog">
          <StatCard size="compact" icon={CheckCircle} title={t('labels.approved')} value={stats.approvedPOIs} color={TUGGI_COLORS.green} isLoading={isLoading} />
        </Link>
        <Link href="/dashboard/reports/users">
          <StatCard size="compact" icon={Users} title={t('labels.users')} value={stats.totalUsers} color={TUGGI_COLORS.purple} isLoading={isLoading} />
        </Link>
        <Link href="/dashboard/reports/engagement">
          <StatCard size="compact" icon={Zap} title={t('labels.active_30d')} value={stats.activeUsers30d} color={TUGGI_COLORS.green} isLoading={isLoading} />
        </Link>
        <Link href="/dashboard/reports/premium">
          <StatCard size="compact" icon={ShieldCheck} title={t('labels.premium')} value={stats.totalPremiumUsers} color={TUGGI_COLORS.orange} isLoading={isLoading} />
        </Link>
        <Link href="/dashboard/reports/engagement">
          <StatCard size="compact" icon={Play} title={t('labels.total_trips')} value={stats.totalTrips} color={TUGGI_COLORS.blue} isLoading={isLoading} />
        </Link>
        <Link href="/dashboard/reports/geography">
          <StatCard size="compact" icon={MapPin} title={t('labels.demand_pending')} value={waitlist?.pending ?? 0} color={TUGGI_COLORS.red} isLoading={isLoading} />
        </Link>
      </div>

      {/* 2. MAPA AO VIVO (hero) + LISTA "POIs ouvidas agora" */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* MAPA */}
        <WidgetCard padded={false} className="lg:col-span-8 overflow-hidden h-[460px]">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <SectionHeader
              title={t('labels.user_map')}
              icon={Globe}
              iconColor={TUGGI_COLORS.blue}
              className="mb-0"
              right={
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-green-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    {activeCount} {t('labels.active_now')}
                  </span>
                  <Link href="/dashboard/reports/geography" className="group flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-tuggi-blue transition-colors">
                    {t('labels.view_details')}
                  </Link>
                </div>
              }
            />
          </div>
          <div className="flex-1 relative">
            <div className="absolute inset-0">
              <GoogleMapComponent
                center={mapCenter}
                zoom={activeUsers.length > 0 ? 5 : 4}
                markers={mapMarkers}
                className="w-full h-full"
                height="100%"
                enableDrawing={false}
                showDrawingButton={false}
              />
            </div>
            {userPins.length === 0 && activeUsers.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[11px] font-black uppercase tracking-widest text-gray-400 bg-white/80 dark:bg-gray-900/80 px-3 py-1 rounded-full">
                  {t('labels.no_users_located')}
                </span>
              </div>
            )}
            {/* Legenda — cores por tipo de pin */}
            <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1.5 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 shadow-sm pointer-events-none">
              <LegendItem color={TUGGI_COLORS.blue} label={t('labels.users')} />
              <LegendItem color={TUGGI_COLORS.orange} label={t('labels.premium')} />
              <LegendItem color={TUGGI_COLORS.green} label={t('labels.active_now')} pulse />
              <LegendItem color={TUGGI_COLORS.red} label={t('labels.demand')} />
            </div>
          </div>
        </WidgetCard>

        {/* LISTA: POIs ouvidas agora */}
        <WidgetCard className="lg:col-span-4 h-[460px]">
          <SectionHeader
            title={t('labels.pois_listened')}
            icon={Radar}
            iconColor={TUGGI_COLORS.orange}
            right={
              <Link href="/dashboard/realtime" className="group flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-green-500 hover:text-green-600 transition-colors">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                {t('labels.view_full_radar')}
              </Link>
            }
          />
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-2">
            {stats.recentVisitedPOIs.length > 0 ? (
              stats.recentVisitedPOIs.slice(0, 20).map((visit) => (
                <RecentVisitCard key={visit.visit_id} visit={visit} locale={locale} />
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center opacity-20">
                <Play className="h-10 w-10 text-gray-500" />
                <p className="text-[10px] font-black uppercase mt-2 italic">{t('labels.waiting_interactions')}</p>
              </div>
            )}
          </div>
        </WidgetCard>
      </div>

      {/* 3. FAIXA ESTRATÉGICA: MAU + Expirations + Demanda por país */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* MAU GROWTH */}
        <WidgetCard className="lg:col-span-5 h-[360px]">
          <SectionHeader title={t('labels.active_base')} icon={TrendingUp} iconColor={TUGGI_COLORS.blue} href="/dashboard/reports/users" linkLabel={t('labels.view_details')} />
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.userGrowth}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
                <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip cursor={{ fill: 'rgba(0,168,232,0.03)' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
                <Bar dataKey="count" fill={TUGGI_COLORS.blue} radius={[8, 8, 0, 0]} barSize={28}>
                  <LabelList dataKey="count" position="top" style={{ fill: TUGGI_COLORS.blue, fontSize: 10, fontWeight: '900' }} offset={8} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </WidgetCard>

        {/* EXPIRATIONS */}
        <WidgetCard className="lg:col-span-3 h-[360px]">
          <SectionHeader title={t('labels.expirations_30d')} icon={Clock} iconColor={TUGGI_COLORS.orange} href="/dashboard/reports/premium" linkLabel={t('labels.view_details')} />
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-2">
            {stats.upcomingExpirations.length > 0 ? (
              stats.upcomingExpirations.slice(0, 10).map((exp) => (
                <UpcomingExpirationsCard key={exp.user_id} expiration={exp} locale={locale} />
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center opacity-30 text-center">
                <ShieldCheck className="h-10 w-10 mb-2" />
                <p className="text-[10px] font-black uppercase">{t('labels.no_expirations')}</p>
              </div>
            )}
          </div>
        </WidgetCard>

        {/* PONTOS DE DEMANDA (waitlist pendente — nickname + link Google Maps) */}
        <WidgetCard className="lg:col-span-4 h-[360px]">
          <SectionHeader title={t('labels.demand_points')} icon={MapPin} iconColor={TUGGI_COLORS.red} href="/dashboard/reports/geography" linkLabel={t('labels.view_details')} />
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
            <WaitlistDemandList pins={waitlistPins} />
          </div>
        </WidgetCard>
      </div>

      {/* FOOTER */}
      <footer className="mt-2 py-6 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center text-gray-400">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-300">TUGGI Enterprise &bull; Master Console</p>
        <div className="flex items-center gap-4 text-[10px]">
          <span className="bg-green-500/10 text-green-500 px-3 py-1 rounded-full font-bold uppercase">SQL Direct Access: {stats.source === 'cache' ? 'CACHED' : 'LIVE'}</span>
          <p suppressHydrationWarning className="font-bold lowercase opacity-60 italic">Last sync: {stats.lastUpdated.toLocaleTimeString()}</p>
        </div>
      </footer>
    </div>
  )
}

function LegendItem({ color, label, pulse }: { color: string; label: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-2.5 h-2.5 rounded-full ${pulse ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: color }}
      />
      <span className="text-[10px] font-black uppercase tracking-tight text-gray-600 dark:text-gray-300">{label}</span>
    </div>
  )
}
