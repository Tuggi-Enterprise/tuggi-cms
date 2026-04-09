'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { 
  Filter, Search, Map as MapIcon, RotateCcw, ChevronLeft, Layers, 
  MapPin, Activity, ShieldCheck, Globe, Loader2
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { useLocationData } from '@/lib/hooks/use-location-data'
import { usePOIsWithTriggers } from '@/lib/hooks/use-pois'
import { POITriggerMap } from '@/components/admin/POITriggerMap'

export default function POITriggerMapPage() {
  const t = useTranslations('POIManagement')
  const router = useRouter()
  const searchParams = useSearchParams()
  
  // Filter States
  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '')
  const [countryFilter, setCountryFilter] = useState(searchParams.get('country') || '')
  const [stateFilter, setStateFilter] = useState(searchParams.get('state') || '')
  const [cityFilter, setCityFilter] = useState(searchParams.get('city') || '')
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending'>(
    (searchParams.get('status') as any) || 'all'
  )

  // Location Data Hook
  const locationData = useLocationData({ autoLoadCountries: true })

  // Data Fetching Hook (Optimized for Triggers)
  const { data: pois = [], isLoading, refetch } = usePOIsWithTriggers({
    city: cityFilter,
    state: stateFilter,
    country: countryFilter
  }, !!cityFilter)

  // Filter local results by search term if needed (since our new RPC is simple)
  const filteredPois = useMemo(() => {
    if (!searchTerm) return pois
    return pois.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
  }, [pois, searchTerm])

  // Sync URL
  useEffect(() => {
    const params = new URLSearchParams()
    if (searchTerm) params.set('search', searchTerm)
    if (countryFilter) params.set('country', countryFilter)
    if (stateFilter) params.set('state', stateFilter)
    if (cityFilter) params.set('city', cityFilter)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    
    const query = params.toString() ? `?${params.toString()}` : ''
    router.replace(`/admin/poi-trigger-map${query}`, { scroll: false })
  }, [searchTerm, countryFilter, stateFilter, cityFilter, statusFilter, router])

  // Load locations
  useEffect(() => {
    if (countryFilter) locationData.loadStates(countryFilter)
  }, [countryFilter])

  useEffect(() => {
    if (countryFilter && stateFilter) locationData.loadCities(countryFilter, stateFilter)
  }, [countryFilter, stateFilter])

  const clearFilters = () => {
    setSearchTerm('')
    setCountryFilter('')
    setStateFilter('')
    setCityFilter('')
    setStatusFilter('all')
  }

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="h-20 flex-shrink-0 bg-white/50 dark:bg-gray-900/50 backdrop-blur-xl border-b border-gray-200 dark:border-gray-800 px-8 flex items-center justify-between z-20">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-tuggi-blue/10 rounded-2xl">
            <Activity className="w-6 h-6 text-tuggi-blue" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">POI & Trigger Visualizer</h1>
            <p className="text-sm text-gray-500 font-medium">Analyze trigger point coverage and visibility</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end mr-4">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Active City</span>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {cityFilter || 'No city selected'}
            </span>
          </div>
          <button 
            onClick={() => refetch()}
            className="p-3 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all"
          >
            <RotateCcw className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 flex-shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col z-10">
          <div className="p-6 flex-1 overflow-y-auto space-y-8 custom-scrollbar">
            {/* Search */}
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Global Search</label>
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-tuggi-blue transition-colors" />
                <input
                  type="text"
                  placeholder="Search POIs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-tuggi-blue/20 focus:border-tuggi-blue outline-none transition-all"
                />
              </div>
            </div>

            {/* Location Filters */}
            <div className="space-y-5">
              <div className="flex items-center justify-between px-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Location Analysis</label>
                {(countryFilter || stateFilter || cityFilter) && (
                  <button onClick={clearFilters} className="text-[10px] text-tuggi-blue hover:underline font-bold uppercase tracking-tighter">Reset</button>
                )}
              </div>
              
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 px-1 text-gray-500">
                    <Globe className="w-3.5 h-3.5" />
                    <span className="text-xs font-semibold">Country</span>
                  </div>
                  <select
                    value={countryFilter}
                    onChange={(e) => {
                      setCountryFilter(e.target.value)
                      setStateFilter('')
                      setCityFilter('')
                    }}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm appearance-none outline-none focus:ring-2 focus:ring-tuggi-blue/20 focus:border-tuggi-blue transition-all"
                  >
                    <option value="">Select Country</option>
                    {locationData.countries.map(c => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 px-1 text-gray-500">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span className="text-xs font-semibold">State</span>
                  </div>
                  <select
                    value={stateFilter}
                    onChange={(e) => {
                      setStateFilter(e.target.value)
                      setCityFilter('')
                    }}
                    disabled={!countryFilter}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm appearance-none outline-none focus:ring-2 focus:ring-tuggi-blue/20 focus:border-tuggi-blue transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">Select State</option>
                    {locationData.states.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 px-1 text-gray-500">
                    <MapPin className="w-3.5 h-3.5" />
                    <span className="text-xs font-semibold">City</span>
                  </div>
                  <select
                    value={cityFilter}
                    onChange={(e) => setCityFilter(e.target.value)}
                    disabled={!stateFilter}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm appearance-none outline-none focus:ring-2 focus:ring-tuggi-blue/20 focus:border-tuggi-blue transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">Select City</option>
                    {locationData.cities.map(c => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Status Filters */}
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Approval Status</label>
              <div className="grid grid-cols-1 gap-2">
                {(['all', 'approved', 'pending'] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={cn(
                      "px-4 py-2.5 rounded-xl text-xs font-bold transition-all text-left flex items-center justify-between group",
                      statusFilter === status 
                        ? "bg-tuggi-blue text-white shadow-lg shadow-tuggi-blue/20" 
                        : "bg-gray-50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                    )}
                  >
                    <span className="capitalize">{status}</span>
                    {statusFilter === status && <Activity className="w-3 h-3 animate-pulse" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Stats</span>
              <span className="text-xs font-bold text-tuggi-blue">{pois.length} results</span>
            </div>
            <div className="h-1.5 w-full bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
               <div 
                 className="h-full bg-tuggi-blue transition-all duration-500" 
                 style={{ width: `${Math.min((pois.length / 1000) * 100, 100)}%` }} 
               />
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 relative bg-gray-100 dark:bg-gray-950">
          {isLoading && (
            <div className="absolute inset-0 z-30 bg-white/60 dark:bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-tuggi-blue/20 rounded-full" />
                <div className="absolute top-0 left-0 w-16 h-16 border-4 border-tuggi-blue border-t-transparent rounded-full animate-spin" />
              </div>
              <p className="mt-4 text-sm font-bold text-gray-900 dark:text-white animate-pulse">Synchronizing Data...</p>
            </div>
          )}

          <POITriggerMap 
            pois={filteredPois as any}
            cityFilter={cityFilter}
            countryFilter={countryFilter}
            stateFilter={stateFilter}
            height="100%"
          />
        </main>
      </div>
    </div>
  )
}
