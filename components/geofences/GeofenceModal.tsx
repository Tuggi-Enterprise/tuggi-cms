'use client'

import { useState, useEffect, useRef } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { X, Save, MapPin, Loader2, Volume2, Globe, FileText, RotateCcw, Download } from 'lucide-react'
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
  const [activeTab, setActiveTab] = useState<'config' | 'boundary' | 'description' | 'audio'>('config')

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

  const { role: cmsUserRole, isAdmin } = useCmsUser()
  const { callFunction } = useAuthenticatedFunctionCall()
  const supabase = useSupabaseClient()
  const t = useTranslations('Geofences')
  const tPOIDetails = useTranslations('Modals.POIDetails')
  const tCommon = useTranslations('Common')
  
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

  const regenerateAllAudios = async () => {
    if (!description.trim()) {
      setErrorMsg(t('saveBeforeAudio'))
      return
    }

    if (selectedLanguages.length === 0) {
      setErrorMsg('Please select at least one language.')
      return
    }

    setIsGeneratingAudio(true)
    setIsTranslating(true)
    setShowResults(false)
    setAudioResults([])
    setErrorMsg('')

    setAudioProgress({ current: 0, total: selectedLanguages.length, currentTask: 'Starting...' })

    try {
      const results: string[] = []

      for (let i = 0; i < selectedLanguages.length; i++) {
        const langCode = selectedLanguages[i]
        const langName = {
          'pt-br': 'Portuguese (BR)',
          'pt-pt': 'Portuguese (PT)',
          'en-us': 'English (US)',
          'en-gb': 'English (UK)',
          'es-es': 'Spanish (ES)',
          'de-de': 'German',
          'fr-fr': 'French',
          'it-it': 'Italian',
          'ja-jp': 'Japanese',
          'cmn-cn': 'Chinese',
          'ko-kr': 'Korean',
          'ru-ru': 'Russian',
        }[langCode as 'pt-br' | 'pt-pt' | 'en-us' | 'en-gb' | 'es-es' | 'de-de' | 'fr-fr' | 'it-it' | 'ja-jp' | 'cmn-cn' | 'ko-kr' | 'ru-ru'] || langCode.toUpperCase()

        setAudioProgress({
          current: i + 1,
          total: selectedLanguages.length,
          currentTask: `Generating ${langName} (${selectedGender}) audio...`
        })

        try {
          const { data: result, error: invokeError } = await callFunction('generate-translated-audio', {
            attractionId: poi.id,
            targetLanguage: langCode,
            voiceGender: selectedGender
          })

          if (invokeError) throw new Error(invokeError.message || 'Failed to generate audio')
          if (!result?.success) throw new Error(result?.error || 'Failed to generate audio')

          results.push(`✅ ${langName} (${selectedGender}): generated successfully`)
        } catch (error: any) {
          results.push(`❌ ${langName} (${selectedGender}): failed - ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      setAudioProgress({ current: selectedLanguages.length, total: selectedLanguages.length, currentTask: 'Completed!' })
      setAudioResults(results)
      setShowResults(true)

      setTimeout(() => fetchDescriptionData(), 1000)
    } catch (e: any) {
      setErrorMsg(e.message)
      setAudioResults([`❌ General error: ${e instanceof Error ? e.message : 'Unknown error'}`])
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
              {isCreateMode ? t('newGeofence') : t('editGeofence') + name}
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
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3">Menu</span>
            </div>
            
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
          </aside>

          {/* Content Area */}
          <main className="flex-1 overflow-y-auto bg-gray-50/30 dark:bg-gray-900/30 p-8">
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
                       <p className="text-xs text-gray-500">{tPOIDetails('labels.description_hint') || "This is the primary Portuguese (BR) text. Save it to translate and generate audios."}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'audio' && (
            <div className="space-y-6">
              {isLoadingData ? <Loader2 className="w-5 h-5 animate-spin mx-auto text-tuggi-blue" /> : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                        {tPOIDetails('labels.narration_audios')}
                      </h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Generate audio narration from attraction descriptions using OpenAI TTS
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
                          { code: 'pt-br', name: '🇧🇷 Português (Brasil)' },
                          { code: 'pt-pt', name: '🇵🇹 Português (Portugal)' },
                          { code: 'en-us', name: '🇺🇸 English (US)' },
                          { code: 'en-gb', name: '🇬🇧 English (UK)' },
                          { code: 'es-es', name: '🇪🇸 Spanish (Spain)' },
                          { code: 'de-de', name: '🇩🇪 German' },
                          { code: 'fr-fr', name: '🇫🇷 French' },
                          { code: 'it-it', name: '🇮🇹 Italian' },
                          { code: 'ja-jp', name: '🇯🇵 Japanese' },
                          { code: 'cmn-cn', name: '🇨🇳 Mandarin' },
                          { code: 'ko-kr', name: '🇰🇷 Korean' },
                          { code: 'ru-ru', name: '🇷🇺 Russian' },
                        ].map((lang) => (
                          <label key={lang.code} className={cn("flex items-start p-2 rounded border cursor-pointer min-h-[40px]", selectedLanguages.includes(lang.code) ? "bg-tuggi-blue/10 border-tuggi-blue" : "bg-white border-gray-300")}>
                            <input type="checkbox" checked={selectedLanguages.includes(lang.code)} onChange={(e) => {
                              if (e.target.checked) setSelectedLanguages([...selectedLanguages, lang.code])
                              else setSelectedLanguages(selectedLanguages.filter(l => l !== lang.code))
                            }} className="mt-0.5 mr-2 text-tuggi-blue" />
                            <span className="text-xs font-medium text-gray-900 leading-snug">{lang.name}</span>
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
                               <th className="text-left py-2 px-3 text-sm font-medium text-gray-700">Audio</th>
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
                      <h4 className="text-lg font-medium text-gray-900">No Audio Available</h4>
                      <p className="text-sm text-gray-500 mt-2">Generate narration audio from the description to provide rich spoken content.</p>
                      {!description.trim() && (
                        <p className="text-xs text-tuggi-orange font-medium mt-4">⚠️ Please save a description first before generating audio narration.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          </main>
        </div>

        {/* Footer */}
        <footer className="flex-none px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl flex justify-end gap-3 z-30">
          <button onClick={onClose} className="px-5 py-2.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium transition-colors">
            {t('cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2.5 bg-gradient-to-r from-tuggi-blue to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl font-medium shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center"
          >
            {isSaving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Save className="w-5 h-5 mr-2" />}
            {isSaving ? t('saving') : t('saveGeofence')}
          </button>
        </footer>
      </div>
    </div>
  )
}
