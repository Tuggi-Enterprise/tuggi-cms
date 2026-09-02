'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import {
  CheckCircle, TrendingUp, AlertCircle, RefreshCw, Clock, Play, Users, ShieldCheck,
  Database, Zap, MapPin, Globe, Radar, Wallet, Hourglass, Timer,
} from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/navigation'
import { getSupabaseClient } from '@/lib/core/supabase-client'
import { StatCard } from '@/components/ui/StatCard'
import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import {
  dashboardService, DashboardStats, EMPTY_DASHBOARD_STATS, EMPTY_PAID_ACCESS,
  UserLocationPin, WaitlistPin, PaidAccessSnapshot, consumedMinutesTotal,
} from '@/lib/services/dashboard-service'
import { LOW_BALANCE_CEILING_MINUTES } from '@/lib/credit/entitlement'
import { formatDuration } from '@/lib/format/duration'
import { appUserLabel } from '@/lib/format/user-identity'
import { RecentVisitCard } from '@/components/dashboard/RecentVisitCard'
import { UpcomingExpirationsCard } from '@/components/dashboard/UpcomingExpirationsCard'
import { LowBalanceCard } from '@/components/dashboard/LowBalanceCard'
import { PaidAccessCard } from '@/components/dashboard/PaidAccessCard'
import { WaitlistDemandList } from '@/components/dashboard/WaitlistDemandList'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'

// recharts is the single heaviest dependency of this route's initial JS and only one widget
// uses it. ssr: false keeps it out of the server render too — the chart has no SEO value in an
// authenticated CMS. The placeholder fills the same box, so nothing below it moves.
const UserGrowthChart = dynamic(
  () => import('@/components/dashboard/UserGrowthChart').then(m => m.UserGrowthChart),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800/60" /> }
)

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
  const [paidAccess, setPaidAccess] = useState<PaidAccessSnapshot>(EMPTY_PAID_ACCESS)
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
      const [dash, pins, wlPins, paid] = await Promise.all([
        dashboardService.getDashboardData(undefined, force),
        dashboardService.getUserLocationPins(5000),
        dashboardService.getWaitlistPins(5000, true),
        // Only what is not yet a comfortable balance. The list arrives from the
        // database already ordered by ascending balance — the top runs out first.
        dashboardService.getPaidAccess(20, LOW_BALANCE_CEILING_MINUTES),
      ])
      if (!dash.success || !dash.data) throw new Error(dash.error || 'Failed to load dashboard')
      setStats(dash.data)
      if (pins.success && pins.data) setUserPins(pins.data)
      if (wlPins.success && wlPins.data) setWaitlistPins(wlPins.data)
      // Paid access is the one block that may arrive empty without a defect: the
      // migration behind both RPCs belongs to `data` and may not be applied yet. Empty
      // here is an empty state on screen, never a broken dashboard.
      setPaidAccess(paid.data ?? EMPTY_PAID_ACCESS)
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
        // The pin names the tourist by `nickname`, falling back to the truncated `user_id`
        // — BR-USUARIO-042. It used to fall back to the word "User", which named nobody.
        title: appUserLabel(p),
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
          title: appUserLabel(u),
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

  // Running out means depending on the balance NOW: an `unlimited` user with a low
  // balance is at no risk — their balance is idle until the term ends
  // (BR-MONETIZACAO-051). The cut is the `state` the database resolved, never a local
  // comparison of `ends_at` (BR-MONETIZACAO-046).
  const lowBalanceUsers = useMemo(
    () => paidAccess.meteredUsers.filter((u) => u.state === 'metered'),
    [paidAccess.meteredUsers]
  )

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

  // Consumed hours: the sum of the two columns has one owner (`consumedMinutesTotal`),
  // because the RPC returns no total and the next screen that wants the same number would
  // add them again, its own way. `null` here is "the aggregate did not come", never
  // "nobody consumed".
  const consumedMinutes = consumedMinutesTotal(paidAccess.overview)

  return (
    <div className="cms-width min-h-screen bg-[#F0F2F5] dark:bg-gray-950 p-4 lg:p-6 flex flex-col gap-4 animate-in fade-in duration-500">

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
        {/* Paid access = `unlimited` + `metered` (BR-MONETIZACAO-046). With no aggregate
            the card shows an em dash: zero would claim that nobody pays. */}
        <Link href="/dashboard/reports/premium">
          <StatCard
            size="compact"
            icon={ShieldCheck}
            title={t('labels.paid_access')}
            value={paidAccess.overview ? paidAccess.overview.unlimited_users + paidAccess.overview.metered_users : '—'}
            color={TUGGI_COLORS.orange}
            isLoading={isLoading}
          />
        </Link>
        <Link href="/dashboard/reports/engagement">
          <StatCard size="compact" icon={Play} title={t('labels.total_trips')} value={stats.totalTrips} color={TUGGI_COLORS.blue} isLoading={isLoading} />
        </Link>
        {/* Consumption, cut by how the minute was granted (BR-MONETIZACAO-047): purchased is
            recognised revenue being used; granted — welcome, coupon, CMS grant — is
            acquisition being burnt. Two slices and no third: a minute that is neither belongs
            to `data`, not to a bucket invented here. With no aggregate, an em dash — zero
            would claim that nobody listened. */}
        <Link href="/dashboard/reports/premium">
          <StatCard
            size="compact"
            icon={Timer}
            title={t('labels.consumed_total')}
            value={consumedMinutes === null ? '—' : formatDuration(consumedMinutes)}
            subtitle={
              consumedMinutes === null
                ? undefined
                : t('labels.consumption_split', {
                    paid: formatDuration(paidAccess.overview?.consumed_minutes_paid),
                    granted: formatDuration(paidAccess.overview?.consumed_minutes_granted),
                  })
            }
            color={TUGGI_COLORS.orange}
            isLoading={isLoading}
          />
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

      {/* 3. PAID ACCESS — the two ways it holds, side by side.
          `unlimited` ends on a date and shows in the middle list; `metered` ends by
          consumption and shows in the right one. Same business block, and the operator
          needs both in one sweep (BR-MONETIZACAO-046). */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* PAID ACCESS COMPOSITION */}
        <WidgetCard className="lg:col-span-4 h-[360px]">
          <SectionHeader title={t('labels.paid_access')} icon={Wallet} iconColor={TUGGI_COLORS.purple} href="/dashboard/reports/premium" linkLabel={t('labels.view_details')} />
          <PaidAccessCard overview={paidAccess.overview} />
        </WidgetCard>

        {/* EXPIRATIONS (term by date) */}
        <WidgetCard className="lg:col-span-4 h-[360px]">
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

        {/* RUNNING OUT (hour consumption) */}
        <WidgetCard className="lg:col-span-4 h-[360px]">
          <SectionHeader title={t('labels.low_balance')} icon={Hourglass} iconColor={TUGGI_COLORS.red} href="/dashboard/reports/premium" linkLabel={t('labels.view_details')} />
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-2">
            {lowBalanceUsers.length > 0 ? (
              lowBalanceUsers.slice(0, 10).map((user) => (
                <LowBalanceCard key={user.user_id} user={user} locale={locale} />
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center opacity-30 text-center">
                <Hourglass className="h-10 w-10 mb-2" />
                <p className="text-[10px] font-black uppercase">{t('labels.no_low_balance')}</p>
              </div>
            )}
          </div>
        </WidgetCard>
      </div>

      {/* 4. STRATEGIC BAND: MAU + demand by country */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* MAU GROWTH */}
        <WidgetCard className="lg:col-span-8 h-[360px]">
          <SectionHeader title={t('labels.active_base')} icon={TrendingUp} iconColor={TUGGI_COLORS.blue} href="/dashboard/reports/users" linkLabel={t('labels.view_details')} />
          <div className="flex-1 min-h-0">
            <UserGrowthChart data={stats.userGrowth} color={TUGGI_COLORS.blue} />
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
