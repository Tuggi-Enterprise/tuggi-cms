'use client'

import { useState, useEffect, useRef } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { X, Save, MapPin, Loader2, Volume2, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GoogleMapComponent, extractPolygonCoordinates } from '@/components/ui/GoogleMapComponent'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { useTranslations } from 'next-intl'
import { useAuthenticatedFunctionCall } from '@/lib/hooks/useAuthenticatedFunctionCall'

export function GeofenceModal({
  poi,
  isOpen,
  onClose,
  onUpdate,
  mode = 'view'
}: {
  poi: any | null
  isOpen: boolean
  onClose: () => void
  onUpdate: () => void
  mode?: 'view' | 'create' | 'edit'
}) {
  const isCreateMode = !poi || mode === 'create'
  const [activeTab, setActiveTab] = useState<'config' | 'boundary' | 'audio'>('config')

  const [name, setName] = useState(poi?.name || '')
  const [country, setCountry] = useState(poi?.country || '')
  const [state, setState] = useState(poi?.state || '')
  const [city, setCity] = useState(poi?.city || '')
  
  const [behavior, setBehavior] = useState(poi?.business_status || 'ENTER_ONLY') // Storing behavior in business_status for now
  const [ownerId, setOwnerId] = useState(poi?.owner_id || '')
  
  const [clients, setClients] = useState<any[]>([])
  
  const [boundaryPolygon, setBoundaryPolygon] = useState<any[] | null>(poi?.boundary_geojson || null)
  const [existingBoundary, setExistingBoundary] = useState<any[] | null>(null)
  const [isDrawingEnabled, setIsDrawingEnabled] = useState(false)

  const [description, setDescription] = useState('')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false)
  
  const { role: cmsUserRole, isAdmin } = useCmsUser()
  const { callFunction } = useAuthenticatedFunctionCall()
  const supabase = useSupabaseClient()
  const t = useTranslations('Geofences')
  
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (isOpen) {
      fetchClients()
      if (!isCreateMode && poi?.id) {
        fetchDescriptionData()
        fetchBoundary()
      }
    }
  }, [isOpen, isCreateMode, poi])

  const fetchClients = async () => {
    const { data } = await supabase.from('clients').select('id, name').eq('status', 'active')
    if (data) {
      setClients(data)
      if (isCreateMode && data.length > 0 && !isAdmin) {
        // Auto-select for non-admins if only one client is available in their scope
        setOwnerId(data[0].id)
      } else if (!isCreateMode && poi?.owner_id) {
        setOwnerId(poi.owner_id)
      }
    }
  }

  const fetchBoundary = async () => {
    try {
       const res = await fetch(`/api/pois/update-boundary`, {
         method: 'POST',
         body: JSON.stringify({ poi_id: poi.id, get_only: true })
       })
       const data = await res.json()
       if(data.boundary) setExistingBoundary(data.boundary)
    } catch(e) {}
  }

  const fetchDescriptionData = async () => {
    setIsLoadingData(true)
    const { data } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('*')
      .eq('attraction_id', poi.id)
      .eq('language', 'pt-br')
      .maybeSingle()
      
    if (data) {
      setDescription(data.description || '')
      setAudioUrl(data.audio_url || null)
    }
    setIsLoadingData(false)
  }

  const handleSave = async () => {
    if (!name.trim()) return setErrorMsg(t('nameRequired'))
    setIsSaving(true)
    setErrorMsg('')
    
    try {
      const payload = {
        name,
        country,
        state,
        city,
        owner_id: ownerId,
        category: 'geofence',
        business_status: behavior, // We hijack business_status for behavior
        description: description,
        boundary: boundaryPolygon
      }

      const endpoint = isCreateMode ? '/api/pois/geofences/create' : `/api/pois/geofences/update?id=${poi.id}`
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      
      onUpdate()
      onClose()
    } catch (e: any) {
      setErrorMsg(e.message)
    } finally {
      setIsSaving(false)
    }
  }

  const handlePolygonChange = (polygon: google.maps.Polygon | null) => {
    if (!polygon) {
      setBoundaryPolygon(null)
      return
    }
    const coords = extractPolygonCoordinates(polygon)
    setBoundaryPolygon(coords)
  }

  const handleGenerateAudio = async () => {
    if (!description.trim()) {
      setErrorMsg(t('saveBeforeAudio'))
      return
    }

    setIsGeneratingAudio(true)
    setErrorMsg('')
    try {
      const { data: result, error: invokeError } = await callFunction('generate-native-narration', {
        poi_id: poi.id,
        target_language: 'pt-br',
        voiceName: 'Nova',
        voiceGender: 'female',
        forceRecreatePtBr: true,
        recreate_only_ptbr: true
      })

      if (invokeError) throw new Error(invokeError.message || 'Failed to generate audio')
      
      // Auto-translate to English and Spanish as well
      await callFunction('generate-translated-audio', { attractionId: poi.id, targetLanguage: 'en-us', voiceGender: 'female' })
      await callFunction('generate-translated-audio', { attractionId: poi.id, targetLanguage: 'es-es', voiceGender: 'female' })

      fetchDescriptionData()
    } catch (e: any) {
      setErrorMsg(e.message)
    } finally {
      setIsGeneratingAudio(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-4xl bg-white dark:bg-gray-900 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-white/50 dark:bg-gray-900/50 backdrop-blur-xl sticky top-0 z-10">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {isCreateMode ? t('newGeofence') : t('editGeofence') + name}
            </h2>
            <p className="text-sm text-gray-500">{t('defineArea')}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-800 px-6">
          <button
            onClick={() => setActiveTab('config')}
            className={cn("px-4 py-3 text-sm font-medium border-b-2 transition-colors", activeTab === 'config' ? 'border-tuggi-blue text-tuggi-blue' : 'border-transparent text-gray-500')}
          >
            <Globe className="w-4 h-4 inline-block mr-2" />
            {t('generalConfig')}
          </button>
          <button
            onClick={() => setActiveTab('boundary')}
            className={cn("px-4 py-3 text-sm font-medium border-b-2 transition-colors", activeTab === 'boundary' ? 'border-tuggi-blue text-tuggi-blue' : 'border-transparent text-gray-500')}
          >
            <MapPin className="w-4 h-4 inline-block mr-2" />
            {t('triggerBoundary')}
          </button>
          <button
            onClick={() => setActiveTab('audio')}
            className={cn("px-4 py-3 text-sm font-medium border-b-2 transition-colors", activeTab === 'audio' ? 'border-tuggi-blue text-tuggi-blue' : 'border-transparent text-gray-500')}
          >
            <Volume2 className="w-4 h-4 inline-block mr-2" />
            {t('alertMessage')}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {errorMsg && (
            <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100">
              {errorMsg}
            </div>
          )}

          {activeTab === 'config' && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('commercialName')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                  className="w-full px-4 py-2 border rounded-xl"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('country')}</label>
                  <input type="text" value={country} onChange={e => setCountry(e.target.value)} className="w-full px-4 py-2 border rounded-xl" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('state')}</label>
                  <input type="text" value={state} onChange={e => setState(e.target.value)} className="w-full px-4 py-2 border rounded-xl" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('city')}</label>
                  <input type="text" value={city} onChange={e => setCity(e.target.value)} className="w-full px-4 py-2 border rounded-xl" />
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-gray-100">
                <h3 className="font-semibold">{t('businessRules')}</h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('triggerBehavior')}</label>
                  <select 
                    value={behavior}
                    onChange={e => setBehavior(e.target.value)}
                    className="w-full px-4 py-2 border rounded-xl"
                  >
                    <option value="ENTER_ONLY">{t('enterOnly')}</option>
                    <option value="INSIDE_ONLY">{t('insideOnly')}</option>
                    <option value="BOTH">{t('bothBehavior')}</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('ownerClient')}</label>
                  <select
                    value={ownerId}
                    onChange={e => setOwnerId(e.target.value)}
                    disabled={!isAdmin}
                    className="w-full px-4 py-2 border rounded-xl disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="">{t('noOwner')}</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {!isAdmin && <p className="text-xs text-gray-500 mt-1">{t('ownerTied')}</p>}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'boundary' && (
            <div className="h-full flex flex-col space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-500">{t('drawPolygonalArea')}</p>
                <button
                  onClick={() => setIsDrawingEnabled(!isDrawingEnabled)}
                  className={cn("px-4 py-2 rounded-lg text-sm font-medium border", isDrawingEnabled ? 'bg-red-50 text-red-600 border-red-200' : 'bg-tuggi-blue text-white')}
                >
                  {isDrawingEnabled ? t('disableDrawing') : t('drawBoundary')}
                </button>
              </div>
              <div className="flex-1 rounded-xl overflow-hidden border">
                <GoogleMapComponent
                  center={poi?.coordinates ? { lat: poi.coordinates.latitude, lng: poi.coordinates.longitude } : { lat: -23.5505, lng: -46.6333 }}
                  zoom={12}
                  onPolygonComplete={handlePolygonChange}
                  enableDrawing={isDrawingEnabled}
                  polygon={existingBoundary || undefined}
                />
              </div>
            </div>
          )}

          {activeTab === 'audio' && (
            <div className="space-y-6">
              {isLoadingData ? <Loader2 className="w-5 h-5 animate-spin mx-auto text-tuggi-blue" /> : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('messageText')}</label>
                    <textarea 
                      rows={4}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder={t('messagePlaceholder')}
                      className="w-full p-4 rounded-xl border"
                    />
                    <div className="flex justify-between items-center mt-2">
                       <p className="text-xs text-gray-500">{t('saveBeforeAudio')}</p>
                       {!isCreateMode && (
                         <button
                           onClick={handleGenerateAudio}
                           disabled={isGeneratingAudio || !description.trim() || isSaving}
                           className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center"
                         >
                           {isGeneratingAudio ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Volume2 className="w-4 h-4 mr-2" />}
                           {isGeneratingAudio ? t('generatingAudio') : t('generateAudio')}
                         </button>
                       )}
                    </div>
                  </div>
                  
                  {audioUrl && (
                    <div className="p-4 rounded-xl border bg-gray-50">
                      <p className="text-sm font-semibold mb-2">{t('currentAudioPreview')}</p>
                      <audio src={audioUrl} controls className="w-full h-10" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 font-medium">{t('cancel')}</button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 bg-tuggi-blue text-white rounded-xl font-medium shadow-lg hover:bg-blue-600 disabled:opacity-50 flex items-center"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            {isSaving ? t('saving') : t('saveGeofence')}
          </button>
        </div>
      </div>
    </div>
  )
}
