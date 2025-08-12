'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { Wrapper, Status } from '@googlemaps/react-wrapper'
import { MarkerClusterer } from '@googlemaps/markerclusterer'
import { 
  MapPin, Loader2, ZoomIn, ZoomOut, Navigation, 
  Eye, EyeOff, Filter, Maximize2, Minimize2 
} from 'lucide-react'
import { cn } from '@/lib/utils'

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

// Saved Polygon interface
interface SavedPolygon {
  id: string
  name: string
  paths: any // GeoJSON data
  country_name?: string
  created_at: string
}

// POI status for color coding
type POIStatus = 'complete' | 'approved' | 'pending' | 'missing_content'

interface POIMapVisualizationProps {
  // Filters
  searchTerm: string
  statusFilter: 'all' | 'approved' | 'pending'
  cityFilter: string
  googleTypesFilter: string
  contentStatusFilter: 'all' | 'missing_description' | 'missing_audio' | 'complete'
  groupStatusFilter?: 'all' | 'grouped' | 'ungrouped' | 'group_main' | 'group_member'
  
  // Callbacks
  onPOIClick: (poi: POI) => void
  onFiltersChange?: (bounds: google.maps.LatLngBounds) => void
  
  // Map settings
  height?: string
  className?: string
  showPolygons?: boolean
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
  searchTerm,
  statusFilter,
  cityFilter,
  googleTypesFilter,
  contentStatusFilter,
  groupStatusFilter = 'all',
  onPOIClick,
  onFiltersChange,
  showPolygons = true,
  initialCenter = { lat: 39.8283, lng: -98.5795 }, // Center of USA
  initialZoom = 4
}: POIMapVisualizationProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const markerClustererRef = useRef<MarkerClusterer | null>(null)
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  const polygonsRef = useRef<google.maps.Polygon[]>([])
  const boundsChangedTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  const supabase = useSupabaseClient()
  
  // State
  const [isLoading, setIsLoading] = useState(true)
  const [pois, setPois] = useState<POI[]>([])
  const [savedPolygons, setSavedPolygons] = useState<SavedPolygon[]>([])
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null)
  const [showClusters, setShowClusters] = useState(true)
  const [viewportBounds, setViewportBounds] = useState<google.maps.LatLngBounds | null>(null)
  const [poiCount, setPOICount] = useState({ total: 0, visible: 0 })

  // Initialize map
  const initializeMap = useCallback(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    const map = new google.maps.Map(mapRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      mapTypeControl: true,
      streetViewControl: true,
      fullscreenControl: true,
      zoomControl: true,
      mapTypeId: google.maps.MapTypeId.ROADMAP,
      styles: [
        {
          featureType: 'poi',
          elementType: 'labels',
          stylers: [{ visibility: 'off' }]
        }
      ]
    })

    mapInstanceRef.current = map

    // Initialize marker clusterer
    const clusterer = new MarkerClusterer({
      map,
      markers: []
    })

    markerClustererRef.current = clusterer

    // Set up bounds changed listener with debounce
    map.addListener('bounds_changed', () => {
      if (boundsChangedTimeoutRef.current) {
        clearTimeout(boundsChangedTimeoutRef.current)
      }
      
      boundsChangedTimeoutRef.current = setTimeout(() => {
        const bounds = map.getBounds()
        if (bounds) {
          setViewportBounds(bounds)
          if (onFiltersChange) {
            onFiltersChange(bounds)
          }
        }
      }, 500) // 500ms debounce
    })

    setIsLoading(false)
  }, [initialCenter, initialZoom, onFiltersChange])

  // Fetch POIs from database with optional viewport filtering
  const fetchPOIs = useCallback(async (bounds?: google.maps.LatLngBounds) => {
    try {
      setIsLoading(true)
      
      let query = supabase
        .schema('core')
        .from('attractions')
        .select(`
          *,
          coordinates:attraction_coordinate(latitude, longitude),
          descriptions:attraction_descriptions(id, description, audio_url, language)
        `)

      // Apply viewport filtering if bounds provided and map is zoomed in enough
      if (bounds && mapInstanceRef.current && mapInstanceRef.current.getZoom()! > 8) {
        const ne = bounds.getNorthEast()
        const sw = bounds.getSouthWest()
        
        query = query
          .gte('attraction_coordinate.latitude', sw.lat())
          .lte('attraction_coordinate.latitude', ne.lat())
          .gte('attraction_coordinate.longitude', sw.lng())
          .lte('attraction_coordinate.longitude', ne.lng())
      }

      const { data, error } = await query.order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching POIs:', error)
        return
      }

      // Transform data to include coordinates and content status
      const poisWithCoords = data?.map(poi => {
        const descriptions = poi.descriptions || []
        const hasDescription = descriptions.some((desc: any) => desc.description && desc.description.trim())
        const hasAudio = descriptions.some((desc: any) => desc.audio_url && desc.audio_url.trim())
        
        return {
          ...poi,
          coordinates: poi.coordinates?.[0] || null,
          has_description: hasDescription,
          has_audio: hasAudio,
          description_count: descriptions.filter((desc: any) => desc.description && desc.description.trim()).length,
          audio_count: descriptions.filter((desc: any) => desc.audio_url && desc.audio_url.trim()).length,
          descriptions: undefined // Remove from final object to keep it clean
        }
      }) || []

      // Filter out POIs without coordinates
      const validPois = poisWithCoords.filter(poi => poi.coordinates?.latitude && poi.coordinates?.longitude)
      
      setPois(validPois)
      setPOICount({ 
        total: data?.length || 0, 
        visible: validPois.length 
      })
    } catch (error) {
      console.error('Error fetching POIs:', error)
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  // Fetch saved polygons
  const fetchSavedPolygons = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .schema('core')
        .from('saved_polygons')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching saved polygons:', error)
        return
      }

      setSavedPolygons(data || [])
    } catch (error) {
      console.error('Error fetching saved polygons:', error)
    }
  }, [supabase])

  // Filter POIs based on current filters
  const filteredPOIs = useMemo(() => {
    return pois.filter(poi => {
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

      return true
    })
  }, [pois, searchTerm, statusFilter, cityFilter, googleTypesFilter, contentStatusFilter])

  // Update markers when filtered POIs change
  const updateMarkers = useCallback(() => {
    if (!mapInstanceRef.current || !markerClustererRef.current) return

    // Clear existing markers
    markersRef.current.forEach(marker => marker.setMap(null))
    markersRef.current.clear()
    markerClustererRef.current.clearMarkers()

    // Create new markers for filtered POIs
    const newMarkers: google.maps.Marker[] = []

    filteredPOIs.forEach(poi => {
      if (!poi.coordinates?.latitude || !poi.coordinates?.longitude) return

      const position = new google.maps.LatLng(poi.coordinates.latitude, poi.coordinates.longitude)
      const status = getPOIStatus(poi)
      const isSelected = selectedPOI?.id === poi.id

      const marker = new google.maps.Marker({
        position,
        title: `${poi.name} - Click to edit`,
        icon: createMarkerIcon(status, isSelected),
        map: showClusters ? undefined : mapInstanceRef.current!,
        cursor: 'pointer'
      })

      // Create info window content
      const infoContent = `
        <div class="p-3 max-w-xs">
          <div class="flex items-start space-x-3">
            ${poi.image_url ? `
              <img src="${poi.image_url}" alt="${poi.name}" class="w-20 h-20 rounded-md object-cover flex-shrink-0" loading="lazy" onerror="this.onerror=null; this.src='https://via.placeholder.com/80?text=No+Image'">
            ` : ''}
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

    // Add markers to clusterer if clustering is enabled
    if (showClusters) {
      markerClustererRef.current.addMarkers(newMarkers)
    }

  }, [filteredPOIs, selectedPOI, showClusters, onPOIClick])

  // Update polygons
  const updatePolygons = useCallback(() => {
    if (!mapInstanceRef.current || !showPolygons) return

    // Clear existing polygons
    polygonsRef.current.forEach(polygon => polygon.setMap(null))
    polygonsRef.current = []

    // Add saved polygons
    savedPolygons.forEach((savedPolygon, index) => {
      try {
        const geojson = savedPolygon.paths
        if (geojson && geojson.type === 'Polygon' && geojson.coordinates && geojson.coordinates[0]) {
          const path = geojson.coordinates[0].map((coord: number[]) => ({
            lat: coord[1],
            lng: coord[0]
          }))

          const colors = ['#8B5CF6', '#F59E0B', '#EF4444', '#10B981', '#3B82F6', '#F97316']
          const color = colors[index % colors.length]

          const polygon = new google.maps.Polygon({
            paths: path,
            fillColor: color,
            fillOpacity: 0.1,
            strokeColor: color,
            strokeWeight: 2,
            strokeOpacity: 0.5
          })

          polygon.setMap(mapInstanceRef.current!)
          polygonsRef.current.push(polygon)

          // Add info window for polygon
          const bounds = new google.maps.LatLngBounds()
          path.forEach((point: { lat: number; lng: number }) => bounds.extend(point))
          const center = bounds.getCenter()

          const infoWindow = new google.maps.InfoWindow({
            content: `
              <div class="p-2">
                <h4 class="font-semibold" style="color: ${color};">📍 ${savedPolygon.name}</h4>
                ${savedPolygon.country_name ? `<p class="text-sm text-gray-600">${savedPolygon.country_name}</p>` : ''}
                <p class="text-xs text-gray-500">Created: ${new Date(savedPolygon.created_at).toLocaleDateString()}</p>
              </div>
            `,
            position: center
          })

          polygon.addListener('click', () => {
            infoWindow.open(mapInstanceRef.current!)
          })
        }
      } catch (error) {
        console.error('Error rendering polygon:', savedPolygon.name, error)
      }
    })
  }, [savedPolygons, showPolygons])

  // Toggle clustering
  const toggleClustering = useCallback(() => {
    setShowClusters(prev => !prev)
  }, [])

  // Fit map to show all POIs
  const fitMapToPOIs = useCallback(() => {
    if (!mapInstanceRef.current || filteredPOIs.length === 0) return

    const bounds = new google.maps.LatLngBounds()
    filteredPOIs.forEach(poi => {
      if (poi.coordinates?.latitude && poi.coordinates?.longitude) {
        bounds.extend(new google.maps.LatLng(poi.coordinates.latitude, poi.coordinates.longitude))
      }
    })

    mapInstanceRef.current.fitBounds(bounds, 50)
  }, [filteredPOIs])

  // Initialize map and fetch data
  useEffect(() => {
    if (window.google && window.google.maps) {
      initializeMap()
    }
  }, [initializeMap])

  useEffect(() => {
    if (mapInstanceRef.current) {
      fetchPOIs()
      fetchSavedPolygons()
    }
  }, [fetchPOIs, fetchSavedPolygons])

  useEffect(() => {
    if (mapInstanceRef.current) {
      updateMarkers()
    }
  }, [updateMarkers])

  useEffect(() => {
    if (mapInstanceRef.current) {
      updatePolygons()
    }
  }, [updatePolygons])

  // Fetch POIs when viewport changes (with debounce)
  useEffect(() => {
    if (viewportBounds && mapInstanceRef.current && mapInstanceRef.current.getZoom()! > 8) {
      const timeoutId = setTimeout(() => {
        fetchPOIs(viewportBounds)
      }, 1000)
      
      return () => clearTimeout(timeoutId)
    }
  }, [viewportBounds, fetchPOIs])

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
            <span className="font-medium">{filteredPOIs.length}</span>
            <span className="text-gray-500 ml-1">visible</span>
          </div>
          <div className="h-4 w-px bg-gray-300" />
          <div className="text-gray-500">
            {poiCount.total} total
          </div>
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