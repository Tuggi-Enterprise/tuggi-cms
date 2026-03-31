'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  MapPin, Search, Filter, Plus, List, Trash2, Edit, RotateCcw, Grid, Eye, FileText, Volume2, Map
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { POI } from '@/components/poi-management/POIDetailsModal'

import { cn } from '@/lib/utils'
import { poiService, POI as POIType } from '@/lib/core/poi-service'
import { usePOIs } from '@/lib/hooks/use-pois'
import { useTranslations } from 'next-intl'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { useLocationData } from '@/lib/hooks/use-location-data'

import { POIDetailsModal } from '@/components/poi-management/POIDetailsModal'

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

export default function GeofencesPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending'>('all')
  const [cityFilter, setCityFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(100)

  const [selectedPoi, setSelectedPoi] = useState<POIType | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isCreateMode, setIsCreateMode] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'cards' | 'map'>('cards')
  
  const { role: cmsUserRole, isViewer, isAdmin, canEdit } = useCmsUser()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useSupabaseClient()

  const t = useTranslations('Geofences')
  const tPOI = useTranslations('POIManagement')

  const debouncedSearchTerm = useDebounce(searchTerm, 300)

  const { data: searchResult, isLoading, refetch } = usePOIs({
    search: debouncedSearchTerm,
    status: statusFilter,
    country: countryFilter,
    state: stateFilter,
    city: cityFilter,
    category: 'geofence', // Hardcode category as geofence
    page: currentPage,
    limit: itemsPerPage
  })

  const pois = searchResult?.data || []
  const fetchPois = useCallback(() => refetch(), [refetch])

  const handleSelectPoi = (poi: POIType) => {
    setSelectedPoi(poi)
    setIsCreateMode(false)
    setIsModalOpen(true)
    
    // URL sync
    const params = new URLSearchParams(window.location.search)
    params.set('poiId', poi.id)
    router.push(`?${params.toString()}`, { scroll: false })
  }

  const handleCreateNew = () => {
    setSelectedPoi(null)
    setIsCreateMode(true)
    setIsModalOpen(true)
    
    // URL sync
    const params = new URLSearchParams(window.location.search)
    params.set('new', 'true')
    router.push(`?${params.toString()}`, { scroll: false })
  }

  const handleDeletePoi = async (poiId: string) => {
    if (!confirm(tPOI('alerts.confirm_delete_single'))) return

    try {
      const response = await fetch(`/api/pois/${poiId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        fetchPois()
      } else {
        alert(tPOI('alerts.delete_error'))
      }
    } catch (error) {
      console.error('Error deleting Geofence:', error)
      alert(tPOI('alerts.delete_error'))
    }
  }

  const clearFilters = () => {
    setSearchTerm('')
    setStatusFilter('all')
    setCityFilter('')
    setCountryFilter('')
    setStateFilter('')
    setCurrentPage(1)
  }

  const hasActiveFilters = searchTerm !== '' || 
           statusFilter !== 'all' || 
           cityFilter !== '' || 
           countryFilter !== '' || 
           stateFilter !== ''

  // Location data for filters
  const locationData = useLocationData({ autoLoadCountries: false })

  const filterOptions = useMemo(() => ({
    countries: locationData.countries.map((country: any) => ({
      value: country.name,
      label: country.name
    })),
    states: locationData.states.map((state: any) => ({
      value: state.value,
      label: state.label
    })),
    cities: locationData.cities.map((city: any) => ({
      value: city.name,
      label: city.name
    }))
  }), [locationData.countries, locationData.states, locationData.cities])

  // Load states when country changes
  useEffect(() => {
    if (countryFilter) {
      locationData.loadStates(countryFilter, 'geofence')
      setStateFilter('')
      setCityFilter('')
    }
  }, [countryFilter])

  // Load cities when state changes
  useEffect(() => {
    if (countryFilter && stateFilter) {
      locationData.loadCities(countryFilter, stateFilter, 'geofence')
      setCityFilter('')
    }
  }, [countryFilter, stateFilter])

  // Initial country load with category
  useEffect(() => {
    locationData.loadCountries('geofence')
  }, [])

  // Listen for ?poiId= and ?new= in URL
  useEffect(() => {
    // SINGLE SOURCE OF TRUTH: Window location search 
    let currentPoiId: string | null = null
    let currentNew: string | null = null
    
    if (typeof window !== 'undefined') {
      const windowParams = new URLSearchParams(window.location.search)
      currentPoiId = windowParams.get('poiId')
      currentNew = windowParams.get('new')
    } else {
      currentPoiId = searchParams.get('poiId')
      currentNew = searchParams.get('new')
    }

    const isNewParam = currentNew === 'true'

    if (isNewParam && !isModalOpen) {
      setSelectedPoi(null)
      setIsCreateMode(true)
      setIsModalOpen(true)
    } else if (currentPoiId && (!selectedPoi || selectedPoi.id !== currentPoiId)) {
      // Optimization: Is it in list?
      const existingInList = searchResult?.data?.find(p => p.id === currentPoiId)
      
      if (existingInList) {
        setSelectedPoi(existingInList)
        setIsCreateMode(false)
        setIsModalOpen(true)
      } else {
        // Not in list, fetch specifically
        const fetchDeepLinkedPoi = async () => {
          try {
            const { data, error } = await supabase
              .schema('core')
              .from('attractions')
              .select(`
                *,
                attraction_descriptions (id, language),
                attraction_groups (id, name, status)
              `)
              .eq('id', currentPoiId)
              .single()

            if (data && !error) {
              const transformedPoi: POIType = {
                ...data,
                coordinates: data.latitude && data.longitude ? { latitude: data.latitude, longitude: data.longitude } : undefined,
                descriptions: data.attraction_descriptions || [],
                group_status: data.attraction_groups?.[0] ? {
                  is_in_group: true,
                  group_id: data.attraction_groups[0].id,
                  group_name: data.attraction_groups[0].name
                } : undefined
              }
              setSelectedPoi(transformedPoi)
              setIsCreateMode(false)
              setIsModalOpen(true)
            }
          } catch (e) {
            console.error("Error loading deep linked geofence", e)
          }
        }
        
        fetchDeepLinkedPoi()
      }
    } else if (!isNewParam && !currentPoiId && isModalOpen) {
      setIsModalOpen(false)
      setSelectedPoi(null)
    }
  }, [searchParams, isModalOpen, selectedPoi?.id, searchResult?.data, supabase])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 lg:p-8 flex flex-col">
      <div className="flex gap-8 flex-1 pt-6">
        {/* Left Column - Filters Sidebar */}
        <div className="w-[20%] flex-shrink-0">
          <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 sticky top-24">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-tuggi-blue/10 rounded-xl">
                    <Filter className="h-5 w-5 text-tuggi-blue" />
                  </div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white tracking-tight">
                    {t('locationFilters')}
                  </h2>
                </div>
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-lg transition-all"
                    title={tPOI('filters.clear_all')}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Search Bar */}
              <div className="mb-6">
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400 group-focus-within:text-tuggi-blue transition-colors" />
                  </div>
                  <input
                    type="text"
                    placeholder={tPOI('filters.search_placeholder')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-gray-50/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-tuggi-blue focus:border-transparent transition-all outline-none"
                  />
                </div>
              </div>

              {/* Filters List */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">{t('locationFilters')}</h3>
                  <div className="space-y-3">
                    <select
                      value={countryFilter}
                      onChange={(e) => setCountryFilter(e.target.value)}
                      className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                      disabled={locationData.countriesLoading}
                    >
                      <option value="">{t('allCountries') || 'All Countries'}</option>
                      {filterOptions.countries.map((country: any) => (
                        <option key={country.value} value={country.value}>
                          {country.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={stateFilter}
                      onChange={(e) => setStateFilter(e.target.value)}
                      className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all disabled:opacity-50"
                      disabled={!countryFilter || locationData.statesLoading}
                    >
                      <option value="">{t('allStates') || 'All States'}</option>
                      {filterOptions.states.map((state: any) => (
                        <option key={state.value} value={state.value}>
                          {state.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={cityFilter}
                      onChange={(e) => setCityFilter(e.target.value)}
                      className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all disabled:opacity-50"
                      disabled={!countryFilter || !stateFilter || locationData.citiesLoading}
                    >
                      <option value="">{t('allCities') || 'All Cities'}</option>
                      {filterOptions.cities.map((city: any) => (
                        <option key={city.value} value={city.value}>
                          {city.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">{t('status')}</h3>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                  >
                    <option value="all">{t('statusAll')}</option>
                    <option value="approved">{t('statusApproved')}</option>
                    <option value="pending">{t('statusPending')}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Content */}
        <div className="w-[80%]">
          {/* Stats Summary Bar */}
          <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 mb-8 sticky top-0 z-30">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-8 pl-2">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">{t('totalGeofences')}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{searchResult?.pagination?.totalCount || 0}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1 p-1 bg-gray-50/50 dark:bg-gray-950/50 rounded-2xl border border-gray-100 dark:border-gray-800 mr-4">
                  <button
                    onClick={() => setViewMode('cards')}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300",
                      viewMode === 'cards' 
                        ? "bg-white dark:bg-gray-800 text-tuggi-blue shadow-md shadow-black/5" 
                        : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    )}
                  >
                    <Grid className="h-3.5 w-3.5" />
                    {tPOI('controls.view_cards')}
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300",
                      viewMode === 'list' 
                        ? "bg-white dark:bg-gray-800 text-tuggi-blue shadow-md shadow-black/5" 
                        : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    )}
                  >
                    <List className="h-3.5 w-3.5" />
                    {tPOI('controls.view_list')}
                  </button>
                  {/* <button
                    onClick={() => setViewMode('map')}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300",
                      viewMode === 'map' 
                        ? "bg-white dark:bg-gray-800 text-tuggi-blue shadow-md shadow-black/5" 
                        : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    )}
                  >
                    <Map className="h-3.5 w-3.5" />
                    {tPOI('controls.view_map')}
                  </button> */}
                </div>

                {canEdit && (
                  <button
                    onClick={handleCreateNew}
                    className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-tuggi-blue to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl font-medium shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 transition-all active:scale-95"
                  >
                    <Plus className="h-5 w-5" />
                    <span>{t('newGeofence')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1">
            {isLoading ? (
              <div className="h-96 flex flex-col items-center justify-center bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm rounded-3xl border border-gray-200 dark:border-gray-800">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue"></div>
                <p className="mt-4 text-gray-500 font-semibold dark:text-gray-400 uppercase tracking-widest text-xs">{tPOI('list.loading')}</p>
              </div>
            ) : pois.length === 0 ? (
              <div className="h-96 flex flex-col items-center justify-center bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm rounded-3xl border border-gray-200 dark:border-gray-800">
                <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-2xl mb-4">
                  <MapPin className="h-10 w-10 text-gray-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">{t('noGeofences')}</h3>
              </div>
            ) : viewMode === 'map' ? (
              <div className="h-96 flex flex-col items-center justify-center bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm rounded-3xl border border-gray-200 dark:border-gray-800">
                <Map className="h-10 w-10 text-gray-400 mb-4" />
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">Map View coming soon</h3>
                <p className="text-gray-500">We are working on bringing map visualization to Geofences.</p>
              </div>
            ) : (
              <div className={cn(
                "transition-all duration-500",
                viewMode === 'cards' 
                  ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6" 
                  : "bg-white/50 dark:bg-gray-900/50 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden"
              )}>
                {viewMode === 'list' ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
                      <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            {t('nameAndLocation')}
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            {t('status')}
                          </th>
                          <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            {t('actions')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                        {pois.map((poi) => (
                          <tr key={poi.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer" onClick={() => handleSelectPoi(poi)}>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex flex-col">
                                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                                  {poi.name}
                                </span>
                                <span className="text-xs text-gray-500">
                                  {[poi.city, poi.state, poi.country].filter(Boolean).join(', ')}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={cn(
                                "px-2.5 py-1 text-xs font-medium rounded-full border",
                                poi.approved
                                  ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800"
                                  : "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-800"
                              )}>
                                {poi.approved ? t('active') : t('statusPending')}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSelectPoi(poi); }}
                                className="text-tuggi-blue hover:text-blue-800 mr-4"
                              >
                                <Edit className="h-4 w-4 inline" />
                              </button>
                              {canEdit && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeletePoi(poi.id); }}
                                  className="text-red-600 hover:text-red-900"
                                >
                                  <Trash2 className="h-4 w-4 inline" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  pois.map((poi) => (
                    <div
                      key={poi.id}
                      className="group transition-all duration-300 cursor-pointer overflow-hidden relative bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/60 dark:border-gray-800/60 rounded-[1.5rem] hover:shadow-2xl hover:shadow-tuggi-blue/5 hover:-translate-y-1 hover:border-tuggi-blue/30 p-5"
                      onClick={() => handleSelectPoi(poi)}
                    >
                      {/* Premium Status Light */}
                      <div className={cn(
                        "absolute top-0 left-0 w-full h-1 opacity-80",
                        poi.approved 
                          ? "bg-gradient-to-r from-green-400 to-emerald-500" 
                          : "bg-gradient-to-r from-yellow-400 to-amber-500"
                      )} />

                      <div className="flex flex-col h-full">
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-[10px] font-bold text-tuggi-blue uppercase tracking-widest px-2.5 py-1 bg-tuggi-blue/5 rounded-full border border-tuggi-blue/10">
                            Geofence
                          </span>
                          <span className={cn(
                            "px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-tighter",
                            poi.approved ? "text-green-500 bg-green-500/10" : "text-yellow-500 bg-yellow-500/10"
                          )}>
                            {poi.approved ? t('active') : t('statusPending')}
                          </span>
                        </div>

                        <div className="h-[3.5rem] flex items-center mb-2">
                          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-tuggi-blue transition-colors leading-tight w-full">
                            {poi.name}
                          </h3>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 font-medium mb-4">
                          <MapPin className="h-3.5 w-3.5 text-tuggi-blue/60 flex-shrink-0" />
                          <span className="truncate">{[poi.city, poi.state, poi.country].filter(Boolean).join(', ')}</span>
                        </div>

                        <div className="mt-auto pt-4 border-t border-gray-100/80 dark:border-gray-800/50 flex flex-col gap-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">

                              <div 
                                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800/50 group-hover:border-orange-400/10 transition-colors"
                                title="Descriptions"
                              >
                                <FileText className="h-3.5 w-3.5 text-orange-400" />
                                <span className="text-xs font-bold text-gray-600 dark:text-gray-400 leading-none">{poi.description_count || 0}</span>
                              </div>
                              <div 
                                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800/50 group-hover:border-green-500/10 transition-colors"
                                title="Audios"
                              >
                                <Volume2 className="h-3.5 w-3.5 text-green-500" />
                                <span className="text-xs font-bold text-gray-600 dark:text-gray-400 leading-none">{poi.audio_count || 0}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSelectPoi(poi); }}
                                className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/10 rounded-xl transition-all"
                              >
                                <Edit className="h-4 w-4" />
                              </button>
                              {canEdit && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDeletePoi(poi.id); }}
                                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* POI Details Modal */}
      <POIDetailsModal
        poi={selectedPoi as any}
        isOpen={isModalOpen}
        mode={isCreateMode ? 'create' : 'view'}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedPoi(null)
          const params = new URLSearchParams(searchParams.toString())
          params.delete('poiId')
          params.delete('new')
          router.push(`?${params.toString()}`, { scroll: false })
        }}
        onUpdate={fetchPois}
        onPOIUpdated={(updatedPOI) => {
          setSelectedPoi(updatedPOI as any)
          setIsCreateMode(false)
          fetchPois()
          
          // Auto switch to edit mode URL
          const params = new URLSearchParams(searchParams.toString())
          params.delete('new')
          params.set('poiId', updatedPOI.id)
          router.push(`?${params.toString()}`, { scroll: false })
        }}
      />
    </div>
  )
}
