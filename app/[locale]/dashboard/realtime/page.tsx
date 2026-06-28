'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { MapPin, RefreshCw, AlertCircle, Activity, Globe } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { dashboardService } from '@/lib/services/dashboard-service'
import { getSupabaseClient } from '@/lib/core/supabase-client'
import { RecentVisitCard, RecentVisit } from '@/components/dashboard/RecentVisitCard'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent' // Fixed import

export default function RealtimeDashboard() {
  const [activeUsers, setActiveUsers] = useState<Array<{ user_id: string; lat: number; lng: number; timestamp: string }>>([])
  const [activePois, setActivePois] = useState<RecentVisit[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  
  const t = useTranslations('Pages.Dashboard')
  const locale = useLocale()
  
  // Ref to hold the current polling interval so we can reset it reliably
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch dashboard data
  const fetchRealtimeData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setIsLoading(true)
      
      const result = await dashboardService.getRealtimeActivity(600) // janela em segundos = 10 min (radar operacional)
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to load realtime dashboard')
      }
      
      setActiveUsers(result.data.active_users || [])
      setActivePois(result.data.active_pois || [])
      setLastSync(new Date())
      setError(null)
      
      if (!isBackground) {
        console.log('✅ Realtime Dashboard active loaded:', result.data.active_users.length, 'users,', result.data.active_pois.length, 'POIs')
      }
    } catch (err) {
      console.error('Realtime Dashboard error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial load and setup realtime + polling (Hybrid approach)
  useEffect(() => {
    // 1. Initial Data Fetch
    fetchRealtimeData(false)
    
    // 2. Fallback Polling (Every 30 seconds)
    pollingIntervalRef.current = setInterval(() => {
      fetchRealtimeData(true)
    }, 30 * 1000)
    
    // 3. Setup Supabase Realtime Listener
    const supabase = getSupabaseClient()
    const channel = supabase.channel('realtime_interactions')
      // ⚠️ Só poi_visits no Realtime (evento raro). NÃO assinar route_trail/user_location_history:
      // são pings de GPS de alta frequência e estourariam a cota do Supabase Realtime.
      // A presença dos usuários no mapa vem do polling de 30s (getRealtimeActivity).
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'drive', table: 'poi_visits' },
        (payload: any) => {
          console.log('🔔 Realtime New Visit Detected!', payload)
          // Trigger immediate background refresh to grab full data (joined names, etc)
          fetchRealtimeData(true)
        }
      )
      .subscribe((status: string) => {
        console.log('📡 Realtime connection status:', status)
      })

    // Cleanup functions
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current)
      supabase.removeChannel(channel)
    }
  }, [fetchRealtimeData])

  // Process map markers
  const mapMarkers = activeUsers.map(u => ({
    id: u.user_id,
    position: { lat: u.lat, lng: u.lng },
    title: 'Active User',
    // Using a subtle blue dot for user locations
    color: '#00A8E8'
  }))

  const mapCenter = activeUsers.length > 0 
    ? { lat: activeUsers[0].lat, lng: activeUsers[0].lng } 
    // Fallback to coordinates somewhat central if no users (Santiago, Chile as example)
    : { lat: -33.4489, lng: -70.6693 }

  // Error State
  if (error && activeUsers.length === 0 && activePois.length === 0) {
    return (
      <div className="min-h-[80vh] bg-gray-50 dark:bg-gray-950 p-8 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{t('error')}</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">{error}</p>
          <button
            onClick={() => fetchRealtimeData(false)}
            className="px-6 py-3 bg-tuggi-blue text-white rounded-xl font-bold hover:bg-tuggi-blue/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4 inline mr-2" />
            {t('retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-80px)] bg-gray-50 dark:bg-gray-950 p-4 lg:p-6 flex flex-col relative overflow-hidden">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
            <Activity className="h-6 w-6 text-tuggi-blue mr-3 animate-pulse" />
            {t('realtime.title')} <span className="text-xs ml-3 px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 rounded-full">{t('live')}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('realtime.subtitle')}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center px-3 py-1.5 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 shadow-sm text-xs text-gray-500">
            <div className={`h-2 w-2 rounded-full mr-2 ${isLoading ? 'bg-yellow-400' : 'bg-green-500 animate-pulse'}`} />
            {lastSync ? `Sync: ${lastSync.toLocaleTimeString(locale)}` : t('realtime.syncing')}
          </div>
          
          <button
            onClick={() => fetchRealtimeData(false)}
            disabled={isLoading}
            className="flex items-center px-3 py-1.5 bg-white border border-gray-200 text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin text-tuggi-blue' : ''}`} />
            {t('realtime.refresh_btn')}
          </button>
        </div>
      </div>

      {/* Main Content Splitted Area */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">
        
        {/* LEFT COLUMN: Map Area */}
        <div className="flex-1 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden relative shadow-sm flex flex-col">
          <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 flex justify-between items-center backdrop-blur-sm z-10">
            <h3 className="font-bold flex items-center text-gray-800 dark:text-gray-200">
              <Globe className="h-4 w-4 mr-2 text-tuggi-blue" />
              {t('realtime.active_users_radar')}
            </h3>
            <span className="text-xs font-bold bg-tuggi-blue/10 text-tuggi-blue px-2 py-1 rounded-md">
              {activeUsers.length} {t('realtime.users_detected')}
            </span>
          </div>
          
          <div className="flex-1 relative bg-gray-100 dark:bg-gray-950">
            {isLoading && activeUsers.length === 0 ? (
               <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm z-20">
                 <RefreshCw className="h-8 w-8 text-tuggi-blue animate-spin" />
               </div>
            ) : (
              <div className="absolute inset-0">
                <GoogleMapComponent
                  center={mapCenter}
                  zoom={activeUsers.length > 0 ? 5 : 3} // Zoom out to show wider area
                  markers={mapMarkers}
                  className="w-full h-full"
                  height="100%"
                  enableDrawing={false}
                  showDrawingButton={false}
                />
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Feed Area */}
        <div className="w-full lg:w-96 flex flex-col bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm min-h-0">
          <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 flex justify-between items-center backdrop-blur-sm sticky top-0 z-10">
            <h3 className="font-bold flex items-center text-gray-800 dark:text-gray-200">
              {t('realtime.recent_interactions')}
            </h3>
            <div className={`h-2 w-2 rounded-full ${isLoading ? 'bg-yellow-400' : 'bg-tuggi-orange animate-pulse'}`} />
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            <div className="flex flex-col gap-3">
              {activePois.length > 0 ? (
                activePois.map((visit) => (
                  <RecentVisitCard key={visit.visit_id} visit={visit} locale={locale} />
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400 text-center">
                  <Activity className="h-10 w-10 mb-3 opacity-20" />
                  <p className="text-sm">{t('realtime.no_interactions_10m')}</p>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
