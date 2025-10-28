'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import { MarkerClusterer } from '@googlemaps/markerclusterer'
import { 
  MapPin, Loader2, ZoomIn, ZoomOut, Navigation, 
  Eye, EyeOff, Filter, Maximize2, Minimize2 
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getThumbnailUrl } from '@/lib/imageUtils'

// POI interface to match existing structure
interface POI {
  id: string
  name: string
  city: string
  country: string
  state: string | null
  category: string
  approved: boolean
  approved_by: string | null
  approved_at: string | null
  rating: number | null
  image_url: string | null
  created_at: string
  updated_at: string
  user_ratings_total: number | null
  formatted_address: string | null
  vicinity: string | null
  website: string | null
  formatted_phone_number: string | null
  business_status: string | null
  price_level: number | null
  opening_hours: any | null
  google_types: string[] | null
  photos_references: string[] | null
  google_place_id: string | null
  user_id: string | null
  coordinates?: {
    latitude: number
    longitude: number
  }
  has_description: boolean
  has_audio: boolean
  description_count: number
  audio_count: number
  reference_links?: string[]
  // Group status indicators
  group_status?: {
    is_in_group: boolean
    group_id?: string
    group_name?: string
    group_role?: 'main' | 'member'
    group_member_count?: number
  }
  // Additional properties for compatibility
  available_languages: string[]
  trigger_points_count: number
  active_trigger_points_count: number
}

// City Boundary interface
interface CityBoundary {
  osm_id: number
  name: string
  name_en: string | null
  boundary: string | null
  admin_level: number | null
  geojson: any // GeoJSON object
  coordinates?: Array<{lat: number, lng: number}> // Parsed coordinates
  validation_status?: 'validated' | 'unvalidated' | 'fallback' | 'failed'
  validation_message?: string
}

// POI status for color coding
type POIStatus = 'complete' | 'approved' | 'pending' | 'missing_content'

interface POIMapVisualizationProps {
  // Data props - if provided, use these instead of fetching
  pois?: POI[]
  totalCount?: number
  
  // Filter props (used for city boundaries and initial filtering)
  searchTerm: string
  statusFilter: 'all' | 'approved' | 'pending'
  countryFilter: string
  stateFilter: string
  cityFilter: string
  googleTypesFilter: string
  contentStatusFilter: 'all' | 'missing_description' | 'missing_audio' | 'complete'
  groupStatusFilter?: 'all' | 'grouped' | 'ungrouped' | 'group_main' | 'group_member'
  triggerPointsFilter?: 'all' | 'with_trigger_points' | 'without_trigger_points'
  
  // Callbacks
  onPOIClick: (poi: POI) => void
  onFiltersChange?: (bounds: google.maps.LatLngBounds) => void
  onPOIUpdated?: (updatedPOI: POI) => void
  onPOIDeleted?: (poiId: string) => void
  
  // Map settings
  height?: string
  className?: string
  initialCenter?: { lat: number; lng: number }
  initialZoom?: number
}

// Get POI status for color coding
function getPOIStatus(poi: POI): POIStatus {
  if (poi.has_description && poi.has_audio) {
    return 'complete'
  }
  if (poi.approved) {
    return 'approved'
  }
  if (!poi.has_description || !poi.has_audio) {
    return 'missing_content'
  }
  return 'pending'
}

// Get status color
function getStatusColor(status: POIStatus): string {
  switch (status) {
    case 'complete':
      return '#10B981' // Green
    case 'approved':
      return '#00A8E8' // Tuggi Blue
    case 'pending':
      return '#FF6F00' // Tuggi Orange
    case 'missing_content':
      return '#EF4444' // Red
    default:
      return '#6B7280' // Gray
  }
}

// Create marker icon based on status
function createMarkerIcon(status: POIStatus, isSelected: boolean = false): google.maps.Icon {
  const color = getStatusColor(status)
  const size = isSelected ? 28 : 24
  const scale = isSelected ? 1.2 : 1
  
  return {
    url: 'data:image/svg+xml;base64,' + btoa(`
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/>
        <circle cx="12" cy="12" r="4" fill="white"/>
      </svg>
    `),
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2)
  }
}

// Map component with clustering
function POIMapContent({
  pois: providedPois,
  totalCount: providedTotalCount,
  searchTerm,
  statusFilter,
  countryFilter,
  stateFilter,
  cityFilter,
  googleTypesFilter,
  contentStatusFilter,
  groupStatusFilter = 'all',
  triggerPointsFilter = 'all',
  onPOIClick,
  onFiltersChange,
  onPOIUpdated,
  onPOIDeleted,
  initialCenter = { lat: 39.8283, lng: -98.5795 }, // Center of USA
  initialZoom = 4
}: POIMapVisualizationProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const markerClustererRef = useRef<MarkerClusterer | null>(null)
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  const boundariesRef = useRef<google.maps.Polygon[]>([])
  const boundsChangedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // State
  const [isLoading, setIsLoading] = useState(true)
  const [pois, setPois] = useState<POI[]>([])
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null)
  const [showClusters, setShowClusters] = useState(true)
  const [poiCount, setPOICount] = useState({ total: 0, visible: 0 })
  const [cityBoundaries, setCityBoundaries] = useState<CityBoundary[]>([])
  const [isLoadingBoundaries, setIsLoadingBoundaries] = useState(false)
  const [isAutoFitting, setIsAutoFitting] = useState(false)
  
  // Clustering state
  const [currentZoom, setCurrentZoom] = useState(initialZoom)
  const [clusteringMode, setClusteringMode] = useState<'clustered' | 'individual'>('clustered')
  const [isTransitioning, setIsTransitioning] = useState(false)
  
  // Use provided POIs if available, otherwise use local state
  const currentPois = providedPois || pois
  const currentTotalCount = providedTotalCount || poiCount.total
  
  // Detect geographic context for intelligent rendering
  const getGeographicContext = useCallback(() => {
    if (!countryFilter) {
      return 'global' // No country = global view (country aggregation)
    } else if (!stateFilter) {
      return 'country' // Country but no state = country view
    } else if (!cityFilter) {
      return 'state' // Country + state but no city = state view
    } else {
      return 'city' // Country + state + city = city view
    }
  }, [countryFilter, stateFilter, cityFilter])
  
  const geographicContext = getGeographicContext()
  
  // Clustering configuration based on zoom levels
  const getClusteringConfig = useCallback((zoom: number) => {
    if (zoom <= 6) {
      return {
        mode: 'clustered' as const,
        gridSize: 100,
        minimumClusterSize: 5,
        maxZoom: 10,
        name: 'Global clusters'
      }
    } else if (zoom <= 10) {
      return {
        mode: 'clustered' as const,
        gridSize: 60,
        minimumClusterSize: 3,
        maxZoom: 13,
        name: 'Regional clusters'
      }
    } else if (zoom <= 13) {
      return {
        mode: 'clustered' as const,
        gridSize: 40,
        minimumClusterSize: 2,
        maxZoom: 15,
        name: 'Local clusters'
      }
    } else {
      return {
        mode: 'individual' as const,
        gridSize: 20,
        minimumClusterSize: 1,
        maxZoom: 20,
        name: 'Individual markers'
      }
    }
  }, [])
  
  // Determine clustering mode based on current zoom
  const clusteringConfig = getClusteringConfig(currentZoom)
  
  // Log when using provided POIs
  useEffect(() => {
    if (providedPois) {
      console.log(`🗺️ Using ${providedPois.length} provided POIs for map visualization`)
      console.log(`🗺️ Geographic context: ${geographicContext}`)
      console.log(`🗺️ Clustering config:`, clusteringConfig)
    }
  }, [providedPois, geographicContext, clusteringConfig])
  
  // Map state preservation
  const [mapState, setMapState] = useState<{
    center: { lat: number; lng: number }
    zoom: number
  }>({
    center: initialCenter,
    zoom: initialZoom
  })

  // Initialize map
  const initializeMap = useCallback(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = new google.maps.Map(mapRef.current, {
      center: mapState.center,
      zoom: mapState.zoom,
      mapTypeControl: true,
      streetViewControl: true,
      fullscreenControl: true,
      zoomControl: true,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      // Disable automatic map updates that could reset position
      gestureHandling: 'greedy',
      styles: [
        {
          featureType: 'poi',
          elementType: 'labels',
          stylers: [{ visibility: 'off' }]
        }
      ]
    })

    mapInstanceRef.current = map

    // CLUSTERING DISABLED: For 31k POIs, direct rendering is more performant
    // The Google Maps API handles large numbers of markers efficiently
    console.log('🗺️ [POIMapVisualization] Clustering disabled for better performance with large datasets')
    
    // Keep clusterer reference null to indicate no clustering
    markerClustererRef.current = null

    // Set up center and zoom change listeners to save state
    map.addListener('center_changed', () => {
      const center = map.getCenter()!
      setMapState(prev => ({
        ...prev,
        center: { lat: center.lat(), lng: center.lng() }
      }))
    })

    map.addListener('zoom_changed', () => {
      const zoom = map.getZoom()!
      setCurrentZoom(zoom)
      setMapState(prev => ({
        ...prev,
        zoom: zoom
      }))
      
      // Update clustering mode based on zoom
      const newConfig = getClusteringConfig(zoom)
      if (newConfig.mode !== clusteringMode) {
        console.log(`🗺️ [POIMapVisualization] Zoom changed: ${zoom}, switching to ${newConfig.name}`)
        setClusteringMode(newConfig.mode)
        setIsTransitioning(true)
        
        // Trigger marker update after a short delay for smooth transition
        setTimeout(() => {
          setIsTransitioning(false)
        }, 300)
      }
    })

    setIsLoading(false)
  }, [initialCenter, initialZoom, onFiltersChange, clusteringMode, getClusteringConfig, mapState.center, mapState.zoom])

  // Remove viewport-based caching since we're using the search API

  // Fetch POIs using pagination to overcome Supabase 1000 limit
  const fetchPOIs = useCallback(async () => {
    // Skip fetching if POIs are provided as props
    if (providedPois) {
      console.log('🗺️ Using provided POIs, skipping fetch')
      setIsLoading(false)
      return
    }
    
    try {
      // Only show loading if we don't have any POIs yet
      if (pois.length === 0) {
        setIsLoading(true)
      }
      
      const baseParams = new URLSearchParams()
      
      // Add all filters to the request (same as list view)
      if (searchTerm) baseParams.set('search', searchTerm)
      if (statusFilter !== 'all') baseParams.set('status', statusFilter)
      if (countryFilter) baseParams.set('country', countryFilter)
      if (stateFilter) baseParams.set('state', stateFilter)
      if (cityFilter) baseParams.set('city', cityFilter)
      if (googleTypesFilter) baseParams.set('googleTypes', googleTypesFilter)
      if (contentStatusFilter !== 'all') baseParams.set('contentStatus', contentStatusFilter)
      if (groupStatusFilter !== 'all') baseParams.set('groupStatus', groupStatusFilter)
      if (triggerPointsFilter !== 'all') baseParams.set('triggerPointsFilter', triggerPointsFilter)
      
      // Use mapView parameter to load all POIs without pagination limit
      baseParams.set('mapView', 'true')
      
      console.log('🗺️ Loading POIs for map with params:', baseParams.toString())
      
      // Fetch all POIs with pagination to overcome Supabase 1000 limit
      let allPoisData: POI[] = []
      let hasMore = true
      let page = 1
      let totalCount = 0
      
      while (hasMore) {
        const params = new URLSearchParams(baseParams)
        params.set('page', page.toString())
        params.set('limit', '1000') // Max per request
        
        console.log(`🗺️ Loading page ${page} for map...`)
        
        const response = await fetch(`/api/pois/search?${params.toString()}`)
        const result = await response.json()
        
        if (result.success) {
          const poisData = result.data || []
          allPoisData = [...allPoisData, ...poisData]
          totalCount = result.pagination.totalCount
          
          // Check if we have more pages
          hasMore = poisData.length === 1000 && allPoisData.length < totalCount
          page++
          
          console.log(`📄 Page ${page - 1}: ${poisData.length} POIs, Total so far: ${allPoisData.length}/${totalCount}`)
          
          // Safety limit to prevent infinite loops
          if (page > 50) {
            console.warn('⚠️ Reached maximum page limit (50) for safety')
            hasMore = false
          }
        } else {
          console.error('Failed to load POIs page:', result.error)
          hasMore = false
        }
      }
      
      // Filter out POIs without coordinates
      const validPois = allPoisData.filter((poi: POI) => poi.coordinates?.latitude && poi.coordinates?.longitude)
      
      setPois(validPois)
      setPOICount({ 
        total: totalCount, 
        visible: validPois.length 
      })
      
      console.log(`✅ POIs loaded for map: ${validPois.length} of ${totalCount} (${allPoisData.length} total fetched)`)
      
    } catch (error) {
      console.error('Error loading POIs for map:', error)
      setPois([])
      setPOICount({ total: 0, visible: 0 })
    } finally {
      // Only hide loading if we were showing it
      if (pois.length === 0) {
        setIsLoading(false)
      }
    }
  }, [providedPois, searchTerm, statusFilter, countryFilter, stateFilter, cityFilter, googleTypesFilter, contentStatusFilter, groupStatusFilter, triggerPointsFilter, pois.length])

  // Fetch city boundaries
  const fetchCityBoundaries = useCallback(async () => {
    if (!cityFilter) {
      setCityBoundaries([])
      return
    }

    setIsLoadingBoundaries(true)
    try {
      const params = new URLSearchParams()
      params.set('city', cityFilter)
      if (countryFilter) {
        params.set('country', countryFilter)
      }
      if (stateFilter) {
        params.set('state', stateFilter)
      }

      console.log('🏙️ Loading city boundaries for:', cityFilter)
      
      const response = await fetch(`/api/city-boundaries?${params.toString()}`)
      const result = await response.json()
      
      if (result.success) {
        setCityBoundaries(result.data || [])
        console.log(`✅ City boundaries loaded: ${result.data?.length || 0} boundaries`)
      } else {
        console.error('Failed to load city boundaries:', result.error)
        setCityBoundaries([])
      }
    } catch (error) {
      console.error('Error loading city boundaries:', error)
      setCityBoundaries([])
    } finally {
      setIsLoadingBoundaries(false)
    }
  }, [cityFilter, countryFilter, stateFilter])

  // Group POIs by country for global view
  const countryGroups = useMemo(() => {
    if (geographicContext !== 'global') return null
    
    const groups = currentPois.reduce((acc, poi) => {
      const country = poi.country
      if (!acc[country]) {
        acc[country] = {
          country,
          pois: [],
          count: 0,
          center: { lat: 0, lng: 0 },
          bounds: null
        }
      }
      acc[country].pois.push(poi)
      acc[country].count++
      
      // Calculate center (simple average for now)
      if (poi.coordinates) {
        acc[country].center.lat += poi.coordinates.latitude
        acc[country].center.lng += poi.coordinates.longitude
      }
      
      return acc
    }, {} as Record<string, { country: string; pois: POI[]; count: number; center: { lat: number; lng: number }; bounds: any }>)
    
    // Calculate final centers
    Object.values(groups).forEach(group => {
      if (group.count > 0) {
        group.center.lat /= group.count
        group.center.lng /= group.count
      }
    })
    
    return groups
  }, [currentPois, geographicContext])

  // Filter POIs based on current filters
  const filteredPOIs = useMemo(() => {
    return currentPois.filter(poi => {
      // Search term filter
      if (searchTerm && !poi.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
          !poi.city.toLowerCase().includes(searchTerm.toLowerCase()) &&
          !poi.country.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false
      }

      // Status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'approved' && !poi.approved) return false
        if (statusFilter === 'pending' && poi.approved) return false
      }

      // Country filter
      if (countryFilter && poi.country !== countryFilter) return false

      // State filter
      if (stateFilter && poi.state !== stateFilter) return false

      // City filter
      if (cityFilter && poi.city !== cityFilter) return false

      // Google types filter (remember user preference from memory)
      if (googleTypesFilter && poi.google_types) {
        if (!poi.google_types.includes(googleTypesFilter)) return false
      }

      // Content status filter
      if (contentStatusFilter !== 'all') {
        if (contentStatusFilter === 'missing_description' && poi.has_description) return false
        if (contentStatusFilter === 'missing_audio' && poi.has_audio) return false
        if (contentStatusFilter === 'complete' && (!poi.has_description || !poi.has_audio)) return false
      }

      // Trigger Points filter
      if (triggerPointsFilter !== 'all') {
        if (triggerPointsFilter === 'with_trigger_points' && poi.trigger_points_count === 0) return false
        if (triggerPointsFilter === 'without_trigger_points' && poi.trigger_points_count > 0) return false
      }

      return true
    })
  }, [currentPois, searchTerm, statusFilter, countryFilter, stateFilter, cityFilter, googleTypesFilter, contentStatusFilter, triggerPointsFilter])

  // Update markers when filtered POIs change
  const updateMarkers = useCallback(() => {
    console.log('🗺️ [POIMapVisualization] updateMarkers called:', {
      hasMap: !!mapInstanceRef.current,
      hasClusterer: !!markerClustererRef.current,
      filteredPOIsCount: filteredPOIs.length,
      geographicContext,
      showClusters,
      currentZoom,
      clusteringMode,
      clusteringConfig
    })
    
    if (!mapInstanceRef.current) {
      console.warn('🗺️ [POIMapVisualization] Missing map:', {
        hasMap: !!mapInstanceRef.current
      })
      return
    }

    // Clear existing markers and clusterer
    markersRef.current.forEach(marker => marker.setMap(null))
    markersRef.current.clear()
    
    if (markerClustererRef.current) {
      markerClustererRef.current.clearMarkers()
      markerClustererRef.current = null
    }

    // Create new markers for filtered POIs
    const newMarkers: google.maps.Marker[] = []

    // Render based on clustering mode
    if (clusteringMode === 'clustered' && !isTransitioning) {
      console.log('🗺️ [POIMapVisualization] Rendering clustered markers:', {
        filteredPOIsCount: filteredPOIs.length,
        clusteringConfig,
        currentZoom
      })
      
      // Create individual markers for clustering
      filteredPOIs.forEach((poi, index) => {
        if (!poi.coordinates?.latitude || !poi.coordinates?.longitude) {
          console.warn(`🗺️ [POIMapVisualization] Skipping POI ${index} - no coordinates:`, poi)
          return
        }

        const position = new google.maps.LatLng(poi.coordinates.latitude, poi.coordinates.longitude)
        const status = getPOIStatus(poi)
        const isSelected = selectedPOI?.id === poi.id

        const marker = new google.maps.Marker({
          position,
          title: `${poi.name} - Click to edit`,
          icon: createMarkerIcon(status, isSelected),
          // Don't add to map directly - let clusterer handle it
          map: null,
          cursor: 'pointer'
        })

        // Add click listener
        marker.addListener('click', () => {
          onPOIClick(poi)
          setSelectedPOI(poi)
        })

        markersRef.current.set(poi.id, marker)
        newMarkers.push(marker)
      })

      // Initialize MarkerClusterer
      if (newMarkers.length > 0) {
        markerClustererRef.current = new MarkerClusterer({
          map: mapInstanceRef.current!,
          markers: newMarkers,
          renderer: {
            render: ({ count, position }) => {
              return new google.maps.Marker({
                position,
                icon: {
                  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                    <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="20" cy="20" r="18" fill="#3B82F6" stroke="#1E40AF" stroke-width="2"/>
                      <text x="20" y="26" text-anchor="middle" fill="white" font-size="12" font-weight="bold">
                        ${count > 999 ? Math.floor(count/1000) + 'k' : count}
                      </text>
                    </svg>
                  `),
                  scaledSize: new google.maps.Size(40, 40),
                  anchor: new google.maps.Point(20, 20)
                },
                label: {
                  text: count.toString(),
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: 'bold'
                },
                zIndex: 1000
              })
            }
          }
        })
      }
    } else {
      console.log('🗺️ [POIMapVisualization] Rendering individual markers:', {
        filteredPOIsCount: filteredPOIs.length,
        clusteringMode,
        isTransitioning
      })
      
      filteredPOIs.forEach((poi, index) => {
        if (!poi.coordinates?.latitude || !poi.coordinates?.longitude) {
          console.warn(`🗺️ [POIMapVisualization] Skipping POI ${index} - no coordinates:`, poi)
          return
        }

        const position = new google.maps.LatLng(poi.coordinates.latitude, poi.coordinates.longitude)
        const status = getPOIStatus(poi)
        const isSelected = selectedPOI?.id === poi.id

        console.log(`🗺️ [POIMapVisualization] Creating marker for POI ${index}:`, {
          name: poi.name,
          coordinates: poi.coordinates,
          status,
          isSelected
        })

        const marker = new google.maps.Marker({
          position,
          title: `${poi.name} - Click to edit`,
          icon: createMarkerIcon(status, isSelected),
          map: mapInstanceRef.current!, // Always add to map since clustering is disabled
          cursor: 'pointer'
        })

      // Create info window content
      const infoContent = `
        <div class="p-3 max-w-xs">
          <div class="flex items-start space-x-3">
            ${(() => {
              const thumbnailUrl = getThumbnailUrl(poi)
              return thumbnailUrl ? `
                <img src="${thumbnailUrl}" alt="${poi.name}" class="w-20 h-20 rounded-md object-cover flex-shrink-0" loading="lazy" onerror="this.onerror=null; this.src='https://via.placeholder.com/80?text=No+Image'">
              ` : ''
            })()}
            <div class="flex-1 min-w-0">
              <h3 class="text-lg font-semibold text-gray-900 mb-1">${poi.name}</h3>
              <p class="text-sm text-gray-600 mb-2">${poi.formatted_address || `${poi.city}, ${poi.country}`}</p>
              
              <div class="flex items-center space-x-4 text-xs text-gray-500 mb-2">
                ${poi.rating ? `
                  <div class="flex items-center">
                    <span class="text-yellow-400">★</span>
                    <span class="ml-1">${poi.rating.toFixed(1)}</span>
                    ${poi.user_ratings_total ? `<span class="ml-1">(${poi.user_ratings_total})</span>` : ''}
                  </div>
                ` : ''}
                <div class="flex items-center space-x-2">
                  <span class="${poi.has_description ? 'text-green-600' : 'text-red-600'}">
                    ${poi.has_description ? '✓' : '✗'} Desc
                  </span>
                  <span class="${poi.has_audio ? 'text-green-600' : 'text-red-600'}">
                    ${poi.has_audio ? '✓' : '✗'} Audio
                  </span>
                </div>
              </div>
              
              <div class="flex items-center justify-between">
                <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                  poi.approved 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-orange-100 text-orange-800'
                }">
                  ${poi.approved ? 'Approved' : 'Pending'}
                </span>
                <div class="text-xs text-blue-600 font-medium">
                  ✏️ Click marker to edit
                </div>
              </div>
            </div>
          </div>
        </div>
      `

      const infoWindow = new google.maps.InfoWindow({
        content: infoContent
      })

      marker.addListener('click', () => {
        // Close other info windows
        markersRef.current.forEach((otherMarker, otherId) => {
          if (otherId !== poi.id && (otherMarker as any).infoWindow) {
            ;(otherMarker as any).infoWindow.close()
          }
        })

        // Open the POI Details Modal directly
        onPOIClick(poi)
        setSelectedPOI(poi)
        
        // Update marker icon to show selection
        marker.setIcon(createMarkerIcon(status, true))
        
        // Reset other markers
        markersRef.current.forEach((otherMarker, otherId) => {
          if (otherId !== poi.id) {
            const otherPOI = filteredPOIs.find(p => p.id === otherId)
            if (otherPOI) {
              otherMarker.setIcon(createMarkerIcon(getPOIStatus(otherPOI), false))
            }
          }
        })

        // Also show info window for additional context
        infoWindow.open(mapInstanceRef.current!, marker)
      })

      // Store info window reference
      ;(marker as any).infoWindow = infoWindow

      markersRef.current.set(poi.id, marker)
      newMarkers.push(marker)
    })
    }

    // Log rendering results
    console.log('🗺️ [POIMapVisualization] Rendering complete:', {
      newMarkersCount: newMarkers.length,
      clusteringMode,
      currentZoom,
      clusteringConfig
    })

    // Update POI count based on context
    setPOICount(prev => ({
      ...prev,
      visible: geographicContext === 'global' ? Object.keys(countryGroups || {}).length : filteredPOIs.length
    }))

  }, [filteredPOIs, selectedPOI, showClusters, onPOIClick, geographicContext, countryGroups, clusteringMode, clusteringConfig, currentZoom, isTransitioning])

  // Update city boundaries on map
  const updateCityBoundaries = useCallback(() => {
    if (!mapInstanceRef.current) return

    // Clear existing boundaries
    boundariesRef.current.forEach(boundary => boundary.setMap(null))
    boundariesRef.current = []

    // Add new boundaries
    cityBoundaries.forEach((boundary, index) => {
      try {
        let paths: google.maps.LatLng[] = []

        // Use pre-parsed coordinates if available (from LocationResolver)
        if (boundary.coordinates && boundary.coordinates.length > 0) {
          paths = boundary.coordinates.map(coord => 
            new google.maps.LatLng(coord.lat, coord.lng)
          )
        } else if (boundary.geojson && boundary.geojson.coordinates) {
          // Fallback to parsing GeoJSON geometry
          if (boundary.geojson.type === 'Polygon') {
            // For Polygon, use the first ring (exterior ring)
            paths = boundary.geojson.coordinates[0].map((coord: number[]) => 
              new google.maps.LatLng(coord[1], coord[0])
            )
          } else if (boundary.geojson.type === 'MultiPolygon') {
            // For MultiPolygon, use the first polygon's first ring
            paths = boundary.geojson.coordinates[0][0].map((coord: number[]) => 
              new google.maps.LatLng(coord[1], coord[0])
            )
          }
        }

        if (paths.length === 0) return

        // Create polygon with city boundary styling
        const polygon = new google.maps.Polygon({
          paths: paths,
          fillColor: '#3B82F6', // Blue color
          fillOpacity: 0.1,
          strokeColor: '#1E40AF', // Darker blue for border
          strokeWeight: 2,
          strokeOpacity: 0.8,
          clickable: true
        })

        polygon.setMap(mapInstanceRef.current!)
        boundariesRef.current.push(polygon)

        // Add info window for boundary
        const bounds = new google.maps.LatLngBounds()
        paths.forEach(point => bounds.extend(point))
        const center = bounds.getCenter()

        const validationIcon = boundary.validation_status === 'validated' ? '✅' : 
                               boundary.validation_status === 'fallback' ? '⚠️' : 
                               boundary.validation_status === 'failed' ? '❌' : '🏙️'
        
        const validationColor = boundary.validation_status === 'validated' ? 'text-green-600' : 
                               boundary.validation_status === 'fallback' ? 'text-yellow-600' : 
                               boundary.validation_status === 'failed' ? 'text-red-600' : 'text-blue-600'

        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div class="p-3">
              <h4 class="font-semibold ${validationColor} mb-1">${validationIcon} ${boundary.name}</h4>
              ${boundary.name_en ? `<p class="text-sm text-gray-600 mb-1">${boundary.name_en}</p>` : ''}
              <p class="text-xs text-gray-500">Admin Level: ${boundary.admin_level || 'N/A'}</p>
              <p class="text-xs text-gray-500">OSM ID: ${boundary.osm_id}</p>
              ${boundary.validation_message ? `<p class="text-xs ${validationColor} mt-2">${boundary.validation_message}</p>` : ''}
            </div>
          `,
          position: center
        })

        polygon.addListener('click', () => {
          infoWindow.open(mapInstanceRef.current!)
        })

      } catch (error) {
        console.error('Error rendering city boundary:', boundary.name, error)
      }
    })

    console.log(`✅ Rendered ${boundariesRef.current.length} city boundaries`)
  }, [cityBoundaries])

  // Toggle clustering
  const toggleClustering = useCallback(() => {
    setShowClusters(prev => !prev)
  }, [])

  // Update POI in local state
  const updatePOIInState = useCallback((updatedPOI: POI) => {
    setPois(prevPois => 
      prevPois.map(poi => 
        poi.id === updatedPOI.id ? updatedPOI : poi
      )
    )
  }, [])

  // Remove POI from local state
  const removePOIFromState = useCallback((poiId: string) => {
    setPois(prevPois => prevPois.filter(poi => poi.id !== poiId))
    setSelectedPOI(prev => prev?.id === poiId ? null : prev)
  }, [])

  // Fit map to show all POIs (only when explicitly requested)
  const fitMapToPOIs = useCallback(() => {
    if (!mapInstanceRef.current || filteredPOIs.length === 0) return

    const bounds = new google.maps.LatLngBounds()
    filteredPOIs.forEach(poi => {
      if (poi.coordinates?.latitude && poi.coordinates?.longitude) {
        bounds.extend(new google.maps.LatLng(poi.coordinates.latitude, poi.coordinates.longitude))
      }
    })

    mapInstanceRef.current.fitBounds(bounds, 50)
    
    // Save the new state after fitting bounds
    setTimeout(() => {
      if (mapInstanceRef.current) {
        const center = mapInstanceRef.current!.getCenter()!
        setMapState(prev => ({
          ...prev,
          center: { lat: center.lat(), lng: center.lng() },
          zoom: mapInstanceRef.current!.getZoom()!
        }))
      }
    }, 100)
  }, [filteredPOIs])

  // Auto fit map when POIs change (after filter changes)
  const autoFitMapToPOIs = useCallback(() => {
    if (!mapInstanceRef.current) return

    setIsAutoFitting(true)
    
    const bounds = new google.maps.LatLngBounds()
    let hasBounds = false

    // Priority 1: Use city boundaries if available
    if (cityBoundaries.length > 0) {
      cityBoundaries.forEach(boundary => {
        if (boundary.coordinates && boundary.coordinates.length > 0) {
          boundary.coordinates.forEach(coord => {
            bounds.extend(new google.maps.LatLng(coord.lat, coord.lng))
            hasBounds = true
          })
        }
      })
    }

    // Priority 2: Fallback to POIs if no boundaries or boundaries don't have coordinates
    if (!hasBounds && filteredPOIs.length > 0) {
      filteredPOIs.forEach(poi => {
        if (poi.coordinates?.latitude && poi.coordinates?.longitude) {
          bounds.extend(new google.maps.LatLng(poi.coordinates.latitude, poi.coordinates.longitude))
          hasBounds = true
        }
      })
    }

    // Only fit bounds if we have something to show
    if (hasBounds) {
      // Add some padding for better visualization
      mapInstanceRef.current.fitBounds(bounds, { left: 50, top: 50, right: 50, bottom: 50 })
      
      // Save the new state after fitting bounds
      setTimeout(() => {
        if (mapInstanceRef.current) {
          const center = mapInstanceRef.current!.getCenter()!
          setMapState(prev => ({
            ...prev,
            center: { lat: center.lat(), lng: center.lng() },
            zoom: mapInstanceRef.current!.getZoom()!
          }))
        }
        setIsAutoFitting(false)
      }, 100)
    } else {
      setIsAutoFitting(false)
    }
  }, [filteredPOIs, cityBoundaries])

  // Initialize map and fetch data
  useEffect(() => {
    if (window.google && window.google.maps && !mapInstanceRef.current) {
      initializeMap()
    }
  }, [initializeMap])

  useEffect(() => {
    if (mapInstanceRef.current) {
      // Always fetch POIs when filters change, but don't reinitialize map
      fetchPOIs()
    }
  }, [fetchPOIs])

  useEffect(() => {
    console.log('🗺️ [POIMapVisualization] useEffect calling updateMarkers:', {
      hasMap: !!mapInstanceRef.current,
      updateMarkersDeps: 'updateMarkers'
    })
    if (mapInstanceRef.current) {
      updateMarkers()
    }
  }, [updateMarkers])

  // Auto fit map when filtered POIs or city boundaries change (after filter changes)
  useEffect(() => {
    if (mapInstanceRef.current && (filteredPOIs.length > 0 || cityBoundaries.length > 0)) {
      // Small delay to ensure markers and boundaries are updated first
      const timer = setTimeout(() => {
        autoFitMapToPOIs()
      }, 200) // Increased delay to ensure boundaries are rendered
      
      return () => clearTimeout(timer)
    }
  }, [filteredPOIs, cityBoundaries, autoFitMapToPOIs])

  useEffect(() => {
    if (mapInstanceRef.current) {
      updateCityBoundaries()
    }
  }, [updateCityBoundaries])

  // Fetch city boundaries when city filter changes
  useEffect(() => {
    if (mapInstanceRef.current) {
      fetchCityBoundaries()
    }
  }, [fetchCityBoundaries])

  // Handle POI updates from parent component
  const handlePOIUpdate = useCallback((updatedPOI: POI) => {
    updatePOIInState(updatedPOI)
  }, [updatePOIInState])

  // Handle POI deletions from parent component
  const handlePOIDelete = useCallback((poiId: string) => {
    removePOIFromState(poiId)
  }, [removePOIFromState])

  return (
    <div className="relative w-full h-full">
      {/* Map Container */}
      <div ref={mapRef} className="w-full h-full" />
      
      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
          <div className="bg-white rounded-lg shadow-lg p-4 flex items-center space-x-3">
            <Loader2 className="h-5 w-5 animate-spin text-tuggi-blue" />
            <span className="text-sm font-medium">Loading POIs...</span>
          </div>
        </div>
      )}

      {/* City Boundaries Loading Indicator */}
      {isLoadingBoundaries && cityFilter && (
        <div className="absolute top-4 left-4 bg-white rounded-lg shadow-lg p-3 z-10">
          <div className="flex items-center space-x-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span className="text-sm font-medium text-gray-700">Loading city boundaries...</span>
          </div>
        </div>
      )}

      {/* Auto Fit Indicator */}
      {isAutoFitting && (
        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-3 z-10">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-sm font-medium text-gray-700">
              {cityBoundaries.length > 0 ? 'Fitting to city boundaries...' : 'Adjusting map view...'}
            </span>
          </div>
        </div>
      )}


      {/* Map Controls */}
      <div className="absolute top-4 right-4 flex flex-col space-y-2 z-10">
        {/* Clustering Toggle */}
        <button
          onClick={toggleClustering}
          className={cn(
            'flex items-center px-3 py-2 rounded-lg shadow-lg text-sm font-medium transition-colors',
            showClusters 
              ? 'bg-tuggi-blue text-white hover:bg-tuggi-blue/90' 
              : 'bg-white text-gray-700 hover:bg-gray-50'
          )}
        >
          {showClusters ? <Eye className="h-4 w-4 mr-2" /> : <EyeOff className="h-4 w-4 mr-2" />}
          Clustering
        </button>

        {/* Fit to POIs */}
        <button
          onClick={fitMapToPOIs}
          className="flex items-center px-3 py-2 bg-white text-gray-700 rounded-lg shadow-lg text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          <Maximize2 className="h-4 w-4 mr-2" />
          Fit All
        </button>
      </div>

      {/* POI Count */}
      <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg px-3 py-2 z-10">
        <div className="flex items-center space-x-4 text-sm">
          <div className="flex items-center">
            <MapPin className="h-4 w-4 text-tuggi-blue mr-1" />
            <span className="font-medium">
              {geographicContext === 'global' ? Object.keys(countryGroups || {}).length : filteredPOIs.length}
            </span>
            <span className="text-gray-500 ml-1">
              {geographicContext === 'global' ? 'countries' : 'visible'}
            </span>
          </div>
          <div className="h-4 w-px bg-gray-300" />
          <div className="text-gray-500">
            {geographicContext === 'global' ? `${currentTotalCount} POIs` : `${currentTotalCount} total`}
          </div>
          {cityBoundaries.length > 0 && (
            <>
              <div className="h-4 w-px bg-gray-300" />
              <div className="flex items-center text-blue-600">
                {cityBoundaries[0]?.validation_status === 'validated' && (
                  <span className="text-green-600 mr-1">✅</span>
                )}
                {cityBoundaries[0]?.validation_status === 'fallback' && (
                  <span className="text-yellow-600 mr-1">⚠️</span>
                )}
                {cityBoundaries[0]?.validation_status === 'failed' && (
                  <span className="text-red-600 mr-1">❌</span>
                )}
                <span className="font-medium">{cityBoundaries.length}</span>
                <span className="text-gray-500 ml-1">boundaries</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Status Legend */}
      <div className="absolute bottom-4 right-4 bg-white rounded-lg shadow-lg p-3 z-10">
        <h4 className="text-xs font-medium text-gray-700 mb-2">Status Legend</h4>
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-xs">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <span>Complete</span>
          </div>
          <div className="flex items-center space-x-2 text-xs">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#00A8E8' }}></div>
            <span>Approved</span>
          </div>
          <div className="flex items-center space-x-2 text-xs">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#FF6F00' }}></div>
            <span>Pending</span>
          </div>
          <div className="flex items-center space-x-2 text-xs">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <span>Missing Content</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Main component with Google Maps wrapper
export function POIMapVisualization(props: POIMapVisualizationProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  if (!apiKey) {
    return (
      <div className={cn(
        'flex items-center justify-center bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800',
        props.className
      )} style={{ height: props.height || '600px' }}>
        <div className="text-center p-6">
          <MapPin className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-red-600 dark:text-red-400 mb-2">
            Google Maps API Key Missing
          </h3>
          <p className="text-red-500 dark:text-red-500 text-sm">
            Please configure NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in your environment variables
          </p>
        </div>
      </div>
    )
  }

  const renderFunction = (status: Status) => {
    switch (status) {
      case Status.LOADING:
        return (
          <div className="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800 rounded-lg">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin text-tuggi-blue mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400">Loading Google Maps...</p>
            </div>
          </div>
        )
      case Status.FAILURE:
        return (
          <div className="flex items-center justify-center h-full bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <div className="text-center p-6">
              <MapPin className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-red-600 dark:text-red-400 mb-2">
                Failed to Load Google Maps
              </h3>
              <p className="text-red-500 dark:text-red-500 text-sm">
                Please check your API key and internet connection
              </p>
            </div>
          </div>
        )
      case Status.SUCCESS:
        return <POIMapContent {...props} />
      default:
        return <div>Unknown status</div>
    }
  }

  return (
    <div className={cn('w-full', props.className)} style={{ height: props.height || '600px' }}>
      <Wrapper 
        apiKey={apiKey} 
        render={renderFunction}
        libraries={['drawing', 'places', 'geometry']}
        version="weekly"
      />
    </div>
  )
}