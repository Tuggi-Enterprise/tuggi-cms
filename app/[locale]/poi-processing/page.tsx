'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, AlertCircle, CheckCircle2, Play, Filter, Database, Settings, Sparkles, Target, ArrowRight, Zap, Globe, Mic2, ChevronDown, StopCircle, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { usePOIProcessing } from '@/lib/hooks/use-poi-processing'
import { locationService } from '@/lib/core/location-service'
import { poiService } from '@/lib/core/poi-service'

interface MigrationResult {
  poi_uuid_id: string
  poi_name: string
  success: boolean
  attraction_id?: string
  error?: string
  steps?: any[]
  skipped?: boolean
}

interface LocationOption {
  value: string
  label: string
  count?: number
}

// Pipeline step configuration
const PIPELINE_MODES = {
  'enrichment_migration_triggers': {
    name: 'Enrich + Migrate + Triggers',
    description: 'Recommended flow for production',
    steps: ['Enrichment', 'Migration', 'Trigger Points', 'Activation'],
    icon: Zap,
    color: 'from-emerald-500 to-teal-600',
    recommended: true
  },
  'migration_only': {
    name: 'Migration Only',
    description: 'Quick migration without processing',
    steps: ['Migration'],
    icon: Database,
    color: 'from-gray-500 to-gray-600',
    recommended: false
  },
  'migration_description': {
    name: 'Migration + Description',
    description: 'Includes AI-generated descriptions',
    steps: ['Migration', 'Description'],
    icon: Sparkles,
    color: 'from-purple-500 to-violet-600',
    recommended: false
  },
  'migration_description_audio': {
    name: 'Migration + Description + Audio',
    description: 'Full content generation',
    steps: ['Migration', 'Description', 'Audio'],
    icon: Mic2,
    color: 'from-blue-500 to-indigo-600',
    recommended: false
  },
  'full': {
    name: 'Full Pipeline',
    description: 'Legacy: All steps including approval',
    steps: ['Migration', 'Description', 'Audio', 'Triggers', 'Approval'],
    icon: Target,
    color: 'from-orange-500 to-red-600',
    recommended: false
  },
  'reprocess_triggers_core': {
    name: 'Reprocess Trigger Points (Core)',
    description: 'Regenerate triggers for existing POIs',
    steps: ['Fetch Core', 'Trigger Points', 'Save'],
    icon: Target,
    color: 'from-pink-500 to-rose-600',
    recommended: false
  }
}

const LANGUAGES = [
  { code: 'pt-br', label: 'Português (BR)', flag: '🇧🇷' },
  { code: 'pt-pt', label: 'Português (PT)', flag: '🇵🇹' },
  { code: 'en-us', label: 'English (US)', flag: '🇺🇸' },
  { code: 'en-uk', label: 'English (UK)', flag: '🇬🇧' },
  { code: 'es-es', label: 'Español', flag: '🇪🇸' },
  { code: 'de-de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr-fr', label: 'Français', flag: '🇫🇷' },
  { code: 'it-it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'ja-jp', label: '日本語', flag: '🇯🇵' },
  { code: 'zh-cn', label: '中文', flag: '🇨🇳' },
  { code: 'ko-kr', label: '한국어', flag: '🇰🇷' },
  { code: 'ru-ru', label: 'Русский', flag: '🇷🇺' }
]

export default function PoiMigrationPage() {
  const t = useTranslations('Pages.POIMigration')
  const tCommon = useTranslations('Common')

  // Form state
  const [country, setCountry] = useState('')
  const [state, setState] = useState('')
  const [city, setCity] = useState('')
  const [processingStatus, setProcessingStatus] = useState('pending')
  const [batchSize, setBatchSize] = useState(25)
  const [mode, setMode] = useState<keyof typeof PIPELINE_MODES>('enrichment_migration_triggers')
  const [autoGenerateAudio, setAutoGenerateAudio] = useState(false)
  const [autoApprove, setAutoApprove] = useState(false)
  const [skipIfExists, setSkipIfExists] = useState(true)
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['pt-br'])
  const [voiceGender, setVoiceGender] = useState<'male' | 'female'>('male')
  

  
  // UI state
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  const isMounted = useRef(true)

  // POI Processing Hook
  const {
    isProcessing,
    progress: processingProgress,
    processMigration,
    cancelProcessing,
    reset: resetProcessing,
    error: processingError
  } = usePOIProcessing({
    batchSize: 1, // We process one by one in the backend pipeline anyway
    onProgress: (p) => {
      // Logic handled by the loop for global progress
    }
  })

  // Location data from homolog.pois
  const [countries, setCountries] = useState<LocationOption[]>([])
  const [states, setStates] = useState<LocationOption[]>([])
  const [cities, setCities] = useState<LocationOption[]>([])
  const [loadingCountries, setLoadingCountries] = useState(false)
  const [loadingStates, setLoadingStates] = useState(false)
  const [loadingCities, setLoadingCities] = useState(false)

  // Data state
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [results, setResults] = useState<MigrationResult[]>([])
  const [progress, setProgress] = useState<{
    total: number
    processed: number
    successful: number
    failed: number
    skipped: number
    percentage: number
  } | null>(null)

  // Check if mode requires description/audio
  const showLanguageOptions = ['migration_description', 'migration_description_audio', 'full'].includes(mode)
  const showVoiceOptions = ['migration_description_audio', 'full'].includes(mode)

  // Load countries from homolog.pois
  useEffect(() => {
    const loadCountries = async () => {
      setLoadingCountries(true)
      try {
        if (mode === 'reprocess_triggers_core') {
          // Use efficient RPC for Core
          const result = await locationService.countries()
          if (result.success && result.data) {
            setCountries(result.data.map(c => ({
              value: c.name,
              label: c.name,
              count: c.totalPOIs
            })))
          }
        } else {
          // Use API for Homolog (Migration)
          const response = await fetch('/api/migration/locations?type=countries&source=homolog')
          if (response.ok) {
            const data = await response.json()
            if (data.success && data.data) {
              setCountries(data.data)
            }
          }
        }
      } catch (error) {
        console.error('Error loading countries:', error)
      } finally {
        setLoadingCountries(false)
      }
    }
    loadCountries()
  }, [mode])

  // Load states when country changes
  useEffect(() => {
    if (country && country !== 'all') {
      setLoadingStates(true)
      setState('')
      setCity('')
      setCities([])
      
      const loadStates = async () => {
        try {
          if (mode === 'reprocess_triggers_core') {
            const result = await locationService.states(country)
            if (result.success && result.data) {
              setStates(result.data.map(s => ({
                value: s.value,
                label: s.label,
                count: s.totalPOIs
              })))
            }
          } else {
            const response = await fetch(`/api/migration/locations?type=states&country=${encodeURIComponent(country)}&source=homolog`)
            if (response.ok) {
              const data = await response.json()
              if (data.success && data.data) {
                setStates(data.data)
              }
            }
          }
        } catch (error) {
          console.error('Error loading states:', error)
        } finally {
          setLoadingStates(false)
        }
      }
      loadStates()
    } else {
      setStates([])
      setCities([])
    }
  }, [country, mode])

  // Load cities when state changes
  useEffect(() => {
    if (country && country !== 'all' && state && state !== 'all') {
      setLoadingCities(true)
      setCity('')
      
      const loadCities = async () => {
        try {
          if (mode === 'reprocess_triggers_core') {
            const result = await locationService.cities(country, state === 'all' ? undefined : state)
            if (result.success && result.data) {
              setCities(result.data.map(c => ({
                value: c.name,
                label: c.name,
                count: c.totalPOIs
              })))
            }
          } else {
            const response = await fetch(`/api/migration/locations?type=cities&country=${encodeURIComponent(country)}&state=${encodeURIComponent(state)}&source=homolog`)
            if (response.ok) {
              const data = await response.json()
              if (data.success && data.data) {
                setCities(data.data)
              }
            }
          }
        } catch (error) {
          console.error('Error loading cities:', error)
        } finally {
          setLoadingCities(false)
        }
      }
      loadCities()
    } else {
      setCities([])
    }
  }, [country, state, mode])

  // Current POI being processed (for live feedback)
  const [currentPoi, setCurrentPoi] = useState<{ name: string; step?: string } | null>(null)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMounted.current = false
    }
  }, [])

  // Start migration with Chunked Loop
  const startMigration = useCallback(async (isResume: boolean = false) => {
    setError(null)
    setSuccess(null)
    resetProcessing()
    
    if (!isResume) {
      setResults([])
      setCurrentPoi(null)
      setProgress({
        total: 0,
        processed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        percentage: 0
      })
    }

    try {
      let currentProcessed = isResume ? (progress?.processed || 0) : 0
      let currentSuccessful = isResume ? (progress?.successful || 0) : 0
      let currentFailed = isResume ? (progress?.failed || 0) : 0
      let currentSkipped = isResume ? ((progress as any)?.skipped || 0) : 0
      let hasMore = true
      
      const chunkLimit = 50 // Fetch 50 candidates at a time

      while (hasMore && isMounted.current) {
        // 1. Fetch Candidates (next chunk)
        const candidatesResult = await poiService.getMigrationCandidates({
          country: country || undefined,
          state: state || undefined,
          city: city || undefined,
          processingStatus: processingStatus,
          limit: chunkLimit,
          source: mode === 'reprocess_triggers_core' ? 'core' : 'homolog'
        })

        if (!candidatesResult.success || !candidatesResult.data || candidatesResult.data.length === 0) {
          hasMore = false
          if (currentProcessed > 0) {
            setSuccess(t('alerts.migration_complete'))
          }
          break
        }

        // 1.5. Shuffle candidate IDs to improve parallelism 
        // (Prevents multiple workers from clashing on the same ID in sequence)
        const candidateIds = candidatesResult.data.map(c => c.id).sort(() => Math.random() - 0.5)
        
        // Update total (at least for this chunk)
        setProgress(prev => {
          const total = prev?.total || 0
          return {
            total: total > 0 ? total : candidatesResult.data.length,
            processed: prev?.processed || 0,
            successful: prev?.successful || 0,
            failed: prev?.failed || 0,
            skipped: prev?.skipped || 0,
            percentage: prev?.percentage || 0
          }
        })

        // 2. Process this chunk
        console.log(`🚀 Processing chunk of ${candidateIds.length} POIs...`)
        
        const result = await processMigration(candidateIds, {
          mode,
          autoGenerateAudio,
          autoApprove,
          skipIfExists,
          languages: selectedLanguages,
          voiceGender,
          // Inner progress handler
          onProgress: (p) => {
             if (p.lastResult) {
               const res = p.lastResult
               setCurrentPoi({ name: res.poiName || res.poiId })
               
               // Update global counters locally
               currentProcessed++
               if (res.data?.skipped) currentSkipped++
               else if (res.success) currentSuccessful++
               else currentFailed++

               // Update results list (keep last 50)
               setResults(prev => [...prev.slice(-49), {
                 poi_uuid_id: res.poiId,
                 poi_name: res.poiName || res.poiId,
                 success: res.success,
                 skipped: res.data?.skipped,
                 attraction_id: res.data?.attraction_id,
                  error: res.errors?.[0] || res.message,
                 steps: res.data?.steps
               }])

               // Update global progress state
               setProgress(prev => {
                 const total = prev?.total || 0
                 return {
                   total: Math.max(total, currentProcessed),
                   processed: currentProcessed,
                   successful: currentSuccessful,
                   failed: currentFailed,
                   skipped: currentSkipped,
                   percentage: total > 0 ? Math.min(100, Math.round((currentProcessed / total) * 100)) : 0
                 }
               })
             }
          }
        })

        // Check if we finished or were cancelled
        if (result.cancelled || candidatesResult.data.length < chunkLimit) {
           hasMore = false
           if (!result.cancelled && currentProcessed > 0) {
               setSuccess(t('alerts.migration_complete'))
           }
        }
        
        // Brief delay before next chunk to allow UI to breathe
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }

    } catch (err: any) {
      console.error('Migration loop error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error during migration loop')
    }
  }, [country, state, city, processingStatus, mode, autoGenerateAudio, autoApprove, skipIfExists, selectedLanguages, voiceGender, progress, processMigration, t, resetProcessing])

  const currentMode = PIPELINE_MODES[mode]
  const ModeIcon = currentMode.icon

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
              <Database className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                {t('title')}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('subtitle')}
              </p>
            </div>
          </div>
        </div>

        {/* Main Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Column - Filters & Options */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* Filters Card */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-800">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-500" />
                  <h2 className="font-semibold text-gray-900 dark:text-white">{t('filters.title')}</h2>
                </div>
              </div>
              
              <div className="p-5 space-y-4">
                {/* Country */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                    {t('filters.country')}
                  </label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    disabled={isProcessing || loadingCountries}
                  >
                    <option value="">{t('filters.all_countries')}</option>
                    <option value="__missing__" className="text-orange-600">⚠️ {t('filters.missing_location')}</option>
                    {loadingCountries ? (
                      <option disabled>{tCommon('status.loading')}</option>
                    ) : (
                      countries.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label} {c.count ? `(${c.count})` : ''}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {/* State */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                    {t('filters.state')}
                  </label>
                  <select
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50"
                    disabled={isProcessing || !country || country === 'all' || loadingStates}
                  >
                    <option value="">{t('filters.all_states')}</option>
                    {loadingStates ? (
                      <option disabled>{tCommon('status.loading')}</option>
                    ) : (
                      states.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label} {s.count ? `(${s.count})` : ''}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {/* City */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                    {t('filters.city')}
                  </label>
                  <select
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50"
                    disabled={isProcessing || !state || state === 'all' || loadingCities}
                  >
                    <option value="">{t('filters.all_cities')}</option>
                    {loadingCities ? (
                      <option disabled>{tCommon('status.loading')}</option>
                    ) : (
                      cities.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label} {c.count ? `(${c.count})` : ''}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {/* Processing Status */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                    {t('filters.status')}
                  </label>
                  <select
                    value={processingStatus}
                    onChange={(e) => setProcessingStatus(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isProcessing}
                  >
                    <option value="all">{t('filters.all_status')}</option>
                    <option value="pending">{tCommon('status.pending')}</option>
                    <option value="processing">{tCommon('status.processing')}</option>
                    <option value="migrated">{tCommon('status.migrated')}</option>
                    <option value="failed">{tCommon('status.error')}</option>
                    <option value="skipped">{tCommon('status.skipped')}</option>
                  </select>
                </div>

                {/* Batch Size */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                    Batch Size
                  </label>
                  <select
                    value={batchSize}
                    onChange={(e) => setBatchSize(Number(e.target.value))}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    disabled={isProcessing}
                  >
                    <option value={10}>{t('filters.pois_count', { count: 10 })}</option>
                    <option value={25}>{t('filters.pois_count', { count: 25 })}</option>
                    <option value={50}>{t('filters.pois_count', { count: 50 })}</option>
                    <option value={100}>{t('filters.pois_count', { count: 100 })}</option>
                    <option value={0}>🔄 {t('filters.all_pois_continuous')}</option>
                  </select>
                  {batchSize === 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                      ⚠️ {t('filters.continuous_hint')}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Advanced Options */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <button
                onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                className="w-full px-5 py-4 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-800 hover:from-gray-100 hover:to-gray-50 dark:hover:from-gray-700 dark:hover:to-gray-800 transition-all"
              >
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-gray-500" />
                  <span className="font-semibold text-gray-900 dark:text-white">{t('advanced.title')}</span>
                </div>
                <ChevronDown className={cn("w-4 h-4 text-gray-500 transition-transform", showAdvancedOptions && "rotate-180")} />
              </button>
              
              {showAdvancedOptions && (
                <div className="p-5 space-y-3 border-t border-gray-100 dark:border-gray-700">
                  <label className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={skipIfExists}
                      onChange={(e) => setSkipIfExists(e.target.checked)}
                      disabled={isProcessing}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {t('advanced.skip_existing')}
                    </span>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={autoApprove}
                      onChange={(e) => setAutoApprove(e.target.checked)}
                      disabled={isProcessing}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {t('advanced.auto_approve')}
                    </span>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={autoGenerateAudio}
                      onChange={(e) => setAutoGenerateAudio(e.target.checked)}
                      disabled={isProcessing}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {t('advanced.auto_generate_audio')}
                    </span>
                  </label>
                </div>
              )}
            </div>

            {/* Parallel Processing Info */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-2xl border border-blue-200 dark:border-blue-800 overflow-hidden">
              <div className="px-5 py-4 flex items-start gap-3">
                <Layers className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-blue-900 dark:text-blue-100 text-sm">Parallel Processing</h3>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    💡 You can open multiple tabs of this page and click START in each one. Each tab will automatically pick different POIs to process — no configuration needed.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Mode Selection & Actions */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Pipeline Mode Selection */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="font-semibold text-gray-900 dark:text-white">{t('pipeline.title')}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('pipeline.subtitle')}</p>
              </div>
              
              <div className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {Object.entries(PIPELINE_MODES).map(([key, config]) => {
                    const Icon = config.icon
                    const isSelected = mode === key
                    return (
                      <button
                        key={key}
                        onClick={() => setMode(key as keyof typeof PIPELINE_MODES)}
                        disabled={isProcessing}
                        className={cn(
                          "relative p-4 rounded-xl border-2 text-left transition-all",
                          isSelected
                            ? "border-transparent ring-2 ring-blue-500 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20"
                            : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        )}
                      >
                        {config.recommended && (
                          <span className="absolute -top-2 -right-2 px-2 py-0.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-[10px] font-bold rounded-full uppercase tracking-wide">
                            {t('pipeline.recommended')}
                          </span>
                        )}
                        <div className="flex items-start gap-3">
                          <div className={cn("p-2 rounded-lg bg-gradient-to-br", config.color)}>
                            <Icon className="w-4 h-4 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 dark:text-white text-sm">
                              {t(`pipeline.modes.${key}.name` as any)}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              {t(`pipeline.modes.${key}.description` as any)}
                            </div>
                          </div>
                        </div>
                        
                        {/* Steps indicator */}
                        <div className="mt-3 flex items-center gap-1 flex-wrap">
                          {config.steps.map((step, idx) => (
                            <span key={step} className="flex items-center">
                              <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] rounded-md">
                                {t(`pipeline.steps.${step.toLowerCase().replace(/ /g, '_')}` as any)}
                              </span>
                              {idx < config.steps.length - 1 && (
                                <ArrowRight className="w-3 h-3 text-gray-400 mx-0.5" />
                              )}
                            </span>
                          ))}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Language Selection (conditional) */}
            {showLanguageOptions && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden animate-in slide-in-from-top-2 duration-300">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-gray-500" />
                    <h2 className="font-semibold text-gray-900 dark:text-white">{t('languages.title')}</h2>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('languages.subtitle')}</p>
                </div>
                
                <div className="p-5">
                  <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => {
                          if (selectedLanguages.includes(lang.code)) {
                            setSelectedLanguages(selectedLanguages.filter(l => l !== lang.code))
                          } else {
                            setSelectedLanguages([...selectedLanguages, lang.code])
                          }
                        }}
                        disabled={isProcessing}
                        className={cn(
                          "flex items-center gap-2 p-3 rounded-xl border transition-all",
                          selectedLanguages.includes(lang.code)
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                            : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        )}
                      >
                        <span className="text-xl">{lang.flag}</span>
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{lang.label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-3">
                    {t('languages.selected_count', { count: selectedLanguages.length })}
                  </p>
                </div>
              </div>
            )}

            {/* Voice Gender Selection (conditional) */}
            {showVoiceOptions && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden animate-in slide-in-from-top-2 duration-300">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <Mic2 className="w-4 h-4 text-gray-500" />
                    <h2 className="font-semibold text-gray-900 dark:text-white">{t('voice.title')}</h2>
                  </div>
                </div>
                
                <div className="p-5">
                  <div className="flex gap-4">
                    {(['male', 'female'] as const).map((gender) => (
                      <button
                        key={gender}
                        onClick={() => setVoiceGender(gender)}
                        disabled={isProcessing}
                        className={cn(
                          "flex-1 p-4 rounded-xl border-2 transition-all text-center",
                          voiceGender === gender
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                            : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                        )}
                      >
                        <div className="text-2xl mb-1">{gender === 'male' ? '👨' : '👩'}</div>
                        <div className="font-medium text-gray-900 dark:text-white capitalize">{t(`voice.${gender}` as any)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Start Migration Button */}
            {isProcessing ? (
              <button
                onClick={() => cancelProcessing()}
                className={cn(
                  "w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-semibold text-lg",
                  "bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg"
                )}
              >
                <StopCircle className="w-5 h-5" />
                {tCommon('actions.cancel')}
              </button>
            ) : (
              <button
                onClick={() => startMigration()}
                disabled={isLoading}
                className={cn(
                  "w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-semibold text-lg",
                  "bg-gradient-to-r from-blue-600 to-indigo-600 text-white",
                  "hover:from-blue-700 hover:to-indigo-700",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  "shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30",
                  "transition-all transform hover:scale-[1.01] active:scale-[0.99]"
                )}
              >
                <Play className="w-5 h-5" />
                {t('actions.start')}
              </button>
            )}

            {/* Progress Section */}
            {(progress && (progress.total > 0 || progress.processed > 0)) && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden animate-in slide-in-from-bottom-2 duration-300">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                  <h2 className="font-semibold text-gray-900 dark:text-white">{t('progress.title')}</h2>
                </div>
                
                <div className="p-5">
                  <div className="mb-4">
                    <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
                      <span>{t('progress.label')}</span>
                      {batchSize === 0 ? (
                        <span className="font-medium">{t('progress.processed_count', { count: progress.processed })}</span>
                      ) : (
                        <span className="font-medium">{progress.percentage}%</span>
                      )}
                    </div>
                    <div className="w-full h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      {batchSize === 0 ? (
                        // Indeterminate progress bar for continuous mode
                        <div className="h-full w-1/3 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-[shimmer_1.5s_ease-in-out_infinite]" 
                          style={{ animation: 'shimmer 1.5s ease-in-out infinite' }}
                        />
                      ) : (
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
                          style={{ width: `${progress.percentage}%` }}
                        />
                      )}
                    </div>
                    {/* Current POI indicator */}
                    {currentPoi && (
                      <div className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 animate-pulse">
                        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                        <span className="truncate">
                          {t('progress.processing_poi', { name: currentPoi.name })}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                      <div className="text-2xl font-bold text-gray-900 dark:text-white">{progress.processed}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{tCommon('status.processed')}</div>
                    </div>
                    <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                      <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{progress.successful}</div>
                      <div className="text-xs text-emerald-600/70 dark:text-emerald-400/70 uppercase tracking-wide">{t('results.successful')}</div>
                    </div>
                    <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded-xl">
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400">{progress.failed}</div>
                      <div className="text-xs text-red-600/70 dark:text-red-400/70 uppercase tracking-wide">{t('results.failed')}</div>
                    </div>
                    <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
                      <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{(progress as any).skipped || 0}</div>
                      <div className="text-xs text-amber-600/70 dark:text-amber-400/70 uppercase tracking-wide">{t('results.skipped') || 'Skipped'}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Messages */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 flex items-center gap-3 animate-in slide-in-from-top-2">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                <span className="text-red-800 dark:text-red-200">{error}</span>
              </div>
            )}

            {success && (
              <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 flex items-center gap-3 animate-in slide-in-from-top-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                <span className="text-emerald-800 dark:text-emerald-200">{success}</span>
              </div>
            )}

            {/* Results Table */}
            {results.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                  <h2 className="font-semibold text-gray-900 dark:text-white">{t('results.title')}</h2>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-700/50">
                        <th className="text-left py-3 px-5 text-gray-600 dark:text-gray-300 font-medium">{t('results.poi_name')}</th>
                        <th className="text-left py-3 px-5 text-gray-600 dark:text-gray-300 font-medium">{t('results.status')}</th>
                        <th className="text-left py-3 px-5 text-gray-600 dark:text-gray-300 font-medium">{t('results.attraction_id')}</th>
                        <th className="text-left py-3 px-5 text-gray-600 dark:text-gray-300 font-medium">{t('results.output')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result, idx) => (
                        <tr key={idx} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="py-3 px-5 text-gray-900 dark:text-white font-medium">{result.poi_name}</td>
                          <td className="py-3 px-5">
                            {result.skipped ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs rounded-full">
                                <Zap className="w-3 h-3" />
                                {tCommon('status.skipped')}
                              </span>
                            ) : result.success ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs rounded-full">
                                <CheckCircle2 className="w-3 h-3" />
                                {t('results.successful')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs rounded-full">
                                <AlertCircle className="w-3 h-3" />
                                {t('results.failed')}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-5 text-gray-600 dark:text-gray-400 font-mono text-xs">
                            {result.attraction_id ? result.attraction_id.slice(0, 8) + '...' : '-'}
                          </td>
                          <td className="py-3 px-5 text-red-600 dark:text-red-400 text-xs">
                            {result.error || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
