'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Loader2, Map as MapIcon } from 'lucide-react'
import { fetchPOIsForMap, MapPOI, MapSearchFilters } from '@/lib/services/poi-map-service'
import { POIMapVisualization } from './POIMapVisualization'
import { useQuery } from '@tanstack/react-query'
import { usePOIsWithTriggers } from '@/lib/hooks/use-pois'

interface OptimizedPOIMapProps {
  searchTerm: string
  statusFilter: 'all' | 'approved' | 'pending'
  countryFilter: string
  stateFilter: string
  cityFilter: string

  contentStatusFilter: string
  groupStatusFilter?: string
  triggerPointsFilter?: string
  showTriggers?: boolean
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
const TP_ZOOM_THRESHOLD = 12

export function OptimizedPOIMap({
  searchTerm,
  statusFilter,
  countryFilter,
  stateFilter,
  cityFilter,

  contentStatusFilter,
  groupStatusFilter,
  triggerPointsFilter,
  showTriggers = false,
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
    search: searchTerm || undefined
  }

  // Fetch POIs using React Query
  const { data: searchResult, isLoading, isFetching } = useQuery({
    queryKey: ['map-pois', bounds, zoom, filters],
    queryFn: async () => {
      if (!bounds) return { data: [], duration: 0 }
      return fetchPOIsForMap(filters, bounds, zoom)
    },
    placeholderData: (previousData) => previousData,
    staleTime: 60000,
    gcTime: 30000, // Evict old panning results after 30s to save memory
    enabled: !!bounds,
  })

  const pois = searchResult?.data || []
  const loadingTime = searchResult?.duration || null

  // Transform MapPOI to POI interface expected by POIMapVisualization
  function transformMapPOIsForVisualization(mapPois: MapPOI[]): any[] {
    return mapPois.map(poi => ({
      id: poi.id,
      name: poi.name,
      city: poi.city || '',
      state: poi.state || null,
      country: poi.country || '',
      approved: poi.approved !== undefined ? poi.approved : false,
      coordinates: {
        latitude: poi.latitude,
        longitude: poi.longitude
      },
      type: poi.type,
      count: poi.count,
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
      has_description: poi.has_description !== undefined ? poi.has_description : false,
      has_audio: poi.has_audio !== undefined ? poi.has_audio : false,
      description_count: 0,
      audio_count: 0,
      available_languages: [],
      trigger_points_count: poi.trigger_points?.length || 0,
      active_trigger_points_count: poi.trigger_points?.filter(tp => tp.is_active).length || 0,
      trigger_points: (poi as any).trigger_points || []
    }))
  }

  const transformedPois = useMemo(() => {
    return transformMapPOIsForVisualization(pois)
  }, [pois, showTriggers, zoom, bounds])


  const isAnyLoading = isLoading || isFetching

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

      {/* Zoom Warning for Triggers */}
      {showTriggers && zoom < TP_ZOOM_THRESHOLD && (
        <div className="absolute top-16 left-1/2 transform -translate-x-1/2 z-10 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-full shadow-lg px-4 py-2">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-orange-700 dark:text-orange-400">
              Zoom in to see Trigger Points 🔍
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
              {transformedPois.length.toLocaleString()} items in {(loadingTime / 1000).toFixed(2)}s
            </span>
          </div>
        </div>
      )}

      {/* Map Component */}
      <POIMapVisualization
        pois={transformedPois}
        totalCount={transformedPois.length} // Show visible count
        searchTerm={searchTerm}
        statusFilter={statusFilter}
        countryFilter={countryFilter}
        stateFilter={stateFilter}
        cityFilter={cityFilter}

        contentStatusFilter={contentStatusFilter as any}
        groupStatusFilter={groupStatusFilter as any}
        triggerPointsFilter={triggerPointsFilter as any}
        showTriggers={showTriggers && zoom >= TP_ZOOM_THRESHOLD}
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

