'use client'

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import {
  MapPin, CheckCircle, FileText, Search, Filter, Plus, Grid, List, Map,
  Trash2, Eye, ChevronLeft, ChevronRight, RotateCcw, Target, Volume2, Clock, Edit, XCircle, Calendar, Users, X
} from 'lucide-react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'

import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import { POI_CATEGORIES } from '@/constants/poi-importer'
import { POIDetailsModal, type POI } from '@/components/poi-management/POIDetailsModal'
import { POIMapVisualization } from '@/components/poi-management/POIMapVisualization'
import { OptimizedPOIMap } from '@/components/poi-management/OptimizedPOIMap'
import { VerificationBadge } from '@/components/verification/VerificationBadge'
import { getThumbnailUrl } from '@/lib/imageUtils'
import { useLocationData } from '@/lib/hooks/use-location-data'
import { poiService, POI as POIType, POISearchFilters } from '@/lib/core/poi-service'
import { extractCoordinates } from '@/lib/core/poi-coordinates'
import { locationService } from '@/lib/core/location-service'
import { usePOIs, usePOIFacets } from '@/lib/hooks/use-pois'
import { useTranslations } from 'next-intl'
import { useCmsUser } from '@/lib/hooks/useCmsUser'

// Custom hook for debouncing
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

// Component that handles search params
function POIListWithSearchParams() {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending'>('all')
  const [cityFilter, setCityFilter] = useState('')
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(100)

  const [contentStatusFilter, setContentStatusFilter] = useState<'all' | 'missing_description' | 'missing_audio' | 'complete'>('all')
  const [groupStatusFilter, setGroupStatusFilter] = useState<'all' | 'grouped' | 'ungrouped' | 'group_main' | 'group_member'>('all')
  const [scoreFilter, setScoreFilter] = useState<'all' | 'no_score' | 'rejected' | 'pending' | 'approved'>('all')
  const [triggerPointsFilter, setTriggerPointsFilter] = useState<'all' | 'with_trigger_points' | 'without_trigger_points'>('all')
  const [isActiveFilter, setIsActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [selectedPois, setSelectedPois] = useState<string[]>([])
  const [countryFilter, setCountryFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [showTriggers, setShowTriggers] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [osmCategoryFilter, setOsmCategoryFilter] = useState<string>('all')
  
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useSupabaseClient()
  const queryClient = useQueryClient()
  const t = useTranslations('POIManagement')
  const { role: cmsUserRole, isAdmin, canEdit } = useCmsUser()

  const [selectedPoi, setSelectedPoi] = useState<POIType | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)



  // View state
  const [viewMode, setViewMode] = useState<'list' | 'cards' | 'map'>('cards')

  // Pagination

  // Use centralized location data
  const locationData = useLocationData({ autoLoadCountries: true })

  // Track if we're initializing from URL to prevent unnecessary updates
  const [isInitializing, setIsInitializing] = useState(true)

  // Debounce search term to avoid excessive filtering
  const debouncedSearchTerm = useDebounce(searchTerm, 300)

  // Helper to invalidate all POI-related caches for instant updates across all views
  const invalidateAllPOICaches = useCallback(async () => {
    // Clear internal service caches first
    poiService.clearCache()
    locationService.clearCache()

    // Use refetchQueries with exact: false to match all queries starting with these keys
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['pois'], exact: false, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['map-pois'], exact: false, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['pois-with-triggers'], exact: false, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['osm-pois'], exact: false, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['osm-map-pois'], exact: false, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['osm-filter-options'], exact: false, type: 'active' }),
    ])
  }, [queryClient])

  // Function to update URL with current filter states and view mode
  const updateURL = useCallback((filters: {
    search?: string
    status?: string
    country?: string
    state?: string
    city?: string
    category?: string
    osmCategory?: string
    contentStatus?: 'all' | 'missing_description' | 'missing_audio' | 'complete'
    groupStatus?: 'all' | 'grouped' | 'ungrouped' | 'group_main' | 'group_member'
    scoreFilter?: 'all' | 'no_score' | 'rejected' | 'pending' | 'approved'
    triggerPointsFilter?: 'all' | 'with_trigger_points' | 'without_trigger_points'
    isActiveFilter?: 'all' | 'active' | 'inactive'
    page?: number
    view?: 'list' | 'cards' | 'map'
  }) => {
    const params = new URLSearchParams()

    // Add non-empty/non-default filters to URL
    if (filters.search && filters.search.trim()) {
      params.set('search', filters.search)
    }
    if (filters.status && filters.status !== 'all') {
      params.set('status', filters.status)
    }
    if (filters.country && filters.country.trim()) {
      params.set('country', filters.country)
    }
    if (filters.state && filters.state.trim()) {
      params.set('state', filters.state)
    }
    if (filters.city && filters.city.trim()) {
      params.set('city', filters.city)
    }
    if (filters.category && filters.category !== 'all') {
      params.set('category', filters.category)
    }
    if (filters.osmCategory && filters.osmCategory !== 'all') {
      params.set('osmCategory', filters.osmCategory)
    }
    if (filters.contentStatus && filters.contentStatus !== 'all') {
      params.set('contentStatus', filters.contentStatus)
    }
    if (filters.groupStatus && filters.groupStatus !== 'all') {
      params.set('groupStatus', filters.groupStatus)
    }
    if (filters.scoreFilter && filters.scoreFilter !== 'all') {
      params.set('scoreFilter', filters.scoreFilter)
    }
    if (filters.triggerPointsFilter && filters.triggerPointsFilter !== 'all') {
      params.set('triggerPointsFilter', filters.triggerPointsFilter)
    }
    if (filters.isActiveFilter && filters.isActiveFilter !== 'all') {
      params.set('isActiveFilter', filters.isActiveFilter)
    }
    if (filters.page && filters.page > 1) {
      params.set('page', filters.page.toString())
    }
    if (filters.view && filters.view !== 'cards') {
      params.set('view', filters.view)
    }

    // Preserve modal parameters
    // We STRICTLY use window.location.search to prevent Next router transition lag from blowing away the poiId
    let existingPoiId: string | null = null
    let existingNew: string | null = null
    if (typeof window !== 'undefined') {
      const currentURLParams = new URLSearchParams(window.location.search)
      existingPoiId = currentURLParams.get('poiId')
      existingNew = currentURLParams.get('new')
    } else {
      existingPoiId = searchParams.get('poiId')
      existingNew = searchParams.get('new')
    }

    if (existingPoiId) params.set('poiId', existingPoiId)
    if (existingNew) params.set('new', existingNew)

    const newURL = params.toString() ? `?${params.toString()}` : ''
    // Prevent infinite loop by only replacing if the URL actually changed
    // Use window.location.search to get the precise raw string
    if (typeof window !== 'undefined' && newURL !== window.location.search) {
      if (!(newURL === '' && window.location.search === '?')) {
        router.replace(`/pois${newURL}`, { scroll: false })
      }
    }
  }, [router, searchParams])

  // Read filters from URL on mount
  const readFiltersFromURL = useCallback(() => {
    const search = searchParams.get('search') || ''
    const status = (searchParams.get('status') as 'all' | 'approved' | 'pending') || 'all'
    const city = searchParams.get('city') || ''
    const country = searchParams.get('country') || ''
    const state = searchParams.get('state') || ''
    const category = searchParams.get('category') || 'all'
    const osmCategory = searchParams.get('osmCategory') || 'all'

    const contentStatus = (searchParams.get('contentStatus') as 'all' | 'missing_description' | 'missing_audio' | 'complete') || 'all'
    const groupStatus = (searchParams.get('groupStatus') as 'all' | 'grouped' | 'ungrouped' | 'group_main' | 'group_member') || 'all'
    const score = (searchParams.get('scoreFilter') as 'all' | 'no_score' | 'rejected' | 'pending' | 'approved') || 'all'
    const triggerPoints = (searchParams.get('triggerPointsFilter') as 'all' | 'with_trigger_points' | 'without_trigger_points') || 'all'
    const isActive = (searchParams.get('isActiveFilter') as 'all' | 'active' | 'inactive') || 'all'
    const page = parseInt(searchParams.get('page') || '1')
    const view = (searchParams.get('view') as 'list' | 'cards' | 'map') || 'cards'

    setSearchTerm(search)
    setStatusFilter(status)
    setCityFilter(city)
    setCountryFilter(country)
    setStateFilter(state)
    setCategoryFilter(category)
    setOsmCategoryFilter(osmCategory)

    setContentStatusFilter(contentStatus)
    setGroupStatusFilter(groupStatus)
    setScoreFilter(score)
    setTriggerPointsFilter(triggerPoints)
    setIsActiveFilter(isActive)
    setCurrentPage(page)
    setViewMode(view)
  }, [searchParams])

  // Determine map loading strategy based on geographic context
  const getMapLoadingStrategy = useCallback((filters: POISearchFilters) => {

    // No modo mapa, o OptimizedPOIMap busca seus próprios pontos por bbox+zoom
    // (cms_search_pois_map, clustering no servidor). A lista NÃO precisa puxar todos
    // os POIs — isso só estourava o banco sem ninguém renderizar. Aqui fazemos um
    // fetch mínimo só para o total do cabeçalho (cms_list_pois LIMIT 1 + cms_poi_facets).
    if (viewMode === 'map') {
      return {
        fetch_all: false,
        limit: 1,
        page: 1,
        map_view: false,
        strategy: 'map_count_only'
      }
    }

    // For list/cards view, use normal pagination
    return {
      fetch_all: false,
      limit: itemsPerPage,
      page: currentPage,
      map_view: false,
      strategy: 'paginated'
    }
  }, [viewMode, itemsPerPage, currentPage])

  // Filtros base (sem página) — reusados pela lista e pelo contador.
  const baseFilters = useMemo(() => ({
    search: debouncedSearchTerm,
    status: statusFilter,
    country: countryFilter,
    state: stateFilter,
    city: cityFilter,
    category: categoryFilter === 'all' ? undefined : categoryFilter,
    osmCategory: osmCategoryFilter === 'all' ? undefined : osmCategoryFilter,
    contentStatus: contentStatusFilter,
    groupStatus: groupStatusFilter,
    scoreFilter: scoreFilter,
    triggerPointsFilter: triggerPointsFilter,
    isActiveFilter: isActiveFilter
  }), [debouncedSearchTerm, statusFilter, countryFilter, stateFilter, cityFilter, categoryFilter, osmCategoryFilter, contentStatusFilter, groupStatusFilter, scoreFilter, triggerPointsFilter, isActiveFilter])

  // Lista (linhas) — re-busca a cada página, MAS sem re-contar (skipFacets).
  const { data: searchResult, isLoading: isQueryLoading, isFetching: isQueryFetching, refetch } = usePOIs({
    ...getMapLoadingStrategy(baseFilters),
    ...baseFilters,
    page: currentPage,
    limit: itemsPerPage,
    skipFacets: true
  } as any)

  // Contador/total — UMA chamada por filtro (chave sem página). Virar de página reusa o cache.
  const { data: facetsResult } = usePOIFacets(baseFilters)

  // Listen for ?poiId= and ?new= in URL
  useEffect(() => {
    // SINGLE SOURCE OF TRUTH: Window location search 
    // This prevents React/NextJS batching delays from resurrecting obsolete pointer states
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
      setIsModalOpen(true)
    } else if (currentPoiId && (!selectedPoi || selectedPoi.id !== currentPoiId)) {
      // Optimiziation: Did we just load this POI in our main list?
      const existingInList = searchResult?.data?.find(p => p.id === currentPoiId)
      
      if (existingInList) {
        setSelectedPoi(existingInList)
        setIsModalOpen(true)
      } else {
        // Not in current page list, fetch specifically
        const fetchDeepLinkedPoi = async () => {
          try {
            const { data, error } = await supabase
              .schema('core')
              .from('attractions')
              .select(`
                *,
                attraction_coordinate (latitude, longitude),
                attraction_descriptions (id, language),
                attraction_groups (id, name)
              `)
              .eq('id', currentPoiId)
              .single()

            if (data && !error) {
              const transformedPoi: POIType = {
                ...data,
                coordinates: extractCoordinates(data),
                descriptions: data.attraction_descriptions || [],
                group_status: data.attraction_groups?.[0] ? {
                  is_in_group: true,
                  group_id: data.attraction_groups[0].id,
                  group_name: data.attraction_groups[0].name
                } : undefined
              }
              setSelectedPoi(transformedPoi)
              setIsModalOpen(true)
            }
          } catch (e) {
            console.error("Error loading deep linked POI", e)
          }
        }
        
        fetchDeepLinkedPoi()
      }
    } else if (!isNewParam && !currentPoiId && isModalOpen) {
      setIsModalOpen(false)
      setSelectedPoi(null)
    }
  }, [searchParams, isModalOpen, selectedPoi?.id, searchResult?.data])

  // Derived data
  const pois = useMemo(() => searchResult?.data || [], [searchResult])

  // Use the results directly from the backend (no more frontend-side filtering)
  const filteredPois = pois
  
  // Total vem do contador (cacheado por filtro); a lista não conta mais por página.
  const totalCount = facetsResult?.data?.total ?? (searchResult?.pagination?.totalCount || 0)
  const totalPages = Math.max(1, Math.ceil(totalCount / itemsPerPage))

  const isLoading = isQueryLoading || (isQueryFetching && pois.length === 0)
  const fetchPois = useCallback(() => refetch(), [refetch])



  // Track whether the current country has states in the database
  const countryHasStates = useMemo(() => {
    // If no country selected or still loading, assume it has states
    if (!countryFilter || locationData.statesLoading) return true
    // After loading, check if the states array is non-empty
    return locationData.states.length > 0
  }, [countryFilter, locationData.states, locationData.statesLoading])

  // Stable references to prevent infinite loops
  const loadStatesForCountry = useCallback((country: string) => {
    if (country) {
      console.log('🔄 Loading states for country:', country)
      locationData.loadStates(country)
      setStateFilter('') // Reset state when country changes
      setCityFilter('') // Reset city when country changes
    }
  }, [locationData.loadStates])

  const loadCitiesForLocation = useCallback((country: string, state?: string) => {
    if (country) {
      console.log('🔄 Loading cities for country:', country, 'state:', state || '(all)')
      locationData.loadCities(country, state)
    }
  }, [locationData.loadCities])

  // Load states when country changes
  useEffect(() => {
    if (countryFilter) {
      const timeoutId = setTimeout(() => {
        loadStatesForCountry(countryFilter)
      }, 100) // Reduced debounce for better UX

      return () => clearTimeout(timeoutId)
    }
  }, [countryFilter, loadStatesForCountry])

  // Load cities when country+state selected, OR when country has no states
  useEffect(() => {
    if (countryFilter && stateFilter) {
      // Normal hierarchical flow: country + state selected → load cities for that state
      const timeoutId = setTimeout(() => {
        loadCitiesForLocation(countryFilter, stateFilter)
      }, 100)
      return () => clearTimeout(timeoutId)
    } else if (countryFilter && !stateFilter && !countryHasStates && !locationData.statesLoading) {
      // Country has NO states (e.g. Portugal) → load all cities for the country directly
      const timeoutId = setTimeout(() => {
        loadCitiesForLocation(countryFilter)
      }, 100)
      return () => clearTimeout(timeoutId)
    } else if (countryFilter && !stateFilter && countryHasStates) {
      // Country HAS states but none selected → clear cities
      setCityFilter('')
    }
  }, [countryFilter, stateFilter, countryHasStates, locationData.statesLoading, loadCitiesForLocation])

  // Load POIs when filters change
  useEffect(() => {
    if (!isInitializing) {
      fetchPois()
    }
  }, [fetchPois, isInitializing])

  // Read filters from URL on mount
  useEffect(() => {
    readFiltersFromURL()
    setIsInitializing(false)
  }, [readFiltersFromURL])

  // Update URL when filters change
  useEffect(() => {
    if (!isInitializing) {
      updateURL({
        search: searchTerm,
        status: statusFilter,
        city: cityFilter,
        country: countryFilter,
        state: stateFilter,
        category: categoryFilter,
        osmCategory: osmCategoryFilter,
        contentStatus: contentStatusFilter,
        groupStatus: groupStatusFilter,
        scoreFilter: scoreFilter,
        triggerPointsFilter: triggerPointsFilter,
        isActiveFilter: isActiveFilter,
        page: currentPage,
        view: viewMode
      })
    }
  }, [searchTerm, statusFilter, cityFilter, countryFilter, stateFilter, categoryFilter, osmCategoryFilter, contentStatusFilter, groupStatusFilter, scoreFilter, triggerPointsFilter, isActiveFilter, currentPage, viewMode, isInitializing, updateURL])

  // Transform POI from service to modal format
  const transformPOIForModal = (poi: POIType): POI => {
    return {
      ...poi,
      // For the modal, keep category and record_type exactly as they come from the service/database
      record_type: (poi.record_type === 'geofence' || poi.record_type === 'point_of_interest') 
        ? poi.record_type 
        : (poi.category === 'geofence' ? 'geofence' : 'point_of_interest'),
      category: poi.category || 'point_of_interest',
    state: poi.state || null,
    approved_by: poi.approved_by || null,
    approved_at: poi.approved_at || null,
    rating: poi.rating || null,
    image_url: poi.image_url || null,
    formatted_address: poi.formatted_address || null,
    vicinity: poi.vicinity || null,
    website: poi.website || null,
    formatted_phone_number: poi.formatted_phone_number || null,
    business_status: poi.business_status || null,
    price_level: poi.price_level || null,
    opening_hours: poi.opening_hours || null,
    google_types: poi.google_types || [],
    photos_references: poi.photos_references || [],
    google_place_id: poi.google_place_id || null,
    user_id: poi.user_id || null,
    user_ratings_total: poi.user_ratings_total || null,
    coordinates: extractCoordinates(poi),
    reference_links: poi.reference_links || [],
    descriptions: poi.descriptions || [],
    group_status: poi.group_status || undefined,
    verification_score: poi.verification_score || null
    }
  }

  // Transform POI from service to map format
  const transformPOIForMap = (poi: POIType) => ({
    ...poi,
    state: poi.state || null,
    approved_by: poi.approved_by || null,
    approved_at: poi.approved_at || null,
    rating: poi.rating || null,
    image_url: poi.image_url || null,
    formatted_address: poi.formatted_address || null,
    vicinity: poi.vicinity || null,
    website: poi.website || null,
    formatted_phone_number: poi.formatted_phone_number || null,
    business_status: poi.business_status || null,
    price_level: poi.price_level || null,
    opening_hours: poi.opening_hours || null,
    google_types: poi.google_types || [],
    photos_references: poi.photos_references || [],
    google_place_id: poi.google_place_id || null,
    user_id: poi.user_id || null,
    user_ratings_total: poi.user_ratings_total || null,
    coordinates: extractCoordinates(poi),
    reference_links: poi.reference_links || [],
    descriptions: poi.descriptions || [],
    group_status: poi.group_status || undefined,
    verification_score: poi.verification_score || null
  })

  // Handle POI selection
  const handleSelectPoi = (poi: POIType) => {
    // Optimiziation: we already have the object, set it instantly
    setSelectedPoi(poi)
    setIsModalOpen(true)
    
    // Always use window.location.search for appending to avoid dropping concurrently updating state
    const currentParamsStr = typeof window !== 'undefined' ? window.location.search : searchParams.toString()
    const params = new URLSearchParams(currentParamsStr)
    params.set('poiId', poi.id)
    router.push(`?${params.toString()}`, { scroll: false })
  }

  // Handle POI selection for map (with transformation)
  const handleSelectPoiForMap = (poi: any) => {
    // Transform the POI back to POIType format
    const transformedPoi: POIType = {
      ...poi,
      state: poi.state || undefined,
      approved_by: poi.approved_by || undefined,
      approved_at: poi.approved_at || undefined,
      rating: poi.rating || undefined,
      image_url: poi.image_url || undefined,
      formatted_address: poi.formatted_address || undefined,
      vicinity: poi.vicinity || undefined,
      website: poi.website || undefined,
      formatted_phone_number: poi.formatted_phone_number || undefined,
      business_status: poi.business_status || undefined,
      price_level: poi.price_level || undefined,
      opening_hours: poi.opening_hours || undefined,
      google_types: poi.google_types || [],
      photos_references: poi.photos_references || [],
      google_place_id: poi.google_place_id || undefined,
      user_id: poi.user_id || undefined,
      user_ratings_total: poi.user_ratings_total || undefined,
      coordinates: extractCoordinates(poi),
      reference_links: poi.reference_links || [],
      descriptions: poi.descriptions || [],
      group_status: poi.group_status || undefined,
      verification_score: poi.verification_score || undefined
    }
    // Optimisticly set instantly
    setSelectedPoi(transformedPoi)
    setIsModalOpen(true)
    
    const currentParamsStr = typeof window !== 'undefined' ? window.location.search : searchParams.toString()
    const params = new URLSearchParams(currentParamsStr)
    params.set('poiId', transformedPoi.id)
    router.push(`?${params.toString()}`, { scroll: false })
  }

  // Handle POI deletion
  const handleDeletePoi = async (poiId: string) => {
    if (!confirm(t('alerts.confirm_delete_single'))) return

    try {
      const response = await fetch(`/api/clients/pois/${poiId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        // Reload POIs
        fetchPois()
      } else {
        alert(t('alerts.delete_error'))
      }
    } catch (error) {
      console.error('Error deleting POI:', error)
      alert(t('alerts.delete_error'))
    }
  }

  // Handle POI garbage (blacklist)
  const handleGarbagePoi = async (poiId: string) => {
    if (!confirm(t('alerts.confirm_garbage_single'))) return

    try {
      const response = await fetch(`/api/pois/${poiId}/garbage`, {
        method: 'POST'
      })

      if (response.ok) {
        fetchPois()
      } else {
        const errorData = await response.json()
        alert(errorData.error || t('alerts.garbage_error'))
      }
    } catch (error) {
      console.error('Error marking POI as garbage:', error)
      alert(t('alerts.request_error'))
    }
  }

  // Handle bulk operations
  const handleBulkDelete = async () => {
    if (selectedPois.length === 0) return

    if (!confirm(t('alerts.confirm_delete_bulk', { count: selectedPois.length }))) return

    try {
      const response = await fetch('/api/pois/bulk-delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poiIds: selectedPois })
      })

      if (response.ok) {
        setSelectedPois([])
        fetchPois()
      } else {
        alert(t('alerts.delete_bulk_error'))
      }
    } catch (error) {
      console.error('Error deleting POIs:', error)
      alert(t('alerts.delete_bulk_error'))
    }
  }

  // Handle bulk garbage
  const handleBulkGarbage = async () => {
    if (selectedPois.length === 0) return

    if (!confirm(`Deseja marcar ${selectedPois.length} itens como LIXO? Eles serão excluídos e bloqueados para re-importação.`)) return

    try {
      const response = await fetch('/api/pois/bulk-garbage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poiIds: selectedPois })
      })

      if (response.ok) {
        setSelectedPois([])
        fetchPois()
      } else {
        const errorData = await response.json()
        alert(errorData.error || 'Erro na operação em lote')
      }
    } catch (error) {
      console.error('Error bulk marking as garbage:', error)
      alert('Erro na requisição')
    }
  }

  // Handle POI selection
  const handlePoiSelection = (poiId: string, isSelected: boolean) => {
    if (isSelected) {
      setSelectedPois(prev => [...prev, poiId])
    } else {
      setSelectedPois(prev => prev.filter(id => id !== poiId))
    }
  }

  // Handle select all
  const handleSelectAll = () => {
    setSelectedPois(pois.map(poi => poi.id))
  }

  // Handle deselect all
  const handleDeselectAll = () => {
    setSelectedPois([])
  }

  // Handle page change
  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  // Handle view mode change
  const handleViewModeChange = (mode: 'list' | 'cards' | 'map') => {
    setViewMode(mode)
  }

  // Clear all filters
  const clearFilters = () => {
    setSearchTerm('')
    setStatusFilter('all')
    setCityFilter('')
    setCountryFilter('')
    setStateFilter('')
    setCategoryFilter('all')
    setOsmCategoryFilter('all')

    setContentStatusFilter('all')
    setGroupStatusFilter('all')
    setScoreFilter('all')
    setTriggerPointsFilter('all')
    setIsActiveFilter('all')
    setCurrentPage(1)
  }

  // Get filter options
  const filterOptions = useMemo(() => ({
    countries: locationData.countries.map(country => ({
      value: country.name,
      label: `${country.name} (${country.totalPOIs})`
    })),
    states: locationData.states.map(state => ({
      value: state.value,
      label: state.label
    })),
    cities: locationData.cities.map(city => ({
      value: city.name,
      label: city.name
    })),

    categories: POI_CATEGORIES.map(cat => ({
      value: cat.value,
      label: cat.label
    })),
    status: [
      { value: 'all', label: t('status_options.all') },
      { value: 'approved', label: t('status_options.approved') },
      { value: 'pending', label: t('status_options.pending') }
    ],
    contentStatus: [
      { value: 'all', label: t('status_options.all_content') },
      { value: 'missing_description', label: t('status_options.missing_description') },
      { value: 'missing_audio', label: t('status_options.missing_audio') },
      { value: 'complete', label: t('status_options.complete') }
    ],
    groupStatus: [
      { value: 'all', label: t('status_options.all_groups') },
      { value: 'grouped', label: t('status_options.grouped') },
      { value: 'ungrouped', label: t('status_options.ungrouped') },
      { value: 'group_main', label: t('status_options.group_main') },
      { value: 'group_member', label: t('status_options.group_member') }
    ],
    scoreFilter: [
      { value: 'all', label: t('status_options.all_scores') },
      { value: 'no_score', label: t('status_options.no_score') },
      { value: 'rejected', label: t('status_options.rejected') },
      { value: 'pending', label: t('status_options.pending') },
      { value: 'approved', label: t('status_options.approved') }
    ],
    triggerPointsFilter: [
      { value: 'all', label: t('status_options.all_trigger_points') },
      { value: 'with_trigger_points', label: t('status_options.with_trigger_points') }
      // 'without_trigger_points' ocultado: filtro de nicho (anti-join esparso ~7s) e
      // não usado na prática. Para esse workflow use /trigger-points/list-for-generation.
    ],
    isActiveFilter: [
      { value: 'all', label: t('status_options.all_active') },
      { value: 'active', label: t('status_options.active') },
      { value: 'inactive', label: t('status_options.inactive') }
    ]
  }), [locationData.countries, locationData.states, locationData.cities, countryFilter, stateFilter, t])

  const recordTypes = useMemo(() => [
    { value: 'all', label: t('status_options.all_types') },
    { value: 'point_of_interest', label: t('status_options.poi_standard') },
    { value: 'geofence', label: t('status_options.geofence') }
  ], [t])
  const hasActiveFilters = useMemo(() => {
    return searchTerm !== '' || 
           statusFilter !== 'all' || 
           categoryFilter !== 'all' ||
           osmCategoryFilter !== 'all' ||
           cityFilter !== '' || 
           countryFilter !== '' || 
           stateFilter !== '' || 
           contentStatusFilter !== 'all' || 
           groupStatusFilter !== 'all' || 
           scoreFilter !== 'all' || 
           triggerPointsFilter !== 'all' ||
           isActiveFilter !== 'all'
  }, [searchTerm, statusFilter, categoryFilter, osmCategoryFilter, cityFilter, countryFilter, stateFilter, contentStatusFilter, groupStatusFilter, scoreFilter, triggerPointsFilter, isActiveFilter])

  // Memoize the transformed POI to prevent infinite loops in POIDetailsModal's useEffect
  const memoizedPoiForModal = useMemo(() => {
    return selectedPoi ? transformPOIForModal(selectedPoi) : null
  }, [selectedPoi])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 lg:p-8 flex flex-col">
      <div className="flex gap-8 flex-1 pt-6">
        {/* Left Column - Filters Sidebar */}
        <div className="w-[18%] flex-shrink-0">
          <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 sticky top-24">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-tuggi-blue/10 rounded-xl">
                    <Filter className="h-5 w-5 text-tuggi-blue" />
                  </div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white tracking-tight">
                    {t('filters.title')}
                  </h2>
                </div>
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-lg transition-all"
                    title={t('filters.clear_all')}
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
                    placeholder={t('filters.search_placeholder')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-gray-50/50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:ring-2 focus:ring-tuggi-blue focus:border-transparent transition-all outline-none"
                  />
                </div>
              </div>

              {/* Filters List */}
              <div className="space-y-5">
                {/* Location Section */}
                <div>
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">{t('filters.location')}</h3>
                  <div className="space-y-3">
                    <select
                      value={countryFilter}
                      onChange={(e) => setCountryFilter(e.target.value)}
                      className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                      disabled={locationData.countriesLoading}
                    >
                      <option value="">{t('filters.all_countries')}</option>
                      {filterOptions.countries.map((country) => (
                        <option key={country.value} value={country.value}>
                          {country.label}
                        </option>
                      ))}
                    </select>

                    {/* State filter: hidden when country has no states */}
                    {countryHasStates && (
                      <select
                        value={stateFilter}
                        onChange={(e) => setStateFilter(e.target.value)}
                        className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all disabled:opacity-50"
                        disabled={!countryFilter || locationData.statesLoading}
                      >
                        <option value="">{t('filters.all_states')}</option>
                        {filterOptions.states.map((state) => (
                          <option key={state.value} value={state.value}>
                            {state.label}
                          </option>
                        ))}
                      </select>
                    )}

                    <select
                      value={cityFilter}
                      onChange={(e) => setCityFilter(e.target.value)}
                      className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all disabled:opacity-50"
                      disabled={!countryFilter || locationData.citiesLoading}
                    >
                      <option value="">{t('filters.all_cities')}</option>
                      {filterOptions.cities.map((city) => (
                        <option key={city.value} value={city.value}>
                          {city.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">{t('filters.status')}</h3>
                  <div className="space-y-3">
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as any)}
                      className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                    >
                      {filterOptions.status.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={contentStatusFilter}
                      onChange={(e) => setContentStatusFilter(e.target.value as any)}
                      className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                    >
                      {filterOptions.contentStatus.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={isActiveFilter}
                      onChange={(e) => setIsActiveFilter(e.target.value as any)}
                      className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                    >
                      {filterOptions.isActiveFilter.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Record Type Section */}
                <div>
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">{t('filters.record_type')}</h3>
                  <select
                    value={categoryFilter}
                    onChange={(e) => {
                      setCategoryFilter(e.target.value)
                      setCurrentPage(1)
                    }}
                    className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                  >
                    <option value="all">{t('status_options.all_types')}</option>
                    <option value="point_of_interest">{t('status_options.poi_standard')}</option>
                    <option value="geofence">{t('status_options.geofence')}</option>
                  </select>
                </div>

                <div>
                  <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-1">{t('filters.advanced')}</h3>
                  <div className="space-y-3">
                    <select
                      value={groupStatusFilter}
                      onChange={(e) => setGroupStatusFilter(e.target.value as any)}
                      className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                    >
                      {filterOptions.groupStatus.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={scoreFilter}
                      onChange={(e) => setScoreFilter(e.target.value as any)}
                      className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                    >
                      {filterOptions.scoreFilter.map((score) => (
                        <option key={score.value} value={score.value}>
                          {score.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={triggerPointsFilter}
                      onChange={(e) => setTriggerPointsFilter(e.target.value as any)}
                      className="w-full px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                    >
                      {filterOptions.triggerPointsFilter.map((filter) => (
                        <option key={filter.value} value={filter.value}>
                          {filter.label}
                        </option>
                      ))}
                    </select>

                    {/* Trigger Points Toggle */}
                    <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                      <label className="flex items-center justify-between cursor-pointer group p-1">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('filters.show_triggers')}</span>
                          <span className="text-[9px] text-gray-400 group-hover:text-tuggi-blue transition-colors">{t('filters.show_triggers_subtitle')}</span>
                        </div>
                        <div 
                          onClick={() => setShowTriggers(!showTriggers)}
                          className={cn(
                            "w-10 h-5 rounded-full transition-all duration-300 relative border",
                            showTriggers ? "bg-tuggi-blue border-tuggi-blue" : "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                          )}
                        >
                          <div className={cn(
                            "absolute top-1 w-3 h-3 rounded-full bg-white transition-all duration-300 shadow-sm",
                            showTriggers ? "left-6" : "left-1"
                          )} />
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Content */}
        <div className="w-[82%]">
          {/* Stats Summary Bar */}
          <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 mb-8 sticky top-0 z-30">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-8 pl-2">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Total de Registros</span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-gray-900 dark:text-white leading-none">{totalCount}</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-tuggi-blue animate-pulse" />
                  </div>
                </div>

                <div className="h-8 w-px bg-gray-200 dark:bg-gray-800" />

                {/* View Modes In Header */}
                <div className="flex items-center gap-1 p-1 bg-gray-50/50 dark:bg-gray-950/50 rounded-2xl border border-gray-100 dark:border-gray-800">
                  <button
                    onClick={() => handleViewModeChange('cards')}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300",
                      viewMode === 'cards' 
                        ? "bg-white dark:bg-gray-800 text-tuggi-blue shadow-md shadow-black/5" 
                        : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    )}
                  >
                    <Grid className="h-3.5 w-3.5" />
                    Cards
                  </button>
                  <button
                    onClick={() => handleViewModeChange('list')}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300",
                      viewMode === 'list' 
                        ? "bg-white dark:bg-gray-800 text-tuggi-blue shadow-md shadow-black/5" 
                        : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    )}
                  >
                    <List className="h-3.5 w-3.5" />
                    List
                  </button>
                  <button
                    onClick={() => handleViewModeChange('map')}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300",
                      viewMode === 'map' 
                        ? "bg-white dark:bg-gray-800 text-tuggi-blue shadow-md shadow-black/5" 
                        : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    )}
                  >
                    <Map className="h-3.5 w-3.5" />
                    Map
                  </button>
                </div>

                <div className="h-8 w-px bg-gray-200 dark:bg-gray-800" />
                
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    {canEdit && (
                      <button
                        onClick={() => {
                          setSelectedPoi(null)
                          setIsModalOpen(true)
                          const currentParamsStr = typeof window !== 'undefined' ? window.location.search : searchParams.toString()
                          const params = new URLSearchParams(currentParamsStr)
                          params.set('new', 'true')
                          router.push(`?${params.toString()}`, { scroll: false })
                        }}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-semibold text-xs bg-tuggi-blue text-white hover:bg-tuggi-blue/90 shadow-lg shadow-tuggi-blue/20 transition-all duration-300"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t('add_manually')}
                      </button>
                    )}

                    {cmsUserRole === 'admin' && (
                      <Link
                        href="/poi-importer"
                        className="flex items-center gap-2 px-5 py-2.5 rounded-2xl font-semibold text-xs bg-green-600 text-white hover:bg-green-600/90 shadow-lg shadow-green-600/20 transition-all duration-300"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t('import_pois')}
                      </Link>
                    )}
                  </div>
                  
                  {selectedPois.length > 0 && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-tuggi-blue/10 rounded-xl">
                      <span className="text-xs font-bold text-tuggi-blue">{selectedPois.length}</span>
                      <span className="text-[10px] font-bold text-tuggi-blue/60 uppercase tracking-tighter">Selecionados</span>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-3 pr-2">
                {selectedPois.length > 0 && isAdmin && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleBulkDelete}
                      className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-500 rounded-xl font-bold text-xs hover:bg-red-500/20 transition-all border border-red-500/10"
                      title="Excluir (Move para Lixeira)"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Excluir
                    </button>
                    <button
                      onClick={handleBulkGarbage}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white dark:bg-white dark:text-gray-900 rounded-xl font-bold text-xs hover:opacity-80 transition-all border border-transparent"
                      title="Marcar como Lixo (Blacklist)"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Lixo
                    </button>
                  </div>
                )}
                <button
                  onClick={handleSelectAll}
                  className="px-4 py-2 bg-tuggi-blue/10 text-tuggi-blue font-bold text-xs rounded-xl hover:bg-tuggi-blue/20 transition-all"
                >
                  {t('controls.select_all')}
                </button>
                <button
                  onClick={() => setSelectedPois([])}
                  className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-bold text-xs rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-all"
                >
                  {t('controls.deselect_all')}
                </button>
              </div>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1">
            {viewMode === 'map' ? (
              <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 overflow-hidden">
                <OptimizedPOIMap
                  searchTerm={searchTerm}
                  statusFilter={statusFilter}
                  countryFilter={countryFilter}
                  stateFilter={stateFilter}
                  cityFilter={cityFilter}
                  contentStatusFilter={contentStatusFilter}
                  groupStatusFilter={groupStatusFilter}
                  triggerPointsFilter={triggerPointsFilter}
                  showTriggers={showTriggers}
                  onPOIClick={handleSelectPoiForMap}
                  onPOIDelete={(poi) => handleDeletePoi(poi.id)}
                  onPOIGarbage={(poi) => handleGarbagePoi(poi.id)}
                  canGarbage={isAdmin}
                  actionMenuLabels={{
                    edit: t('map_actions.edit'),
                    delete: t('map_actions.delete'),
                    garbage: t('map_actions.garbage'),
                    approved: t('map_actions.approved'),
                    pending: t('map_actions.pending')
                  }}
                  height="70vh"
                  className="w-full"
                />
              </div>
            ) : (
              <div className="space-y-6">
                {isLoading ? (
                  <div className="h-96 flex flex-col items-center justify-center bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm rounded-3xl border border-gray-200 dark:border-gray-800">
                    <div className="relative">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-tuggi-blue"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-2 h-2 bg-tuggi-blue rounded-full animate-pulse" />
                      </div>
                    </div>
                    <p className="mt-4 text-gray-500 font-semibold dark:text-gray-400 uppercase tracking-widest text-xs">Carregando POIs...</p>
                  </div>
                ) : filteredPois.length === 0 ? (
                  <div className="h-96 flex flex-col items-center justify-center bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm rounded-3xl border border-gray-200 dark:border-gray-800">
                    <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-2xl mb-4">
                      <MapPin className="h-10 w-10 text-gray-400" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">{t('list.no_pois_found')}</h3>
                    <p className="text-gray-500 dark:text-gray-400 font-medium">{t('list.no_pois_subtitle')}</p>
                  </div>
                ) : (
                  <>
                    {/* POI Content */}
                    <div className={cn(
                      "transition-all duration-500",
                      viewMode === 'cards' 
                        ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-6" 
                        : "space-y-3"
                    )}>
                      {filteredPois.map((poi) => (
                        <div
                          key={poi.id}
                          className={cn(
                            "group transition-all duration-300 cursor-pointer overflow-hidden relative",
                            viewMode === 'cards' 
                              ? "bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200/60 dark:border-gray-800/60 rounded-[1.5rem] hover:shadow-2xl hover:shadow-tuggi-blue/5 hover:-translate-y-1 hover:border-tuggi-blue/30 p-5" 
                              : "bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl p-4 border border-gray-200/60 dark:border-gray-800/60 rounded-2xl hover:border-tuggi-blue/30 hover:shadow-xl hover:shadow-black/5"
                          )}
                          onClick={() => handleSelectPoi(poi)}
                        >
                          {/* Premium Status Light */}
                          <div className={cn(
                            "absolute top-0 left-0 w-full h-1 opacity-80",
                            poi.approved 
                              ? "bg-gradient-to-r from-green-400 to-emerald-500" 
                              : "bg-gradient-to-r from-orange-400 to-amber-500"
                          )} />

                          <div className={cn(
                            "flex",
                            viewMode === 'cards' ? "flex-col h-full" : "items-center gap-6"
                          )}>
                            {/* Card Header Layer */}
                            {viewMode === 'cards' && (
                              <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                  {poi.category ? (
                                    <span className="text-[10px] font-bold text-tuggi-blue uppercase tracking-widest px-2.5 py-1 bg-tuggi-blue/5 rounded-full border border-tuggi-blue/10">
                                      {poi.category}
                                    </span>
                                  ) : (
                                    <div className="w-1.5 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700" />
                                  )}
                                </div>
                                <div 
                                  className="relative cursor-pointer group/checkbox"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePoiSelection(poi.id, !selectedPois.includes(poi.id));
                                  }}
                                >
                                  <div className={cn(
                                    "h-5 w-5 rounded-lg border-2 transition-all duration-300 flex items-center justify-center",
                                    selectedPois.includes(poi.id)
                                      ? "bg-tuggi-blue border-tuggi-blue scale-105 shadow-lg shadow-tuggi-blue/20"
                                      : "border-gray-200 dark:border-gray-700 group-hover/checkbox:border-tuggi-blue/50 bg-white dark:bg-gray-900"
                                  )}>
                                    {selectedPois.includes(poi.id) && (
                                      <div className="w-2 h-2 rounded-[2px] bg-white animate-in zoom-in-50 duration-200" />
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* List View Checkbox & Status icon */}
                            {viewMode === 'list' && (
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <input
                                  type="checkbox"
                                  checked={selectedPois.includes(poi.id)}
                                  onChange={(e) => {
                                    e.stopPropagation()
                                    handlePoiSelection(poi.id, e.target.checked)
                                  }}
                                  className="h-3.5 w-3.5 text-tuggi-blue rounded border-gray-200 dark:bg-gray-800 focus:ring-0"
                                />
                                  <div className={cn(
                                    "p-1.5 rounded-lg flex items-center gap-1.5",
                                    poi.approved ? "bg-green-500/10 text-green-500" : "bg-orange-500/10 text-orange-500"
                                  )}>
                                    <MapPin className="h-4 w-4" />
                                    <span className="text-[10px] font-bold uppercase tracking-wider hidden lg:inline-block">
                                      {poi.category}
                                    </span>
                                  </div>
                              </div>
                            )}

                            <div className="flex-1 min-w-0">
                              <div className={cn(
                                "mb-3",
                                viewMode === 'list' && "grid grid-cols-1 md:grid-cols-4 gap-4 items-center"
                              )}>
                                <div className={cn(viewMode === 'list' && "col-span-2")}>
                                  <div className="h-[3rem] flex items-center mb-1">
                                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-tuggi-blue transition-colors leading-tight w-full">
                                      {poi.name}
                                    </h3>
                                  </div>
                                  <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 font-medium">
                                    <MapPin className="h-3.5 w-3.5 text-tuggi-blue/60 flex-shrink-0" />
                                    <span className="truncate">{poi.city}{poi.state ? `, ${poi.state}` : ''}</span>
                                  </div>
                                </div>

                                {viewMode === 'list' && (
                                  <div className="hidden md:flex items-center gap-4 text-[11px] text-gray-400">
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-800">
                                      <Target className="h-3 w-3 text-tuggi-blue/60" />
                                      <span className="font-medium text-gray-700 dark:text-gray-300">{poi.trigger_points_count || 0}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-800">
                                      <FileText className="h-3 w-3 text-orange-400/60" />
                                      <span className="font-medium text-gray-700 dark:text-gray-300">{poi.description_count || 0}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-800">
                                      <Volume2 className="h-3 w-3 text-green-400/60" />
                                      <span className="font-medium text-gray-700 dark:text-gray-300">{poi.audio_count || 0}</span>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Cards Stats Area */}
                              {viewMode === 'cards' && (
                                <div className="mt-auto pt-4 border-t border-gray-100/80 dark:border-gray-800/50 flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <div 
                                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800/50 group-hover:border-tuggi-blue/10 transition-colors"
                                      title="Trigger Points"
                                    >
                                      <Target className="h-3.5 w-3.5 text-tuggi-blue" />
                                      <span className="text-xs font-bold text-gray-600 dark:text-gray-400 leading-none">{poi.trigger_points_count || 0}</span>
                                    </div>
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

                                  <div className="flex items-center gap-2">
                                    <div className="opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center gap-1">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleSelectPoi(poi)
                                        }}
                                        className="p-2 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/10 rounded-xl transition-all border border-transparent hover:border-tuggi-blue/20"
                                      >
                                        <Eye className="h-4 w-4" />
                                      </button>
                                      {isAdmin && (
                                        <div className="flex items-center gap-1">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              handleDeletePoi(poi.id)
                                            }}
                                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all border border-transparent hover:border-red-500/20"
                                            title="Excluir"
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </button>
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              handleGarbagePoi(poi.id)
                                            }}
                                            className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-all border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
                                            title="Marcar como Lixo"
                                          >
                                            <XCircle className="h-4 w-4" />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* List Row End Actions */}
                              {viewMode === 'list' && (
                                <div className="ml-auto flex items-center gap-2">
                                  <VerificationBadge
                                    attractionId={poi.id}
                                    verificationData={poi.verification_data}
                                  />
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleSelectPoi(poi)
                                      }}
                                      className="p-1.5 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-lg transition-all"
                                    >
                                      <Eye className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Pagination - Premium Style */}
                    {totalPages > 1 && (
                      <div className="mt-10 px-6 py-5 bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl shadow-black/5 flex items-center justify-between">
                        <div className="flex items-center gap-6">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Página</span>
                            <span className="text-xl font-bold text-gray-900 dark:text-white leading-none">
                              {currentPage} <span className="text-gray-300 dark:text-gray-700 mx-1">/</span> {totalPages}
                            </span>
                          </div>
                          
                          <div className="flex flex-col">
                            <label htmlFor="itemsPerPage" className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Items</label>
                            <select
                              id="itemsPerPage"
                              value={itemsPerPage}
                              onChange={(e) => {
                                setItemsPerPage(Number(e.target.value))
                                setCurrentPage(1)
                              }}
                              className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-tuggi-blue transition-all"
                            >
                              {[20, 50, 100, 200, 500].map(val => (
                                <option key={val} value={val}>{val}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                            className="p-3 bg-gray-50 dark:bg-gray-800 text-gray-500 rounded-2xl hover:bg-tuggi-blue hover:text-white disabled:opacity-30 disabled:hover:bg-gray-50 disabled:hover:text-gray-500 transition-all duration-300 border border-gray-100 dark:border-gray-700 shadow-sm"
                          >
                            <ChevronLeft className="h-6 w-6" />
                          </button>
                          <button
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                            className="p-3 bg-gray-50 dark:bg-gray-800 text-gray-500 rounded-2xl hover:bg-tuggi-blue hover:text-white disabled:opacity-30 disabled:hover:bg-gray-50 disabled:hover:text-gray-500 transition-all duration-300 border border-gray-100 dark:border-gray-700 shadow-sm"
                          >
                            <ChevronRight className="h-6 w-6" />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* POI Details Modal */}
      <POIDetailsModal
        mode={selectedPoi ? 'view' : 'create'}
        poi={memoizedPoiForModal}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
            setSelectedPoi(null)
            const params = new URLSearchParams(searchParams.toString())
            params.delete('poiId')
            params.delete('new')
            router.push(`?${params.toString()}`, { scroll: false })
          }}
          onUpdate={() => {
            console.log('📝 [PAGE] onUpdate called - Force refetching...')
            invalidateAllPOICaches()
            fetchPois()
          }}
          onPOIUpdated={(updatedPOI: any) => {
            console.log('📝 [PAGE] onPOIUpdated called - Syncing list and cache...')
            
            // 1. Force state update for the active POI
            setSelectedPoi(updatedPOI)
            
            // 2. Invalidate cache globally for POIs
            invalidateAllPOICaches()
            
            // 3. Update the specific record in any active queries to be optimistic
            queryClient.setQueriesData({ queryKey: ['pois'], exact: false }, (oldData: any) => {
              if (!oldData || !oldData.data) return oldData
              return {
                ...oldData,
                data: oldData.data.map((p: any) => p.id === updatedPOI.id ? { ...p, ...updatedPOI } : p)
              }
            })
            
            // 4. Force a hard refetch after a small delay to catch backend changes
            setTimeout(() => {
              fetchPois()
            }, 300)
          }}
          onPOIDeleted={(deletedId) => {
            console.log('📝 [PAGE] onPOIDeleted called - Removing from list...')
            
            // 1. Clear state
            setSelectedPoi(null)
            setIsModalOpen(false)
            setSelectedPois(prev => prev.filter(id => id !== deletedId))
            
            // 2. Remove from cache immediately
            queryClient.setQueriesData({ queryKey: ['pois'], exact: false }, (oldData: any) => {
              if (!oldData || !oldData.data) return oldData
              return {
                ...oldData,
                data: oldData.data.filter((p: any) => p.id !== deletedId),
                pagination: {
                  ...oldData.pagination,
                  totalCount: Math.max(0, (oldData.pagination?.totalCount || 0) - 1)
                }
              }
            })
             
            // 3. Invalidate and Refetch
            invalidateAllPOICaches()
            
            // 4. Update URL
            const params = new URLSearchParams(searchParams.toString())
            params.delete('poiId')
            router.push(`?${params.toString()}`, { scroll: false })
            
            // 5. Final refetch
            setTimeout(() => fetchPois(), 100)
          }}

        />
    </div>
  )
}

// Main component with Suspense
export default function POIListPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tuggi-blue"></div>
      </div>
    }>
      <POIListWithSearchParams />
    </Suspense>
  )
}