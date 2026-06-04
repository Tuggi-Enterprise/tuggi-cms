'use client'

/**
 * Boundary tab — geographic polygon drawing & management.
 * Extracted from POIDetailsModal; reads shared POI/boundary state and handlers
 * from POIModalContext. Boundary data access lives in lib/core/poi-boundary-service.
 */

import { useTranslations } from 'next-intl'
import { MapPin, RotateCcw, Trash2, Loader2, Save, Sparkles } from 'lucide-react'
import { GoogleMapComponent, extractPolygonCoordinates } from '@/components/ui/GoogleMapComponent'
import { cn } from '@/lib/utils'
import { usePOIModalContext } from '../POIModalContext'

export function BoundaryTab() {
  const t = useTranslations('Modals.POIDetails')
  const tCommon = useTranslations('Common')
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
                  color: '#FF6B35'
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
                polygonOptions={{
                  strokeColor: '#FF6B35',
                  strokeOpacity: 0.8,
                  strokeWeight: 3,
                  fillColor: '#FF6B35',
                  fillOpacity: 0.2
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                {t('validation.location_required')}
              </div>
            )}
          </div>

          {canEdit && (
            <div className="mt-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "px-2 py-1 rounded text-xs font-bold uppercase",
                    boundaryPolygon && boundaryPolygon.length >= 3
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  )}>
                    {boundaryPolygon && boundaryPolygon.length >= 3
                      ? t('labels.boundary_defined')
                      : t('labels.boundary_missing')}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setBoundaryPolygon(existingBoundary)
                      setIsDrawingEnabled(false)
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 flex items-center gap-1"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {tCommon('actions.reset')}
                  </button>

                  {(boundaryPolygon || existingBoundary) && (
                    <button
                      onClick={handleDeleteBoundary}
                      className="px-3 py-1.5 text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {tCommon('actions.delete')}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveBoundary}
                  disabled={isSavingBoundary || !boundaryPolygon || boundaryPolygon.length < 3}
                  className="flex-1 px-4 py-3 bg-tuggi-blue text-white rounded-xl font-bold text-sm hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center transition-all shadow-lg shadow-blue-500/20"
                >
                  {isSavingBoundary ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('labels.saving_boundary')}
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      {t('labels.save_boundary')}
                    </>
                  )}
                </button>

                <button
                  onClick={() => setIsDrawingEnabled(!isDrawingEnabled)}
                  className={cn(
                    "px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2",
                    isDrawingEnabled
                      ? "bg-amber-500 text-white hover:bg-amber-600"
                      : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  )}
                >
                  <Sparkles className="h-4 w-4" />
                  {isDrawingEnabled ? t('labels.stop_drawing') : t('labels.start_drawing')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
