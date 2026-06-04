'use client'

import { useMemo, useState } from 'react'
import { Loader2, Map as MapIcon } from 'lucide-react'
import { fetchPOIsForMap, MapPOI, MapSearchFilters } from '@/lib/services/poi-map-service'
import { POIMapVisualization, POI, TriggerRenderGroup, PoiActionMenuLabels } from './POIMapVisualization'
import { useQuery } from '@tanstack/react-query'
import { useTriggerPointsForPOI } from '@/lib/hooks/use-trigger-points-for-poi'
import { useTriggerPointsInBbox } from '@/lib/hooks/use-trigger-points-in-bbox'
import { extractCoordinates } from '@/lib/core/poi-coordinates'

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
  onPOIDelete?: (poi: any) => void
  onPOIGarbage?: (poi: any) => void
  canGarbage?: boolean
  actionMenuLabels?: PoiActionMenuLabels
  height?: string
  className?: string
}

const TP_ZOOM_THRESHOLD = 12
const BULK_TP_THRESHOLD = 500

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
  onPOIDelete,
  onPOIGarbage,
  canGarbage = false,
  actionMenuLabels,
  height = '600px',
  className
}: OptimizedPOIMapProps) {
  const [bounds, setBounds] = useState<{ minLat: number; minLng: number; maxLat: number; maxLng: number } | null>(null)
  const [zoom, setZoom] = useState<number>(2)
  const [hoveredPoi, setHoveredPoi] = useState<POI | null>(null)

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
    gcTime: 30000,
    enabled: !!bounds,
  })

  const pois = searchResult?.data || []
  const loadingTime = searchResult?.duration || null

  function transformMapPOIsForVisualization(mapPois: MapPOI[]): POI[] {
    return mapPois.map(poi => ({
      id: poi.id,
      name: poi.name,
      city: poi.city || '',
      state: poi.state || null,
      country: poi.country || '',
      approved: poi.approved !== undefined ? poi.approved : false,
      coordinates: extractCoordinates(poi),
      type: poi.type,
      count: poi.count,
      category: '',
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
      trigger_points_count: poi.trigger_points_count || 0,
      active_trigger_points_count: poi.active_trigger_points_count || 0
    }))
  }

  const transformedPois = useMemo(() => {
    return transformMapPOIsForVisualization(pois)
  }, [pois])

  // ---------- Hover-mode: TPs + boundary for the currently-hovered POI ----------
  const hoveredPoiId = hoveredPoi?.id || null
  const { data: hoverData } = useTriggerPointsForPOI(hoveredPoiId)
  const hoverTps = hoverData?.triggerPoints
  const hoverBoundary = hoverData?.boundary ?? null

  // ---------- Bulk-mode: TPs for the entire viewport (with guardrail) ----------
  const bulkEnabled = showTriggers && zoom >= TP_ZOOM_THRESHOLD && !!bounds
  const {
    triggerPoints: bulkTps,
    count: bulkCount,
    overLimit: bulkOverLimit
  } = useTriggerPointsInBbox(bounds, bulkEnabled, BULK_TP_THRESHOLD)

  // ---------- Compose `triggers` prop for the map ----------
  const triggers: TriggerRenderGroup[] = useMemo(() => {
    const groups: TriggerRenderGroup[] = []
    const poiPosition = (poiId: string) => {
      const p = pois.find(x => x.id === poiId)
      return p ? { lat: p.latitude, lng: p.longitude } : null
    }

    // Bulk-mode groups
    if (bulkEnabled && !bulkOverLimit && bulkTps.length > 0) {
      const byPoi = new Map<string, { lat: number; lng: number; tps: any[] }>()
      for (const tp of bulkTps) {
        const pos = poiPosition(tp.attraction_id)
        if (!pos) continue
        let g = byPoi.get(tp.attraction_id)
        if (!g) {
          g = { lat: pos.lat, lng: pos.lng, tps: [] }
          byPoi.set(tp.attraction_id, g)
        }
        g.tps.push({
          id: tp.id,
          latitude: tp.latitude,
          longitude: tp.longitude,
          bearing: tp.bearing,
          is_active: tp.is_active
        })
      }
      for (const [poiId, g] of byPoi) {
        groups.push({ poiId, poiPosition: { lat: g.lat, lng: g.lng }, tps: g.tps })
      }
    }

    // Hover-mode group (always added; takes precedence visually via overwrite of same key)
    if (hoveredPoi && hoveredPoi.coordinates && hoverTps && hoverTps.length > 0) {
      const existingIdx = groups.findIndex(g => g.poiId === hoveredPoi.id)
      const hoverGroup: TriggerRenderGroup = {
        poiId: hoveredPoi.id,
        poiPosition: {
          lat: hoveredPoi.coordinates.latitude,
          lng: hoveredPoi.coordinates.longitude
        },
        tps: hoverTps.map(tp => ({
          id: tp.id,
          latitude: tp.latitude,
          longitude: tp.longitude,
          bearing: tp.bearing,
          is_active: tp.is_active
        }))
      }
      if (existingIdx >= 0) groups[existingIdx] = hoverGroup
      else groups.push(hoverGroup)
    }

    return groups
  }, [bulkEnabled, bulkOverLimit, bulkTps, hoveredPoi, hoverTps, pois])

  // Bulk mode benefits from no arrow decoration (cheaper). Hover-only keeps arrows.
  const isHoverOnly = !bulkEnabled || bulkOverLimit || bulkTps.length === 0
  const drawArrows = isHoverOnly

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

      {/* Bulk over-limit guardrail banner */}
      {bulkEnabled && bulkOverLimit && (
        <div className="absolute top-16 left-1/2 transform -translate-x-1/2 z-10 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-full shadow-lg px-4 py-2 max-w-md text-center">
          <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
            Muitos TPs nesta região ({bulkCount.toLocaleString()}). Passe o mouse sobre um POI para ver seus TPs específicos, ou aproxime o zoom.
          </span>
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
        totalCount={transformedPois.length}
        searchTerm={searchTerm}
        statusFilter={statusFilter}
        countryFilter={countryFilter}
        stateFilter={stateFilter}
        cityFilter={cityFilter}

        contentStatusFilter={contentStatusFilter as any}
        groupStatusFilter={groupStatusFilter as any}
        triggerPointsFilter={triggerPointsFilter as any}
        triggers={triggers}
        drawArrows={drawArrows}
        hoverBoundary={hoverBoundary}
        onPOIClick={onPOIClick}
        onPOIDelete={onPOIDelete}
        onPOIGarbage={onPOIGarbage}
        canGarbage={canGarbage}
        actionMenuLabels={actionMenuLabels}
        onPoiHoverEnter={(poi) => setHoveredPoi(poi)}
        onPoiHoverLeave={() => setHoveredPoi(null)}
        onBoundsChanged={(newBounds, newZoom) => {
          setBounds(newBounds)
          setZoom(newZoom)
        }}
        height={height}
        className={className}
      />

    </div>
  )
}
