'use client'

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Search, Filter, Edit, CheckCircle, XCircle, Eye, Trash2, MapPin, Calendar, Star, Users, Clock, ChevronLeft, ChevronRight, List, Map, Grid, X } from 'lucide-react'
import Link from 'next/link'

import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import { POI_CATEGORIES } from '@/constants/poi-importer'
import { POIDetailsModal, type POI } from '@/components/poi-management/POIDetailsModal'
import { POIMapVisualization } from '@/components/poi-management/POIMapVisualization'
import { VerificationBadge } from '@/components/verification/VerificationBadge'
import { getThumbnailUrl } from '@/lib/imageUtils'

interface POIStats {
  total: number
  approved: number
  pending: number
  content_stats: {
    with_description: number
    with_audio: number
    complete: number
    missing_description: number
    missing_audio: number
  }
  group_stats: {
    grouped: number
    ungrouped: number
    group_main: number
    group_member: number
  }
  trigger_points_stats: {
    with_trigger_points: number
    without_trigger_points: number
    total_trigger_points: number
    active_trigger_points: number
  }
  verification_stats: {
    no_score: number
    pending: number
    approved: number
    rejected: number
  }
  countries: string[]
  cities: string[]
}

interface FilterOptions {
  countries: Array<{ value: string; label: string; cities: Array<{ value: string; label: string }> }>
  cities: Array<{ value: string; label: string }>
  googleTypes: Array<{ value: string; label: string }>
  categories: Array<{ value: string; label: string }>
  status: Array<{ value: string; label: string }>
  contentStatus: Array<{ value: string; label: string }>
  groupStatus: Array<{ value: string; label: string }>
  scoreFilter: Array<{ value: string; label: string }>
  triggerPointsFilter: Array<{ value: string; label: string }>
}

interface SearchResponse {
  success: boolean
  data: POI[]
  pagination: {
    page: number
    limit: number
    totalCount: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
    startIndex: number
    endIndex: number
  }
  filters: {
    search: string
    status: string
    country: string
    state: string
    city: string
    googleTypes: string
    category: string
    contentStatus: string
    groupStatus: string
    scoreFilter: string
    triggerPointsFilter: string
  }
}

// Component that handles search params
function POIListWithSearchParams() {
  const [pois, setPois] = useState<POI[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'pending'>('all')
  const [cityFilter, setCityFilter] = useState('')
  const [googleTypesFilter, setGoogleTypesFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [contentStatusFilter, setContentStatusFilter] = useState<'all' | 'missing_description' | 'missing_audio' | 'complete'>('all')
  const [groupStatusFilter, setGroupStatusFilter] = useState<'all' | 'grouped' | 'ungrouped' | 'group_main' | 'group_member'>('all')
  const [scoreFilter, setScoreFilter] = useState<'all' | 'no_score' | 'rejected' | 'pending' | 'approved'>('all')
  const [triggerPointsFilter, setTriggerPointsFilter] = useState<'all' | 'with_trigger_points' | 'without_trigger_points'>('all')
  const [selectedPois, setSelectedPois] = useState<string[]>([])
  const [countryFilter, setCountryFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [stats, setStats] = useState<POIStats | null>(null)
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null)
  const [selectedPoi, setSelectedPoi] = useState<POI | null>(null)
  const [availableCountries, setAvailableCountries] = useState<Array<{ value: string; label: string; count: number }>>([]) 
  const [availableCities, setAvailableCities] = useState<Array<{ value: string; label: string; count: number }>>([]) 
  const [availableStates, setAvailableStates] = useState<Array<{ value: string; label: string; count: number }>>([]) 
  const [isLoadingCountries, setIsLoadingCountries] = useState(false)
  const [isLoadingCities, setIsLoadingCities] = useState(false)
  const [isLoadingStates, setIsLoadingStates] = useState(false)
  
  // View state
  const [viewMode, setViewMode] = useState<'list' | 'cards' | 'map'>('cards')
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(20)
  const [pagination, setPagination] = useState({
    totalCount: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false
  })
  
  const router = useRouter()
  const searchParams = useSearchParams()

  // Track if we're initializing from URL to prevent unnecessary updates
  const [isInitializing, setIsInitializing] = useState(true)

  // Debounce search term to avoid excessive API calls
  const debouncedSearchTerm = useDebounce(searchTerm, 500)

  // Function to update URL with current filter states and view mode
  const updateURL = (filters: {
    search?: string
    status?: string
    city?: string
    country?: string
    state?: string
    googleTypes?: string
    category?: string
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
    if (filters.city && filters.city.trim()) {
      params.set('city', filters.city)
    }
    if (filters.state && filters.state.trim()) {
      params.set('state', filters.state)
    }
    if (filters.googleTypes && filters.googleTypes.trim()) {
      params.set('googleTypes', filters.googleTypes)
    }
    if (filters.category && filters.category.trim()) {
      params.set('category', filters.category)
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
    
    const newUrl = params.toString() ? `?${params.toString()}` : '/pois'
    router.push(newUrl, { scroll: false })
  }

  // Function to clear all filters
  const clearAllFilters = () => {
    setSearchTerm('')
    setStatusFilter('all')
    setCountryFilter('')
    setCityFilter('')
    setStateFilter('')
    setGoogleTypesFilter('')
    setCategoryFilter('')
    setContentStatusFilter('all')
    setGroupStatusFilter('all')
    setScoreFilter('all')
    setTriggerPointsFilter('all')
    setCurrentPage(1)
    setViewMode('cards')
    router.push('/pois', { scroll: false })
  }

  // Function to read filters from URL
  const readFiltersFromURL = useCallback(() => {
    const search = searchParams.get('search') || ''
    const status = (searchParams.get('status') as 'all' | 'approved' | 'pending') || 'all'
    const country = searchParams.get('country') || ''
    const state = searchParams.get('state') || ''
    const city = searchParams.get('city') || ''
    const googleTypes = searchParams.get('googleTypes') || ''
    const category = searchParams.get('category') || ''
    const contentStatus = (searchParams.get('contentStatus') as 'all' | 'missing_description' | 'missing_audio' | 'complete') || 'all'
    const groupStatus = (searchParams.get('groupStatus') as 'all' | 'grouped' | 'ungrouped' | 'group_main' | 'group_member') || 'all'
    const scoreFilterParam = (searchParams.get('scoreFilter') as 'all' | 'no_score' | 'rejected' | 'pending' | 'approved') || 'all'
    const triggerPointsFilterParam = (searchParams.get('triggerPointsFilter') as 'all' | 'with_trigger_points' | 'without_trigger_points') || 'all'
    const page = parseInt(searchParams.get('page') || '1')
    const view = (searchParams.get('view') as 'list' | 'cards' | 'map') || 'cards'

    setSearchTerm(search)
    setStatusFilter(status)
    setCountryFilter(country)
    setStateFilter(state)
    setCityFilter(city)
    setGoogleTypesFilter(googleTypes)
    setCategoryFilter(category)
    setContentStatusFilter(contentStatus)
    setGroupStatusFilter(groupStatus)
    setScoreFilter(scoreFilterParam)
    setTriggerPointsFilter(triggerPointsFilterParam)
    setCurrentPage(page)
    setViewMode(view)
  }, [searchParams])

  // Load countries on mount
  const loadCountries = async () => {
    setIsLoadingCountries(true)
    try {
      const response = await fetch('/api/pois/countries')
      const result = await response.json()
      
      if (result.success) {
        setAvailableCountries(result.data)
      } else {
        console.error('Failed to load countries:', result.error)
      }
    } catch (error) {
      console.error('Error loading countries:', error)
    } finally {
      setIsLoadingCountries(false)
    }
  }

  // Load states when country is selected
  const loadStates = async (country: string) => {
    if (!country) {
      setAvailableStates([])
      return
    }
    
    setIsLoadingStates(true)
    try {
      const response = await fetch(`/api/states?country=${encodeURIComponent(country)}`)
      const result = await response.json()
      
      if (result.success && Array.isArray(result.data)) {
        // API now returns objects with {value, label, count}
        setAvailableStates(result.data)
      } else {
        console.error('Failed to load states:', result.error || 'Invalid response')
        setAvailableStates([])
      }
    } catch (error) {
      console.error('Error loading states:', error)
      setAvailableStates([])
    } finally {
      setIsLoadingStates(false)
    }
  }

  // Load cities when country and state are selected
  const loadCities = async (country: string, state?: string) => {
    if (!country) {
      setAvailableCities([])
      return
    }
    
    setIsLoadingCities(true)
    try {
      let url = `/api/pois/cities?country=${encodeURIComponent(country)}`
      if (state) {
        url += `&state=${encodeURIComponent(state)}`
      }
      
      const response = await fetch(url)
      const result = await response.json()
      
      if (result.success) {
        setAvailableCities(result.data)
      } else {
        console.error('Failed to load cities:', result.error)
        setAvailableCities([])
      }
    } catch (error) {
      console.error('Error loading cities:', error)
      setAvailableCities([])
    } finally {
      setIsLoadingCities(false)
    }
  }

  // Load basic filter options (non-hierarchical)
  const loadFilterOptions = async () => {
    try {
      const response = await fetch('/api/pois/filters')
      const result = await response.json()
      
      if (result.success) {
        // Only keep non-hierarchical filters
        const { countries, cities, ...otherFilters } = result.data
        setFilterOptions({
          countries: [], // Will be loaded separately
          cities: [], // Will be loaded separately
          ...otherFilters
        })
      } else {
        console.error('Failed to load filter options:', result.error)
      }
    } catch (error) {
      console.error('Error loading filter options:', error)
    }
  }

  // Load POI statistics
  const loadStats = async () => {
    try {
      const params = new URLSearchParams()
      
      // Apply same filters as search
      if (debouncedSearchTerm) params.set('search', debouncedSearchTerm)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (countryFilter) params.set('country', countryFilter)
      if (stateFilter) params.set('state', stateFilter)
      if (cityFilter) params.set('city', cityFilter)
      if (googleTypesFilter) params.set('googleTypes', googleTypesFilter)
      if (categoryFilter) params.set('category', categoryFilter)
      
      const response = await fetch(`/api/pois/stats?${params.toString()}`)
      const result = await response.json()
      
      if (result.success) {
        setStats(result.data)
      } else {
        console.error('Failed to load stats:', result.error)
      }
    } catch (error) {
      console.error('Error loading stats:', error)
    }
  }

  // Load POIs using the new search endpoint
  const loadPois = async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      
      // Add all filters to the request
      if (debouncedSearchTerm) params.set('search', debouncedSearchTerm)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (countryFilter) params.set('country', countryFilter)
      if (stateFilter) params.set('state', stateFilter)
      if (cityFilter) params.set('city', cityFilter)
      if (googleTypesFilter) params.set('googleTypes', googleTypesFilter)
      if (categoryFilter) params.set('category', categoryFilter)
      if (contentStatusFilter !== 'all') params.set('contentStatus', contentStatusFilter)
      if (groupStatusFilter !== 'all') params.set('groupStatus', groupStatusFilter)
      if (scoreFilter !== 'all') params.set('scoreFilter', scoreFilter)
      if (triggerPointsFilter !== 'all') params.set('triggerPointsFilter', triggerPointsFilter)
      params.set('page', currentPage.toString())
      params.set('limit', itemsPerPage.toString())
      
      console.log('🔍 Loading POIs with params:', params.toString())
      
      const response = await fetch(`/api/pois/search?${params.toString()}`)
      const result: SearchResponse = await response.json()
      
      if (result.success) {
        setPois(result.data)
        setPagination({
          totalCount: result.pagination.totalCount,
          totalPages: result.pagination.totalPages,
          hasNextPage: result.pagination.hasNextPage,
          hasPrevPage: result.pagination.hasPrevPage
        })
        console.log('✅ POIs loaded:', result.data.length, 'of', result.pagination.totalCount)
      } else {
        console.error('Failed to load POIs:', (result as any).error)
        setPois([])
        setPagination({
          totalCount: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false
        })
      }
    } catch (error) {
      console.error('Error loading POIs:', error)
      setPois([])
      setPagination({
        totalCount: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Initialize from URL on mount
  useEffect(() => {
    readFiltersFromURL()
    loadFilterOptions()
    loadCountries() // Only load countries initially
    setIsInitializing(false)
    // Set loading to false if no filters are applied initially
    const hasInitialFilters = searchParams.get('country') || searchParams.get('search')
    if (!hasInitialFilters) {
      setIsLoading(false)
    }
  }, [])

  // Load states when country changes
  useEffect(() => {
    if (countryFilter) {
      loadStates(countryFilter)
      // Clear state and city when country changes
      if (stateFilter) {
        setStateFilter('')
        setCityFilter('')
      }
    } else {
      setAvailableStates([])
      setStateFilter('')
      setCityFilter('')
    }
  }, [countryFilter])

  // Load cities when country or state changes
  useEffect(() => {
    if (countryFilter) {
      loadCities(countryFilter, stateFilter)
      // Clear city when state changes
      if (stateFilter && cityFilter) {
        setCityFilter('')
      }
    } else {
      setAvailableCities([])
      setCityFilter('')
    }
  }, [countryFilter, stateFilter])

  // Update URL when filters change (but not during initialization)
  useEffect(() => {
    if (!isInitializing) {
      updateURL({
        search: debouncedSearchTerm,
        status: statusFilter,
        country: countryFilter,
        state: stateFilter,
        city: cityFilter,
        googleTypes: googleTypesFilter,
        category: categoryFilter,
        contentStatus: contentStatusFilter,
        groupStatus: groupStatusFilter,
        scoreFilter: scoreFilter,
        triggerPointsFilter: triggerPointsFilter,
        page: currentPage,
        view: viewMode
      })
    }
  }, [debouncedSearchTerm, statusFilter, countryFilter, stateFilter, cityFilter, googleTypesFilter, categoryFilter, contentStatusFilter, groupStatusFilter, scoreFilter, triggerPointsFilter, currentPage, viewMode, isInitializing])

  // Load POIs and stats when filters change
  useEffect(() => {
    if (!isInitializing) {
      // Only load POIs if there's at least a country selected or a search term
      if (countryFilter || debouncedSearchTerm) {
        loadPois()
        loadStats()
      } else {
        // Clear POIs if no country is selected and no search term
        setPois([])
        setPagination({
          totalCount: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false
        })
        setStats(null)
      }
    }
  }, [debouncedSearchTerm, statusFilter, countryFilter, stateFilter, cityFilter, googleTypesFilter, categoryFilter, contentStatusFilter, groupStatusFilter, scoreFilter, triggerPointsFilter, currentPage, viewMode, isInitializing])

  // Get filtered cities based on selected country (now using availableCities)
  const filteredCities = useMemo(() => {
    return availableCities
  }, [availableCities])

  // Get filtered states based on selected country (now using availableStates)
  const filteredStates = useMemo(() => {
    return availableStates
  }, [availableStates])

  // Navigation functions
  const goToPage = (page: number) => {
    setCurrentPage(page)
  }

  const goToPreviousPage = () => {
    if (pagination.hasPrevPage) {
      setCurrentPage(currentPage - 1)
    }
  }

  const goToNextPage = () => {
    if (pagination.hasNextPage) {
      setCurrentPage(currentPage + 1)
    }
  }

  // POI selection functions
  const togglePoiSelection = (poiId: string) => {
    setSelectedPois(prev => 
      prev.includes(poiId) 
        ? prev.filter(id => id !== poiId)
        : [...prev, poiId]
    )
  }

  const selectAllPois = () => {
    setSelectedPois(pois.map(poi => poi.id))
  }

  const clearSelection = () => {
    setSelectedPois([])
  }

  const handlePOIClick = (poi: POI) => {
    setSelectedPoi(poi)
  }

  const handleFiltersChange = () => {
    // Handle map filters change if needed
  }

  if (isLoading && pois.length === 0) {
    return <POIListLoading />
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar with Filters */}
      <div className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Filters</h2>
          
          <div className="space-y-4">
            {/* Search */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Search</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search POIs..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm"
                />
                {searchTerm !== debouncedSearchTerm && searchTerm && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-tuggi-blue"></div>
                  </div>
                )}
              </div>
            </div>

            {/* Status Filter */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Status</h3>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm"
              >
                {filterOptions?.status.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {/* Country Filter */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Country</h3>
              <select
                value={countryFilter}
                onChange={(e) => {
                  setCountryFilter(e.target.value)
                  setCityFilter('') // Reset city when country changes
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm"
                disabled={isLoadingCountries}
              >
                <option value="">All Countries</option>
                {availableCountries.map(option => (
                   <option key={option.value} value={option.value}>{option.label}</option>
                 ))}
              </select>
            </div>

            {/* State Filter */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">State</h3>
              <select
                value={stateFilter}
                onChange={(e) => {
                  setStateFilter(e.target.value)
                  setCityFilter('') // Reset city when state changes
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm"
                disabled={!countryFilter || isLoadingStates}
              >
                <option value="">{countryFilter ? `All States in ${countryFilter}` : 'Select a country first'}</option>
                {filteredStates.map((option: { value: string; label: string }) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
              </select>
              {isLoadingStates && (
                <div className="text-xs text-gray-500 mt-1 flex items-center">
                  <div className="animate-spin rounded-full h-3 w-3 border-b border-tuggi-blue mr-2"></div>
                  Loading states...
                </div>
              )}
            </div>

            {/* City Filter */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">City</h3>
              <select
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm"
                disabled={!countryFilter || isLoadingCities}
              >
                <option value="">
                  {stateFilter ? `All Cities in ${stateFilter}` : 
                   countryFilter ? `All Cities in ${countryFilter}` : 
                   'Select a country first'}
                </option>
                {filteredCities.map(option => (
                   <option key={option.value} value={option.value}>{option.label}</option>
                 ))}
              </select>
              {isLoadingCities && (
                <div className="text-xs text-gray-500 mt-1 flex items-center">
                  <div className="animate-spin rounded-full h-3 w-3 border-b border-tuggi-blue mr-2"></div>
                  Loading cities...
                </div>
              )}
            </div>

            {/* Type Filter */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Type</h3>
              <select
                value={googleTypesFilter}
                onChange={(e) => setGoogleTypesFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm"
              >
                <option value="">All Types</option>
                {filterOptions?.googleTypes.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {/* Category Filter */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Category</h3>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm"
              >
                <option value="">All Categories</option>
                {filterOptions?.categories.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {/* Content Status Filter */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Content Status</h3>
              <select
                value={contentStatusFilter}
                onChange={(e) => setContentStatusFilter(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm"
              >
                {filterOptions?.contentStatus.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {/* Group Status Filter */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Group Status</h3>
              <select
                value={groupStatusFilter}
                onChange={(e) => setGroupStatusFilter(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm"
              >
                {filterOptions?.groupStatus.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {/* Score Filter */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Score</h3>
              <select
                value={scoreFilter}
                onChange={(e) => setScoreFilter(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm"
              >
                {filterOptions?.scoreFilter.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {/* Trigger Points Filter */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Trigger Points</h3>
              <select
                value={triggerPointsFilter}
                onChange={(e) => setTriggerPointsFilter(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm"
              >
                {filterOptions?.triggerPointsFilter.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {/* Clear Filters Button */}
            <button
              onClick={clearAllFilters}
              className="w-full px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Clear All Filters
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header with Stats */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6">
          {/* Compact Stats */}
          <div className="grid grid-cols-4 md:grid-cols-7 gap-4 mb-4">
            <div className="text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{stats?.total.toLocaleString() || 0}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Total</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-green-600">{stats?.approved.toLocaleString() || 0}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Approved</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-yellow-600">{stats?.pending.toLocaleString() || 0}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Pending</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">{stats?.content_stats.with_description.toLocaleString() || 0}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">With Desc</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-purple-600">{stats?.content_stats.with_audio.toLocaleString() || 0}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">With Audio</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-indigo-600">{stats?.content_stats.complete.toLocaleString() || 0}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Complete</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-orange-600">{stats?.trigger_points_stats.with_trigger_points.toLocaleString() || 0}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Triggers</div>
            </div>
          </div>

          {/* Top Bar */}
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Points of Interest</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {pagination.totalCount > 0 
                  ? `Showing ${(currentPage - 1) * itemsPerPage + 1}-${Math.min(currentPage * itemsPerPage, pagination.totalCount)} of ${pagination.totalCount} POIs`
                  : 'No POIs found'
                }
              </p>
            </div>
            
            <div className="flex items-center gap-4">
              {/* View Toggle */}
              <div className="flex border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('cards')}
                  className={cn(
                    'px-3 py-2 text-sm transition-colors',
                    viewMode === 'cards'
                      ? 'bg-tuggi-blue text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  )}
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'px-3 py-2 text-sm transition-colors',
                    viewMode === 'list'
                      ? 'bg-tuggi-blue text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  )}
                >
                  <List className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('map')}
                  className={cn(
                    'px-3 py-2 text-sm transition-colors',
                    viewMode === 'map'
                      ? 'bg-tuggi-blue text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  )}
                >
                  <Map className="w-4 h-4" />
                </button>
              </div>

              {/* Add POI Button */}
              <Link
                href="/pois/new"
                className="inline-flex items-center px-4 py-2 bg-tuggi-blue text-white rounded-lg hover:bg-tuggi-blue-dark transition-colors text-sm"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add POI
              </Link>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-6">
          {/* Loading State */}
          {isLoading && (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tuggi-blue"></div>
            </div>
          )}

          {/* Content based on view mode */}
          {!isLoading && (
            <>
              {viewMode === 'map' ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden" style={{ height: '600px' }}>
                  <POIMapVisualization
                    searchTerm={searchTerm}
                    statusFilter={statusFilter}
                    countryFilter={countryFilter}
                    stateFilter={stateFilter}
                    cityFilter={cityFilter}
                    googleTypesFilter={googleTypesFilter}
                    contentStatusFilter={contentStatusFilter}
                    groupStatusFilter={groupStatusFilter}
                    triggerPointsFilter={triggerPointsFilter}
                    onPOIClick={handlePOIClick}
                    onFiltersChange={handleFiltersChange}
                    height="600px"
                    className="rounded-lg border"
                  />
                </div>
              ) : (
                <>
                  {/* POI List/Cards */}
                  {pois.length === 0 ? (
                    <div className="text-center py-12">
                      {!countryFilter && !searchTerm ? (
                        <div>
                          <div className="text-gray-500 dark:text-gray-400 mb-4">Selecione um país para visualizar os POIs.</div>
                          <div className="text-sm text-gray-400 dark:text-gray-500">Use os filtros na barra lateral para começar.</div>
                        </div>
                      ) : (
                        <div>
                          <div className="text-gray-500 dark:text-gray-400 mb-4">No POIs found with the applied filters.</div>
                          <button
                            onClick={clearAllFilters}
                            className="text-tuggi-blue hover:text-tuggi-blue-dark"
                          >
                            Clear all filters
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={cn(
                      viewMode === 'cards'
                        ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6'
                        : 'space-y-4'
                    )}>
                      {pois.map((poi) => (
                        <POICard
                          key={poi.id}
                          poi={poi}
                          viewMode={viewMode}
                          isSelected={selectedPois.includes(poi.id)}
                          onToggleSelection={togglePoiSelection}
                          onOpenModal={handlePOIClick}
                        />
                      ))}
                    </div>
                  )}

                  {/* Pagination */}
                  {pagination.totalPages > 1 && (
                    <div className="flex justify-center items-center mt-8 gap-2">
                      <button
                        onClick={goToPreviousPage}
                        disabled={!pagination.hasPrevPage}
                        className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      
                      <div className="flex gap-1">
                        {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                          let pageNum
                          if (pagination.totalPages <= 5) {
                            pageNum = i + 1
                          } else if (currentPage <= 3) {
                            pageNum = i + 1
                          } else if (currentPage >= pagination.totalPages - 2) {
                            pageNum = pagination.totalPages - 4 + i
                          } else {
                            pageNum = currentPage - 2 + i
                          }
                          
                          return (
                            <button
                              key={pageNum}
                              onClick={() => goToPage(pageNum)}
                              className={cn(
                                'px-3 py-2 rounded-lg text-sm transition-colors',
                                currentPage === pageNum
                                  ? 'bg-tuggi-blue text-white'
                                  : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                              )}
                            >
                              {pageNum}
                            </button>
                          )
                        })}
                      </div>
                      
                      <button
                        onClick={goToNextPage}
                        disabled={!pagination.hasNextPage}
                        className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* POI Details Modal */}
      {selectedPoi && (
        <POIDetailsModal
          poi={selectedPoi}
          isOpen={!!selectedPoi}
          onClose={() => setSelectedPoi(null)}
          onUpdate={loadPois}
        />
      )}
    </div>
  )
}

interface POICardProps {
  poi: POI
  viewMode: 'list' | 'cards'
  isSelected: boolean
  onToggleSelection: (poiId: string) => void
  onOpenModal: (poi: POI) => void
}

function POICard({ poi, viewMode, isSelected, onToggleSelection, onOpenModal }: POICardProps) {
  const thumbnailUrl = getThumbnailUrl(poi)
  
  if (viewMode === 'list') {
    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow">
        <div className="flex items-center gap-4">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelection(poi.id)}
            className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue"
          />
          
          {thumbnailUrl && (
            <img
              src={thumbnailUrl}
              alt={poi.name}
              className="w-16 h-16 object-cover rounded-lg"
            />
          )}
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-gray-900 dark:text-white truncate">{poi.name}</h3>
              <VerificationBadge attractionId={poi.id} size="sm" />
            </div>
            
            <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
              <div className="flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                <span>{poi.city}, {poi.country}</span>
              </div>
              
              {poi.google_types && (
                <div className="flex items-center gap-1">
                  <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs">
                    {poi.google_types[0]}
                  </span>
                </div>
              )}
              
              <div className="flex items-center gap-1">
                <Calendar className="w-4 h-4" />
                <span>{formatDate(poi.created_at)}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenModal(poi)}
              className="p-2 text-gray-600 dark:text-gray-400 hover:text-tuggi-blue dark:hover:text-tuggi-blue transition-colors"
            >
              <Eye className="w-4 h-4" />
            </button>
            
            <Link
              href={`/pois/${poi.id}/edit`}
              className="p-2 text-gray-600 dark:text-gray-400 hover:text-tuggi-blue dark:hover:text-tuggi-blue transition-colors"
            >
              <Edit className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden hover:shadow-lg transition-shadow">
      <div className="relative">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelection(poi.id)}
          className="absolute top-3 left-3 z-10 rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue"
        />
        
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={poi.name}
            className="w-full h-48 object-cover"
          />
        ) : (
          <div className="w-full h-48 bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
            <MapPin className="w-12 h-12 text-gray-400" />
          </div>
        )}
      </div>
      
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-semibold text-gray-900 dark:text-white truncate flex-1">{poi.name}</h3>
          <VerificationBadge attractionId={poi.id} size="sm" />
        </div>
        
        <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          <div className="flex items-center gap-1 mb-1">
            <MapPin className="w-4 h-4" />
            <span>{poi.city}, {poi.country}</span>
          </div>
          
          {poi.google_types && (
            <div className="flex flex-wrap gap-1 mb-1">
              {poi.google_types.slice(0, 2).map((type, index) => (
                <span key={index} className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs">
                  {type}
                </span>
              ))}
              {poi.google_types.length > 2 && (
                <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs">
                  +{poi.google_types.length - 2}
                </span>
              )}
            </div>
          )}
          
          <div className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            <span>{formatDate(poi.created_at)}</span>
          </div>
        </div>
        
        <div className="flex justify-between items-center">
          <button
            onClick={() => onOpenModal(poi)}
            className="flex items-center gap-1 px-3 py-1 text-sm text-tuggi-blue hover:bg-tuggi-blue hover:text-white rounded transition-colors"
          >
            <Eye className="w-4 h-4" />
            View
          </button>
          
          <Link
            href={`/pois/${poi.id}/edit`}
            className="flex items-center gap-1 px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-tuggi-blue dark:hover:text-tuggi-blue transition-colors"
          >
            <Edit className="w-4 h-4" />
            Edit
          </Link>
        </div>
      </div>
    </div>
  )
}

function POIListLoading() {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar Skeleton */}
      <div className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 p-6">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
        <div className="space-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Main Content Skeleton */}
      <div className="flex-1 flex flex-col">
        {/* Header Skeleton */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6">
          <div className="grid grid-cols-7 gap-4 mb-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="text-center">
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded mb-1"></div>
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center">
            <div>
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded mb-2 w-48"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-64"></div>
            </div>
            <div className="flex gap-4">
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-24"></div>
              <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
            </div>
          </div>
        </div>
        
        {/* Content Skeleton */}
        <div className="flex-1 p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="h-48 bg-gray-200 dark:bg-gray-700"></div>
                <div className="p-4">
                  <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mb-1"></div>
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded mb-3 w-3/4"></div>
                  <div className="flex justify-between">
                    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
                    <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-12"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function POIListPage() {
  return (
    <Suspense fallback={<POIListLoading />}>
      <POIListWithSearchParams />
    </Suspense>
  )
}

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