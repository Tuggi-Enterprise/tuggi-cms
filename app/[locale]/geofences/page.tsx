'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  MapPin, Search, Filter, Plus, List, Trash2, Edit, RotateCcw
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import { cn } from '@/lib/utils'
import { poiService, POI as POIType } from '@/lib/core/poi-service'
import { usePOIs } from '@/lib/hooks/use-pois'
import { useTranslations } from 'next-intl'
import { useCmsUser } from '@/lib/hooks/useCmsUser'

import { GeofenceModal } from '@/components/geofences/GeofenceModal'

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
  
  const { role: cmsUserRole, isViewer, isAdmin, canEdit } = useCmsUser()

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
  }

  const handleCreateNew = () => {
    setSelectedPoi(null)
    setIsCreateMode(true)
    setIsModalOpen(true)
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
                    <input
                      type="text"
                      placeholder={t('country')}
                      value={countryFilter}
                      onChange={(e) => setCountryFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-transparent rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      placeholder={t('state')}
                      value={stateFilter}
                      onChange={(e) => setStateFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-transparent rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      placeholder={t('city')}
                      value={cityFilter}
                      onChange={(e) => setCityFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-transparent rounded-lg text-sm"
                    />
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

          {/* List View */}
          <div className="bg-white/50 dark:bg-gray-900/50 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
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
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {t('owner')}
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {t('actions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                  {isLoading ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                        {tPOI('list.loading')}
                      </td>
                    </tr>
                  ) : pois.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                        {t('noGeofences')}
                      </td>
                    </tr>
                  ) : (
                    pois.map((poi) => (
                      <tr key={poi.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
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
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                           {(poi as any).created_by || poi.owner_id || t('system')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => handleSelectPoi(poi)}
                            className="text-tuggi-blue hover:text-blue-800 mr-4"
                          >
                            <Edit className="h-4 w-4 inline" />
                          </button>
                          {canEdit && (
                            <button
                              onClick={() => handleDeletePoi(poi.id)}
                              className="text-red-600 hover:text-red-900"
                            >
                              <Trash2 className="h-4 w-4 inline" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      
      {isModalOpen && (
        <GeofenceModal
          poi={selectedPoi}
          isOpen={isModalOpen}
          mode={isCreateMode ? 'create' : 'edit'}
          onClose={() => setIsModalOpen(false)}
          onUpdate={fetchPois}
        />
      )}
    </div>
  )
}
