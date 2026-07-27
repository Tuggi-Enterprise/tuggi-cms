'use client'

/**
 * EntityMapView — /pois-style map for Events and Places (which are entity_kind rows in
 * core.attractions). Reuses the presentational POIMapVisualization: it plots all items as
 * markers and, on hover, overlays that item's boundary + trigger points (fetched per
 * attraction_id via the entity-agnostic /api/pois/[id]/trigger-points). Clicking a marker
 * opens the edit modal. Boundary/TP are VIEW-ONLY here (editing happens in the modal) —
 * same behavior as the /pois map.
 *
 * Unlike OptimizedPOIMap (which is bound to the POI-only cms_search_pois_map RPC), this is
 * fed the full, already-fetched list of events/places (small, curated datasets) so no bbox
 * RPC is needed. Render it only once the items have loaded so the initial framing is right.
 */

import { useMemo, useState } from 'react'
import {
  POIMapVisualization,
  buildHoverTriggerGroup,
  type POI,
  type PoiActionMenuLabels,
} from '@/components/poi-management/POIMapVisualization'
import { useTriggerPointsForPOI } from '@/lib/hooks/use-trigger-points-for-poi'

export interface EntityMapItem {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  approved?: boolean
  priority_level?: number | null
  city?: string | null
  state?: string | null
  country?: string | null
  description_count?: number
  trigger_point_count?: number
}

interface EntityMapViewProps {
  items: EntityMapItem[]
  onItemClick: (id: string) => void
  actionMenuLabels?: PoiActionMenuLabels
  height?: string
  className?: string
}

const hasCoords = (it: EntityMapItem): it is EntityMapItem & { latitude: number; longitude: number } =>
  Number.isFinite(it.latitude as number) && Number.isFinite(it.longitude as number)

export function EntityMapView({
  items,
  onItemClick,
  actionMenuLabels,
  height = '70vh',
  className,
}: EntityMapViewProps) {
  const [hoveredPoi, setHoveredPoi] = useState<POI | null>(null)

  // Adapt entity rows -> POI shape (only rows with coordinates are plottable).
  const pois: POI[] = useMemo(
    () =>
      items.filter(hasCoords).map((it) => ({
        id: it.id,
        name: it.name,
        city: it.city || '',
        state: it.state ?? null,
        country: it.country || '',
        category: '',
        approved: it.approved ?? false,
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
        coordinates: { latitude: it.latitude, longitude: it.longitude },
        has_description: (it.description_count ?? 0) > 0,
        has_audio: false,
        priority_level: it.priority_level ?? null,
        description_count: it.description_count ?? 0,
        audio_count: 0,
        available_languages: [],
        trigger_points_count: it.trigger_point_count ?? 0,
        active_trigger_points_count: 0,
        type: 'poi' as const,
      })),
    [items],
  )

  // Frame the map on the loaded items (POIMapVisualization does not auto-fit; it defaults
  // to the center of the USA). Computed once from the items present at mount.
  const initialView = useMemo(() => {
    if (pois.length === 0) return { center: undefined, zoom: undefined }
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
    for (const p of pois) {
      const { latitude, longitude } = p.coordinates!
      minLat = Math.min(minLat, latitude); maxLat = Math.max(maxLat, latitude)
      minLng = Math.min(minLng, longitude); maxLng = Math.max(maxLng, longitude)
    }
    const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 }
    const latSpan = maxLat - minLat
    const lngSpan = (maxLng - minLng) * Math.cos((center.lat * Math.PI) / 180)
    const span = Math.max(latSpan, lngSpan, 0.005)
    const zoom = Math.max(3, Math.min(16, Math.floor(Math.log2(360 / span)) - 1))
    return { center, zoom }
  }, [pois])

  // Hover: fetch that entity's TPs + boundary (endpoint is entity-agnostic, by attraction_id).
  const { data: hoverData } = useTriggerPointsForPOI(hoveredPoi?.id || null)
  const hoverBoundary = hoverData?.boundary ?? null
  const triggers = useMemo(() => {
    const group = buildHoverTriggerGroup(hoveredPoi, hoverData?.triggerPoints)
    return group ? [group] : []
  }, [hoveredPoi, hoverData])

  return (
    <POIMapVisualization
      pois={pois}
      totalCount={pois.length}
      searchTerm=""
      statusFilter="all"
      countryFilter=""
      stateFilter=""
      cityFilter=""
      contentStatusFilter=""
      triggers={triggers}
      drawArrows
      hoverBoundary={hoverBoundary}
      onPOIClick={(p) => onItemClick(p.id)}
      actionMenuLabels={actionMenuLabels}
      onPoiHoverEnter={(p) => setHoveredPoi(p)}
      onPoiHoverLeave={() => setHoveredPoi(null)}
      initialCenter={initialView.center}
      initialZoom={initialView.zoom}
      height={height}
      className={className}
    />
  )
}
