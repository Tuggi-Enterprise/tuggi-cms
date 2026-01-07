'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Loader2, Map as MapIcon } from 'lucide-react'
import { fetchPOIsForMap, MapPOI, MapSearchFilters } from '@/lib/services/poi-map-service'
import { POIMapVisualization } from './POIMapVisualization'
import { useQuery } from '@tanstack/react-query'

interface OptimizedPOIMapProps {
  searchTerm: string
  statusFilter: 'all' | 'approved' | 'pending'
  countryFilter: string
  stateFilter: string
  cityFilter: string
  googleTypesFilter: string
  contentStatusFilter: string
  groupStatusFilter?: string
  triggerPointsFilter?: string
  onPOIClick: (poi: any) => void
  height?: string
  className?: string
}

/**
 * Optimized POI Map Component
 * 
 * Features:
 * - Progressive loading with visual feedback
 * - Parallel chunk fetching
 * - Lightweight data transfer
 * - Real-time progress updates
 */
export function OptimizedPOIMap({
  searchTerm,
  statusFilter,
  countryFilter,
  stateFilter,
  cityFilter,
  googleTypesFilter,
  contentStatusFilter,
  groupStatusFilter,
  triggerPointsFilter,
  onPOIClick,
  height = '600px',
  className
}: OptimizedPOIMapProps) {
  const [bounds, setBounds] = useState<{ minLat: number; minLng: number; maxLat: number; maxLng: number } | null>(null)
  const [zoom, setZoom] = useState<number>(2)

  // Filters object for query key
  const filters: MapSearchFilters = {
    country: countryFilter || undefined,
    state: stateFilter || undefined,
    city: cityFilter || undefined,
    status: statusFilter,
    search: searchTerm || undefined,
    googleTypes: googleTypesFilter || undefined
  }

  // Fetch POIs using React Query
  const { data: searchResult, isLoading, isFetching } = useQuery({
    queryKey: ['map-pois', bounds, zoom, filters],
    queryFn: async () => {
      if (!bounds) return { data: [], duration: 0 }
      return fetchPOIsForMap(filters, bounds, zoom)
    },
    enabled: !!bounds,
    placeholderData: (previousData) => previousData, // Keep previous data while fetching new to avoid flickering
    staleTime: 60000, // 1 minute stale time
  })

  const pois = searchResult?.data || []
  const loadingTime = searchResult?.duration || null

  // Transform MapPOI to POI interface expected by POIMapVisualization
  // TODO: Update POIMapVisualization to handle MapPOI directly and clusters
  function transformMapPOIsForVisualization(mapPois: MapPOI[]): any[] {
    return mapPois.map(poi => ({
      id: poi.id,
      name: poi.name,
      city: poi.city || '',
      state: poi.state || null,
      country: poi.country || '',
      approved: poi.approved || false,
      rating: poi.rating || null,
      image_url: poi.image_url || null,
      formatted_address: poi.formatted_address || null,
      user_ratings_total: poi.user_ratings_total || null,
      google_types: poi.google_types || null,
      coordinates: {
        latitude: poi.latitude,
        longitude: poi.longitude
      },
      // Pass through new fields
      type: poi.type,
      count: poi.count,
      
      // Default values to satisfy interface
      category: '',
      approved_by: null,
      approved_at: null,
      created_at: '',
      updated_at: '',
      vicinity: null,
      website: null,
      formatted_phone_number: null,
      business_status: null,
      price_level: null,
      opening_hours: null,
      photos_references: null,
      google_place_id: null,
      user_id: null,
      has_description: false,
      has_audio: false,
      description_count: 0,
      audio_count: 0,
      available_languages: [],
      trigger_points_count: 0,
      active_trigger_points_count: 0
    }))
  }

  const transformedPois = useMemo(() => {
    return transformMapPOIsForVisualization(pois)
  }, [pois])

  return (
    <div className="relative">
      {/* Loading Indicator */}
      {(isLoading || isFetching) && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-white dark:bg-gray-800 rounded-full shadow-lg px-4 py-2">
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
        <div className="absolute top-4 right-4 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-sm px-3 py-2 text-xs">
          <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
            <MapIcon className="w-4 h-4" />
            <span>
              {pois.length.toLocaleString()} items in {(loadingTime / 1000).toFixed(2)}s
            </span>
          </div>
        </div>
      )}

      {/* Map Component */}
      <POIMapVisualization
        pois={transformedPois}
        totalCount={pois.length} // This is just visible count now
        searchTerm={searchTerm}
        statusFilter={statusFilter}
        countryFilter={countryFilter}
        stateFilter={stateFilter}
        cityFilter={cityFilter}
        googleTypesFilter={googleTypesFilter}
        contentStatusFilter={contentStatusFilter as any}
        groupStatusFilter={groupStatusFilter as any}
        triggerPointsFilter={triggerPointsFilter as any}
        onPOIClick={onPOIClick}
        height={height}
        className={className}
        // New props
        onBoundsChanged={(newBounds, newZoom) => {
          setBounds(newBounds)
          setZoom(newZoom)
        }}
      />
    </div>
  )
}

