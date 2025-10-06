'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, Map as MapIcon } from 'lucide-react'
import { fetchPOIsForMap, MapPOI, MapSearchFilters } from '@/lib/services/poi-map-service'
import { POIMapVisualization } from './POIMapVisualization'

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
  const [pois, setPois] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loadedCount, setLoadedCount] = useState(0)
  const [loadingTime, setLoadingTime] = useState<number | null>(null)

  // Fetch POIs with progressive loading
  const fetchPOIs = useCallback(async () => {
    setIsLoading(true)
    setLoadingProgress(0)
    setLoadedCount(0)
    setPois([])
    setLoadingTime(null)

    const filters: MapSearchFilters = {
      country: countryFilter || undefined,
      state: stateFilter || undefined,
      city: cityFilter || undefined,
      status: statusFilter,
      search: searchTerm || undefined
    }

    console.log('🗺️ Starting optimized map loading...', filters)

    try {
      const startTime = performance.now()

      const result = await fetchPOIsForMap(filters, {
        chunkSize: 1000, // Supabase RPC hard limit
        maxParallel: 5,  // More parallel requests for faster loading
        onProgress: (loaded, total) => {
          setLoadedCount(loaded)
          setTotalCount(total)
          setLoadingProgress((loaded / total) * 100)
        },
        onChunk: (chunk, total) => {
          // Update map progressively as chunks arrive
          setPois(prev => {
            const newPois = transformMapPOIsForVisualization(chunk)
            return [...prev, ...newPois]
          })
          
          console.log(`📍 Rendered ${chunk.length} markers (total: ${pois.length + chunk.length})`)
        }
      })

      const duration = performance.now() - startTime
      setLoadingTime(duration)

      console.log(`✅ Map loading complete: ${result.data.length} POIs in ${(duration / 1000).toFixed(2)}s`)
    } catch (error) {
      console.error('❌ Error loading map POIs:', error)
    } finally {
      setIsLoading(false)
    }
  }, [searchTerm, statusFilter, countryFilter, stateFilter, cityFilter])

  // Load POIs when filters change
  useEffect(() => {
    fetchPOIs()
  }, [fetchPOIs])

  // Transform MapPOI to POI interface expected by POIMapVisualization
  function transformMapPOIsForVisualization(mapPois: MapPOI[]): any[] {
    return mapPois.map(poi => ({
      id: poi.id,
      name: poi.name,
      city: poi.city,
      state: poi.state || null,
      country: poi.country,
      approved: poi.approved,
      rating: poi.rating || null,
      image_url: poi.image_url || null,
      formatted_address: poi.formatted_address || null,
      user_ratings_total: poi.user_ratings_total || null,
      google_types: poi.google_types || null,
      coordinates: {
        latitude: poi.latitude,
        longitude: poi.longitude
      },
      // Default values for required fields
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

  return (
    <div className="relative">
      {/* Loading Progress Overlay */}
      {isLoading && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 min-w-[300px]">
          <div className="flex items-center space-x-3">
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            <div className="flex-1">
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  Loading POIs...
                </span>
                <span className="text-gray-600 dark:text-gray-400">
                  {loadedCount.toLocaleString()} / {totalCount.toLocaleString()}
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${loadingProgress}%` }}
                />
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {loadingProgress.toFixed(0)}% complete
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Performance Stats */}
      {!isLoading && loadingTime !== null && (
        <div className="absolute top-4 right-4 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-sm px-3 py-2 text-xs">
          <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
            <MapIcon className="w-4 h-4" />
            <span>
              {pois.length.toLocaleString()} POIs loaded in {(loadingTime / 1000).toFixed(2)}s
            </span>
          </div>
        </div>
      )}

      {/* Map Component */}
      <POIMapVisualization
        pois={pois}
        totalCount={totalCount}
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
      />
    </div>
  )
}

