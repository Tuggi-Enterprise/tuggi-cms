'use client'

import { useState, useEffect } from 'react'
import { Loader2, AlertCircle, CheckCircle2, Play, Filter, Database, Settings, Sparkles, Target, ArrowRight, Zap, Globe, Mic2, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MigrationResult {
  poi_uuid_id: string
  poi_name: string
  success: boolean
  attraction_id?: string
  error?: string
  steps?: any[]
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
  const [isMigrating, setIsMigrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [results, setResults] = useState<MigrationResult[]>([])
  const [progress, setProgress] = useState<{
    total: number
    processed: number
    successful: number
    failed: number
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
        const response = await fetch('/api/migration/locations?type=countries')
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.data) {
            setCountries(data.data)
          }
        }
      } catch (error) {
        console.error('Error loading countries:', error)
      } finally {
        setLoadingCountries(false)
      }
    }
    loadCountries()
  }, [])

  // Load states when country changes
  useEffect(() => {
    if (country && country !== 'all') {
      setLoadingStates(true)
      setState('')
      setCity('')
      setCities([])
      
      const loadStates = async () => {
        try {
          const response = await fetch(`/api/migration/locations?type=states&country=${encodeURIComponent(country)}`)
          if (response.ok) {
            const data = await response.json()
            if (data.success && data.data) {
              setStates(data.data)
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
  }, [country])

  // Load cities when state changes
  useEffect(() => {
    if (country && country !== 'all' && state && state !== 'all') {
      setLoadingCities(true)
      setCity('')
      
      const loadCities = async () => {
        try {
          const response = await fetch(`/api/migration/locations?type=cities&country=${encodeURIComponent(country)}&state=${encodeURIComponent(state)}`)
          if (response.ok) {
            const data = await response.json()
            if (data.success && data.data) {
              setCities(data.data)
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
  }, [country, state])

  // Current POI being processed (for live feedback)
  const [currentPoi, setCurrentPoi] = useState<{ name: string; step?: string } | null>(null)

  // Start migration with SSE streaming
  const startMigration = async (isResume: boolean = false) => {
    setIsMigrating(true)
    setError(null)
    setSuccess(null)
    
    if (!isResume) {
      setResults([])
      setCurrentPoi(null)
      setProgress({
        total: 0,
        processed: 0,
        successful: 0,
        failed: 0,
        percentage: 0
      })
    }

    // Flag to track if we should auto-resume
    let shouldAutoResume = false

    try {
      const response = await fetch('/api/migration/migrate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: {
            country: country || undefined,
            state: state || undefined,
            city: city || undefined,
            processing_status: processingStatus
          },
          options: {
            batch_size: batchSize,
            mode,
            auto_generate_audio: autoGenerateAudio,
            auto_approve_if_satisfactory: autoApprove,
            skip_if_exists: skipIfExists,
            languages: selectedLanguages,
            voice_gender: voiceGender
          }
        })
      })

      if (!response.ok) {
        throw new Error('Migration request failed')
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('Response body is not readable')
      }

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        
        // Parse SSE events
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7)
            const dataLine = lines[i + 1]
            
            if (dataLine?.startsWith('data: ')) {
              const data = JSON.parse(dataLine.slice(6))
              
              switch (eventType) {
                case 'start':
                  setProgress(prev => ({
                    ...prev!,
                    total: isResume && (data.total === '?' || (prev?.total && prev.total > 0)) ? prev!.total : data.total
                  }))
                  break
                  
                case 'progress':
                  setCurrentPoi({ name: data.poi_name })
                  setProgress(prev => {
                    const currentTotal = typeof data.total === 'number' ? data.total : (prev?.total || 0)
                    return {
                      ...prev!,
                      processed: (prev?.processed || 0), // Don't increment yet, wait for poi_complete
                      percentage: currentTotal > 0 ? Math.round(((prev?.processed || 0) / currentTotal) * 100) : 0
                    }
                  })
                  break
                  
                case 'poi_complete':
                  setResults(prev => [...prev.slice(-49), { // Keep only last 50 results to avoid memory issues
                    poi_uuid_id: data.poi_id,
                    poi_name: data.poi_name,
                    success: data.success,
                    attraction_id: data.attraction_id,
                    error: data.error,
                    steps: data.steps
                  }])
                  setProgress(prev => {
                    const newSuccessful = prev!.successful + (data.success ? 1 : 0)
                    const newFailed = prev!.failed + (data.success ? 0 : 1)
                    const newProcessed = prev!.processed + 1
                    const total = typeof data.total === 'number' ? data.total : prev!.total
                    return {
                      ...prev!,
                      processed: newProcessed,
                      successful: newSuccessful,
                      failed: newFailed,
                      percentage: total > 0 ? Math.min(100, Math.round((newProcessed / total) * 100)) : 0
                    }
                  })
                  break
                  
                case 'complete':
                  setCurrentPoi(null)
                  setProgress(prev => ({
                    total: data.total,
                    processed: data.processed + (prev?.processed || 0),
                    successful: data.successful + (prev?.successful || 0),
                    failed: data.failed + (prev?.failed || 0),
                    percentage: 100
                  }))
                  
                  if (data.hasMore) {
                    setSuccess(`${data.message} Waiting for next batch...`)
                    shouldAutoResume = true
                  } else {
                    setSuccess(data.message)
                  }
                  break
                  
                case 'poi_skipped':
                  // Optionally log skipped POIs to a special list or just show status
                  setCurrentPoi({ name: `${data.poi_name} (Skipped: ${data.reason})` })
                  break
                  
                case 'error':

                  setError(data.error)
                  break
              }
              
              i++ // Skip the data line
            }
          }
        }
      }
    } catch (error) {
      console.error('Migration error:', error)
      setError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setIsMigrating(false)
      setCurrentPoi(null)
      
      // Auto-resume if needed (after a short delay to avoid flooding)
      if (shouldAutoResume) {
        setTimeout(() => {
          startMigration()
        }, 2000)
      }
    }
  }

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
                POI Migration
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Homolog → Core Pipeline
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
                  <h2 className="font-semibold text-gray-900 dark:text-white">Filters</h2>
                </div>
              </div>
              
              <div className="p-5 space-y-4">
                {/* Country */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
                    Country
                  </label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    disabled={isMigrating || loadingCountries}
                  >
                    <option value="">All Countries</option>
                    <option value="__missing__" className="text-orange-600">⚠️ Missing Location Data</option>
                    {loadingCountries ? (
                      <option disabled>Loading...</option>
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
                    State
                  </label>
                  <select
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50"
                    disabled={isMigrating || !country || country === 'all' || loadingStates}
                  >
                    <option value="">All States</option>
                    {loadingStates ? (
                      <option disabled>Loading...</option>
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
                    City
                  </label>
                  <select
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50"
                    disabled={isMigrating || !state || state === 'all' || loadingCities}
                  >
                    <option value="">All Cities</option>
                    {loadingCities ? (
                      <option disabled>Loading...</option>
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
                    Status
                  </label>
                  <select
                    value={processingStatus}
                    onChange={(e) => setProcessingStatus(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    disabled={isMigrating}
                  >
                    <option value="all">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="migrated">Migrated</option>
                    <option value="failed">Failed</option>
                    <option value="skipped">Skipped</option>
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
                    disabled={isMigrating}
                  >
                    <option value={10}>10 POIs</option>
                    <option value={25}>25 POIs</option>
                    <option value={50}>50 POIs</option>
                    <option value={100}>100 POIs</option>
                    <option value={0}>🔄 All POIs (continuous)</option>
                  </select>
                  {batchSize === 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                      ⚠️ Will process all matching POIs until complete
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
                  <span className="font-semibold text-gray-900 dark:text-white">Advanced Options</span>
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
                      disabled={isMigrating}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Skip existing POIs in core
                    </span>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={autoApprove}
                      onChange={(e) => setAutoApprove(e.target.checked)}
                      disabled={isMigrating}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Auto-approve if criteria met
                    </span>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={autoGenerateAudio}
                      onChange={(e) => setAutoGenerateAudio(e.target.checked)}
                      disabled={isMigrating}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Auto-generate audio
                    </span>
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Mode Selection & Actions */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Pipeline Mode Selection */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="font-semibold text-gray-900 dark:text-white">Pipeline Mode</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Select the processing workflow</p>
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
                        disabled={isMigrating}
                        className={cn(
                          "relative p-4 rounded-xl border-2 text-left transition-all",
                          isSelected
                            ? "border-transparent ring-2 ring-blue-500 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20"
                            : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        )}
                      >
                        {config.recommended && (
                          <span className="absolute -top-2 -right-2 px-2 py-0.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-[10px] font-bold rounded-full uppercase tracking-wide">
                            Recommended
                          </span>
                        )}
                        <div className="flex items-start gap-3">
                          <div className={cn("p-2 rounded-lg bg-gradient-to-br", config.color)}>
                            <Icon className="w-4 h-4 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 dark:text-white text-sm">
                              {config.name}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              {config.description}
                            </div>
                          </div>
                        </div>
                        
                        {/* Steps indicator */}
                        <div className="mt-3 flex items-center gap-1 flex-wrap">
                          {config.steps.map((step, idx) => (
                            <span key={step} className="flex items-center">
                              <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] rounded-md">
                                {step}
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
                    <h2 className="font-semibold text-gray-900 dark:text-white">Languages</h2>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Select languages for description/audio generation</p>
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
                        disabled={isMigrating}
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
                    {selectedLanguages.length} language{selectedLanguages.length !== 1 ? 's' : ''} selected
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
                    <h2 className="font-semibold text-gray-900 dark:text-white">Voice</h2>
                  </div>
                </div>
                
                <div className="p-5">
                  <div className="flex gap-4">
                    {(['male', 'female'] as const).map((gender) => (
                      <button
                        key={gender}
                        onClick={() => setVoiceGender(gender)}
                        disabled={isMigrating}
                        className={cn(
                          "flex-1 p-4 rounded-xl border-2 transition-all text-center",
                          voiceGender === gender
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                            : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                        )}
                      >
                        <div className="text-2xl mb-1">{gender === 'male' ? '👨' : '👩'}</div>
                        <div className="font-medium text-gray-900 dark:text-white capitalize">{gender}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Start Migration Button */}
            <button
              onClick={() => startMigration()}
              disabled={isMigrating || isLoading}
              className={cn(
                "w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl font-semibold text-lg",
                "bg-gradient-to-r from-blue-600 to-indigo-600 text-white",
                "hover:from-blue-700 hover:to-indigo-700",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30",
                "transition-all transform hover:scale-[1.01] active:scale-[0.99]"
              )}
            >
              {isMigrating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing Migration...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Start Migration
                </>
              )}
            </button>

            {/* Progress Section */}
            {(progress && (progress.total > 0 || progress.processed > 0)) && (
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 overflow-hidden animate-in slide-in-from-bottom-2 duration-300">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                  <h2 className="font-semibold text-gray-900 dark:text-white">Progress</h2>
                </div>
                
                <div className="p-5">
                  <div className="mb-4">
                    <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
                      <span>Processing</span>
                      {batchSize === 0 ? (
                        <span className="font-medium">{progress.processed} processed</span>
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
                          Processing: <span className="font-medium text-gray-900 dark:text-white">{currentPoi.name}</span>
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                      <div className="text-2xl font-bold text-gray-900 dark:text-white">{progress.processed}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Processed</div>
                    </div>
                    <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                      <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{progress.successful}</div>
                      <div className="text-xs text-emerald-600/70 dark:text-emerald-400/70 uppercase tracking-wide">Success</div>
                    </div>
                    <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded-xl">
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400">{progress.failed}</div>
                      <div className="text-xs text-red-600/70 dark:text-red-400/70 uppercase tracking-wide">Failed</div>
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
                  <h2 className="font-semibold text-gray-900 dark:text-white">Results</h2>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-700/50">
                        <th className="text-left py-3 px-5 text-gray-600 dark:text-gray-300 font-medium">POI Name</th>
                        <th className="text-left py-3 px-5 text-gray-600 dark:text-gray-300 font-medium">Status</th>
                        <th className="text-left py-3 px-5 text-gray-600 dark:text-gray-300 font-medium">Attraction ID</th>
                        <th className="text-left py-3 px-5 text-gray-600 dark:text-gray-300 font-medium">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result, idx) => (
                        <tr key={idx} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="py-3 px-5 text-gray-900 dark:text-white font-medium">{result.poi_name}</td>
                          <td className="py-3 px-5">
                            {result.success ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs rounded-full">
                                <CheckCircle2 className="w-3 h-3" />
                                Success
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs rounded-full">
                                <AlertCircle className="w-3 h-3" />
                                Failed
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
