'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
  PieChart, Pie, Cell
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
  const [isMounted, setIsMounted] = useState(false)
  
  const t = useTranslations('Pages.Dashboard');
  const locale = useLocale();

  useEffect(() => {
    setIsMounted(true)
  }, [])

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

    // 3. Optional: Polling fallback (60s as requested)
    const interval = setInterval(() => fetchData(true), 60 * 1000)

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

  if (!isMounted) return null;

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
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard size="compact" icon={Database} title={t('labels.catalog')} value={stats.totalInventory} color={TUGGI_COLORS.blue} isLoading={isLoading} />
        <StatCard size="compact" icon={CheckCircle} title={t('labels.approved')} value={stats.approvedPOIs} color={TUGGI_COLORS.green} isLoading={isLoading} />
        <StatCard size="compact" icon={Users} title={t('labels.users')} value={stats.totalUsers} color={TUGGI_COLORS.purple} isLoading={isLoading} />
        <StatCard size="compact" icon={ShieldCheck} title={t('labels.premium')} value={stats.totalPremiumUsers} color={TUGGI_COLORS.orange} isLoading={isLoading} />
        <StatCard size="compact" icon={Zap} title={t('labels.active_30d')} value={stats.activeUsers30d} color={TUGGI_COLORS.green} isLoading={isLoading} />
        <StatCard size="compact" icon={Play} title={t('labels.total_trips')} value={stats.totalTrips} color={TUGGI_COLORS.blue} isLoading={isLoading} />
        <StatCard size="compact" icon={Clock} title="Speed (6h)" value={stats.migrationMetrics?.recentAvgSeconds ? `${stats.migrationMetrics.recentAvgSeconds}s` : '--'} color={TUGGI_COLORS.green} isLoading={isLoading} />
      </div>

      {/* 2. THE ANALYTICS HUD (3-BLOCK ROW) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-fit">
        {/* BLOCK 1: GROWTH (5 COLS) */}
        <div className="lg:col-span-5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex flex-col shadow-sm h-[380px]">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">{t('labels.active_base')}</h3>
            </div>
            <span className="text-[10px] font-black text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">{t('labels.history')}</span>
          </div>
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
        </div>

        {/* BLOCK 2: EXPIRATIONS (3 COLS) */}
        <div className="lg:col-span-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm flex flex-col h-[380px]">
           <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300 mb-4 flex items-center justify-between">
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
                 <p className="text-[10px] font-black uppercase">{t('labels.no_expirations')}</p>
               </div>
             )}
           </div>
           <button className="mt-3 w-full py-2.5 text-[10px] font-black uppercase tracking-widest text-gray-400 border border-gray-100 dark:border-gray-800 rounded-lg hover:bg-gray-50 transition-all active:scale-[0.98]">
             {t('labels.subscriber_management')}
           </button>
        </div>

        {/* BLOCK 3: LIVE RECENT ACTIVITY (4 COLS) */}
        <div className="lg:col-span-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm flex flex-col h-[380px]">
           <div className="flex items-center justify-between mb-4 border-b border-gray-50 dark:border-gray-800 pb-2">
             <h3 className="text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">{t('labels.live_feed')}</h3>
             <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[10px] font-black text-green-500 uppercase tracking-widest">{t('labels.realtime')}</span>
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
            {/* LANGUAGE INVENTORY RANKING */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm flex flex-col h-full">
               <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xs font-black uppercase text-gray-400 tracking-widest leading-none">{t('labels.catalog_languages')}</h3>
                  <Database className="h-4 w-4 text-gray-400" />
               </div>
               <div className="space-y-5 flex-1">
                  {stats.languagesBreakdown.slice(0, 4).map((lang, idx) => {
                    const maxCount = stats.languagesBreakdown[0]?.count || 1;
                    const ratio = (lang.count / maxCount) * 100;
                    
                    const getLangName = (code: string) => {
                      const c = code.toLowerCase();
                      if (c === 'pt-br') return 'Português (BR)';
                      if (c === 'pt-pt') return 'Português (PT)';
                      if (c === 'pt') return 'Português';
                      if (c === 'en-us') return 'English (US)';
                      if (c === 'en-gb') return 'English (UK)';
                      if (c === 'en') return 'English';
                      if (c === 'es-es') return 'Español (ES)';
                      if (c === 'es') return 'Español';
                      if (c === 'it') return 'Italiano';
                      if (c === 'fr') return 'Français';
                      if (c === 'de') return 'Deutsch';
                      return code.toUpperCase();
                    };

                    const langName = getLangName(lang.language);
                    const langCount = lang.count;

                    return (
                      <div key={idx} className="space-y-1.5">
                         <div className="flex justify-between items-center text-xs font-black">
                            <span className="uppercase tracking-tight text-gray-900 dark:text-gray-100">{langName}</span>
                            <span className="text-tuggi-blue">{lang.count.toLocaleString()}</span>
                         </div>
                         <div className="h-1.5 w-full bg-gray-50 dark:bg-gray-800 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-tuggi-blue rounded-full transition-all duration-1000 opacity-60" 
                              style={{ width: `${ratio}%` }} 
                            />
                         </div>
                      </div>
                    );
                  })}
               </div>
            </div>

            {/* INVENTORY DISTRIBUTION (PREMIUM DONUT) */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm flex flex-col h-full">
               <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-black uppercase text-gray-400 tracking-widest leading-none">{t('labels.catalog')}</h3>
                  <Database className="h-4 w-4 text-gray-400" />
               </div>
               
               <div className="flex-1 min-h-[110px] relative">
                  {isMounted && (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Core', value: stats.approvedPOIs },
                            { name: 'Homolog', value: stats.homologPOIs }
                          ]}
                          cx="50%"
                          cy="50%"
                          innerRadius={36}
                          outerRadius={50}
                          paddingAngle={5}
                          cornerRadius={4}
                          dataKey="value"
                          stroke="none"
                        >
                          <Cell key="cell-0" fill={TUGGI_COLORS.green} />
                          <Cell key="cell-1" fill={TUGGI_COLORS.purple} />
                        </Pie>
                        <Tooltip 
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontSize: '11px', fontWeight: '900' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}

                  {/* CENTER TYPOGRAPHY - TOTAL */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mt-1">
                     <span suppressHydrationWarning className="text-base font-black text-gray-900 dark:text-white leading-none">
                       {((stats.approvedPOIs + stats.homologPOIs) / 1000).toFixed(0)}k
                     </span>
                     <span className="text-[7px] font-black text-gray-400 uppercase tracking-widest">Total</span>
                  </div>
               </div>

               <div className="mt-4 flex justify-between gap-2 border-t border-gray-50 dark:border-gray-800 pt-3">
                  <div className="flex flex-col">
                     <div className="flex items-center gap-1.5 mb-0.5">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: TUGGI_COLORS.green }} />
                        <span className="text-[9px] font-black uppercase text-gray-400">Core</span>
                     </div>
                     <div className="flex items-baseline gap-1">
                        <span suppressHydrationWarning className="text-sm font-black text-gray-900 dark:text-white">
                          {stats.approvedPOIs.toLocaleString()}
                        </span>
                        <span className="text-[9px] font-bold text-tuggi-green">
                          {((stats.approvedPOIs / (stats.approvedPOIs + stats.homologPOIs || 1)) * 100).toFixed(0)}%
                        </span>
                     </div>
                  </div>
                  <div className="flex flex-col text-right">
                     <div className="flex items-center gap-1.5 mb-0.5 justify-end">
                        <span className="text-[9px] font-black uppercase text-gray-400">Homolog</span>
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: TUGGI_COLORS.purple }} />
                     </div>
                     <div className="flex items-baseline justify-end gap-1">
                        <span className="text-[9px] font-bold text-tuggi-purple">
                          {((stats.homologPOIs / (stats.approvedPOIs + stats.homologPOIs || 1)) * 100).toFixed(0)}%
                        </span>
                        <span suppressHydrationWarning className="text-sm font-black text-gray-900 dark:text-white">
                          {stats.homologPOIs.toLocaleString()}
                        </span>
                     </div>
                  </div>
               </div>
            </div>

            {/* DEVICE ACCESS METRICS */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm flex flex-col h-full">
               <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-black uppercase text-gray-400 tracking-widest">{t('labels.device_access')}</h3>
                  <Smartphone className="h-4 w-4 text-gray-400" />
               </div>
               <div className="flex flex-row items-center flex-1 min-h-[120px] gap-6">
                  {/* CHART SIDE */}
                  <div className="w-1/2 h-full">
                    {isMounted && (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={consolidatedPlatforms.map(p => ({
                              name: p.platform === 'ios' ? 'iOS' : 'Android',
                              value: p.count
                            }))}
                            cx="50%"
                            cy="50%"
                            innerRadius={28}
                            outerRadius={45}
                            paddingAngle={5}
                            dataKey="value"
                            stroke="none"
                          >
                            {consolidatedPlatforms.map((p, index) => (
                              <Cell 
                                key={`cell-${index}`} 
                                fill={p.platform === 'ios' ? TUGGI_COLORS.blue : TUGGI_COLORS.green} 
                              />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontSize: '11px', fontWeight: '900' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>

                  {/* LEGEND SIDE */}
                  <div className="w-1/2 flex flex-col gap-5 border-l border-gray-50 dark:border-gray-800 pl-6">
                     {consolidatedPlatforms.map(p => (
                       <div key={p.platform} className="flex flex-col">
                          <div className="flex items-center gap-1.5 mb-1">
                             <div 
                               className="w-2 h-2 rounded-full" 
                               style={{ backgroundColor: p.platform === 'ios' ? TUGGI_COLORS.blue : TUGGI_COLORS.green }} 
                             />
                             <span className="text-[10px] font-black uppercase text-gray-400 tracking-tight">
                               {p.platform === 'ios' ? 'Apple iOS' : 'Android OS'}
                             </span>
                          </div>
                          <span className="text-lg font-black text-gray-900 dark:text-white leading-none">
                            {((p.count / (stats.totalTrips || 1)) * 100).toFixed(0)}%
                          </span>
                          <span className="text-[10px] font-bold text-gray-400 uppercase opacity-40">
                             {p.count.toLocaleString()} sessions
                          </span>
                       </div>
                     ))}
                  </div>
               </div>
            </div>
          </div>

          {/* DENSITY & POPULARITY GRID (CITIES, COUNTRIES & TOP POIS) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1">
             {/* COUNTRIES DENSITY */}
             <div className="bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-2xl shadow-black/5 flex flex-col h-[440px]">
                <div className="px-5 py-4 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between bg-gray-50/20">
                   <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500">{t('labels.country_footprint')}</h3>
                   <div className="flex items-center gap-2">
                      <Flag className="h-4 w-4 text-tuggi-green opacity-50" />
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('labels.national_presence')}</span>
                   </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                   <table className="w-full text-left border-collapse">
                     <thead className="bg-gray-50/80 dark:bg-gray-800/80 sticky top-0 backdrop-blur-sm z-10 transition-colors">
                       <tr>
                         <th className="px-5 py-2 text-[9px] font-black text-gray-400 uppercase tracking-tighter">{t('labels.country')}</th>
                         <th className="px-5 py-2 text-[9px] font-black text-gray-400 uppercase text-center tracking-tighter">{t('labels.cities')}</th>
                         <th className="px-5 py-2 text-[9px] font-black text-gray-400 uppercase text-right tracking-tighter">{t('labels.total_pois')}</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                       {stats.countryDistribution.map((c, idx) => (
                         <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors group">
                           <td className="px-5 py-3">
                             <div className="flex items-center gap-2">
                               <Globe className="h-3.5 w-3.5 text-tuggi-blue opacity-50 group-hover:opacity-100 transition-opacity" />
                               <span className="text-xs font-black text-gray-900 dark:text-white uppercase tracking-tight">{c.country}</span>
                             </div>
                           </td>
                           <td className="px-5 py-3 text-center">
                             <span className="text-[11px] font-bold text-gray-500">{c.city_count}</span>
                           </td>
                           <td className="px-5 py-3 text-right">
                             <span className="text-[11px] font-black bg-tuggi-green/10 text-tuggi-green border border-tuggi-green/20 px-3 py-1 rounded-full shadow-sm">
                               {c.poi_count}
                             </span>
                           </td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                </div>
             </div>

             {/* CITIES DENSITY */}
             <div className="bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-2xl shadow-black/5 flex flex-col h-[440px]">
                <div className="px-5 py-4 border-b border-gray-50 dark:border-gray-800 flex items-center justify-between bg-gray-50/20">
                   <h3 className="text-xs font-black uppercase tracking-[0.2em] text-gray-500">{t('labels.geo_density')}</h3>
                   <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-blue-500 opacity-50" />
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('labels.urban_capillarity')}</span>
                   </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                   <table className="w-full text-left border-collapse">
                     <thead className="bg-gray-50/80 dark:bg-gray-800/80 sticky top-0 backdrop-blur-sm z-10 transition-colors">
                       <tr>
                         <th className="px-5 py-2 text-[9px] font-black text-gray-400 uppercase tracking-tighter">{t('labels.location')}</th>
                         <th className="px-5 py-2 text-[9px] font-black text-gray-400 uppercase text-right tracking-tighter">{t('labels.volume')}</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                       {stats.cityDistribution.slice(0, 8).map((city, idx) => (
                         <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors group">
                           <td className="px-5 py-3">
                             <span className="text-xs font-black text-gray-900 dark:text-gray-200 group-hover:text-tuggi-blue transition-colors">{city.city}</span>
                             <span className="text-[9px] text-gray-400 font-bold ml-2 uppercase opacity-40">{city.country}</span>
                           </td>
                           <td className="px-5 py-3 text-right">
                             <span className="text-[10px] font-black bg-blue-50 dark:bg-blue-900/20 text-blue-600 border border-blue-100 dark:border-blue-800/30 px-2 py-0.5 rounded-full shadow-sm">
                               {city.poi_count}
                             </span>
                           </td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                </div>
             </div>

             {/* TOP PERFORMING POIS - PREMIUM LIST STYLE */}
             <div className="bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-2xl shadow-black/5 flex flex-col h-[440px]">
                <h3 className="text-xs font-black uppercase text-gray-400 mb-6 tracking-[0.2em] border-b border-gray-50 dark:border-gray-800 pb-3 flex items-center justify-between">
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
                            <div className="flex items-start justify-between gap-4">
                              <span className="text-xs font-black text-gray-900 dark:text-white line-clamp-2 group-hover:text-tuggi-blue transition-colors flex-1">
                                {poi.poi_name}
                              </span>
                              <div className="flex flex-col items-end shrink-0 ml-auto leading-none">
                                 <span className="text-sm font-black text-tuggi-blue leading-none">{poi.total_visits}</span>
                                 <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter mt-1">{t('table.visits')}</span>
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
          <div className="bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-2xl shadow-black/5 flex flex-col h-[400px]">
             <h3 className="text-[11px] font-black uppercase text-gray-400 mb-6 tracking-[0.2em] border-b border-gray-50 dark:border-gray-800 pb-3 flex items-center justify-between">
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
                      <div className="flex items-center justify-between mb-3 gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                           <div className={cn(
                             "w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shadow-sm shrink-0",
                             isRecent ? "bg-tuggi-blue text-white" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-100 dark:border-gray-700"
                           )}>
                              {activity.name?.charAt(0).toUpperCase() || '?'}
                           </div>
                           <div className="flex flex-col min-w-0">
                              <span className="text-xs font-black text-gray-900 dark:text-white truncate lg:max-w-[150px] leading-tight">
                                {activity.name || 'Anonymous'}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className={cn(
                                  "text-[9px] font-black uppercase px-2 py-0.5 rounded-full tracking-wider border",
                                  activity.platform.toLowerCase() === 'ios'
                                    ? "bg-gray-900 text-white border-transparent"
                                    : "bg-green-500 text-white border-transparent"
                                )}>
                                  {activity.platform}
                                </span>
                              </div>
                           </div>
                        </div>
                        <div className="text-right flex flex-col items-end gap-0.5 shrink-0 ml-auto">
                           <span className={cn(
                             "text-[12px] font-black font-mono leading-none",
                             isRecent ? "text-tuggi-blue animate-pulse" : "text-gray-400"
                           )}>
                              {new Date(activity.last_activity).toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: true })}
                           </span>
                           <div className="flex items-center gap-1 opacity-60">
                              <Clock className="h-2.5 w-2.5 text-gray-400" />
                              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">
                                {(() => {
                                  const mins = Math.round(activity.duration_minutes);
                                  if (mins < 60) return `${mins}m`;
                                  const h = Math.floor(mins / 60);
                                  const m = mins % 60;
                                  return m > 0 ? `${h}h ${m}m` : `${h}h`;
                                })()} {t('labels.duration')}
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

          {/* MIGRATION PERFORMANCE */}
          <div className="bg-white dark:bg-gray-950 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-2xl shadow-black/5 flex flex-col flex-1 min-h-[240px]">
             <h3 className="text-[11px] font-black uppercase text-gray-400 mb-4 tracking-[0.2em] border-b border-gray-50 dark:border-gray-800 pb-3 flex items-center justify-between">
                <span>Migration Speed</span>
                <Clock className="h-4 w-4 text-tuggi-green opacity-50" />
             </h3>
             <div className="flex items-center gap-3 mb-4">
                <span suppressHydrationWarning className="text-3xl font-black text-tuggi-green leading-none">
                  {(() => {
                    const data2026 = (stats.migrationMetrics?.monthly || []).filter(item => item.month.startsWith('2026'));
                    const totalVol = data2026.reduce((acc, curr) => acc + curr.volume, 0);
                    return totalVol > 0 ? (data2026.reduce((acc, curr) => acc + (curr.avg_seconds * curr.volume), 0) / totalVol).toFixed(2) : '0.00';
                  })()}s
                </span>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-tight border-l border-gray-100 dark:border-gray-800 pl-3">Global<br/>Average (2026)</span>
             </div>
             <div className="flex-1 min-h-0 w-full mt-2">
                {isMounted && (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={(stats.migrationMetrics?.monthly || []).filter(item => item.month.startsWith('2026'))} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.4} />
                      <XAxis 
                        dataKey="month" 
                        tick={{ fill: '#9ca3af', fontSize: 10, fontWeight: 700 }} 
                        axisLine={false} 
                        tickLine={false} 
                        tickFormatter={(val) => val ? `${val.split('-')[1]}/${val.split('-')[0].slice(2)}` : ''} 
                      />
                      <YAxis hide domain={[0, 'dataMax']} />
                      <Tooltip 
                        cursor={{ fill: 'rgba(16,185,129,0.05)' }} 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', fontSize: '11px', fontWeight: '900' }} 
                      />
                      <Bar dataKey="volume" fill={TUGGI_COLORS.green} radius={[4, 4, 0, 0]} barSize={24}>
                         <LabelList 
                           dataKey="avg_seconds" 
                           position="top" 
                           formatter={(val: any) => `${val}s`} 
                           style={{ fill: '#9ca3af', fontSize: 10, fontWeight: '800' }} 
                           offset={6} 
                         />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
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