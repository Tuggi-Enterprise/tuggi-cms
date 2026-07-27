'use client'

/**
 * Boundary tab — geographic polygon drawing & management.
 * Extracted from POIDetailsModal; reads shared POI/boundary state and handlers
 * from POIModalContext. The control set is the shared <BoundaryControls>; boundary
 * data access lives in lib/core/poi-boundary-service.
 */

import { useTranslations } from 'next-intl'
import { MapPin } from 'lucide-react'
import { GoogleMapComponent, extractPolygonCoordinates } from '@/components/ui/GoogleMapComponent'
import { BOUNDARY_COLOR, BOUNDARY_POLYGON_OPTIONS } from '@/lib/maps-config'
import { usePOIModalContext } from '../POIModalContext'
import { BoundaryControls } from '../BoundaryControls'

export function BoundaryTab() {
  const t = useTranslations('Modals.POIDetails')
  const {
    getPoi,
    canEdit,
    boundaryPolygon,
    setBoundaryPolygon,
    existingBoundary,
    isDrawingEnabled,
    setIsDrawingEnabled,
    isSavingBoundary,
    handleBoundaryPolygonComplete,
    handleSaveBoundary,
    handleDeleteBoundary,
  } = usePOIModalContext()

  const poi = getPoi()
  const coordinates = poi?.coordinates

  return (
    <div className="px-6 py-4 max-h-[80vh] overflow-y-auto">
      <div className="space-y-6">
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
              <MapPin className="h-5 w-5 mr-2 text-tuggi-blue" />
              {t('labels.geographic_boundaries')}
            </h3>
          </div>

          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {isDrawingEnabled
              ? t('labels.drawing_instruction')
              : t('labels.drawing_disabled_instruction')}
          </p>

          <div className="h-96 w-full rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600 relative">
            {coordinates ? (
              <GoogleMapComponent
                componentId="edit-boundary-map"
                center={{ lat: coordinates.latitude, lng: coordinates.longitude }}
                zoom={18}
                height="100%"
                markers={[{
                  id: 'poi-location',
                  position: { lat: coordinates.latitude, lng: coordinates.longitude },
                  title: poi?.name || '',
                  color: BOUNDARY_COLOR
                }]}
                polygon={boundaryPolygon || existingBoundary || undefined}
                enableDrawing={isDrawingEnabled && canEdit}
                showDrawingButton={false}
                onMapClick={() => {}}
                onPolygonComplete={handleBoundaryPolygonComplete}
                onPolygonChange={(polygon) => {
                  const coords = extractPolygonCoordinates(polygon)
                  setBoundaryPolygon(coords)
                }}
                polygonOptions={BOUNDARY_POLYGON_OPTIONS}
              />
            ) : (
              <div className="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                {t('validation.location_required')}
              </div>
            )}
          </div>

          <BoundaryControls
            className="mt-6"
            boundaryPolygon={boundaryPolygon}
            existingBoundary={existingBoundary}
            isDrawingEnabled={isDrawingEnabled}
            isSaving={isSavingBoundary}
            canEdit={canEdit}
            onReset={() => {
              setBoundaryPolygon(existingBoundary)
              setIsDrawingEnabled(false)
            }}
            onDelete={handleDeleteBoundary}
            onSave={handleSaveBoundary}
            onToggleDrawing={() => setIsDrawingEnabled(!isDrawingEnabled)}
          />
        </div>
      </div>
    </div>
  )
}
