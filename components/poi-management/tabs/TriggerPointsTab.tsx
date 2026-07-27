'use client'

/**
 * Unified "Boundary & Trigger Points" tab — delegates to TriggerPointsManager, which
 * hosts a single map workspace with a [Trigger Points | Boundary] mode toggle. This
 * wrapper reads both the POI and the geographic-boundary state/handlers from
 * POIModalContext and forwards them, so the manager can edit TPs and the boundary in
 * place (the standalone Boundary tab has been folded in here).
 */

import { TriggerPointsManager } from '../TriggerPointsManager'
import { usePOIModalContext } from '../POIModalContext'

export function TriggerPointsTab() {
  const {
    getPoi,
    invalidateAllPOICaches,
    existingBoundary,
    boundaryPolygon,
    setBoundaryPolygon,
    isDrawingEnabled,
    setIsDrawingEnabled,
    isSavingBoundary,
    handleBoundaryPolygonComplete,
    handleSaveBoundary,
    handleDeleteBoundary,
  } = usePOIModalContext()
  const poi = getPoi()
  const coordinates = poi?.coordinates
  const isGeofence = poi?.record_type === 'geofence' || poi?.category === 'geofence'

  return (
    <div className="h-[80vh]">
      <TriggerPointsManager
        attractionId={poi?.id || ''}
        attractionName={poi?.name || ''}
        attractionCoordinates={coordinates ? { lat: coordinates.latitude, lng: coordinates.longitude } : undefined}
        attractionTypes={poi?.google_types || []}
        onUpdate={invalidateAllPOICaches}
        isGeofence={isGeofence}
        boundary={{
          existingBoundary,
          boundaryPolygon,
          setBoundaryPolygon,
          isDrawingEnabled,
          setIsDrawingEnabled,
          isSavingBoundary,
          handleBoundaryPolygonComplete,
          handleSaveBoundary,
          handleDeleteBoundary,
        }}
      />
    </div>
  )
}
