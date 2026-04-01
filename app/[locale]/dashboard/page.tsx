'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, LabelList
} from 'recharts'
import { 
  MapPin, CheckCircle, TrendingUp, AlertCircle, RefreshCw, 
  Database, Zap, Clock, Play, Eye, Headphones, Users, ShieldCheck, Globe, Smartphone, Camera, Flag, QrCode
} from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl';
import { cn } from '@/lib/utils'
import { getSupabaseClient } from '@/lib/core/supabase-client'
import { StatCard } from '@/components/ui/StatCard'
import { dashboardService, DashboardStats, EMPTY_DASHBOARD_STATS } from '@/lib/services/dashboard-service'
import { RecentVisitCard } from '@/components/dashboard/RecentVisitCard'
import { UpcomingExpirationsCard } from '@/components/dashboard/UpcomingExpirationsCard'

// ============================================================================
// COLORS TUGGI BRAND
// ============================================================================

const TUGGI_COLORS = {
  blue: '#00A8E8',
  orange: '#FF6F00',
  green: '#10B981',
  purple: '#8B5CF6',
  red: '#EF4444',
  background: '#F7F9FA',
  text: '#1A1A1A',
  border: '#D9D9D9'
}

const FUNNEL_COLORS = {
  approved: TUGGI_COLORS.green,
  pending: TUGGI_COLORS.orange, 
  homolog: TUGGI_COLORS.purple
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_DASHBOARD_STATS)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const t = useTranslations('Pages.Dashboard');
  const locale = useLocale();

  const fetchData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setIsLoading(true)
      const result = await dashboardService.getDashboardData()
      if (!result.success || !result.data) throw new Error(result.error || 'Failed to load dashboard')
      setStats(result.data)
      setError(null)
    } catch (err) {
      if (!isBackground) setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    // 1. Initial Load
    fetchData(false)

    // 2. Realtime Listener (as per Realtime Dashboard dynamic)
    const supabase = getSupabaseClient()
    const channel = supabase.channel('dashboard_sync')
      .on(
        'postgres_changes', 
        { event: 'INSERT', schema: 'drive', table: 'poi_visits' }, 
        () => {
          console.log('🔔 Dashboard: Live POI visit detected, syncing metrics...')
          fetchData(true)
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'drive', table: 'route_trail' },
        () => {
           console.log('🔔 Dashboard: Live Trip activity detected, syncing metrics...')
           fetchData(true)
        }
      )
      .subscribe()

    // 3. Optional: Polling fallback (30s instead of 5min)
    const interval = setInterval(() => fetchData(true), 30 * 1000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [fetchData])

  const funnelData = [
    { name: t('kpi.approved_pois'), value: stats.approvedPOIs, color: FUNNEL_COLORS.approved },
    { name: t('kpi.pending'), value: stats.pendingPOIs, color: FUNNEL_COLORS.pending },
    { name: t('kpi.total_homolog'), value: stats.homologPOIs, color: FUNNEL_COLORS.homolog }
  ]

  const consolidatedPlatforms = stats.tripsByPlatform.reduce((acc, curr) => {
    const platform = curr.platform.toLowerCase().includes('ios') ? 'ios' : 'android';
    const existing = acc.find(p => p.platform === platform);
    if (existing) {
      existing.count += curr.count;
    } else {
      acc.push({ platform, count: curr.count });
    }
    return acc;
  }, [] as { platform: string; count: number }[]);

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

  return (
    <div className="min-h-screen bg-[#F0F2F5] dark:bg-gray-950 p-4 lg:p-6 flex flex-col gap-4 animate-in fade-in duration-500">
      
      {/* 1. MÁSTER KPI BAR (COMPACT) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard size="compact" icon={Database} title={t('labels.catalog')} value={stats.totalInventory} color={TUGGI_COLORS.blue} isLoading={isLoading} />
        <StatCard size="compact" icon={CheckCircle} title={t('labels.approved')} value={stats.approvedPOIs} color={TUGGI_COLORS.green} isLoading={isLoading} />
        <StatCard size="compact" icon={Users} title={t('labels.users')} value={stats.totalUsers} color={TUGGI_COLORS.purple} isLoading={isLoading} />
        <StatCard size="compact" icon={ShieldCheck} title={t('labels.premium')} value={stats.totalPremiumUsers} color={TUGGI_COLORS.orange} isLoading={isLoading} />
        <StatCard size="compact" icon={Zap} title={t('labels.active_30d')} value={stats.activeUsers30d} color={TUGGI_COLORS.green} isLoading={isLoading} />
        <StatCard size="compact" icon={Play} title={t('labels.total_trips')} value={stats.totalTrips} color={TUGGI_COLORS.blue} isLoading={isLoading} />
      </div>

      {/* 2. THE ANALYTICS HUD (3-BLOCK ROW) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-fit">
        {/* BLOCK 1: GROWTH (5 COLS) */}
        <div className="lg:col-span-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex flex-col shadow-sm h-[380px]">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              <h3 className="text-xs font-black uppercase tracking-tight text-gray-700 dark:text-gray-300">{t('labels.active_base')}</h3>
            </div>
            <span className="text-[9px] font-black text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">{t('labels.history')}</span>
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.userGrowth}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
                <XAxis dataKey="month" tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} width={30} />
                <Tooltip cursor={{ fill: 'rgba(0,168,232,0.03)' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
                <Bar dataKey="count" fill={TUGGI_COLORS.blue} radius={[8, 8, 0, 0]} barSize={28}>
                  <LabelList dataKey="count" position="top" style={{ fill: TUGGI_COLORS.blue, fontSize: 9, fontWeight: '900' }} offset={8} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* BLOCK 2: EXPIRATIONS (3 COLS) */}
        <div className="lg:col-span-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm flex flex-col h-[380px]">
           <h3 className="text-xs font-black uppercase tracking-tight text-gray-700 dark:text-gray-300 mb-4 flex items-center justify-between">
              <span>{t('labels.expirations_30d')}</span>
              <Clock className="h-4 w-4 text-orange-400" />
           </h3>
           <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-2">
             {stats.upcomingExpirations.length > 0 ? (
               stats.upcomingExpirations.slice(0, 10).map((exp) => (
                 <UpcomingExpirationsCard key={exp.user_id} expiration={exp} locale={locale} />
               ))
             ) : (
               <div className="h-full flex flex-col items-center justify-center opacity-30 text-center">
                 <ShieldCheck className="h-10 w-10 mb-2" />
                 <p className="text-[9px] font-black uppercase">{t('labels.no_expirations')}</p>
               </div>
             )}
           </div>
           <button className="mt-3 w-full py-2 text-[9px] font-black uppercase tracking-widest text-gray-400 border border-gray-100 dark:border-gray-800 rounded-lg hover:bg-gray-50 transition-colors">
             {t('labels.subscriber_management')}
           </button>
        </div>

        {/* BLOCK 3: LIVE RECENT ACTIVITY (4 COLS) */}
        <div className="lg:col-span-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm flex flex-col h-[380px]">
           <div className="flex items-center justify-between mb-4 border-b border-gray-50 dark:border-gray-800 pb-2">
             <h3 className="text-xs font-black uppercase tracking-tight text-gray-700 dark:text-gray-300">{t('labels.live_feed')}</h3>
             <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[9px] font-black text-green-500 uppercase tracking-widest">{t('labels.realtime')}</span>
             </div>
           </div>
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
        </div>
      </div>

      {/* 3. CONTENT DEPTH & GEOGRAPHY (THE REORGANIZED BOTTOM) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT HUB: GEO & CATALOG QUALITY (8 COLS) */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* LANGUAGES BREAKDOWN */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
               <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t('labels.catalog_languages')}</h3>
                  <Globe className="h-4 w-4 text-tuggi-blue" />
               </div>
               <div className="space-y-3">
                  {stats.languagesBreakdown.slice(0, 4).map((lang, idx) => (
                    <div key={idx} className="space-y-1">
                       <div className="flex justify-between items-center text-[10px] font-bold">
                          <span className="uppercase">{lang.language === 'pt' ? 'Português' : lang.language === 'en' ? 'English' : lang.language === 'es' ? 'Español' : lang.language}</span>
                          <span className="text-gray-400">{lang.count} {t('labels.core_homolog')}</span>
                       </div>
                       <div className="h-1.5 w-full bg-gray-50 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-500 rounded-full" 
                            style={{ width: `${(lang.count / (stats.totalPOIs || 1)) * 100}%` }} 
                          />
                       </div>
                    </div>
                  ))}
               </div>
            </div>

            {/* CONTENT QUALITY METRICS */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm grid grid-cols-2 gap-4">
               <div className="flex flex-col justify-center border-r border-gray-50 dark:border-gray-800 pr-2">
                  <p className="text-[9px] font-black text-gray-400 uppercase mb-2">{t('labels.pois_with_audio')}</p>
                  <p className="text-xl font-black text-tuggi-green leading-tight">{stats.withAudio}</p>
                  <p className="text-[9px] font-bold text-gray-400 uppercase leading-none">{t('labels.cataloged')}</p>
               </div>
               <div className="flex flex-col justify-center">
                  <p className="text-[9px] font-black text-gray-400 uppercase mb-2">{t('labels.avg_quality')}</p>
                  <p className="text-xl font-black text-blue-500 leading-tight">{(stats.contentCoverage * 10).toFixed(1)}%</p>
                  <p className="text-[9px] font-bold text-gray-400 uppercase leading-none">{t('labels.completeness')}</p>
               </div>
            </div>

            {/* DEVICE ACCESS METRICS */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
               <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-widest">{t('labels.device_access')}</h3>
                  <Smartphone className="h-4 w-4 text-gray-400" />
               </div>
               <div className="space-y-4">
                  {consolidatedPlatforms.map(p => (
                    <div key={p.platform}>
                       <div className="flex justify-between items-end mb-1">
                          <span className="text-[9px] font-black text-gray-500 uppercase">{p.platform === 'ios' ? 'Apple iOS' : 'Android OS'}</span>
                          <span className="text-xs font-black text-gray-900 dark:text-white">{((p.count / (stats.totalTrips || 1)) * 100).toFixed(0)}%</span>
                       </div>
                       <div className="h-1.5 w-full bg-gray-50 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div 
                            className={cn("h-full rounded-full animate-in slide-in-from-left duration-1000", p.platform === 'ios' ? 'bg-blue-500' : 'bg-green-500')} 
                            style={{ width: `${(p.count / (stats.totalTrips || 1)) * 100}%` }} 
                          />
                       </div>
                    </div>
                  ))}
               </div>
            </div>
          </div>

          {/* DENSITY & POPULARITY GRID (CITIES, COUNTRIES & TOP POIS) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1">
             {/* CITIES DENSITY */}
             <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm flex flex-col">
                <div className="px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between bg-gray-50/20">
                   <h3 className="text-[10px] font-black uppercase tracking-tight text-gray-500">{t('labels.geo_density')}</h3>
                   <div className="flex items-center gap-2">
                      <MapPin className="h-3 w-3 text-blue-500" />
                      <span className="text-[9px] font-black text-gray-400 uppercase">{t('labels.urban_capillarity')}</span>
                   </div>
                </div>
                <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                   <table className="w-full text-left border-collapse">
                     <thead className="bg-gray-50/80 dark:bg-gray-800/80 sticky top-0 backdrop-blur-sm z-10">
                       <tr>
                         <th className="px-5 py-2 text-[9px] font-black text-gray-400 uppercase">{t('labels.location')}</th>
                         <th className="px-5 py-2 text-[9px] font-black text-gray-400 uppercase text-center">{t('labels.volume')}</th>
                         <th className="px-5 py-2 text-[9px] font-black text-gray-400 uppercase text-right">{t('labels.approval_rate')}</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                       {stats.cityDistribution.slice(0, 8).map((city, idx) => (
                         <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                           <td className="px-5 py-2.5">
                             <span className="text-xs font-bold text-gray-700 dark:text-gray-200">{city.city}</span>
                             <span className="text-[9px] text-gray-400 font-bold ml-2 uppercase opacity-40">{city.country}</span>
                           </td>
                           <td className="px-5 py-2.5 text-center">
                             <span className="text-[10px] font-black bg-blue-50 dark:bg-blue-900/20 text-blue-600 px-2 py-0.5 rounded-full">{city.poi_count}</span>
                           </td>
                           <td className="px-5 py-2.5 text-right">
                             <div className="flex items-center justify-end gap-2">
                                <div className="w-12 h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-green-500" style={{ width: `${(city.approved_count / city.poi_count) * 100}%` }} />
                                </div>
                                <span className="text-[10px] font-black text-gray-900 dark:text-white w-6">{((city.approved_count / city.poi_count) * 100).toFixed(0)}%</span>
                             </div>
                           </td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                </div>
             </div>

             {/* COUNTRIES DENSITY */}
             <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm flex flex-col">
                <div className="px-5 py-3 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between bg-gray-50/20">
                   <h3 className="text-[10px] font-black uppercase tracking-tight text-gray-500">{t('labels.country_footprint')}</h3>
                   <div className="flex items-center gap-2">
                      <Flag className="h-3 w-3 text-tuggi-green" />
                      <span className="text-[9px] font-black text-gray-400 uppercase">{t('labels.national_presence')}</span>
                   </div>
                </div>
                <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                   <table className="w-full text-left border-collapse">
                     <thead className="bg-gray-50/80 dark:bg-gray-800/80 sticky top-0 backdrop-blur-sm z-10">
                       <tr>
                         <th className="px-5 py-2 text-[9px] font-black text-gray-400 uppercase">{t('labels.country')}</th>
                         <th className="px-5 py-2 text-[9px] font-black text-gray-400 uppercase text-center">{t('labels.cities')}</th>
                         <th className="px-5 py-2 text-[9px] font-black text-gray-400 uppercase text-right">{t('labels.total_pois')}</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                       {stats.countryDistribution.map((c, idx) => (
                         <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                           <td className="px-5 py-2.5">
                             <div className="flex items-center gap-2">
                               <Globe className="h-3 w-3 text-gray-400 opacity-40" />
                               <span className="text-xs font-black text-gray-900 dark:text-white uppercase tracking-tight">{c.country}</span>
                             </div>
                           </td>
                           <td className="px-5 py-2.5 text-center">
                             <span className="text-[10px] font-bold text-gray-500">{c.city_count}</span>
                           </td>
                           <td className="px-5 py-2.5 text-right">
                             <span className="text-[10px] font-black bg-tuggi-green/10 text-tuggi-green px-3 py-1 rounded-full">{c.poi_count}</span>
                           </td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                </div>
             </div>

             {/* TOP PERFORMING POIS - PREMIUM LIST STYLE */}
             <div className="bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-2xl shadow-black/5 flex flex-col min-h-[350px]">
                <h3 className="text-[10px] font-black uppercase text-gray-400 mb-6 tracking-[0.2em] border-b border-gray-50 dark:border-gray-800 pb-3 flex items-center justify-between">
                   <span>{t('labels.top_visited_pois')}</span>
                   <Camera className="h-4 w-4 text-orange-500 opacity-50" />
                </h3>
                <div className="space-y-2.5 flex-1 overflow-y-auto custom-scrollbar pr-1">
                   {stats.topVisitedPOIs.length > 0 ? Array.from(new Map(stats.topVisitedPOIs.map(item => [item.poi_id || '', item])).values()).slice(0, 5).map((poi, idx) => (
                     <div 
                       key={poi.poi_id || idx} 
                       className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-900/50 border border-transparent hover:border-gray-100 dark:hover:border-gray-800 rounded-xl transition-all duration-300 group"
                     >
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm shrink-0 shadow-sm",
                          idx === 0 ? "bg-orange-500 text-white" : 
                          idx === 1 ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 font-black" :
                          "bg-white dark:bg-gray-800 text-gray-400 border border-gray-100 dark:border-gray-700"
                        )}>
                           #{idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                           <div className="flex items-center justify-between mb-1">
                             <span className="text-[11px] font-black text-gray-900 dark:text-white truncate group-hover:text-tuggi-blue transition-colors">
                               {poi.poi_name}
                             </span>
                           </div>
                           <div className="flex items-center gap-3">
                              <div className="flex items-center gap-1">
                                 <span className="text-[10px] font-black text-tuggi-blue">{poi.total_visits}</span>
                                 <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter">{t('table.visits')}</span>
                              </div>
                              <div className="w-1 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
                              <div className="flex items-center gap-1">
                                 <span className="text-[10px] font-black text-tuggi-orange">{poi.audio_plays}</span>
                                 <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter">{t('labels.audios')}</span>
                              </div>
                           </div>
                        </div>
                     </div>
                   )) : (
                     <div className="h-full flex items-center justify-center opacity-30 text-[10px] font-black uppercase tracking-widest">{t('labels.waiting_interactions')}</div>
                   )}
                </div>
             </div>
          </div>
        </div>

        {/* RIGHT HUB: POPULARITY & PLATFORMS (4 COLS) */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {/* RECENT APP ACTIVITY - MISSION CONTROL LOG STYLE */}
          <div className="bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-2xl shadow-black/5 flex flex-col min-h-[350px]">
             <h3 className="text-[10px] font-black uppercase text-gray-400 mb-6 tracking-[0.2em] border-b border-gray-50 dark:border-gray-800 pb-3 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-tuggi-blue animate-pulse" />
                  {t('labels.recent_app_activity')}
                </span>
                <Smartphone className="h-4 w-4 text-tuggi-blue opacity-50" />
             </h3>
             
             <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar pr-1">
                {stats.recentAppActivity.length > 0 ? stats.recentAppActivity.map((activity, idx) => {
                  const isRecent = idx === 0;
                  return (
                    <div 
                      key={activity.user_id + idx} 
                      className={cn(
                        "group relative p-3 rounded-xl border transition-all duration-300",
                        isRecent 
                          ? "bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-800/50" 
                          : "bg-gray-50 dark:bg-gray-900 border-transparent hover:border-gray-100 dark:hover:border-gray-800"
                      )}
                    >
                      {/* USER HEADER */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                           <div className={cn(
                             "w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shadow-sm",
                             isRecent ? "bg-tuggi-blue text-white" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-100 dark:border-gray-700"
                           )}>
                              {activity.name.charAt(0).toUpperCase()}
                           </div>
                           <div className="flex flex-col">
                              <span className="text-[11px] font-black text-gray-900 dark:text-white truncate max-w-[120px] leading-tight">
                                {activity.name}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className={cn(
                                  "text-[8px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider border",
                                  activity.platform.toLowerCase() === 'ios'
                                    ? "bg-gray-900 text-white border-transparent"
                                    : "bg-green-500 text-white border-transparent"
                                )}>
                                  {activity.platform}
                                </span>
                              </div>
                           </div>
                        </div>
                        <div className="text-right flex flex-col items-end gap-0.5">
                           <span className={cn(
                             "text-[11px] font-black font-mono leading-none",
                             isRecent ? "text-tuggi-blue animate-pulse" : "text-gray-400"
                           )}>
                              {new Date(activity.last_activity).toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: true })}
                           </span>
                           <div className="flex items-center gap-1 opacity-60">
                              <Clock className="h-2.5 w-2.5 text-gray-400" />
                              <span className="text-[9px] font-bold text-gray-500 uppercase tracking-tighter">
                                {Math.round(activity.duration_minutes)}m {t('labels.duration')}
                              </span>
                           </div>
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="h-full flex items-center justify-center opacity-30 text-[10px] font-black uppercase tracking-widest">{t('labels.waiting_interactions')}</div>
                )}
             </div>
          </div>


          {/* SYSTEM UPTIME BENTO */}
          <div className="bg-gray-900 rounded-xl p-4 text-white flex items-center justify-between border border-gray-800 shadow-xl">
             <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-60 italic">Cloud Core v4.3.0 stable</span>
             </div>
             <div className="flex items-center gap-2">
                <span className="text-[9px] font-bold opacity-40">{t('labels.uptime')}</span>
                <span className="text-[10px] font-black text-green-400">99.98%</span>
             </div>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="mt-4 py-6 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center text-gray-400">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-300">TUGGI Enterprise &bull; Master Console</p>
        <div className="flex items-center gap-4 text-[10px]">
          <span className="bg-green-500/10 text-green-500 px-3 py-1 rounded-full font-bold uppercase">SQL Direct Access: {stats.source === 'cache' ? 'CACHED' : 'LIVE'}</span>
          <p suppressHydrationWarning className="font-bold lowercase opacity-60 italic">Last sync: {stats.lastUpdated.toLocaleTimeString()}</p>
        </div>
      </footer>

    </div>
  );
}