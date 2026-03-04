'use client'

import { useState, useEffect, useRef } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { X, Save, MapPin, Loader2, Volume2, Globe, FileText, RotateCcw, Download, LocateFixed } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GoogleMapComponent, extractPolygonCoordinates } from '@/components/ui/GoogleMapComponent'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { useTranslations } from 'next-intl'
import { useAuthenticatedFunctionCall } from '@/lib/hooks/useAuthenticatedFunctionCall'
import { useUserLocation } from '@/components/providers/UserLocationProvider'

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
  const [poiId, setPoiId] = useState<string | null>(poi?.id || null)
  const isCreateMode = (!poi || mode === 'create') && !poiId
  const [activeTab, setActiveTab] = useState<'boundary' | 'config' | 'description' | 'audio' | 'review'>('boundary')

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
  
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['pt-br', 'en-us', 'es-es'])
  const [selectedGender, setSelectedGender] = useState<'male' | 'female'>('male')
  const [audioProgress, setAudioProgress] = useState({ current: 0, total: 0, currentTask: '' })
  const [audioResults, setAudioResults] = useState<string[]>([])
  const [showResults, setShowResults] = useState(false)
  const [translatedDescriptions, setTranslatedDescriptions] = useState<any[]>([])
  const [isTranslating, setIsTranslating] = useState(false)

  const { role: cmsUserRole, isAdmin, clientId } = useCmsUser()
  const { callFunction } = useAuthenticatedFunctionCall()
  const supabase = useSupabaseClient()
  const t = useTranslations('Geofences')
  const tPOIDetails = useTranslations('Modals.POIDetails')
  const tCommon = useTranslations('Common')
  
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [currentMapCenter, setCurrentMapCenter] = useState<{ lat: number; lng: number } | null>(null)

  const { userLocation, requestLocation } = useUserLocation()
  const defaultCenter = userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : { lat: -23.5505, lng: -46.6333 } // SP as fallback

  useEffect(() => {
    if (isOpen) {
      if (poi) {
        setName(poi.name || '')
        setCountry(poi.country || '')
        setState(poi.state || '')
        setCity(poi.city || '')
        setBehavior(poi.business_status || 'ENTER_ONLY')
        setOwnerId(poi.owner_id || '')
        setPoiId(poi.id || null)
      }
      
      fetchClients()
      if (poiId || poi?.id) {
        fetchDescriptionData()
        fetchBoundary()
      }

      // Set initial map center
      if (poi?.coordinates?.latitude) {
        setCurrentMapCenter({ lat: poi.coordinates.latitude, lng: poi.coordinates.longitude })
      } else if (userLocation) {
        setCurrentMapCenter({ lat: userLocation.lat, lng: userLocation.lng })
      } else {
        setCurrentMapCenter({ lat: -23.5505, lng: -46.6333 })
      }
    }
  }, [isOpen, poi])

  const handleCenterOnUser = async () => {
    let location = userLocation
    
    if (!location) {
      location = await requestLocation()
    }

    if (location) {
      console.log('📍 [GeofenceModal] Centering on location:', location)
      setCurrentMapCenter({ 
        lat: location.lat, 
        lng: location.lng,
      })
      // Force a slight change if it's already the same to trigger useEffect in MapComponent
      setTimeout(() => {
        setCurrentMapCenter({ lat: location!.lat, lng: location!.lng })
      }, 50)
    } else {
      alert("Não foi possível obter sua localização. Por favor, verifique as permissões do navegador.")
    }
  }

  const handlePolygonChange = (polygon: google.maps.Polygon | null) => {
    console.log('📍 [GeofenceModal] handlePolygonChange called:', !!polygon)
    if (!polygon) {
      setBoundaryPolygon(null)
      setExistingBoundary(null)
      return
    }
    const coords = extractPolygonCoordinates(polygon)
    setBoundaryPolygon(coords)
    setExistingBoundary(coords) // Ensure it persists when switching tabs
  }

  const fetchClients = async () => {
    try {
      const res = await fetch('/api/clients/my-clients')
      if (res.ok) {
        const { clients: data } = await res.json()
        if (data) {
          setClients(data)
          // Robust owner auto-selection:
          // 1. If we already have a selected ownerId, keep it.
          // 2. If it's empty, and the POI has one, use it.
          // 3. If it's empty, and the user has a linked client (clientId), use it.
          // 4. If it's empty, we're not admin, and there's only one client, auto-select it.
          if (!ownerId && poi?.owner_id) {
            setOwnerId(poi.owner_id)
          } else if (!ownerId && clientId) {
            setOwnerId(clientId)
          } else if (!ownerId && data.length > 0 && !isAdmin) {
            setOwnerId(data[0].id)
          }
        }
      }
    } catch(err) {
      console.error('Failed to fetch clients', err)
    }
  }

  const fetchBoundary = async () => {
    if (!poiId) return
    console.log(`🔍 [GeofenceModal] fetchBoundary: Fetching for poiId: ${poiId}`)
    try {
       const res = await fetch(`/api/pois/update-boundary`, {
         method: 'POST',
         body: JSON.stringify({ poi_id: poiId, get_only: true })
       })
       const data = await res.json()
       console.log(`📥 [GeofenceModal] fetchBoundary Response:`, data)
       if(data.boundary) {
         setExistingBoundary(data.boundary)
         // Sync boundaryPolygon if it's not already set
         if (!boundaryPolygon) setBoundaryPolygon(data.boundary)
       }
    } catch(e) {
      console.error('📍 [GeofenceModal] Error fetching boundary:', e)
    }
  }

  const fetchDescriptionData = async () => {
    if (!poiId) return
    setIsLoadingData(true)
    const { data } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('*')
      .eq('attraction_id', poiId)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      
    if (data) {
      const ptDesc = data.find((d: any) => d.language === 'pt-br' || d.language === 'pt')
      if (ptDesc) {
        setDescription(ptDesc.description || '')
        setAudioUrl(ptDesc.audio_url || null)
      }
      
      const allAudiosAvailable = data.filter((desc: any) => desc.audio_url)
      setTranslatedDescriptions(allAudiosAvailable)
    }
    setIsLoadingData(false)
  }

  const saveGeofenceData = async () => {
    console.log('💾 [GeofenceModal] saveGeofenceData called', {
      name,
      hasBoundary: !!boundaryPolygon,
      boundaryCount: boundaryPolygon?.length,
      poiId,
      ownerId
    })

    if (!name.trim()) {
      setErrorMsg(t('nameRequired'))
      setActiveTab('config')
      return null
    }
    
    if (!boundaryPolygon && !poiId) {
      setErrorMsg(t('drawWarning'))
      setActiveTab('boundary')
      return null
    }

    if (!ownerId) {
      // Re-using a basic fallback string since the exact translation key might not exist
      setErrorMsg(t('ownerTied') || 'Selecione um Cliente / Responsável.')
      setActiveTab('config')
      return null
    }

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
        business_status: behavior,
        description: description,
        boundary: boundaryPolygon
      }

      const targetId = poiId
      const endpoint = targetId ? `/api/pois/geofences/update?id=${targetId}` : '/api/pois/geofences/create'
      console.log(`🌐 [GeofenceModal] Sending request to ${endpoint} with payload:`, JSON.stringify(payload, null, 2))
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      
      const resData = await res.json()
      console.log('📥 [GeofenceModal] Response from server:', resData)
      if (!res.ok) throw new Error(resData.error || 'Failed to save')
      
      const newId = resData.data?.id || targetId
      if (newId) setPoiId(newId)
      
      onUpdate()
      return newId
    } catch (e: any) {
      setErrorMsg(e.message)
      return null
    } finally {
      setIsSaving(false)
    }
  }

  const handleSave = async () => {
    const savedId = await saveGeofenceData()
    if (savedId) {
      onClose()
    }
  }



  const regenerateAllAudios = async () => {
    if (!description.trim()) {
      setErrorMsg(t('saveBeforeAudio'))
      return
    }

    if (selectedLanguages.length === 0) {
      setErrorMsg(t('selectLanguageError'))
      return
    }

    setIsGeneratingAudio(true)
    setIsTranslating(true)
    setShowResults(false)
    setAudioResults([])
    setErrorMsg('')

    setAudioProgress({ current: 0, total: selectedLanguages.length, currentTask: t('audioTaskStarting') })

    try {
      const results: string[] = []

      for (let i = 0; i < selectedLanguages.length; i++) {
        const langCode = selectedLanguages[i]
        const langDisplayName = tPOIDetails(`languages.${langCode}`)
        const genderLabel = selectedGender === 'male' ? tPOIDetails('labels.male') : tPOIDetails('labels.female')

        setAudioProgress({
          current: i + 1,
          total: selectedLanguages.length,
          currentTask: t('audioTaskGenerating', { lang: langDisplayName, gender: genderLabel })
        })

        try {
          const { data: result, error: invokeError } = await callFunction('generate-translated-audio', {
            attractionId: poiId,
            targetLanguage: langCode,
            voiceGender: selectedGender
          })

          if (invokeError) throw new Error(invokeError.message || 'Failed to generate audio')
          if (!result?.success) throw new Error(result?.error || 'Failed to generate audio')

          results.push(`✅ ${langDisplayName} (${genderLabel}): ${t('generatedSuccessfully')}`)
        } catch (error: any) {
          results.push(`❌ ${langDisplayName} (${genderLabel}): ${t('failedToGenerate')} - ${error instanceof Error ? error.message : tCommon('error.unknown')}`)
        }
      }

      setAudioProgress({ current: selectedLanguages.length, total: selectedLanguages.length, currentTask: t('audioTaskCompleted') })
      setAudioResults(results)
      setShowResults(true)

      setTimeout(() => fetchDescriptionData(), 1000)
    } catch (e: any) {
      setErrorMsg(e.message)
      setAudioResults([`❌ ${t('audioTaskGeneralError')}: ${e instanceof Error ? e.message : tCommon('error.unknown')}`])
      setShowResults(true)
    } finally {
      setIsGeneratingAudio(false)
      setIsTranslating(false)
      setTimeout(() => setAudioProgress({ current: 0, total: 0, currentTask: '' }), 3000)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm">
      <div className="w-[85vw] bg-white dark:bg-gray-900 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <header className="flex-none px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl z-30">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {isCreateMode ? t('newGeofence') : (t('editGeofence') + ' ' + (name || ''))}
            </h2>
            <p className="text-sm text-gray-500">{t('defineArea')}</p>
          </div>
          <button onClick={onClose} className="p-3 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-2xl transition-all">
            <X className="w-6 h-6" />
          </button>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Lateral Menu (Sidebar) */}
          <aside className="w-72 bg-white dark:bg-gray-900 border-r border-gray-100/50 dark:border-gray-800 p-6 flex flex-col gap-2 z-20">
            <div className="mb-4">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3">{t('menuLabel')}</span>
            </div>
            
            <button
              onClick={() => setActiveTab('boundary')}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                activeTab === 'boundary' 
                  ? 'bg-tuggi-blue text-white' 
                  : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
              )}
            >
              <MapPin className={cn("h-5 w-5", activeTab === 'boundary' && "animate-pulse")} />
              {t('triggerBoundary')}
            </button>

            <button
              onClick={() => setActiveTab('config')}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                activeTab === 'config' 
                  ? 'bg-tuggi-blue text-white' 
                  : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
              )}
            >
              <Globe className={cn("h-5 w-5", activeTab === 'config' && "animate-pulse")} />
              {t('generalConfig')}
            </button>
            
            <button
              onClick={() => setActiveTab('description')}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                activeTab === 'description' 
                  ? 'bg-tuggi-blue text-white' 
                  : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
              )}
            >
              <FileText className={cn("h-5 w-5", activeTab === 'description' && "animate-pulse")} />
              {tPOIDetails('tabs.description')}
            </button>
            <button
              onClick={() => setActiveTab('audio')}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                activeTab === 'audio' 
                  ? 'bg-tuggi-blue text-white' 
                  : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
              )}
            >
              <Volume2 className={cn("h-5 w-5", activeTab === 'audio' && "animate-pulse")} />
              {t('alertMessage')}
            </button>

            <button
              onClick={() => setActiveTab('review')}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                activeTab === 'review' 
                  ? 'bg-tuggi-blue text-white' 
                  : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
              )}
            >
              <Save className={cn("h-5 w-5", activeTab === 'review' && "animate-pulse")} />
              {t('finalReview')}
            </button>
          </aside>

          {/* Content Area */}
          <main className="flex-1 overflow-y-auto bg-gray-50/30 dark:bg-gray-900/30 p-8">
          {errorMsg && (
            <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-xl text-sm border border-red-100">
              {errorMsg}
            </div>
          )}

          {activeTab === 'boundary' && (
            <div className="h-full flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-gray-500">{t('drawPolygonalArea')}</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCenterOnUser}
                    className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 hover:text-tuggi-blue hover:border-tuggi-blue transition-all"
                    title="Centralizar na minha localização"
                  >
                    <LocateFixed className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setIsDrawingEnabled(!isDrawingEnabled)}
                    className={cn("px-4 py-2 rounded-lg text-sm font-medium border", isDrawingEnabled ? 'bg-red-50 text-red-600 border-red-200' : 'bg-tuggi-blue text-white')}
                  >
                    {isDrawingEnabled ? t('disableDrawing') : t('drawBoundary')}
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 rounded-xl overflow-hidden border">
                <GoogleMapComponent
                  center={currentMapCenter || defaultCenter}
                  zoom={12}
                  height="100%"
                  onPolygonComplete={handlePolygonChange}
                  enableDrawing={isDrawingEnabled}
                  polygon={existingBoundary || undefined}
                />
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setActiveTab('config')}
                  className="px-8 py-3 bg-tuggi-blue text-white rounded-xl font-bold hover:bg-tuggi-blue/90 transition-all flex items-center gap-2"
                >
                  {t('nextStep')}
                </button>
              </div>
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
                    <option value="" disabled>{t('noOwner')}</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {!isAdmin && <p className="text-xs text-gray-500 mt-1">{t('ownerTied')}</p>}
                </div>
              </div>
              
              <div className="pt-6 flex justify-end">
                <button
                  onClick={() => setActiveTab('description')}
                  className="px-8 py-3 bg-tuggi-blue text-white rounded-xl font-bold hover:bg-tuggi-blue/90 transition-all flex items-center gap-2"
                >
                  {t('nextStep')}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'description' && (
            <div className="space-y-6">
              {isLoadingData ? <Loader2 className="w-5 h-5 animate-spin mx-auto text-tuggi-blue" /> : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('messageText')}</label>
                    <textarea 
                      rows={6}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder={t('messagePlaceholder')}
                      className="w-full p-4 rounded-xl border focus:border-tuggi-blue focus:ring-1 focus:ring-tuggi-blue transition-all"
                    />
                    <div className="flex justify-between items-center mt-2">
                       <p className="text-xs text-gray-500">{tPOIDetails('labels.description_hint')}</p>
                    </div>
                  </div>
                  <div className="pt-6 flex justify-end">
                    <button
                      onClick={async () => {
                        const savedId = await saveGeofenceData()
                        if (savedId) setActiveTab('audio')
                      }}
                      disabled={isSaving}
                      className="px-8 py-3 bg-tuggi-blue text-white rounded-xl font-bold hover:bg-tuggi-blue/90 transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                      {isSaving && <Loader2 className="w-5 h-5 animate-spin" />}
                      {t('nextStep')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'audio' && (
            <div className="space-y-6">
              {isLoadingData ? <Loader2 className="w-5 h-5 animate-spin mx-auto text-tuggi-blue" /> : (
                <div className="space-y-6">
                  {/* (Audio generation UI content remains same) */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                        {tPOIDetails('labels.narration_audios')}
                      </h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {t('audioTabSubtitle')}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => fetchDescriptionData()}
                        className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        {tPOIDetails('actions.refresh')}
                      </button>
                      <button
                        onClick={regenerateAllAudios}
                        disabled={isGeneratingAudio || isTranslating || (!description.trim() && !audioUrl)}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-tuggi-blue hover:bg-tuggi-blue/90 disabled:opacity-50"
                      >
                        {(isGeneratingAudio || isTranslating) ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            {tCommon('actions.generating')}
                          </>
                        ) : (
                          <>
                            <Volume2 className="h-4 w-4 mr-2" />
                            {audioUrl ? tPOIDetails('actions.regenerate_all') : tPOIDetails('actions.generate_all')}
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        {tPOIDetails('labels.voice_gender')}
                      </label>
                      <div className="flex gap-4">
                        <label className="flex items-center cursor-pointer">
                          <input type="radio" value="male" checked={selectedGender === 'male'} onChange={(e) => setSelectedGender('male')} className="mr-2 text-tuggi-blue" />
                          <span className="text-sm text-gray-700 dark:text-gray-300">{tPOIDetails('labels.male')}</span>
                        </label>
                        <label className="flex items-center cursor-pointer">
                          <input type="radio" value="female" checked={selectedGender === 'female'} onChange={(e) => setSelectedGender('female')} className="mr-2 text-tuggi-blue" />
                          <span className="text-sm text-gray-700 dark:text-gray-300">{tPOIDetails('labels.female')}</span>
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        {tPOIDetails('labels.languages_to_generate')}
                      </label>
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                        {[
                          { code: 'pt-br' },
                          { code: 'pt-pt' },
                          { code: 'en-us' },
                          { code: 'en-gb' },
                          { code: 'es-es' },
                          { code: 'de-de' },
                          { code: 'fr-fr' },
                          { code: 'it-it' },
                          { code: 'ja-jp' },
                          { code: 'cmn-cn' },
                          { code: 'ko-kr' },
                          { code: 'ru-ru' },
                        ].map((lang) => (
                          <label key={lang.code} className={cn("flex items-start p-2 rounded border cursor-pointer min-h-[40px]", selectedLanguages.includes(lang.code) ? "bg-tuggi-blue/10 border-tuggi-blue" : "bg-white border-gray-300")}>
                            <input type="checkbox" checked={selectedLanguages.includes(lang.code)} onChange={(e) => {
                              if (e.target.checked) setSelectedLanguages([...selectedLanguages, lang.code])
                              else setSelectedLanguages(selectedLanguages.filter(l => l !== lang.code))
                            }} className="mt-0.5 mr-2 text-tuggi-blue" />
                            <span className="text-xs font-medium text-gray-900 leading-snug">
                              {tPOIDetails(`languages.${lang.code}`)}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  {(isGeneratingAudio || isTranslating) && audioProgress.total > 0 && (
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                      <div className="flex items-center justify-between mb-2">
                         <h6 className="text-sm font-medium text-blue-900">{tPOIDetails('labels.audio_generation_progress')}</h6>
                         <span className="text-sm text-blue-700">{audioProgress.current} / {audioProgress.total}</span>
                      </div>
                      <div className="w-full bg-blue-200 rounded-full h-2 mb-2">
                        <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${(audioProgress.current / audioProgress.total) * 100}%` }}></div>
                      </div>
                      <p className="text-sm text-blue-700">{audioProgress.currentTask}</p>
                    </div>
                  )}

                  {showResults && audioResults.length > 0 && (
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <div className="flex items-center justify-between mb-3">
                         <h6 className="text-sm font-medium text-gray-900">🎯 {tPOIDetails('labels.generation_results')}</h6>
                         <button onClick={() => setShowResults(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
                      </div>
                      <div className="space-y-2">
                        {audioResults.map((res, i) => (
                          <div key={i} className={`p-2 rounded text-sm ${res.includes('✅') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{res}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {translatedDescriptions.length > 0 ? (
                    <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
                      <h5 className="text-lg font-medium text-gray-900 mb-4">🎵 {tPOIDetails('labels.available_audios')}</h5>
                      <div className="overflow-x-auto">
                        <table className="w-full table-auto">
                          <thead>
                            <tr className="border-b border-gray-200">
                               <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">{tPOIDetails('labels.language')}</th>
                               <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">{tPOIDetails('labels.gender')}</th>
                               <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">{tPOIDetails('labels.description')}</th>
                               <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">{tPOIDetails('tabs.audio')}</th>
                               <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">{tPOIDetails('labels.actions')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {translatedDescriptions.map((desc, index) => (
                              <tr key={desc.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="py-3 px-3 text-sm">
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                                    {(desc.language || '').toUpperCase()}
                                  </span>
                                </td>
                                <td className="py-3 px-3 text-sm">
                                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${desc.gender === 'male' ? 'bg-indigo-100 text-indigo-800' : 'bg-pink-100 text-pink-800'}`}>
                                    {desc.gender === 'male' ? `♂️ ${tPOIDetails('labels.male')}` : `♀️ ${tPOIDetails('labels.female')}`}
                                  </span>
                                </td>
                                <td className="py-3 px-3 text-sm max-w-xs truncate" title={desc.description}>
                                  {desc.description?.substring(0, 50)}...
                                </td>
                                <td className="py-3 px-3 text-sm">
                                  {desc.audio_url && (
                                    <button onClick={() => { new Audio(desc.audio_url).play() }} className="inline-flex items-center px-2 py-1 text-xs bg-green-100 text-green-800 rounded">
                                      <Volume2 className="h-3 w-3 mr-1" /> {tPOIDetails('actions.play')}
                                    </button>
                                  )}
                                </td>
                                <td className="py-3 px-3 text-sm">
                                  {desc.audio_url && (
                                    <button onClick={() => window.open(desc.audio_url, '_blank')} className="inline-flex items-center px-2 py-1 text-xs bg-gray-200 text-gray-800 rounded">
                                      <Download className="h-3 w-3 mr-1" /> {tPOIDetails('actions.download')}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 px-4 border rounded-xl bg-gray-50 flex flex-col items-center">
                      <Volume2 className="w-12 h-12 text-gray-300 mb-4" />
                      <h4 className="text-lg font-medium text-gray-900">{t('noAudioAvailableTitle')}</h4>
                      <p className="text-sm text-gray-500 mt-2">{t('noAudioAvailableDesc')}</p>
                      {!description.trim() && (
                        <p className="text-xs text-tuggi-orange font-medium mt-4">{t('saveDescriptionWarning')}</p>
                      )}
                    </div>
                  )}

                  <div className="pt-6 flex justify-end">
                    <button
                      onClick={() => setActiveTab('review')}
                      className="px-8 py-3 bg-tuggi-blue text-white rounded-xl font-bold hover:bg-tuggi-blue/90 transition-all flex items-center gap-2"
                    >
                      {t('finishReview')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'review' && (
            <div className="space-y-8 max-w-3xl">
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 p-8 shadow-sm space-y-6">
                <div className="flex items-center gap-4 text-tuggi-blue mb-4">
                  <Save className="w-8 h-8" />
                  <h3 className="text-2xl font-bold">{t('finalReview')}</h3>
                </div>

                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('generalInfo')}</p>
                    <p className="text-lg font-semibold text-gray-900">{name || tPOIDetails('placeholders.enter_name')}</p>
                    <p className="text-sm text-gray-500">{city}, {state} - {country}</p>
                    <p className="text-sm font-medium mt-2">{t('triggerBehavior')}: <span className="text-tuggi-blue">{behavior}</span></p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('boundaryStatus')}</p>
                    <div className="flex items-center gap-2">
                       {boundaryPolygon ? (
                         <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold bg-green-100 text-green-700">{t('boundaryDrawn')}</span>
                       ) : (
                         <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold bg-red-100 text-red-700">{t('boundaryMissing')}</span>
                       )}
                    </div>
                    <p className="text-sm text-gray-500 mt-2">{t('ownerClient')}: {ownerId || t('noOwner')}</p>
                  </div>
                </div>

                <div className="pt-6 border-t border-gray-100 space-y-4">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('contentNarration')}</p>
                  <div className="p-4 bg-gray-50 rounded-xl">
                    <p className="text-sm text-gray-700 line-clamp-3 italic">"{description || t('noMessage')}"</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {translatedDescriptions.map(d => (
                      <span key={d.id} className="px-3 py-1 bg-blue-50 text-tuggi-blue rounded-full text-[10px] font-bold">
                        {d.language?.toUpperCase()} ✓
                      </span>
                    ))}
                    {translatedDescriptions.length === 0 && <span className="text-xs text-gray-400">{t('noAudioGenerated')}</span>}
                  </div>
                </div>

                <div className="pt-8 flex flex-col gap-4">
                   <button
                    onClick={handleSave}
                    disabled={isSaving || !name.trim() || !boundaryPolygon}
                    className="w-full py-4 bg-gradient-to-r from-tuggi-blue to-blue-600 text-white rounded-2xl font-bold shadow-xl shadow-blue-500/20 hover:shadow-blue-500/30 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                    {isSaving ? t('saving') : t('confirmedSave')}
                   </button>
                   {!boundaryPolygon && <p className="text-center text-xs text-red-500 font-medium">{t('drawWarning')}</p>}
                </div>
              </div>
            </div>
          )}
          </main>
        </div>

        {/* Footer */}
        <footer className="flex-none px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl flex justify-end gap-3 z-30">
          <button onClick={onClose} className="px-5 py-2.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium transition-colors">
            {t('cancel')}
          </button>
        </footer>
      </div>
    </div>
  )
}
