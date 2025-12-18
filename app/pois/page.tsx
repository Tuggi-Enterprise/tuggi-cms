'use client'

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Search, Filter, Edit, XCircle, Eye, Trash2, Calendar, Users, ChevronLeft, ChevronRight, List, Map, Grid, X, MapPin } from 'lucide-react'
import Link from 'next/link'

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
  const [pois, setPois] = useState<POIType[]>([])
  const [filteredPois, setFilteredPois] = useState<POIType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending'>('all')
  const [cityFilter, setCityFilter] = useState('')
  const [googleTypesFilter, setGoogleTypesFilter] = useState('')
  const [contentStatusFilter, setContentStatusFilter] = useState<'all' | 'missing_description' | 'missing_audio' | 'complete'>('all')
  const [groupStatusFilter, setGroupStatusFilter] = useState<'all' | 'grouped' | 'ungrouped' | 'group_main' | 'group_member'>('all')
  const [scoreFilter, setScoreFilter] = useState<'all' | 'no_score' | 'rejected' | 'pending' | 'approved'>('all')
  const [triggerPointsFilter, setTriggerPointsFilter] = useState<'all' | 'with_trigger_points' | 'without_trigger_points'>('all')
  const [selectedPois, setSelectedPois] = useState<string[]>([])  
  const [countryFilter, setCountryFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [selectedPoi, setSelectedPoi] = useState<POIType | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [cmsUserRole, setCmsUserRole] = useState<string | null>(null)
  
  // View state
  const [viewMode, setViewMode] = useState<'list' | 'cards' | 'map'>('cards')
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(100) // Increased to better utilize Supabase's 1000 limit
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  
  const router = useRouter()
  const searchParams = useSearchParams()

  // Use centralized location data
  const locationData = useLocationData({ autoLoadCountries: true })

  // Track if we're initializing from URL to prevent unnecessary updates
  const [isInitializing, setIsInitializing] = useState(true)

  // Debounce search term to avoid excessive filtering
  const debouncedSearchTerm = useDebounce(searchTerm, 300)

  // Function to update URL with current filter states and view mode
  const updateURL = (filters: {
    search?: string
    status?: string
    city?: string
    country?: string
    state?: string
    googleTypes?: string
    contentStatus?: string
    groupStatus?: string
    scoreFilter?: string
    triggerPointsFilter?: string
    page?: number
    view?: string
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
    
    if (filters.googleTypes && filters.googleTypes.trim()) {
      params.set('googleTypes', filters.googleTypes)
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
    if (filters.page && filters.page > 1) {
      params.set('page', filters.page.toString())
    }
    if (filters.view && filters.view !== 'cards') {
      params.set('view', filters.view)
    }

    const newURL = params.toString() ? `?${params.toString()}` : ''
    router.replace(`/pois${newURL}`, { scroll: false })
  }

  // Read filters from URL on mount
  const readFiltersFromURL = useCallback(() => {
    const search = searchParams.get('search') || ''
    const status = (searchParams.get('status') as 'all' | 'approved' | 'pending') || 'all'
    const city = searchParams.get('city') || ''
    const country = searchParams.get('country') || ''
    const state = searchParams.get('state') || ''
    const googleTypes = searchParams.get('googleTypes') || ''
    const contentStatus = (searchParams.get('contentStatus') as 'all' | 'missing_description' | 'missing_audio' | 'complete') || 'all'
    const groupStatus = (searchParams.get('groupStatus') as 'all' | 'grouped' | 'ungrouped' | 'group_main' | 'group_member') || 'all'
    const score = (searchParams.get('scoreFilter') as 'all' | 'no_score' | 'rejected' | 'pending' | 'approved') || 'all'
    const triggerPoints = (searchParams.get('triggerPointsFilter') as 'all' | 'with_trigger_points' | 'without_trigger_points') || 'all'
    const page = parseInt(searchParams.get('page') || '1')
    const view = (searchParams.get('view') as 'list' | 'cards' | 'map') || 'cards'

    setSearchTerm(search)
    setStatusFilter(status)
    setCityFilter(city)
    setCountryFilter(country)
    setStateFilter(state)
    setGoogleTypesFilter(googleTypes)
    setContentStatusFilter(contentStatus)
    setGroupStatusFilter(groupStatus)
    setScoreFilter(score)
    setTriggerPointsFilter(triggerPoints)
    setCurrentPage(page)
    setViewMode(view)
  }, [searchParams])

  // Determine map loading strategy based on geographic context
  const getMapLoadingStrategy = useCallback((filters: POISearchFilters) => {
    console.log('🗺️ Current viewMode:', viewMode)
    
    // For map view, use intelligent loading strategy
    if (viewMode === 'map') {
      // Case 1: No country filter = show country aggregation
      if (!filters.country) {
        return {
          fetch_all: true,
          limit: 0, // No pagination for map
          page: 1,
          map_view: true,
          strategy: 'country_aggregation'
        }
      }
      // Case 2: Country but no state = show all POIs in country
      else if (!filters.state) {
        return {
          fetch_all: true,
          limit: 0,
          page: 1,
          map_view: true,
          strategy: 'country_all'
        }
      }
      // Case 3: Country + state but no city = show all POIs in state
      else if (!filters.city) {
        return {
          fetch_all: true,
          limit: 0,
          page: 1,
          map_view: true,
          strategy: 'state_all'
        }
      }
      // Case 4: Country + state + city = show all POIs in city
      else {
        return {
          fetch_all: true,
          limit: 0,
          page: 1,
          map_view: true,
          strategy: 'city_all'
        }
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

  // Load POIs using centralized service
  const fetchPois = useCallback(async () => {
    setIsLoading(true)

    try {
      const baseFilters: POISearchFilters = {
        search: debouncedSearchTerm,
        status: statusFilter,
        country: countryFilter,
        state: stateFilter,
        city: cityFilter,
        googleTypes: googleTypesFilter,
        contentStatus: contentStatusFilter,
        groupStatus: groupStatusFilter,
        scoreFilter: scoreFilter,
        triggerPointsFilter: triggerPointsFilter
      }

      // Get intelligent loading strategy
      const mapStrategy = getMapLoadingStrategy(baseFilters)
      
      const filters: POISearchFilters = {
        ...baseFilters,
        ...mapStrategy
      }

      console.log('🗺️ Map Loading Strategy:', mapStrategy.strategy)
      console.log('🗺️ Filters for search:', filters)

      const result = await poiService.search(filters)
      
      if (result.success) {
        setPois(result.data || [])
        setFilteredPois(result.data || [])
        setTotalCount(result.pagination.totalCount)
        setTotalPages(result.pagination.totalPages)
      } else {
        console.error('Failed to load POIs:', result.error)
      }
    } catch (error) {
      console.error('Error loading POIs:', error)
    } finally {
      setIsLoading(false)
    }
  }, [debouncedSearchTerm, statusFilter, countryFilter, stateFilter, cityFilter, googleTypesFilter, contentStatusFilter, groupStatusFilter, scoreFilter, triggerPointsFilter, itemsPerPage, currentPage, getMapLoadingStrategy])


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
    if (country && state) {
      console.log('🔄 Loading cities for country:', country, 'state:', state)
      locationData.loadCities(country, state)
    }
  }, [locationData.loadCities])

  // Load states when country changes
  useEffect(() => {
    // Fetch current CMS role for UI role-based decisions
    const fetchRole = async () => {
      try {
        const response = await fetch('/api/auth/check')
        if (!response.ok) return
        const data = await response.json()
        setCmsUserRole(data?.user?.role || null)
      } catch (err) {
        console.warn('Failed to fetch cms user role:', err)
      }
    }
    fetchRole()
  }, [])

  useEffect(() => {
    if (countryFilter) {
      const timeoutId = setTimeout(() => {
        loadStatesForCountry(countryFilter)
      }, 100) // Reduced debounce for better UX
      
      return () => clearTimeout(timeoutId)
    }
  }, [countryFilter, loadStatesForCountry])

  // Load cities only when both country and state are selected
  useEffect(() => {
    if (countryFilter && stateFilter) {
      const timeoutId = setTimeout(() => {
        loadCitiesForLocation(countryFilter, stateFilter)
      }, 100) // Reduced debounce for better UX
      
      return () => clearTimeout(timeoutId)
    } else if (countryFilter && !stateFilter) {
      // Clear cities when state is deselected
      setCityFilter('')
    }
  }, [countryFilter, stateFilter, loadCitiesForLocation])

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
        googleTypes: googleTypesFilter,
        contentStatus: contentStatusFilter,
        groupStatus: groupStatusFilter,
        scoreFilter: scoreFilter,
        triggerPointsFilter: triggerPointsFilter,
        page: currentPage,
        view: viewMode
      })
    }
  }, [searchTerm, statusFilter, cityFilter, countryFilter, stateFilter, googleTypesFilter, contentStatusFilter, groupStatusFilter, scoreFilter, triggerPointsFilter, currentPage, viewMode, isInitializing, updateURL])

  // Transform POI from service to modal format
  const transformPOIForModal = (poi: POIType): POI => ({
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
    coordinates: poi.coordinates || undefined,
    reference_links: poi.reference_links || [],
    descriptions: poi.descriptions || [],
    group_status: poi.group_status || undefined,
    verification_score: poi.verification_score || null
  })

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
    coordinates: poi.coordinates || undefined,
    reference_links: poi.reference_links || [],
    descriptions: poi.descriptions || [],
    group_status: poi.group_status || undefined,
    verification_score: poi.verification_score || null
  })

  // Handle POI selection
  const handleSelectPoi = (poi: POIType) => {
    setSelectedPoi(poi)
    setIsModalOpen(true)
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
      coordinates: poi.coordinates || undefined,
      reference_links: poi.reference_links || [],
      descriptions: poi.descriptions || [],
      group_status: poi.group_status || undefined,
      verification_score: poi.verification_score || undefined
    }
    setSelectedPoi(transformedPoi)
    setIsModalOpen(true)
  }

  // Handle POI deletion
  const handleDeletePoi = async (poiId: string) => {
    if (!confirm('Are you sure you want to delete this POI?')) return

    try {
      const response = await fetch(`/api/pois/${poiId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        // Reload POIs
        fetchPois()
      } else {
        alert('Failed to delete POI')
      }
    } catch (error) {
      console.error('Error deleting POI:', error)
      alert('Failed to delete POI')
    }
  }

  // Handle bulk operations
  const handleBulkDelete = async () => {
    if (selectedPois.length === 0) return
    
    if (!confirm(`Are you sure you want to delete ${selectedPois.length} POIs?`)) return

    try {
      const response = await fetch('/api/pois/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poiIds: selectedPois })
      })

      if (response.ok) {
        setSelectedPois([])
        fetchPois()
      } else {
        alert('Failed to delete POIs')
      }
    } catch (error) {
      console.error('Error deleting POIs:', error)
      alert('Failed to delete POIs')
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
    setGoogleTypesFilter('')
    setContentStatusFilter('all')
    setGroupStatusFilter('all')
    setScoreFilter('all')
    setTriggerPointsFilter('all')
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
    googleTypes: [
      { value: 'tourist_attraction', label: 'Tourist Attraction' },
      { value: 'museum', label: 'Museum' },
      { value: 'park', label: 'Park' },
      { value: 'restaurant', label: 'Restaurant' },
      { value: 'lodging', label: 'Lodging' },
      { value: 'shopping_mall', label: 'Shopping Mall' },
      { value: 'church', label: 'Church' },
      { value: 'hospital', label: 'Hospital' },
      { value: 'school', label: 'School' },
      { value: 'bank', label: 'Bank' }
    ],
    categories: POI_CATEGORIES.map(cat => ({
      value: cat.value,
      label: cat.label
    })),
    status: [
      { value: 'all', label: 'All Status' },
      { value: 'approved', label: 'Approved' },
      { value: 'pending', label: 'Pending' }
    ],
    contentStatus: [
      { value: 'all', label: 'All Content' },
      { value: 'missing_description', label: 'Missing Description' },
      { value: 'missing_audio', label: 'Missing Audio' },
      { value: 'complete', label: 'Complete' }
    ],
    groupStatus: [
      { value: 'all', label: 'All Groups' },
      { value: 'grouped', label: 'Grouped' },
      { value: 'ungrouped', label: 'Ungrouped' },
      { value: 'group_main', label: 'Group Main' },
      { value: 'group_member', label: 'Group Member' }
    ],
    scoreFilter: [
      { value: 'all', label: 'All Scores' },
      { value: 'no_score', label: 'No Score' },
      { value: 'rejected', label: 'Rejected' },
      { value: 'pending', label: 'Pending' },
      { value: 'approved', label: 'Approved' }
    ],
    triggerPointsFilter: [
      { value: 'all', label: 'All Trigger Points' },
      { value: 'with_trigger_points', label: 'With Trigger Points' },
      { value: 'without_trigger_points', label: 'Without Trigger Points' }
    ]
  }), [locationData.countries, locationData.states, locationData.cities, countryFilter, stateFilter])

  return (
    <div className="p-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center">
              <MapPin className="h-8 w-8 mr-3 text-tuggi-orange" />
              POI Management
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
                Manage and organize Points of Interest
              </p>
            </div>
              <div className="flex gap-3">
              <button
                onClick={() => {
                  setSelectedPoi(null)
                  setIsModalOpen(true)
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center"
              >
                <Plus className="h-4 w-4 mr-2" />
                Adicionar POI Manualmente
              </button>
              {cmsUserRole === 'admin' && (
                <Link
                  href="/poi-importer"
                  className="px-4 py-2 bg-tuggi-blue text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Import POIs
                </Link>
              )}
            </div>
          </div>
        </div>


      <div className="flex gap-6">
        {/* Left Column - Filters */}
        <div className="w-[15%]">
        {/* Search and Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                  <Filter className="h-5 w-5 mr-2 text-tuggi-blue" />
                  Filters
              </h2>
                <button
                  onClick={clearFilters}
                  className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Clear All
                </button>
            </div>

            {/* Search Bar */}
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search POIs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                />
              </div>
            </div>

            {/* Filters */}
              <div className="space-y-4">
                {/* Country Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Country
                  </label>
                  <select
                    value={countryFilter}
                    onChange={(e) => setCountryFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                    disabled={locationData.countriesLoading}
                  >
                    <option value="">All Countries</option>
                    {filterOptions.countries.map((country) => (
                      <option key={country.value} value={country.value}>
                        {country.label}
                      </option>
                    ))}
                  </select>
                  {locationData.countriesLoading && (
                    <div className="flex items-center mt-1 text-sm text-gray-500">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-tuggi-blue mr-1"></div>
                      Loading countries...
                    </div>
                  )}
                </div>

                {/* State Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    State
                  </label>
                  <select
                    value={stateFilter}
                    onChange={(e) => setStateFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                    disabled={!countryFilter || locationData.statesLoading}
                  >
                    <option value="">All States</option>
                    {filterOptions.states.map((state) => (
                      <option key={state.value} value={state.value}>
                        {state.label}
                      </option>
                    ))}
                  </select>
                  {locationData.statesLoading && (
                    <div className="flex items-center mt-1 text-sm text-gray-500">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-tuggi-blue mr-1"></div>
                      Loading states...
                    </div>
                  )}
                </div>

                {/* City Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    City
                  </label>
                  <select
                    value={cityFilter}
                    onChange={(e) => setCityFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                    disabled={!countryFilter || locationData.citiesLoading}
                  >
                    <option value="">All Cities</option>
                    {filterOptions.cities.map((city) => (
                      <option key={city.value} value={city.value}>
                        {city.label}
                      </option>
                    ))}
                  </select>
                  {locationData.citiesLoading && (
                    <div className="flex items-center mt-1 text-sm text-gray-500">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-tuggi-blue mr-1"></div>
                      Loading cities...
                    </div>
                  )}
                </div>

                {/* Status Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Status
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                  >
                    {filterOptions.status.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Content Status Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Content Status
                  </label>
                  <select
                    value={contentStatusFilter}
                    onChange={(e) => setContentStatusFilter(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                  >
                    {filterOptions.contentStatus.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Google Types Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Google Types
                  </label>
                  <select
                    value={googleTypesFilter}
                    onChange={(e) => setGoogleTypesFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                  >
                    <option value="">All Types</option>
                    {filterOptions.googleTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Group Status Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Group Status
                  </label>
                  <select
                    value={groupStatusFilter}
                    onChange={(e) => setGroupStatusFilter(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                  >
                    {filterOptions.groupStatus.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Score Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Score Filter
                  </label>
                  <select
                    value={scoreFilter}
                    onChange={(e) => setScoreFilter(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                  >
                    {filterOptions.scoreFilter.map((score) => (
                      <option key={score.value} value={score.value}>
                        {score.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Trigger Points Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Trigger Points
                  </label>
                  <select
                    value={triggerPointsFilter}
                    onChange={(e) => setTriggerPointsFilter(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-tuggi-blue focus:border-transparent"
                  >
                    {filterOptions.triggerPointsFilter.map((filter) => (
                      <option key={filter.value} value={filter.value}>
                        {filter.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Content */}
        <div className="w-[85%]">
          {/* View Controls and Bulk Actions */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                    onClick={() => handleViewModeChange('cards')}
                  className={cn(
                      "p-2 rounded-lg transition-colors",
                      viewMode === 'cards' ? "bg-tuggi-blue text-white" : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  )}
                >
                    <Grid className="h-4 w-4" />
                </button>
                <button
                    onClick={() => handleViewModeChange('list')}
                  className={cn(
                      "p-2 rounded-lg transition-colors",
                      viewMode === 'list' ? "bg-tuggi-blue text-white" : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  )}
                >
                    <List className="h-4 w-4" />
                </button>
                <button
                    onClick={() => handleViewModeChange('map')}
                  className={cn(
                      "p-2 rounded-lg transition-colors",
                      viewMode === 'map' ? "bg-tuggi-blue text-white" : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  )}
                >
                  <Map className="h-4 w-4" />
                </button>
              </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {totalCount} POIs found
              </div>
            </div>
            <div className="flex items-center gap-2">
                {selectedPois.length > 0 && cmsUserRole === 'admin' && (
                  <button
                    onClick={handleBulkDelete}
                    className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                  >
                    Delete Selected ({selectedPois.length})
                  </button>
                )}
                <button
                  onClick={handleSelectAll}
                  className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                >
                  Select All
                </button>
                <button
                  onClick={handleDeselectAll}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                >
                  Deselect All
                </button>
            </div>
          </div>
        </div>

        {/* Content */}
        {viewMode === 'map' ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
              <OptimizedPOIMap
                searchTerm={searchTerm}
                statusFilter={statusFilter}
                countryFilter={countryFilter}
                stateFilter={stateFilter}
                cityFilter={cityFilter}
                googleTypesFilter={googleTypesFilter}
                contentStatusFilter={contentStatusFilter}
                groupStatusFilter={groupStatusFilter}
                triggerPointsFilter={triggerPointsFilter}
                onPOIClick={handleSelectPoiForMap}
                height="600px"
                className="w-full rounded-lg"
              />
            </div>
        ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            {isLoading ? (
              <div className="p-8 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tuggi-blue mx-auto"></div>
                  <p className="mt-2 text-gray-500 dark:text-gray-400">Loading POIs...</p>
              </div>
              ) : filteredPois.length === 0 ? (
              <div className="p-8 text-center">
                <MapPin className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No POIs found</h3>
                  <p className="text-gray-500 dark:text-gray-400">Try adjusting your filters or search terms.</p>
              </div>
            ) : (
              <>
                {/* POI List */}
                <div className={cn(
                    "divide-y divide-gray-200 dark:divide-gray-700",
                    viewMode === 'cards' ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4" : ""
                )}>
                    {filteredPois.map((poi) => (
                    <div
                      key={poi.id}
                      className={cn(
                          "p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer",
                          viewMode === 'cards' && "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                      )}
                        onClick={() => handleSelectPoi(poi)}
                    >
                      <div className="flex items-start justify-between">
                          <div className="flex items-start">
                            <input
                              type="checkbox"
                              checked={selectedPois.includes(poi.id)}
                              onChange={(e) => {
                                e.stopPropagation()
                                handlePoiSelection(poi.id, e.target.checked)
                              }}
                              className="h-4 w-4 text-tuggi-blue rounded border-gray-300 focus:ring-tuggi-blue focus:ring-offset-0 mt-1"
                            />
                            {/* POI Image */}
                            <div className="flex-shrink-0">
                              {getThumbnailUrl(poi) ? (
                                <img
                                  src={getThumbnailUrl(poi)!}
                                  alt={poi.name}
                                  className="w-12 h-12 rounded-lg object-cover bg-gray-100 dark:bg-gray-700"
                                  loading="lazy"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                    target.nextElementSibling?.classList.remove('hidden');
                                  }}
                                />
                              ) : null}
                              <div className={`w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center ${getThumbnailUrl(poi) ? 'hidden' : ''}`}>
                                <MapPin className="w-5 h-5 text-gray-400" />
                              </div>
                            </div>
                            
                            <div className="ml-3 flex-1">
                          <div className="flex items-center gap-2 mb-2">
                                <h3 className="text-sm font-medium text-gray-900 dark:text-white">{poi.name}</h3>
                                <VerificationBadge 
                                  attractionId={poi.id}
                                  verificationData={poi.verification_data}
                                />
                          </div>
                              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                            {poi.city}, {poi.state && `${poi.state}, `}{poi.country}
                          </p>
                              <div className="flex items-center gap-4 text-xs text-gray-400 dark:text-gray-500">
                            <span>Trigger Points: {poi.trigger_points_count || 0}</span>
                            <span>Descriptions: {poi.description_count || 0}</span>
                            <span>Audio: {poi.audio_count || 0}</span>
                              </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                                handleSelectPoi(poi)
                            }}
                              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {cmsUserRole === 'admin' && (
                            <button
                            onClick={(e) => {
                              e.stopPropagation()
                                handleDeletePoi(poi.id)
                            }}
                            className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                      <span>
                          Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, totalCount)} of {totalCount} results
                          {totalCount > 1000 && (
                            <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                              (Supabase limit: 1000 per request)
                      </span>
                          )}
                        </span>
                        <div className="flex items-center gap-2">
                          <label htmlFor="itemsPerPage" className="text-sm font-medium">
                            Items per page:
                          </label>
                          <select
                            id="itemsPerPage"
                            value={itemsPerPage}
                            onChange={(e) => {
                              setItemsPerPage(Number(e.target.value))
                              setCurrentPage(1) // Reset to first page when changing items per page
                            }}
                            className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                          >
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                            <option value={200}>200</option>
                            <option value={500}>500</option>
                            <option value={1000}>1000 (Max - {Math.ceil(totalCount / 1000)} requests)</option>
                          </select>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                          onClick={() => handlePageChange(currentPage - 1)}
                          disabled={currentPage === 1}
                          className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Previous
                      </button>
                        <span className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300">
                          Page {currentPage} of {totalPages}
                      </span>
                      <button
                          onClick={() => handlePageChange(currentPage + 1)}
                          disabled={currentPage === totalPages}
                          className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                      >
                        Next
                        <ChevronRight className="h-4 w-4 ml-1" />
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

        {/* POI Details Modal */}
      {isModalOpen && (
          <POIDetailsModal
            mode={selectedPoi ? 'view' : 'create'}
            poi={selectedPoi ? transformPOIForModal(selectedPoi) : null}
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false)
              setSelectedPoi(null)
            }}
            onUpdate={() => {
              fetchPois()
            }}
            onPOIUpdated={(updatedPOI) => {
              // When a POI is created or updated, refresh the list and select the new/updated POI
              fetchPois()
              // If it's a new POI (has ID), we can optionally select it
              if (updatedPOI?.id) {
                setSelectedPoi(updatedPOI as any)
              }
            }}
          />
        )}
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