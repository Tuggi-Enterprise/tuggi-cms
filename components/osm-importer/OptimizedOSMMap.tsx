'use client'

import { useState, useMemo } from 'react'
import { Loader2, Map as MapIcon } from 'lucide-react'
import { OSMService, MapPOI, OSMMapFilters } from '@/lib/services/osm-service-simple'
import { POIMapVisualization } from '@/components/poi-management/POIMapVisualization'
import { useQuery } from '@tanstack/react-query'

interface OptimizedOSMMapProps {
  searchTerm: string
  countryFilter: string
  stateFilter: string
  cityFilter: string
  categoryFilter: string
  
  onPOIClick?: (poi: any) => void
  onToggleSelection?: (id: string) => void
  height?: string
  className?: string
  selectedFeatureIds?: Set<string>
}

/**
 * Optimized OSM Map Component
 * 
 * Features:
 * - Server-side clustering via RPC
 * - Viewport-based fetching
 * - Reuses POIMapVisualization for rendering
 */
export function OptimizedOSMMap({
  searchTerm,
  countryFilter,
  stateFilter,
  cityFilter,
  categoryFilter,
  onPOIClick,
  onToggleSelection,
  height = '600px',
  className,
  selectedFeatureIds
}: OptimizedOSMMapProps) {
  const [bounds, setBounds] = useState<{ minLat: number; minLng: number; maxLat: number; maxLng: number } | null>(null)
  const [zoom, setZoom] = useState<number>(2)

  // Filters object for query key
  const filters: OSMMapFilters = useMemo(() => ({
    country: countryFilter || undefined,
    state: stateFilter || undefined,
    city: cityFilter || undefined,
    category: categoryFilter || undefined,
    search: searchTerm || undefined
  }), [countryFilter, stateFilter, cityFilter, categoryFilter, searchTerm])

  // Fetch POIs using React Query
  const { data: searchResult, isLoading, isFetching } = useQuery({
    queryKey: ['osm-map-pois', bounds, zoom, filters],
    queryFn: async () => {
      // Don't fetch if bounds aren't set yet
      if (!bounds) return { data: [], duration: 0 }
      return OSMService.searchMapPOIs(filters, bounds, zoom)
    },
    enabled: !!bounds,
    placeholderData: (previousData) => previousData, // Keep previous data while fetching
    staleTime: 60000, // 1 minute stale time
  })

  const pois = searchResult?.data || []
  const loadingTime = searchResult?.duration || null

  // Transform MapPOI to POI interface expected by POIMapVisualization
  const transformedPois = useMemo(() => {
    return pois.map(poi => ({
      // Base ID
      id: poi.id,
      // MapPOI fields
      name: poi.name || `Cluster (${poi.count})`,
      city: poi.city || '',
      state: poi.state || null,
      country: poi.country || 'Brazil',
      
      // Visualization specific fields
      coordinates: {
        latitude: poi.latitude,
        longitude: poi.longitude
      },
      type: poi.type,
      count: poi.count,
      
      // Default/Empty values for required fields not present in MapPOI
      category: poi.category || '',
      approved: false, // Homolog always unapproved/pending usually
      
      // Extended fields required by Visualization interface
      has_description: false,
      has_audio: false,
      description_count: 0,
      audio_count: 0,
      available_languages: [],
      trigger_points_count: 0,
      active_trigger_points_count: 0,
      
      // Default fields to satisfy POI interface
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      vicinity: null,
      website: null,
      formatted_phone_number: null,
      business_status: null,
      price_level: null,
      opening_hours: null,
      photos_references: null,
      google_place_id: null,
      user_id: null,
      
      // Ensure selection state is passed
      selected: selectedFeatureIds?.has(poi.id)
    }))
  }, [pois, selectedFeatureIds])

  return (
    <div className="relative" style={{ height }}>
      {/* Loading Indicator */}
      {(isLoading || isFetching) && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-white dark:bg-gray-800 rounded-full shadow-lg px-4 py-2 pointer-events-none">
          <div className="flex items-center space-x-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              Updating map...
            </span>
          </div>
        </div>
      )}

      {/* Performance Stats */}
      {loadingTime !== null && (
        <div className="absolute top-4 right-4 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-sm px-3 py-2 text-xs pointer-events-none">
          <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
            <MapIcon className="w-4 h-4" />
            <span>
              {pois.length.toLocaleString()} items in {(loadingTime).toFixed(0)}ms
            </span>
          </div>
        </div>
      )}

      {/* Map Component */}
      <POIMapVisualization
        pois={transformedPois}
        totalCount={pois.length}
        searchTerm={searchTerm}
        
        // Pass empty filters here as we handle filtering server-side
        // The visualization component uses these for highlighting matching markers?
        // Or just for context. Passing them ensures consistency.
        statusFilter={'all'} 
        countryFilter={countryFilter}
        stateFilter={stateFilter}
        cityFilter={cityFilter}
        
        // Disable other filters not relevant to OSM
        contentStatusFilter={'all'}
        groupStatusFilter={'all'}
        triggerPointsFilter={'all'}
        
        onPOIClick={(poi) => {
          onPOIClick?.(poi)
          if (onToggleSelection && poi.id) {
            onToggleSelection(poi.id)
          }
        }}
        height={height}
        className={className}
        
        // Handle viewport changes to trigger refetch
        onBoundsChanged={(newBounds, newZoom) => {
          setBounds(newBounds)
          setZoom(newZoom)
        }}
      />
    </div>
  )
}
