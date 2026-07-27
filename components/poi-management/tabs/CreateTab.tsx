'use client'

/**
 * Create tab — manual POI creation flow (name, map location, boundary drawing,
 * category/type, owner/business status). Extracted from POIDetailsModal; reads
 * create state/handlers from POIModalContext. Enrichment/create data access is
 * handled by the parent handlers (handleCreatePOI).
 */

import { useTranslations } from 'next-intl'
import { CheckCircle, Loader2, Plus } from 'lucide-react'
import { GoogleMapComponent, extractPolygonCoordinates } from '@/components/ui/GoogleMapComponent'
import { BOUNDARY_COLOR, BOUNDARY_POLYGON_OPTIONS } from '@/lib/maps-config'
import { cn } from '@/lib/utils'
import { usePOIModalContext } from '../POIModalContext'

export function CreateTab() {
  const t = useTranslations('Modals.POIDetails')
  const tCommon = useTranslations('Common')
  const {
    createName,
    setCreateName,
    createCoordinates,
    setCreateCoordinates,
    createLocation,
    createBoundary,
    setCreateBoundary,
    createCategory,
    setCreateCategory,
    createType,
    setCreateType,
    createOwnerId,
    setCreateOwnerId,
    createBusinessStatus,
    setCreateBusinessStatus,
    createPriorityLevel,
    setCreatePriorityLevel,
    isCreating,
    isGeocoding,
    createError,
    isDrawingEnabled,
    setIsDrawingEnabled,
    clients,
    enhancedCategories,
    handleCreatePOI,
    isAdmin,
    onClose,
  } = usePOIModalContext()

  return (
              <div className="px-6 py-4 max-h-[80vh] overflow-y-auto">
                <div className="space-y-6">
                  <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                      <Plus className="h-5 w-5 mr-2 text-tuggi-blue" />
                      {t('actions.create_poi')}
                    </h3>

                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {t('labels.name')} *
                          </label>
                          <input
                            type="text"
                            value={createName}
                            onChange={(e) => setCreateName(e.target.value)}
                            placeholder={t('placeholders.name')}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {t('labels.record_type')} *
                          </label>
                          <select
                            value={createType}
                            onChange={(e) => setCreateType(e.target.value as 'standard' | 'geofence')}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                          >
                            <option value="standard">{t('labels.poi_local')}</option>
                            <option value="geofence">{t('labels.geofence_restricted')}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {t('labels.category')} *
                          </label>
                          <select
                            value={createCategory}
                            onChange={(e) => setCreateCategory(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                          >
                            {enhancedCategories.map(cat => (
                              <option key={cat.value} value={cat.value}>{cat.label}</option>
                            ))}
                          </select>
                        </div>
                        {createType !== 'geofence' && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              {t('labels.priority_level')}
                            </label>
                            <select
                              value={String(createPriorityLevel)}
                              onChange={(e) => setCreatePriorityLevel(parseInt(e.target.value, 10))}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                            >
                              <option value="1">{t('labels.priority_1')}</option>
                              <option value="2">{t('labels.priority_2')}</option>
                              <option value="3">{t('labels.priority_3')}</option>
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-orange-50/50 dark:bg-orange-900/10 border border-orange-100 dark:border-orange-800 rounded-lg">
                        <div className={createType === 'geofence' ? '' : 'md:col-span-2'}>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            {t('labels.client_owner')} *
                          </label>
                          <select
                            value={createOwnerId}
                            onChange={e => setCreateOwnerId(e.target.value)}
                            disabled={!isAdmin}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md disabled:bg-gray-100 disabled:text-gray-500 dark:bg-gray-700 dark:text-white"
                          >
                            <option value="" disabled>{t('labels.select_client')}</option>
                            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          {!isAdmin && <p className="text-xs text-gray-500 mt-1">{t('labels.linked_to_current_client')}</p>}
                        </div>
                        
                        {createType === 'geofence' && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                              {t('labels.trigger_behavior')}
                            </label>
                            <select 
                              value={createBusinessStatus}
                              onChange={e => setCreateBusinessStatus(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white"
                            >
                              <option value="ENTER_ONLY">{t('labels.enter_only')}</option>
                              <option value="INSIDE_ONLY">{t('labels.inside_only')}</option>
                              <option value="BOTH">{t('labels.both_enter_inside')}</option>
                            </select>
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                            {t('labels.location_boundary')} *
                          </label>
                        </div>

                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                          {t('labels.location_hint', { hint: isDrawingEnabled ? t('labels.drawing_hint') : t('labels.activate_drawing') })}
                        </p>

                        <div className="h-96 w-full rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
                          <GoogleMapComponent
                            componentId="create-poi-map"
                            center={createCoordinates || { lat: -23.5505, lng: -46.6333 }}
                            zoom={createCoordinates ? 18 : 10}
                            height="100%"
                            markers={createCoordinates ? [{
                              id: 'poi-location',
                              position: createCoordinates,
                              title: createName || tCommon('labels.new_location'),
                              color: BOUNDARY_COLOR
                            }] : []}
                            polygon={createBoundary || undefined}
                            enableDrawing={isDrawingEnabled}
                            showDrawingButton={false}
                            onMapClick={(lat: number, lng: number) => {
                              setCreateCoordinates({ lat, lng })
                            }}
                            onPolygonComplete={(polygon: any) => {
                              const coords = extractPolygonCoordinates(polygon)
                              setCreateBoundary(coords)
                              setIsDrawingEnabled(false) // Disable drawing after polygon is complete
                            }}
                            polygonOptions={BOUNDARY_POLYGON_OPTIONS}
                          />
                        </div>
                        {createBoundary && createBoundary.length >= 3 && (
                          <div className="mt-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-md border border-green-200 dark:border-green-800">
                            <div className="flex items-center justify-between text-sm">
                              <div className="text-green-800 dark:text-green-300 flex items-center">
                                <CheckCircle className="h-4 w-4 mr-2" />
                                {t('labels.boundary_drawn', { count: createBoundary.length })}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setCreateBoundary(null)
                                  setIsDrawingEnabled(true)
                                }}
                                className="text-red-600 hover:text-red-700 dark:text-red-400 text-xs"
                              >
                                {t('actions.clear')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {isGeocoding && (
                        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {t('labels.detecting_location')}
                        </div>
                      )}

                      {createLocation && !isGeocoding && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                          <h4 className="text-sm font-medium text-blue-900 dark:bg-blue-200 mb-2">
                            {t('labels.location_detected')}
                          </h4>
                          <div className="space-y-1 text-sm text-blue-800 dark:text-blue-300">
                            {createLocation.city && (
                              <p><strong>{t('labels.city')}:</strong> {createLocation.city}</p>
                            )}
                            {createLocation.state && (
                              <p><strong>{t('labels.state')}:</strong> {createLocation.state}</p>
                            )}
                            {createLocation.country && (
                              <p><strong>{t('labels.country')}:</strong> {createLocation.country}</p>
                            )}
                      {createLocation.formatted_address && (
                              <p className="text-xs mt-2 text-blue-600 dark:text-blue-400">
                                {createLocation.formatted_address}
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {createError && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                          <p className="text-sm text-red-800 dark:text-red-300">{createError}</p>
                        </div>
                      )}

                      <div className="flex justify-end gap-3 pt-4">
                        <button
                          onClick={onClose}
                          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
                        >
                          {t('actions.cancel')}
                        </button>
                        <button
                          onClick={handleCreatePOI}
                          disabled={isCreating || !createName.trim() || !createCoordinates}
                          className="px-4 py-2 text-sm font-medium text-white bg-tuggi-blue rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                        >
                          {isCreating ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              {t('actions.creating')}
                            </>
                          ) : (
                            <>
                              <Plus className="h-4 w-4 mr-2" />
                              {t('actions.create_poi')}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
  )
}
