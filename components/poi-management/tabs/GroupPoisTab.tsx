'use client'

/**
 * Group-POIs tab — polygon-based POI grouping.
 * Extracted from POIDetailsModal; reads shared state/handlers from
 * POIModalContext. Group data access lives in lib/core/poi-groups-service.
 * Note: `groupInfo` is owned by the parent because the descriptions fetch also
 * depends on it — hence it stays in shared context rather than tab-local state.
 */

import { useTranslations } from 'next-intl'
import { Users, CheckCircle, MapPin, Star, Loader2, Save, Plus, Trash2 } from 'lucide-react'
import { GoogleMapComponent } from '@/components/ui/GoogleMapComponent'
import { cn } from '@/lib/utils'
import { usePOIModalContext } from '../POIModalContext'

export function GroupPoisTab() {
  const t = useTranslations('Modals.POIDetails')
  const tCommon = useTranslations('Common')
  const {
    getPoi,
    requestConfirm,
    groupInfo,
    nearbyPOIs,
    selectedPOIs,
    drawnPolygon,
    groupName,
    setGroupName,
    groupLoading,
    handleTogglePOI,
    handlePolygonComplete,
    handleSaveGroup,
  } = usePOIModalContext()

  const poi = getPoi()
  const coordinates = poi?.coordinates

  return (
    <div className="px-6 py-4 max-h-[80vh] overflow-y-auto">
      {coordinates ? (
        <div className="space-y-6">
          {/* Header Section */}
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Users className="h-5 w-5 text-tuggi-blue" />
                {t('labels.group_management')}
              </h4>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {t('labels.group_management_description')}
              </p>
            </div>
            {groupInfo && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800">
                  <CheckCircle className="h-4 w-4 mr-1" />
                  {t('labels.grouped')}
                </span>
              </div>
            )}
          </div>

          {/* Current Group Status */}
          {groupInfo && (
            <div className="bg-tuggi-blue/5 dark:bg-tuggi-blue/10 border border-tuggi-blue/20 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-tuggi-blue/10 rounded-full flex items-center justify-center">
                    <Users className="h-5 w-5 text-tuggi-blue" />
                  </div>
                </div>
                <div className="flex-1">
                  <h5 className="font-medium text-gray-900 dark:text-white">
                    {groupInfo.name}
                  </h5>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {t('labels.group_member_hint')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Map Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h5 className="font-medium text-gray-900 dark:text-white">
                {t('labels.select_area_pois')}
              </h5>
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <MapPin className="h-4 w-4" />
                {t('labels.draw_polygon_hint')}
              </div>
            </div>

            <div className="relative">
              <div className="w-full h-80 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
                <GoogleMapComponent
                  center={{ lat: coordinates.latitude, lng: coordinates.longitude }}
                  zoom={18}
                  height="100%"
                  markers={[
                    { id: poi!.id, position: { lat: coordinates.latitude, lng: coordinates.longitude }, title: `${poi!.name} (Main POI)`, color: '#10B981' },
                    ...nearbyPOIs.filter((p: any) => p.coordinates && p.coordinates.latitude && p.coordinates.longitude).map((p: any) => ({
                      id: p.id,
                      position: { lat: p.coordinates.latitude, lng: p.coordinates.longitude },
                      title: p.name,
                      color: selectedPOIs.includes(p.id) ? '#FF6F00' : '#888'
                    }))
                  ]}
                  polygon={drawnPolygon || undefined}
                  showDrawingButton={false}
                  onMarkerClick={handleTogglePOI}
                  onPolygonComplete={handlePolygonComplete}
                />
              </div>

              {/* Legend */}
              <div className="absolute top-3 right-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <span className="text-gray-700 dark:text-gray-300">{t('labels.main_poi')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-tuggi-orange rounded-full"></div>
                    <span className="text-gray-700 dark:text-gray-300">{tCommon('status.selected')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
                    <span className="text-gray-700 dark:text-gray-300">{tCommon('status.available')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* POI Selection Section */}
          <div className="space-y-3">
            <h5 className="font-medium text-gray-900 dark:text-white">
              {t('labels.nearby_pois_found', { count: nearbyPOIs.length })}
            </h5>

            {nearbyPOIs.length > 0 ? (
              <div className="space-y-2">
                {nearbyPOIs.map((p: any) => (
                  <div
                    key={p.id}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                      selectedPOIs.includes(p.id)
                        ? "bg-tuggi-orange/10 border-tuggi-orange/30 shadow-sm"
                        : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
                    )}
                    onClick={() => handleTogglePOI(p.id)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedPOIs.includes(p.id)}
                      onChange={() => handleTogglePOI(p.id)}
                      className="rounded border-gray-300 text-tuggi-orange focus:ring-tuggi-orange"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white truncate">
                        {p.name}
                      </p>
                      {p.formatted_address && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                          {p.formatted_address}
                        </p>
                      )}
                    </div>
                    {p.rating && (
                      <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                        <Star className="h-4 w-4 text-yellow-400" />
                        {p.rating.toFixed(1)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <MapPin className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                <p className="text-sm font-medium">{t('labels.no_nearby_pois')}</p>
                <p className="text-xs mt-1">{t('labels.draw_polygon_instruction')}</p>
              </div>
            )}
          </div>

          {/* Group Configuration */}
          <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h5 className="font-medium text-gray-900 dark:text-white">
              {t('labels.group_configuration')}
            </h5>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('labels.group_name')}
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  placeholder={t('placeholders.enter_group_name')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {t('labels.main_poi')}: {poi?.name || 'N/A'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('labels.main_poi_hint')}
                  </p>
                </div>
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300">
                  {tCommon('status.main')}
                </span>
              </div>

              {selectedPOIs.length > 0 && (
                <div className="p-3 bg-tuggi-blue/5 dark:bg-tuggi-blue/10 rounded-lg">
                  <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                    {tCommon('status.selected')} POIs ({selectedPOIs.length})
                  </p>
                  <div className="space-y-1">
                    {selectedPOIs.map(id => {
                      // First check if it's the main POI
                      if (id === poi?.id) {
                        return (
                          <div key={id} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                            <Users className="h-3 w-3" />
                            {poi?.name || 'N/A'} ({tCommon('status.main')})
                          </div>
                        )
                      }
                      // Then check if it's in nearbyPOIs
                      const p = nearbyPOIs.find((nearbyPoi: any) => nearbyPoi.id === id)
                      return p ? (
                        <div key={id} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                          <Users className="h-3 w-3" />
                          {p.name}
                        </div>
                      ) : (
                        <div key={id} className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-500">
                          <Users className="h-3 w-3" />
                          POI {id.substring(0, 8)}... (Loading...)
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {selectedPOIs.length === 0 ? (
                <span>{t('labels.select_poi_to_create')}</span>
              ) : (
                <span>{t('labels.ready_to_create', { action: groupInfo ? tCommon('actions.update') : tCommon('actions.create'), count: selectedPOIs.length + 1 })}</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              {groupInfo && (
                <button
                  onClick={async () => {
                    // Handle group deletion
                    if (await requestConfirm(t('labels.disband_confirm'))) {
                      // Add delete group logic here
                    }
                  }}
                  className="inline-flex items-center px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  {t('labels.disband_group')}
                </button>
              )}

              <button
                onClick={handleSaveGroup}
                disabled={groupLoading || selectedPOIs.length < 1}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-tuggi-blue border border-transparent rounded-md hover:bg-tuggi-blue/90 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {groupLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : groupInfo ? (
                  <Save className="h-4 w-4 mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                {groupLoading ? 'Saving...' : groupInfo ? 'Update Group' : 'Create Group'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <MapPin className="h-16 w-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
          <p className="text-lg font-medium">{t('labels.no_coordinates_available')}</p>
          <p className="text-sm mt-1">{t('labels.need_coordinates_hint')}</p>
        </div>
      )}
    </div>
  )
}
