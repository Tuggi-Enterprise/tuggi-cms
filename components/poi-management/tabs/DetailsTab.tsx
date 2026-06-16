'use client'

/**
 * Details tab — POI identification, metadata, location, reference links and
 * destructive actions. Extracted from POIDetailsModal; reads shared POI state
 * and mutation handlers from POIModalContext. POI write operations live in
 * lib/core/poi-mutations-service (via the parent handlers).
 */

import { useTranslations } from 'next-intl'
import { Calendar, CheckCircle, ExternalLink, Globe, Info, MapPin, Save, Star, Target, Trash2, User, Users, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import { getFullSizeImageUrl } from '@/lib/imageUtils'
import { usePOIModalContext } from '../POIModalContext'

export function DetailsTab() {
  const t = useTranslations('Modals.POIDetails')
  const tCommon = useTranslations('Common')
  const {
    getPoi,
    canEdit,
    isCreateMode,
    onClose,
    editedPoi,
    setEditedPoi,
    isSaving,
    isAdmin,
    enhancedCategories,
    clients,
    images,
    referenceLinks,
    openInGoogleMaps,
    handleSaveChanges,
    handleDelete,
    handleGarbage,
  } = usePOIModalContext()
  const poi = getPoi()

  return (
              <div className="px-6 py-4 max-h-[80vh] overflow-y-auto space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* LEFT: Identification & Location (Col-Span 2) */}
                  <div className="lg:col-span-2 space-y-6">
                    {/* Primary Info Card */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm">
                      <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                        <Target className="h-4 w-4 text-tuggi-blue" />
                        POI Identification
                      </h4>
                      
                      <div className="space-y-5">
                        {/* POI Name */}
                        <div>
                          <label className="block text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1.5 ml-1">
                            {t('labels.name')} *
                          </label>
                          <input
                            type="text"
                            value={editedPoi?.name || ''}
                            onChange={(e) => setEditedPoi((prev: any) => prev ? ({ ...prev, name: e.target.value }) : null)}
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-transparent rounded-xl focus:bg-white focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white font-medium"
                            placeholder="Ex: Eiffel Tower"
                          />
                        </div>

                        {/* City | State | Country */}
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1.5 ml-1">
                              {t('labels.city')} *
                            </label>
                            <input
                              type="text"
                              value={editedPoi?.city || ''}
                              onChange={(e) => setEditedPoi((prev: any) => prev ? ({ ...prev, city: e.target.value }) : null)}
                              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-transparent rounded-xl focus:bg-white focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1.5 ml-1">
                              {t('labels.state')}
                            </label>
                            <input
                              type="text"
                              value={editedPoi?.state || ''}
                              onChange={(e) => setEditedPoi((prev: any) => prev ? ({ ...prev, state: e.target.value || null }) : null)}
                              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-transparent rounded-xl focus:bg-white focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1.5 ml-1">
                              {t('labels.country')} *
                            </label>
                            <input
                              type="text"
                              value={editedPoi?.country || ''}
                              onChange={(e) => setEditedPoi((prev: any) => prev ? ({ ...prev, country: e.target.value }) : null)}
                              className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-transparent rounded-xl focus:bg-white focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Geography Card */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm">
                      <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-tuggi-blue" />
                        Geographic Data
                      </h4>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Address Display */}
                        {(getPoi()?.formatted_address || getPoi()?.vicinity) && (
                          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 flex gap-3">
                            <MapPin className="h-5 w-5 text-gray-400 mt-1" />
                            <div className="min-w-0">
                              <span className="block text-[10px] font-black text-gray-400 uppercase tracking-tighter mb-1">Formatted Address</span>
                              <p className="text-xs text-gray-900 dark:text-white line-clamp-2 leading-relaxed">
                                {getPoi()?.formatted_address || getPoi()?.vicinity}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Coordinates Display */}
                        {getPoi()?.coordinates && (
                          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 flex flex-col justify-between">
                            <div className="flex gap-3">
                              <Globe className="h-5 w-5 text-gray-400 mt-1" />
                              <div className="min-w-0">
                                <span className="block text-[10px] font-black text-gray-400 uppercase tracking-tighter mb-1">{t('labels.coordinates')}</span>
                                <p className="text-xs font-mono text-gray-900 dark:text-white font-bold tracking-tight">
                                  {getPoi()!.coordinates!.latitude.toFixed(6)}, {getPoi()!.coordinates!.longitude.toFixed(6)}
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={openInGoogleMaps}
                              className="text-[10px] font-bold text-tuggi-blue hover:text-tuggi-blue/80 inline-flex items-center gap-1 mt-3 transition-colors uppercase tracking-tight"
                            >
                              <ExternalLink className="h-3 w-3" />
                              {t('actions.view_on_google_maps')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* RIGHT: Classification & Ownership */}
                  <div className="space-y-6">
                    {/* Settings Card */}
                    <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-100 dark:border-gray-700 shadow-sm">
                      <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-6">Classification</h4>
                      
                      <div className="space-y-5">
                        {/* Record Type */}
                        <div>
                          <label className="block text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1.5 ml-1">
                            {t('labels.record_type')}
                          </label>
                          <select
                            value={editedPoi?.record_type === 'geofence' || editedPoi?.category === 'geofence' ? 'geofence' : 'standard'}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditedPoi((prev: any) => {
                                if (!prev) return null;
                                const isGeofence = val === 'geofence';
                                return {
                                  ...prev,
                                  record_type: isGeofence ? 'geofence' : 'point_of_interest',
                                  category: (!isGeofence && prev.category === 'geofence') ? 'tourist_attraction' : prev.category
                                };
                              });
                            }}
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-transparent rounded-xl focus:bg-white focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white text-sm font-bold"
                          >
                            <option value="standard">{t('labels.poi_local')}</option>
                            <option value="geofence">{t('labels.geofence_restricted')}</option>
                          </select>
                        </div>

                        {/* Category */}
                        <div>
                          <label className="block text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1.5 ml-1">
                            {t('labels.category')}
                          </label>
                          <select
                            value={editedPoi?.category || ''}
                            onChange={(e) => setEditedPoi((prev: any) => prev ? ({ ...prev, category: e.target.value }) : null)}
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-transparent rounded-xl focus:bg-white focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white text-sm"
                          >
                            {enhancedCategories.map(category => (
                              <option key={category.value} value={category.value}>
                                {category.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Priority Level (1 Padrão Tuggi · 2 Complementar · 3 Adicional) */}
                        <div>
                          <label className="block text-[10px] font-black text-gray-500 uppercase tracking-tighter mb-1.5 ml-1">
                            {t('labels.priority_level')}
                          </label>
                          <select
                            value={String(editedPoi?.priority_level ?? getPoi()?.priority_level ?? 3)}
                            onChange={(e) => setEditedPoi((prev: any) => prev ? ({ ...prev, priority_level: parseInt(e.target.value, 10) }) : null)}
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-transparent rounded-xl focus:bg-white focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white text-sm"
                          >
                            <option value="1">{t('labels.priority_1')}</option>
                            <option value="2">{t('labels.priority_2')}</option>
                            <option value="3">{t('labels.priority_3')}</option>
                          </select>
                        </div>

                        {/* Google Types Badge Cloud */}
                        {getPoi()?.google_types && getPoi()!.google_types!.length > 0 && (
                          <div className="pt-2">
                             <label className="block text-[10px] font-black text-gray-400 uppercase tracking-tighter mb-3 ml-1">
                                {t('labels.google_types', { count: getPoi()!.google_types!.length })}
                              </label>
                            <div className="flex flex-wrap gap-1.5">
                              {getPoi()?.google_types?.slice(0, 8).map((type: string, index: number) => (
                                <span
                                  key={index}
                                  className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 tracking-tighter"
                                >
                                  {type.replace(/_/g, ' ')}
                                </span>
                              ))}
                              {getPoi()!.google_types!.length > 8 && (
                                <span className="text-[9px] font-bold text-gray-400 px-1">+{getPoi()!.google_types!.length - 8} more</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Management Card */}
                    <div className="bg-orange-50/50 dark:bg-orange-900/10 rounded-2xl p-6 border border-orange-100 dark:border-orange-900/30">
                      <h4 className="text-xs font-black text-orange-400 uppercase tracking-widest mb-6">Management</h4>
                      
                      <div className="space-y-5">
                        {/* Client Owner */}
                        <div>
                          <label className="block text-[10px] font-black text-orange-500 uppercase tracking-tighter mb-1.5 ml-1">
                            {t('labels.client_owner')}
                          </label>
                          <select
                            value={editedPoi?.owner_id || ''}
                            onChange={e => setEditedPoi((prev: any) => prev ? ({ ...prev, owner_id: e.target.value }) : null)}
                            disabled={!isAdmin}
                            className="w-full px-4 py-3 bg-white/80 dark:bg-gray-800 border-transparent rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-400 transition-all dark:text-white text-sm font-bold disabled:opacity-50"
                          >
                            <option value="" disabled>{t('labels.select_client')}</option>
                            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>

                        {/* Behavior (Geofence only) */}
                        {(editedPoi?.record_type === 'geofence' || editedPoi?.category === 'geofence') && (
                          <div className="animate-in slide-in-from-top-2 duration-300">
                            <label className="block text-[10px] font-black text-orange-500 uppercase tracking-tighter mb-1.5 ml-1">
                              {t('labels.trigger_behavior')}
                            </label>
                            <select 
                              value={editedPoi?.business_status || 'BOTH'}
                              onChange={e => setEditedPoi((prev: any) => prev ? ({ ...prev, business_status: e.target.value }) : null)}
                              className="w-full px-4 py-3 bg-white/80 dark:bg-gray-800 border-transparent rounded-xl focus:bg-white focus:ring-2 focus:ring-orange-400 transition-all dark:text-white text-sm font-black"
                            >
                              <option value="BOTH">{t('labels.both')}</option>
                              <option value="INSIDE">{t('labels.inside')}</option>
                              <option value="OUTSIDE">{t('labels.outside')}</option>
                            </select>
                          </div>
                        )}
                      </div>
                  </div>
                  </div>
                </div>
                    {/* Boundary Drawing & Image Preview Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="hidden">
                        {/* Boundary Drawing Section -> removed for brevity but we keep the structure so compiler doesn't complain */}
                      </div>

                      {/* Right Column: Image Preview */}
                      <div>
                        {(() => {
                          const currentPoiForImage = getPoi()
                          if (!currentPoiForImage) return null
                          const fullSizeImageUrl = getFullSizeImageUrl(currentPoiForImage)
                          return (fullSizeImageUrl || images.length > 0) && (
                            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700 h-full flex flex-col justify-between">
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                {t('labels.images')}
                              </label>
                              <div className="space-y-2 flex-grow">
                                {fullSizeImageUrl && (
                                  <img
                                    src={fullSizeImageUrl}
                                    alt={currentPoiForImage.name}
                                    className="w-full h-48 object-cover rounded-md border border-gray-200 dark:border-gray-700"
                                    loading="eager"
                                  />
                                )}
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    </div>

                    {/* SECTION 4: OSM Data (from homolog.pois) - Two Column Layout */}
                    {poi?._homologData && (
                      <>
                        {/* OSM Categories & Metadata - Two Column Layout */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* Left Column: OSM Categories */}
                          {(poi?._homologData?.primary_category || poi?._homologData?.categories?.length > 0) && (
                            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                <Target className="h-5 w-5 mr-2 text-tuggi-blue" />
                                {t('labels.osm_categories')}
                              </h3>

                              <div className="space-y-4">
                                {poi?._homologData?.primary_category && (
                                  <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('labels.primary_category')}</div>
                                    <div className="text-sm text-gray-900 dark:text-white font-semibold capitalize">{poi?._homologData?.primary_category}</div>
                                    {poi?._homologData?.primary_category_type && (
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('labels.type')}: {poi?._homologData?.primary_category_type}</div>
                                    )}
                                  </div>
                                )}

                                {poi?._homologData?.categories && poi?._homologData?.categories.length > 0 && (
                                  <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('labels.all_categories')}</div>
                                    <div className="flex flex-wrap gap-2">
                                      {poi?._homologData?.categories.map((cat: string, idx: number) => (
                                        <span
                                          key={idx}
                                          className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border border-purple-200 dark:border-purple-700"
                                        >
                                          {cat}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Right Column: Metadata */}
                          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                              <Info className="h-5 w-5 mr-2 text-gray-600" />
                              {t('labels.metadata')}
                            </h3>

                            <div className="space-y-4">
                              <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                <div className="flex items-start space-x-3">
                                  <Calendar className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('labels.created')}</div>
                                    <div className="text-sm text-gray-900 dark:text-white">{getPoi()?.created_at ? formatDate(getPoi()!.created_at) : t('common.na')}</div>
                                  </div>
                                </div>
                              </div>

                              <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                <div className="flex items-start space-x-3">
                                  <Calendar className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('labels.updated')}</div>
                                    <div className="text-sm text-gray-900 dark:text-white">{getPoi()?.updated_at ? formatDate(getPoi()!.updated_at) : t('common.na')}</div>
                                  </div>
                                </div>
                              </div>

                              {(() => {
                                const poi = getPoi();
                                const approvedAt = poi?.approved_at;
                                if (!approvedAt) return null;
                                return (
                                  <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                    <div className="flex items-start space-x-3">
                                      <User className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                      <div>
                                        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('labels.approved_at')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{formatDate(approvedAt)}</div>
                                        {poi?.approved_by && (
                                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('labels.by')}: {poi.approved_by}</div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}

                              {getPoi()?.google_place_id && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="flex items-start space-x-3">
                                    <ExternalLink className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                    <div>
                                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('labels.google_place_id')}</div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono break-all">{getPoi()!.google_place_id}</div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Detailed Address & Extended Contact - Two Column Layout */}
                        {((poi?._homologData?.neighborhood || poi?._homologData?.street_name || poi?._homologData?.house_number || poi?._homologData?.postal_code) ||
                          (poi?._homologData?.contact_email || poi?._homologData?.operator_name)) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {/* Detailed Address */}
                              {(poi?._homologData?.neighborhood || poi?._homologData?.street_name || poi?._homologData?.house_number || poi?._homologData?.postal_code) && (
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                    <MapPin className="h-5 w-5 mr-2 text-red-600" />
                                    {t('labels.detailed_address')}
                                  </h3>

                                  <div className="space-y-4">
                                    {poi?._homologData?.neighborhood && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.neighborhood')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{poi?._homologData?.neighborhood}</div>
                                      </div>
                                    )}

                                    {poi?._homologData?.street_name && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.street')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white">
                                          {poi?._homologData?.street_name}
                                          {poi?._homologData?.house_number && `, ${poi?._homologData?.house_number}`}
                                        </div>
                                      </div>
                                    )}

                                    {poi?._homologData?.postal_code && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.postal_code')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{poi?._homologData?.postal_code}</div>
                                      </div>
                                    )}

                                    {poi?._homologData?.description && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.description')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{poi?._homologData?.description}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Extended Contact Info */}
                              {(poi?._homologData?.contact_email || poi?._homologData?.operator_name) && (
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                    <Globe className="h-5 w-5 mr-2 text-blue-600" />
                                    {t('labels.extended_contact')}
                                  </h3>

                                  <div className="space-y-4">
                                    {poi?._homologData?.contact_email && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="flex items-start space-x-3">
                                          <Globe className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                          <div className="flex-1">
                                            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('labels.email')}</div>
                                            <a
                                              href={`mailto:${poi?._homologData?.contact_email}`}
                                              className="text-sm text-tuggi-blue hover:text-tuggi-blue/80 underline break-all"
                                            >
                                              {poi?._homologData?.contact_email}
                                            </a>
                                          </div>
                                        </div>
                                      </div>
                                    )}

                                    {poi?._homologData?.operator_name && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="flex items-start space-x-3">
                                          <User className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                          <div className="flex-1">
                                            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('labels.operator')}</div>
                                            <div className="text-sm text-gray-900 dark:text-white">{poi?._homologData?.operator_name}</div>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                        {/* Brand & Accessibility - Two Column Layout */}
                        {(poi?._homologData?.brand ||
                          (poi?._homologData?.wheelchair_accessible || poi?._homologData?.wheelchair_toilets || poi?._homologData?.accessibility_notes || poi?._homologData?.has_wheelchair_access)) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {/* Brand Information */}
                              {poi?._homologData?.brand && (
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                    <Star className="h-5 w-5 mr-2 text-yellow-600" />
                                    {t('labels.brand_information')}
                                  </h3>

                                  <div className="space-y-4">
                                    <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.brand')}</div>
                                      <div className="text-sm font-semibold text-gray-900 dark:text-white">{poi?._homologData?.brand}</div>
                                    </div>

                                    {poi?._homologData?.brand_wikidata && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.wikidata_id')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white font-mono">{poi?._homologData?.brand_wikidata}</div>
                                      </div>
                                    )}

                                    {poi?._homologData?.brand_wikipedia && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.wikipedia')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{poi?._homologData?.brand_wikipedia}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Accessibility */}
                              {(poi?._homologData?.wheelchair_accessible || poi?._homologData?.wheelchair_toilets || poi?._homologData?.accessibility_notes || poi?._homologData?.has_wheelchair_access) && (
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                    <Users className="h-5 w-5 mr-2 text-green-600" />
                                    {t('labels.accessibility')}
                                  </h3>

                                  <div className="space-y-4">
                                    {(poi?._homologData?.wheelchair_accessible || poi?._homologData?.has_wheelchair_access) && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.wheelchair_access')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white capitalize">
                                          {poi?._homologData?.wheelchair_accessible || (poi?._homologData?.has_wheelchair_access ? t('common.yes') : t('common.no'))}
                                        </div>
                                      </div>
                                    )}

                                    {poi?._homologData?.wheelchair_toilets && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.wheelchair_toilets')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white capitalize">{poi?._homologData?.wheelchair_toilets}</div>
                                      </div>
                                    )}

                                    {poi?._homologData?.accessibility_notes && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.accessibility_notes')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{poi?._homologData?.accessibility_notes}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                        {/* Physical Characteristics */}
                        {(poi?._homologData?.height || poi?._homologData?.building_material || poi?._homologData?.building_colour || poi?._homologData?.architectural_style) && (
                          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                              <Target className="h-5 w-5 mr-2 text-indigo-600" />
                              {t('labels.physical_characteristics')}
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {poi?._homologData?.height && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.height')}</div>
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">
                                    {Number(poi?._homologData?.height).toFixed(2)} m
                                  </div>
                                </div>
                              )}

                              {poi?._homologData?.building_material && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.building_material')}</div>
                                  <div className="text-sm text-gray-900 dark:text-white capitalize">{poi?._homologData?.building_material}</div>
                                </div>
                              )}

                              {poi?._homologData?.building_colour && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.building_colour')}</div>
                                  <div className="text-sm text-gray-900 dark:text-white capitalize">{poi?._homologData?.building_colour}</div>
                                </div>
                              )}

                              {poi?._homologData?.architectural_style && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.architectural_style')}</div>
                                  <div className="text-sm text-gray-900 dark:text-white capitalize">{poi?._homologData?.architectural_style}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Historical & Heritage - Two Column Layout */}
                        {(poi?._homologData?.heritage_status || poi?._homologData?.unesco_status || poi?._homologData?.landmark_type || poi?._homologData?.architect || poi?._homologData?.start_date || poi?._homologData?.historic_period) && (
                          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                              <Calendar className="h-5 w-5 mr-2 text-amber-600" />
                              {t('labels.historical_heritage_details')}
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {poi?._homologData?.heritage_status && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.heritage_status')}</div>
                                  <div className="text-sm text-gray-900 dark:text-white capitalize">{poi?._homologData?.heritage_status}</div>
                                </div>
                              )}

                              {poi?._homologData?.unesco_status && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.unesco_status')}</div>
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white capitalize">{poi?._homologData?.unesco_status}</div>
                                  {poi?._homologData?.unesco_inscription_date && (
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                      {t('labels.unesco_inscribed')}: {poi?._homologData?.unesco_inscription_date}
                                    </div>
                                  )}
                                </div>
                              )}

                              {poi?._homologData?.landmark_type && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.landmark_type')}</div>
                                  <div className="text-sm text-gray-900 dark:text-white capitalize">{poi?._homologData?.landmark_type}</div>
                                  {poi?._homologData?.landmark_level && (
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                      {t('labels.landmark_level')}: {poi?._homologData?.landmark_level}
                                    </div>
                                  )}
                                </div>
                              )}

                              {poi?._homologData?.architect && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.architect')}</div>
                                  <div className="text-sm text-gray-900 dark:text-white">{poi?._homologData?.architect}</div>
                                </div>
                              )}

                              {poi?._homologData?.start_date && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.start_date')}</div>
                                  <div className="text-sm text-gray-900 dark:text-white">{poi?._homologData?.start_date}</div>
                                </div>
                              )}

                              {poi?._homologData?.historic_period && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.historic_period')}</div>
                                  <div className="text-sm text-gray-900 dark:text-white capitalize">{poi?._homologData?.historic_period}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Type-Specific & Infrastructure - Two Column Layout */}
                        {((poi?._homologData?.museum_type || poi?._homologData?.leisure_type || poi?._homologData?.monument_type) ||
                          (poi?._homologData?.parking_capacity || poi?._homologData?.entrance_fee)) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {/* Type-Specific Information */}
                              {(poi?._homologData?.museum_type || poi?._homologData?.leisure_type || poi?._homologData?.monument_type) && (
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                    <Target className="h-5 w-5 mr-2 text-blue-600" />
                                    {t('labels.type_specific_info')}
                                  </h3>

                                  <div className="space-y-4">
                                    {poi?._homologData?.museum_type && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.museum_type')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white capitalize">{poi?._homologData?.museum_type}</div>
                                      </div>
                                    )}

                                    {poi?._homologData?.leisure_type && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.leisure_type')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white capitalize">{poi?._homologData?.leisure_type}</div>
                                      </div>
                                    )}

                                    {poi?._homologData?.monument_type && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.monument_type')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white capitalize">{poi?._homologData?.monument_type}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Infrastructure & Facilities */}
                              {(poi?._homologData?.parking_capacity || poi?._homologData?.entrance_fee) && (
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                    <Info className="h-5 w-5 mr-2 text-teal-600" />
                                    {t('labels.infrastructure_facilities')}
                                  </h3>

                                  <div className="space-y-4">
                                    {poi?._homologData?.parking_capacity && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.parking_capacity')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{poi?._homologData?.parking_capacity}</div>
                                      </div>
                                    )}

                                    {poi?._homologData?.entrance_fee && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('labels.entrance_fee')}</div>
                                        <div className="text-sm text-gray-900 dark:text-white capitalize">{poi?._homologData?.entrance_fee}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                        {/* Additional Flags */}
                        {poi?._homologData?.is_building && (
                          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="h-5 w-5 text-green-600" />
                              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200">
                                {t('labels.building')}
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center space-x-3 pt-4 border-t border-gray-200 dark:border-gray-600">
                      {isAdmin && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleDelete}
                            disabled={isSaving}
                            className="inline-flex items-center px-4 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                            title="Excluir (Move para Lixeira)"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {t('actions.delete_poi')}
                          </button>
                          <button
                            onClick={handleGarbage}
                            disabled={isSaving}
                            className="inline-flex items-center px-4 py-2 border border-gray-900 text-sm font-medium rounded-md text-white bg-gray-900 hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50"
                            title="Marcar como Lixo (Blacklist)"
                          >
                            <XCircle className="h-4 w-4 mr-2" />
                            Lixo
                          </button>
                        </div>
                      )}
                      <button
                        onClick={onClose}
                        className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
                      >
                        {t('actions.cancel')}
                      </button>
                      {(isCreateMode || canEdit) && (
                        <button
                          onClick={handleSaveChanges}
                          disabled={isSaving}
                          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-tuggi-blue hover:bg-tuggi-blue/90 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50"
                        >
                          <Save className="h-4 w-4 mr-2" />
                          {isSaving ? tCommon('actions.saving') : t('actions.save_changes')}
                        </button>
                      )}
                    </div>
                  </div>
  )
}
