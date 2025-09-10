'use client'

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
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
  recentlyAdded: number
  withDescription: number
  withAudio: number
  contentComplete: number
}

// Component that handles search params
function POIListWithSearchParams() {
  const [pois, setPois] = useState<POI[]>([])
  const [filteredPois, setFilteredPois] = useState<POI[]>([])
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
  const [cities, setCities] = useState<string[]>([])  
  const [filteredCities, setFilteredCities] = useState<string[]>([])  
  const [countries, setCountries] = useState<string[]>([])  
  const [countryFilter, setCountryFilter] = useState('')
  const [stats, setStats] = useState<POIStats>({ total: 0, approved: 0, pending: 0, recentlyAdded: 0, withDescription: 0, withAudio: 0, contentComplete: 0 })
  const [selectedPoi, setSelectedPoi] = useState<POI | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  
  // View state
  const [viewMode, setViewMode] = useState<'list' | 'cards' | 'map'>('cards')
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(20)
  const [totalPages, setTotalPages] = useState(1)
  
  const supabase = useSupabaseClient()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Track if we're initializing from URL to prevent unnecessary updates
  const [isInitializing, setIsInitializing] = useState(true)

  // Debounce search term to avoid excessive filtering
  const debouncedSearchTerm = useDebounce(searchTerm, 300)

  // Function to update URL with current filter states and view mode
  // URL params: ?search=term&status=approved&city=Paris&googleTypes=restaurant&contentStatus=complete&triggerPoints=without_trigger_points&page=2&view=map
  const updateURL = (filters: {
    search?: string
    status?: string
    city?: string
    country?: string
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

    // Update URL without triggering a page reload
    const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname
    window.history.replaceState({}, '', newUrl)
  }

  // Function to clear all filters
  const clearAllFilters = () => {
    setSearchTerm('')
    setStatusFilter('all')
    setCityFilter('')
    setCountryFilter('')
    setGoogleTypesFilter('')
    setContentStatusFilter('all')
    setGroupStatusFilter('all')
    setScoreFilter('all')
    setTriggerPointsFilter('all')
    setCurrentPage(1)
    setIsInitializing(false) // Ensure URL updates work after clearing
  }

  // Function to read filters from URL parameters
  const readFiltersFromURL = () => {
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || searchParams.get('filter') || 'all' // Handle legacy 'filter' param
    const country = searchParams.get('country') || ''
    const city = searchParams.get('city') || ''
    const googleTypes = searchParams.get('googleTypes') || ''
    const contentStatus = searchParams.get('contentStatus') || 'all'
    const groupStatus = searchParams.get('groupStatus') || 'all'
    const scoreFilter = searchParams.get('scoreFilter') || 'all'
    const triggerPointsFilter = searchParams.get('triggerPointsFilter') || 'all'
    const page = parseInt(searchParams.get('page') || '1')
    const view = searchParams.get('view') || 'cards'

    // Set states from URL parameters without triggering URL updates
    setSearchTerm(search)
    setStatusFilter(status as any)
    setCityFilter(city)
    setCountryFilter(country)
    setGoogleTypesFilter(googleTypes)
    setContentStatusFilter(contentStatus as any)
    setGroupStatusFilter(groupStatus as any)
    setScoreFilter(scoreFilter as any)
    setTriggerPointsFilter(triggerPointsFilter as any)
    setCurrentPage(page)
    setViewMode(view as 'list' | 'cards' | 'map')
    
    // Mark initialization as complete
    setIsInitializing(false)
  }

  // Load POIs only on initial mount
  useEffect(() => {
    console.log('🔍 POIS: Initial load - fetching POIs...')
    fetchPois()
  }, []) // Empty dependency array - only run once

  // Read filters from URL only on initial mount
  useEffect(() => {
    readFiltersFromURL()
  }, []) // Empty dependency array - only run once

  // Memoize filtered POIs to prevent unnecessary re-filtering
  const filteredPoisMemo = useMemo(() => {
    let filtered = pois

    // Search filter
    if (debouncedSearchTerm) {
      filtered = filtered.filter(poi =>
        poi.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        poi.city.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        poi.country.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
      )
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(poi =>
        statusFilter === 'approved' ? poi.approved : !poi.approved
      )
    }

    // Country filter
    if (countryFilter) {
      filtered = filtered.filter(poi => poi.country === countryFilter)
    }

    // City filter
    if (cityFilter) {
      filtered = filtered.filter(poi => poi.city === cityFilter)
    }

    // Google Types filter
    if (googleTypesFilter) {
      filtered = filtered.filter(poi => 
        poi.google_types?.includes(googleTypesFilter)
      )
    }

    // Content Status filter
    if (contentStatusFilter !== 'all') {
      filtered = filtered.filter(poi => {
        switch (contentStatusFilter) {
          case 'missing_description':
            return !poi.has_description
          case 'missing_audio':
            return !poi.has_audio
          case 'complete':
            return poi.has_description && poi.has_audio
          default:
            return true
        }
      })
    }

    // Group Status filter
    if (groupStatusFilter !== 'all') {
      filtered = filtered.filter(poi => {
        switch (groupStatusFilter) {
          case 'grouped':
            return poi.group_status?.is_in_group === true
          case 'ungrouped':
            return poi.group_status?.is_in_group === false
          case 'group_main':
            return poi.group_status?.is_in_group === true && poi.group_status?.group_role === 'main'
          case 'group_member':
            return poi.group_status?.is_in_group === true && poi.group_status?.group_role === 'member'
          default:
            return true
        }
      })
    }

    // Score filter
    if (scoreFilter !== 'all') {
      filtered = filtered.filter(poi => {
        const ptBrDescription = poi.descriptions?.find((desc: any) => 
          desc.language === 'pt-br' && desc.description && desc.description.trim()
        )
        
        if (!ptBrDescription) {
          return scoreFilter === 'no_score'
        }

        const verificationStatus = ptBrDescription.verification_status
        
        switch (scoreFilter) {
          case 'no_score':
            return !verificationStatus
          case 'rejected':
            return verificationStatus === 'rejected'
          case 'pending':
            return verificationStatus === 'pending'
          case 'approved':
            return verificationStatus === 'approved'
          default:
            return true
        }
      })
    }

    // Trigger Points filter
    if (triggerPointsFilter !== 'all') {
      filtered = filtered.filter(poi => {
        switch (triggerPointsFilter) {
          case 'with_trigger_points':
            return poi.trigger_points_count > 0
          case 'without_trigger_points':
            return poi.trigger_points_count === 0
          default:
            return true
        }
      })
    }

    return filtered
  }, [pois, debouncedSearchTerm, statusFilter, countryFilter, cityFilter, googleTypesFilter, contentStatusFilter, groupStatusFilter, scoreFilter, triggerPointsFilter])

  // Update filteredPois state and pagination when memoized result changes
  useEffect(() => {
    setFilteredPois(filteredPoisMemo)
    const newTotalPages = Math.ceil(filteredPoisMemo.length / itemsPerPage)
    setTotalPages(newTotalPages)
    
    // Only reset to page 1 if we're beyond the available pages
    if (currentPage > newTotalPages && newTotalPages > 0) {
      setTimeout(() => setCurrentPage(1), 0)
    }
  }, [filteredPoisMemo, currentPage, itemsPerPage])

  useEffect(() => {
    calculateStats()
  }, [pois])

  // Update filtered cities when country filter changes
  useEffect(() => {
    if (countryFilter) {
      const citiesInCountry = Array.from(new Set(
        pois
          .filter(poi => poi.country === countryFilter)
          .map(poi => poi.city)
          .filter(Boolean)
      ))
      setFilteredCities(citiesInCountry)
      // Reset city filter if current city is not in the selected country
      if (cityFilter && !citiesInCountry.includes(cityFilter)) {
        setCityFilter('')
      }
    } else {
      setFilteredCities(cities)
    }
  }, [countryFilter, pois, cities, cityFilter])

  // Update URL when filters change (but not during initialization)
  useEffect(() => {
    if (!isInitializing) {
      updateURL({
        search: debouncedSearchTerm,
        status: statusFilter,
        city: cityFilter,
        country: countryFilter,
        googleTypes: googleTypesFilter,
        contentStatus: contentStatusFilter,
        groupStatus: groupStatusFilter,
        scoreFilter: scoreFilter,
        triggerPointsFilter: triggerPointsFilter,
        page: currentPage,
        view: viewMode
      })
    }
  }, [debouncedSearchTerm, statusFilter, countryFilter, cityFilter, googleTypesFilter, contentStatusFilter, groupStatusFilter, scoreFilter, triggerPointsFilter, currentPage, viewMode, isInitializing])

  const fetchPois = async () => {
    setIsLoading(true)
    try {
      console.log('🔍 POIS: Starting fetchPois...')

      // Fetch all group memberships
      const { data: allGroupMemberships, error: groupMembershipsError } = await supabase
        .schema('core')
        .from('attraction_group_members')
        .select(`
          attraction_id,
          group_id,
          group_role
        `)

      // Fetch groups separately
      const { data: allGroups, error: groupsError } = await supabase
        .schema('core')
        .from('attraction_groups')
        .select('id, name')

      // Create a map of group_id to group name
      const groupNameMap: Record<string, string> = {}
      allGroups?.forEach(group => {
        groupNameMap[group.id] = group.name
      })

      // Create a map of attraction_id to group membership
      const groupMembershipMap: Record<string, any> = {}
      allGroupMemberships?.forEach(membership => {
        groupMembershipMap[membership.attraction_id] = {
          ...membership,
          group_name: groupNameMap[membership.group_id]
        }
      })

      // Fetch all POIs with pagination
      let allPoisData: any[] = []
      let hasMore = true
      let page = 0
      const pageSize = 1000

      while (hasMore) {
        const { data: poisData, error: poisError } = await supabase
          .schema('core')
          .from('attractions')
          .select(`
            *,
            coordinates:attraction_coordinate!left(latitude, longitude),
            descriptions:attraction_descriptions!left(id, description, audio_url, language, verification_status),
            trigger_points:attraction_trigger_points!left(id, is_active)
          `)
          .order('created_at', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1)

        if (poisError) {
          console.error('Error fetching POIs page', page, ':', poisError)
          break
        }

        if (poisData && poisData.length > 0) {
          allPoisData = [...allPoisData, ...poisData]

          
          // If we got less than pageSize, we've reached the end
          if (poisData.length < pageSize) {
            hasMore = false
          } else {
            page++
          }
        } else {
          hasMore = false
        }

        // Safety check to prevent infinite loop
        if (page > 10) {
          break
        }
      }



      // Transform data to include coordinates, content status, group info, trigger points, and available languages
      const poisWithCoords = allPoisData.map(poi => {
        const descriptions = poi.descriptions || []
        const triggerPoints = poi.trigger_points || []
        const hasDescription = descriptions.some((desc: any) => desc.description && desc.description.trim())
        const hasAudio = descriptions.some((desc: any) => desc.audio_url && desc.audio_url.trim())
        
        // Extract available languages from descriptions
        const availableLanguages = [...new Set(
          descriptions
            .filter((desc: any) => (desc.description && desc.description.trim()) || (desc.audio_url && desc.audio_url.trim()))
            .map((desc: any) => desc.language)
            .filter(Boolean)
        )]
        
        // Count trigger points
        const triggerPointsCount = triggerPoints.length
        const activeTriggerPointsCount = triggerPoints.filter((tp: any) => tp.is_active).length
        
        // Process group membership from the map
        const groupMembership = groupMembershipMap[poi.id]
        let groupStatus = null
        
        if (groupMembership) {
          groupStatus = {
            is_in_group: true,
            group_id: groupMembership.group_id,
            group_name: groupMembership.group_name,
            group_role: groupMembership.group_role,
            group_member_count: 0 // Will be populated later if needed
          }
        } else {
          groupStatus = {
            is_in_group: false
          }
        }
        
        return {
          ...poi,
          coordinates: poi.coordinates?.[0] || null,
          formatted_phone_number: poi.formatted_phone_number || null,
          business_status: poi.business_status || null,
          has_description: hasDescription,
          has_audio: hasAudio,
          description_count: descriptions.filter((desc: any) => desc.description && desc.description.trim()).length,
          audio_count: descriptions.filter((desc: any) => desc.audio_url && desc.audio_url.trim()).length,
          available_languages: availableLanguages,
          trigger_points_count: triggerPointsCount,
          active_trigger_points_count: activeTriggerPointsCount,
          group_status: groupStatus,
          descriptions: descriptions, // Keep descriptions for score filtering
          trigger_points: undefined, // Remove from final object to keep it clean
          group_membership: undefined // Remove from final object to keep it clean
        }
      }) || []



      setPois(poisWithCoords)
      
      // Extract unique cities and countries
      const uniqueCities = Array.from(new Set(poisWithCoords.map(poi => poi.city).filter(Boolean)))
      const uniqueCountries = Array.from(new Set(poisWithCoords.map(poi => poi.country).filter(Boolean)))
      setCities(uniqueCities)
      setCountries(uniqueCountries)
      setFilteredCities(uniqueCities) // Initialize filtered cities with all cities
    } catch (error) {
      console.error('Error fetching POIs:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const calculateStats = () => {
    const total = pois.length
    const approved = pois.filter(poi => poi.approved).length
    const pending = total - approved
    const recentlyAdded = pois.filter(poi => {
      const created = new Date(poi.created_at)
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      return created > weekAgo
    }).length
    const withDescription = pois.filter(poi => poi.has_description).length
    const withAudio = pois.filter(poi => poi.has_audio).length
    const contentComplete = pois.filter(poi => poi.has_description && poi.has_audio).length

    setStats({ total, approved, pending, recentlyAdded, withDescription, withAudio, contentComplete })
  }



  // Memoize filtered and paginated POIs to prevent unnecessary re-renders
  const paginatedPois = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return filteredPois.slice(startIndex, endIndex)
  }, [filteredPois, currentPage, itemsPerPage])

  const getPaginatedPois = () => paginatedPois

  const goToPage = (page: number) => {
    setCurrentPage(page)
  }

  const togglePOISelection = (poiId: string) => {
    setSelectedPois(prev =>
      prev.includes(poiId)
        ? prev.filter(id => id !== poiId)
        : [...prev, poiId]
    )
  }

  const toggleAllPOIs = () => {
    const currentPagePois = getPaginatedPois()
    const allSelected = currentPagePois.every(poi => selectedPois.includes(poi.id))
    
    if (allSelected) {
      // Deselect all from current page
      setSelectedPois(prev => prev.filter(id => !currentPagePois.map(p => p.id).includes(id)))
    } else {
      // Select all from current page
      setSelectedPois(prev => [...new Set([...prev, ...currentPagePois.map(p => p.id)])])
    }
  }

  const selectAllPois = () => {
    const currentPagePois = getPaginatedPois()
    const allSelected = currentPagePois.every(poi => selectedPois.includes(poi.id))
    
    if (allSelected) {
      // Deselect all from current page
      setSelectedPois(prev => prev.filter(id => !currentPagePois.map(p => p.id).includes(id)))
    } else {
      // Select all from current page
      setSelectedPois(prev => [...new Set([...prev, ...currentPagePois.map(p => p.id)])])
    }
  }

  const bulkApprove = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .update({ 
          approved: true,
          approved_by: user?.id,
          approved_at: new Date().toISOString()
        })
        .in('id', selectedPois)

      if (error) throw error

      console.log('🔍 POIS: Bulk approve - fetching POIs...')
      await fetchPois()
      setSelectedPois([])
    } catch (error) {
      console.error('Error bulk approving POIs:', error)
    }
  }

  const bulkReject = async () => {
    try {
      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .update({ 
          approved: false,
          approved_by: null,
          approved_at: null
        })
        .in('id', selectedPois)

      if (error) throw error

      console.log('🔍 POIS: Bulk reject - fetching POIs...')
      await fetchPois()
      setSelectedPois([])
    } catch (error) {
      console.error('Error bulk rejecting POIs:', error)
    }
  }

  const toggleApproval = async (poiId: string, currentStatus: boolean) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .update({ 
          approved: !currentStatus,
          approved_by: !currentStatus ? user?.id : null,
          approved_at: !currentStatus ? new Date().toISOString() : null
        })
        .eq('id', poiId)

      if (error) throw error

      console.log('🔍 POIS: Toggle approval - updating specific POI...')
      // Update the specific POI in local state
      setPois(prevPois => 
        prevPois.map(poi => 
          poi.id === poiId 
            ? { ...poi, approved: !currentStatus, approved_by: !currentStatus ? user?.id || null : null, approved_at: !currentStatus ? new Date().toISOString() : null }
            : poi
        )
      )
      
      // Update selected POI if it's the one being edited
      if (selectedPoi && selectedPoi.id === poiId) {
        setSelectedPoi(prev => prev ? { ...prev, approved: !currentStatus, approved_by: !currentStatus ? user?.id || null : null, approved_at: !currentStatus ? new Date().toISOString() : null } : null)
      }
    } catch (error) {
      console.error('Error updating POI approval:', error)
    }
  }

  const deletePoi = async (poiId: string) => {
    if (!window.confirm('Are you sure you want to delete this POI? This action cannot be undone.')) {
      return
    }

    try {
      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .delete()
        .eq('id', poiId)

      if (error) throw error

      console.log('🔍 POIS: Delete POI - fetching POIs...')
      await fetchPois()
    } catch (error) {
      console.error('Error deleting POI:', error)
    }
  }

  const openPOIDetails = (poi: POI) => {
    setSelectedPoi(poi)
    setIsModalOpen(true)
  }

  const closePOIDetails = () => {
    setSelectedPoi(null)
    setIsModalOpen(false)
  }

  // Function to update a specific POI without reloading all data
  const updateSpecificPOI = async (poiId: string) => {
    try {
      console.log('🔍 POIS: Updating specific POI:', poiId)
      
      // Fetch only the specific POI that was updated
      const { data: updatedPOI, error } = await supabase
        .schema('core')
        .from('attractions')
        .select(`
          *,
          coordinates:attraction_coordinate!left(latitude, longitude),
          descriptions:attraction_descriptions!left(id, description, audio_url, language),
          trigger_points:attraction_trigger_points!left(id, is_active)
        `)
        .eq('id', poiId)
        .single()

      if (error) {
        console.error('Error fetching updated POI:', error)
        // Fallback to full reload if specific update fails
        await fetchPois()
        return
      }

      // Transform the updated POI data
      const descriptions = updatedPOI.descriptions || []
      const triggerPoints = updatedPOI.trigger_points || []
      const hasDescription = descriptions.some((desc: any) => desc.description && desc.description.trim())
      const hasAudio = descriptions.some((desc: any) => desc.audio_url && desc.audio_url.trim())
      
      const availableLanguages = [...new Set(
        descriptions
          .filter((desc: any) => (desc.description && desc.description.trim()) || (desc.audio_url && desc.audio_url.trim()))
          .map((desc: any) => desc.language)
      )]

      const transformedPOI = {
        ...updatedPOI,
        coordinates: updatedPOI.coordinates?.[0] || null,
        has_description: hasDescription,
        has_audio: hasAudio,
        description_count: descriptions.filter((desc: any) => desc.description && desc.description.trim()).length,
        audio_count: descriptions.filter((desc: any) => desc.audio_url && desc.audio_url.trim()).length,
        trigger_points_count: triggerPoints.length,
        active_trigger_points_count: triggerPoints.filter((tp: any) => tp.is_active).length,
        available_languages: availableLanguages,
        descriptions: undefined,
        trigger_points: undefined
      }

      // Update the POI in the local state
      setPois(prevPois => 
        prevPois.map(poi => 
          poi.id === poiId ? transformedPOI : poi
        )
      )

      // Update selected POI if it's the one being edited
      if (selectedPoi && selectedPoi.id === poiId) {
        setSelectedPoi(transformedPOI)
      }

      console.log('🔍 POIS: Successfully updated POI:', poiId)
    } catch (error) {
      console.error('Error updating specific POI:', error)
      // Fallback to full reload if specific update fails
      await fetchPois()
    }
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="space-y-3">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar Filters */}
      <div className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">Filters</h3>
          {(searchTerm || statusFilter !== 'all' || countryFilter || cityFilter ||  googleTypesFilter || contentStatusFilter !== 'all' || groupStatusFilter !== 'all' || triggerPointsFilter !== 'all') && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-tuggi-blue/10 text-tuggi-blue mt-2">
              <Filter className="h-3 w-3 mr-1" />
              Filtered
            </span>
          )}
        </div>

        {/* Filters */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Search */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Search</h3>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search POIs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
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
              <option value="all">All Status</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
            </select>
          </div>

          {/* Country Filter */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Country</h3>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm"
            >
              <option value="">All Countries</option>
              {countries.map(country => (
                <option key={country} value={country}>{country}</option>
              ))}
            </select>
          </div>

          {/* City Filter */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">City</h3>
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white text-sm"
            >
              <option value="">{countryFilter ? `All Cities in ${countryFilter}` : 'All Cities'}</option>
              {filteredCities.map(city => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
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
              {POI_CATEGORIES.filter(cat => cat.value !== 'all').map(category => (
                <option key={category.value} value={category.value}>{category.label}</option>
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
              <option value="all">All Content</option>
              <option value="missing_description">Missing Desc</option>
              <option value="missing_audio">Missing Audio</option>
              <option value="complete">Complete</option>
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
              <option value="all">All Groups</option>
              <option value="grouped">Grouped</option>
              <option value="ungrouped">Ungrouped</option>
              <option value="group_main">Group Main</option>
              <option value="group_member">Group Member</option>
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
              <option value="all">All Scores</option>
              <option value="no_score">No Score</option>
              <option value="rejected">Rejected</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
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
              <option value="all">All Trigger Points</option>
              <option value="with_trigger_points">With Trigger Points</option>
              <option value="without_trigger_points">Without Trigger Points</option>
            </select>
          </div>

          {/* Clear Filters */}
          {(searchTerm || statusFilter !== 'all' || cityFilter || countryFilter || googleTypesFilter || contentStatusFilter !== 'all' || groupStatusFilter !== 'all' || scoreFilter !== 'all' || triggerPointsFilter !== 'all') && (
            <div>
              <button
                onClick={clearAllFilters}
                className="w-full inline-flex items-center justify-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Clear All Filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Page Header */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <div>
                <h1 className="text-2xl font-bold text-tuggi-text dark:text-white">
                  POI Management
                </h1>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  Manage and approve imported Points of Interest
                </p>
              </div>
              
              {/* Compact Stats */}
              <div className="flex items-center space-x-4 ml-8">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Total:</span>
                  <span className="text-lg font-bold text-tuggi-blue">{stats.total}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Approved:</span>
                  <span className="text-lg font-bold text-green-600">{stats.approved}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Pending:</span>
                  <span className="text-lg font-bold text-tuggi-orange">{stats.pending}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">With Desc:</span>
                  <span className="text-lg font-bold text-blue-600">{stats.withDescription}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">With Audio:</span>
                  <span className="text-lg font-bold text-purple-600">{stats.withAudio}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Complete:</span>
                  <span className="text-lg font-bold text-emerald-600">{stats.contentComplete}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Top Bar */}
        <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between">
            {/* View Toggle */}
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  viewMode === 'list'
                    ? 'bg-white dark:bg-gray-800 text-tuggi-blue shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-300'
                )}
              >
                <List className="h-4 w-4 mr-1.5" />
                List
              </button>
              <button
                onClick={() => setViewMode('cards')}
                className={cn(
                  'flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  viewMode === 'cards'
                    ? 'bg-white dark:bg-gray-800 text-tuggi-blue shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-300'
                )}
              >
                <Grid className="h-4 w-4 mr-1.5" />
                Cards
              </button>
              <button
                onClick={() => setViewMode('map')}
                className={cn(
                  'flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  viewMode === 'map'
                    ? 'bg-white dark:bg-gray-800 text-tuggi-blue shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-300'
                )}
              >
                <Map className="h-4 w-4 mr-1.5" />
                Map
              </button>
            </div>

            {/* Results Info and Bulk Actions */}
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Showing {filteredPois.length} of {pois.length} POIs
                {selectedPois.length > 0 && (
                  <span className="ml-2 font-medium text-tuggi-blue">
                    • {selectedPois.length} selected
                  </span>
                )}
              </div>
              
              {selectedPois.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={bulkApprove}
                    className="inline-flex items-center px-3 py-1.5 text-sm bg-green-100 text-green-800 border border-green-200 rounded-md hover:bg-green-200 transition-colors"
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Approve Selected
                  </button>
                  <button
                    onClick={bulkReject}
                    className="inline-flex items-center px-3 py-1.5 text-sm bg-red-100 text-red-800 border border-red-200 rounded-md hover:bg-red-200 transition-colors"
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Reject Selected
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {viewMode === 'map' ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <POIMapVisualization
            searchTerm={searchTerm}
            statusFilter={statusFilter}
            countryFilter=""
            stateFilter=""
            cityFilter={cityFilter}
            googleTypesFilter={googleTypesFilter}
            contentStatusFilter={contentStatusFilter}
            groupStatusFilter={groupStatusFilter}
            triggerPointsFilter={triggerPointsFilter}
            onPOIClick={openPOIDetails}
            height="600px"
            className="w-full"
            showPolygons={true}
            initialCenter={{ lat: 39.8283, lng: -98.5795 }}
            initialZoom={4}
          />
        </div>
      ) : viewMode === 'list' ? (
        /* POI List View */
        <div className="space-y-4">
          {getPaginatedPois().length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <MapPin className="h-12 w-12 mx-auto text-gray-400 dark:text-gray-600 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No POIs found</h3>
              <p className="text-gray-500 dark:text-gray-400">
                Try adjusting your filters or search terms
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        <input
                          type="checkbox"
                          checked={selectedPois.length === getPaginatedPois().length && getPaginatedPois().length > 0}
                          onChange={toggleAllPOIs}
                          className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue"
                        />
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        POI
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Location
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Content
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        TP&apos;s
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Score
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {getPaginatedPois().map((poi) => (
                      <tr key={poi.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={selectedPois.includes(poi.id)}
                            onChange={() => togglePOISelection(poi.id)}
                            className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue"
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            {(() => {
                              const thumbnailUrl = getThumbnailUrl(poi)
                              return thumbnailUrl && (
                                <div className="relative h-10 w-10 rounded-lg overflow-hidden flex-shrink-0 mr-3">
                                  <img
                                    src={thumbnailUrl}
                                    alt={poi.name}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement
                                      target.style.display = 'none'
                                    }}
                                  />
                                </div>
                              )
                            })()}
                            <div>
                              <div className="text-sm font-medium text-gray-900 dark:text-white">
                                {poi.name}
                              </div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">
                                {poi.google_types?.join(', ')}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {poi.city}, {poi.country}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => toggleApproval(poi.id, poi.approved)}
                            className={cn(
                              'inline-flex items-center px-2 py-1 text-xs font-medium rounded-full transition-colors',
                              poi.approved
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
                                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300'
                            )}
                          >
                            {poi.approved ? (
                              <>
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Approved
                              </>
                            ) : (
                              <>
                                <Clock className="h-3 w-3 mr-1" />
                                Pending
                              </>
                            )}
                          </button>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center space-x-2">
                            <div className="flex items-center" title={poi.has_description ? `Has ${poi.description_count} description(s)` : 'No description available'}>
                              {poi.has_description ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500" />
                              )}
                              <span className="ml-1 text-xs text-gray-600 dark:text-gray-400">Desc</span>
                            </div>
                            <div className="flex items-center" title={poi.has_audio ? `Has ${poi.audio_count} audio file(s)` : 'No audio available'}>
                              {poi.has_audio ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500" />
                              )}
                              <span className="ml-1 text-xs text-gray-600 dark:text-gray-400">Audio</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {poi.trigger_points_count || 0}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <VerificationBadge
                            attractionId={poi.id}
                            showScore={true}
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => openPOIDetails(poi)}
                              className="inline-flex items-center px-2 py-1 text-xs bg-tuggi-blue/10 text-tuggi-blue border border-tuggi-blue/20 rounded hover:bg-tuggi-blue/20 transition-colors"
                            >
                              <Edit className="h-3 w-3 mr-1" />
                              Edit
                            </button>
                            <button
                              onClick={() => deletePoi(poi.id)}
                              className="inline-flex items-center px-2 py-1 text-xs bg-red-100 text-red-800 border border-red-200 rounded hover:bg-red-200 transition-colors"
                            >
                              <Trash2 className="h-3 w-3 mr-1" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Pagination for List View */}
          {viewMode === 'list' && totalPages > 1 && (
            <div className="flex items-center justify-center space-x-2 mt-6">
              <button
                onClick={() => goToPage(Math.max(currentPage - 1, 1))}
                disabled={currentPage === 1}
                className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </button>
              
              <div className="flex items-center space-x-1">
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let page;
                  if (totalPages <= 7) {
                    page = i + 1;
                  } else if (currentPage <= 4) {
                    page = i + 1;
                  } else if (currentPage >= totalPages - 3) {
                    page = totalPages - 6 + i;
                  } else {
                    page = currentPage - 3 + i;
                  }
                  
                  return (
                    <button
                      key={page}
                      onClick={() => goToPage(page)}
                      className={cn(
                        'inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors',
                        page === currentPage
                          ? 'bg-tuggi-blue text-white'
                          : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                      )}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>
              
              <button
                onClick={() => goToPage(Math.min(currentPage + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </button>
            </div>
          )}
        </div>
      ) : (
        /* POI Cards Grid */
        <div className="space-y-4">
          {getPaginatedPois().length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <MapPin className="h-12 w-12 mx-auto text-gray-400 dark:text-gray-600 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No POIs found</h3>
              <p className="text-gray-500 dark:text-gray-400">
                Try adjusting your filters or search terms
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              {getPaginatedPois().map((poi) => (
                <div
                  key={poi.id}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow"
                >
                  {/* Card Header */}
                  <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedPois.includes(poi.id)}
                        onChange={() => togglePOISelection(poi.id)}
                        className="rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue mt-1 flex-shrink-0"
                      />
                      {(() => {
                        const thumbnailUrl = getThumbnailUrl(poi)
                        return thumbnailUrl && (
                          <div className="relative h-16 w-16 rounded-lg overflow-hidden flex-shrink-0">
                            <img
                              src={thumbnailUrl}
                              alt={poi.name}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement
                                target.style.display = 'none'
                              }}
                            />
                          </div>
                        )
                      })()}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-gray-900 dark:text-white truncate">
                              {poi.name}
                            </h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                              {poi.city}, {poi.country}
                            </p>
                          </div>
                          
                          {/* Status Badge */}
                          <button
                            onClick={() => toggleApproval(poi.id, poi.approved)}
                            className={cn(
                              'inline-flex items-center px-2 py-1 text-xs font-medium rounded-full transition-colors flex-shrink-0',
                              poi.approved
                                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/40'
                                : 'bg-tuggi-orange/10 text-tuggi-orange border border-tuggi-orange/20 hover:bg-tuggi-orange/20'
                            )}
                          >
                            {poi.approved ? (
                              <>
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Approved
                              </>
                            ) : (
                              <>
                                <Clock className="h-3 w-3 mr-1" />
                                Pending
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-4 space-y-3">
                    {/* Rating */}
                    {poi.rating && (
                      <div className="flex items-center">
                        <Star className="h-4 w-4 text-yellow-400 mr-1" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {poi.rating.toFixed(1)}
                        </span>
                        {poi.user_ratings_total && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                            ({poi.user_ratings_total} reviews)
                          </span>
                        )}
                      </div>
                    )}

                    {/* Address */}
                    {poi.formatted_address && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                        {poi.formatted_address}
                      </p>
                    )}

                    {/* Google Types */}
                    {poi.google_types && poi.google_types.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {poi.google_types.slice(0, 3).map((type, index) => (
                          <span 
                            key={index}
                            className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                          >
                            {POI_CATEGORIES.find(cat => cat.value === type)?.label || type}
                          </span>
                        ))}
                        {poi.google_types.length > 3 && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            +{poi.google_types.length - 3} more
                          </span>
                        )}
                      </div>
                    )}

                    {/* Available Languages */}
                    {poi.available_languages.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-medium text-gray-700 dark:text-gray-300">Available Languages:</h4>
                        <div className="flex flex-wrap gap-1">
                          {poi.available_languages.map((language, index) => (
                            <span 
                              key={index}
                              className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300"
                            >
                              {language.toUpperCase()}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Trigger Points Info */}
                    <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                      <div className="flex items-center space-x-1">
                        <span className="w-2 h-2 bg-tuggi-blue rounded-full"></span>
                        <span>{poi.active_trigger_points_count}/{poi.trigger_points_count} active trigger points</span>
                      </div>
                    </div>

                    {/* Content & Group Status */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="flex items-center" title={poi.has_description ? `Has ${poi.description_count} description(s)` : 'No description available'}>
                          {poi.has_description ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                          <span className="ml-1 text-xs text-gray-600 dark:text-gray-400">
                            Desc
                          </span>
                        </div>
                        <div className="flex items-center" title={poi.has_audio ? `Has ${poi.audio_count} audio file(s)` : 'No audio available'}>
                          {poi.has_audio ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                          <span className="ml-1 text-xs text-gray-600 dark:text-gray-400">
                            Audio
                          </span>
                        </div>
                        
                        {/* Verification Badge */}
                        <VerificationBadge 
                          attractionId={poi.id}
                          size="sm"
                          showScore={true}
                        />
                      </div>
                      
                      {/* Group Status */}
                      {poi.group_status?.is_in_group ? (
                        <div className={cn(
                          'inline-flex items-center px-2 py-1 text-xs font-medium rounded-full',
                          poi.group_status.group_role === 'main' 
                            ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'
                            : 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
                        )}>
                          <Users className="h-3 w-3 mr-1" />
                          {poi.group_status.group_role === 'main' ? 'Main' : 'Member'}
                        </div>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300">
                          Individual
                        </span>
                      )}
                    </div>

                    {/* Group Name */}
                    {poi.group_status?.group_name && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        Group: {poi.group_status.group_name}
                      </p>
                    )}
                  </div>

                  {/* Card Footer */}
                  <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 rounded-b-lg">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(poi.created_at)}
                      </div>
                      <div className="flex items-center space-x-2">
                        {poi.has_description && !poi.has_audio && (
                          <button
                            onClick={() => openPOIDetails(poi)}
                            className="inline-flex items-center px-2 py-1 text-xs bg-purple-100 text-purple-800 border border-purple-200 rounded hover:bg-purple-200 transition-colors"
                            title="Generate audio from description"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Audio
                          </button>
                        )}
                        <button
                          onClick={() => openPOIDetails(poi)}
                          className="inline-flex items-center px-2 py-1 text-xs bg-tuggi-blue/10 text-tuggi-blue border border-tuggi-blue/20 rounded hover:bg-tuggi-blue/20 transition-colors"
                        >
                          <Edit className="h-3 w-3 mr-1" />
                          Edit
                        </button>
                        <button
                          onClick={() => deletePoi(poi.id)}
                          className="inline-flex items-center px-2 py-1 text-xs bg-red-100 text-red-800 border border-red-200 rounded hover:bg-red-200 transition-colors"
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center space-x-2 mt-6">
              <button
                onClick={() => goToPage(Math.max(currentPage - 1, 1))}
                disabled={currentPage === 1}
                className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </button>
              
              <div className="flex items-center space-x-1">
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let page;
                  if (totalPages <= 7) {
                    page = i + 1;
                  } else if (currentPage <= 4) {
                    page = i + 1;
                  } else if (currentPage >= totalPages - 3) {
                    page = totalPages - 6 + i;
                  } else {
                    page = currentPage - 3 + i;
                  }
                  
                  return (
                    <button
                      key={page}
                      onClick={() => goToPage(page)}
                      className={cn(
                        'inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors',
                        page === currentPage
                          ? 'bg-tuggi-blue text-white'
                          : 'text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                      )}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>
              
              <button
                onClick={() => goToPage(Math.min(currentPage + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </button>
            </div>
          )}
        </div>
      )}
      </div>

      {/* POI Details Modal */}
      {selectedPoi && (
        <POIDetailsModal
          poi={selectedPoi}
          isOpen={isModalOpen}
          onClose={closePOIDetails}
          onUpdate={() => {
            if (selectedPoi) {
              updateSpecificPOI(selectedPoi.id)
            }
          }}
        />
      )}
    </div>
    </div>
  )
}

function POIListLoading() {
  return (
    <div className="p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
        <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded"></div>
        <div className="space-y-3">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
          ))}
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