import { useState, useCallback, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/core/supabase-client'

export interface SimpleOSMPOI {
  _id: string
  properties: any
  geometry: any
  type?: 'poi' | 'cluster'
  count?: number
}

export function useOSMImporterSimple(initialHasData: boolean | null = null) {
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = useState<'table' | 'map'>('table')
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 50

  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)

  // Fetch POIs from Supabase (homolog.pois) via React Query
  const { 
    data: poisData, 
    isLoading, 
    error, 
    refetch 
  } = useQuery({
    queryKey: ['osm-pois', currentPage, searchTerm, cityFilter, stateFilter, categoryFilter],
    queryFn: async () => {
      const supabase = getSupabaseClient()
      console.log('🔍 [HOOK] Fetching OSM POIs...', { currentPage, searchTerm })
      
      const { data, error, count } = await supabase
        .schema('homolog')
        .from('pois')
        .select('*', { count: 'exact' })
        .range((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage - 1)
        .order('created_at', { ascending: false })

      if (error) throw error
      return { data, total: count || 0 }
    },
    staleTime: 60000,
  })

  // Selection logic
  const toggleSelection = useCallback((id: string) => {
    setSelectedFeatures(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    if (!poisData?.data) return
    setSelectedFeatures(new Set(poisData.data.map((p: any) => p.id || p.uuid_id)))
  }, [poisData])

  const clearSelection = useCallback(() => {
    setSelectedFeatures(new Set())
  }, [])

  const removePOIsFromState = useCallback((ids: string[]) => {
    // With React Query, we just invalidate the cache
    queryClient.invalidateQueries({ queryKey: ['osm-pois'] })
    queryClient.invalidateQueries({ queryKey: ['osm-map-pois'] })
  }, [queryClient])

  const updatePOIInState = useCallback((updatedPOI: any) => {
    queryClient.invalidateQueries({ queryKey: ['osm-pois'] })
    queryClient.invalidateQueries({ queryKey: ['osm-map-pois'] })
  }, [queryClient])

  return {
    features: poisData?.data || [],
    dbPagination: { total: poisData?.total || 0 },
    selectedFeatures,
    isLoading,
    error,
    viewMode,
    setViewMode,
    showUploadModal,
    setShowUploadModal,
    searchTerm,
    setSearchTerm,
    cityFilter,
    setCityFilter,
    stateFilter,
    setStateFilter,
    categoryFilter,
    setCategoryFilter,
    currentPage,
    setCurrentPage,
    toggleSelection,
    selectAll,
    clearSelection,
    removePOIsFromState,
    updatePOIInState,
    isDeleting,
    setIsDeleting,
    loadDataForMode: (mode: string) => queryClient.invalidateQueries({ queryKey: ['osm-pois'] }),
    refreshLocalStats: () => {},
    clearData: () => {},
    importSelected: async () => {}, // Handled in component
    loadFile: () => {},
    progress: null,
    importResults: null,
    availableStates: [], // Simplified for now
    availableCities: [],
    availableCategories: [],
    localDBStats: { features: poisData?.total || 0, coordinates: 0 }
  }
}
