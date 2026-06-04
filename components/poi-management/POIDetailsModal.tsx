'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSupabaseClient, useSessionContext } from '@supabase/auth-helpers-react'
import { useQueryClient } from '@tanstack/react-query'
import { 
  X, Save, CheckCircle, Trash2, MapPin, ExternalLink, Star, Calendar, User, Globe, Phone, Clock, 
  Target, Info, FileText, Sparkles, RotateCcw, Play, Eye, Volume2, Download, Loader2, Users, 
  Plus, AlertTriangle, AlertCircle, Layers, Zap, Navigation, XCircle, ArrowRight 
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getScoreDescription, getScoreColor, getScoreBackgroundColor } from '@/lib/score/compute'
import { formatDate } from '@/lib/utils'
import { POI_CATEGORIES } from '@/constants/poi-importer'
import { TriggerPointsManager } from './TriggerPointsManager'
import { GoogleMapComponent, extractPolygonCoordinates } from '@/components/ui/GoogleMapComponent'
import { VerificationBadge } from '@/components/verification/VerificationBadge'
import { getFullSizeImageUrl } from '@/lib/imageUtils'
import { useAuthenticatedFunctionCall } from '@/lib/hooks/useAuthenticatedFunctionCall'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { poiService } from '@/lib/core/poi-service'
import { locationService } from '@/lib/core/location-service'
import {
  fetchBoundary as fetchBoundaryRemote,
  saveBoundary as saveBoundaryRemote,
  deleteBoundary as deleteBoundaryRemote,
  sanitizeBoundary,
} from '@/lib/core/poi-boundary-service'
import { usePoiMutations } from '@/lib/hooks/usePoiMutations'
import {
  fetchNearbyInPolygon,
  fetchGroupOfPoi,
  saveGroup as saveGroupRemote,
} from '@/lib/core/poi-groups-service'
import {
  fetchDescriptions as fetchDescriptionsRemote,
  upsertPortugueseDescription,
} from '@/lib/core/poi-descriptions-service'
import { fetchVerificationRaw } from '@/lib/core/poi-verification-service'
import { POIModalProvider, type POIModalContextValue } from './POIModalContext'
import { BoundaryTab } from './tabs/BoundaryTab'
import { TriggerPointsTab } from './tabs/TriggerPointsTab'
import { GroupPoisTab } from './tabs/GroupPoisTab'
import { DescriptionTab } from './tabs/DescriptionTab'
import { NarrationAudioTab } from './tabs/NarrationAudioTab'
import { ReviewTab } from './tabs/ReviewTab'

export interface POI {
  id: string
  name: string
  city: string
  country: string
  state: string | null
  category: string
  osm_category?: string | null
  record_type?: string
  primary_category?: string | null
  approved: boolean
  approved_by: string | null
  approved_at: string | null
  rating: number | null
  image_url: string | null
  created_at: string
  updated_at: string
  user_ratings_total: number | null
  formatted_address: string | null
  vicinity: string | null
  website: string | null
  formatted_phone_number: string | null
  business_status: string | null
  price_level: number | null
  opening_hours: any | null
  google_types: string[] | null
  photos_references: string[] | null
  google_place_id: string | null
  user_id: string | null
  owner_id?: string | null
  coordinates?: {
    latitude: number
    longitude: number
  }
  // Content status indicators
  has_description: boolean
  has_audio: boolean
  description_count: number
  audio_count: number
  available_languages: string[]
  trigger_points_count: number
  active_trigger_points_count: number
  is_active?: boolean
  reference_links?: string[] // Add reference links field
  descriptions?: any[] // Add descriptions field for filtering
  // Group status indicators
  group_status?: {
    is_in_group: boolean
    group_id?: string
    group_name?: string
    group_role?: 'main' | 'member'
    group_member_count?: number
  }
  verification_score?: number | null
  _homologData?: any
}

interface POIDetailsModalProps {
  poi: POI | null
  isOpen: boolean
  onClose: () => void
  onUpdate: () => void
  onPOIUpdated?: (updatedPOI: POI) => void
  onPOIDeleted?: (poiId: string) => void
  mode?: 'view' | 'create'
}

import { useTranslations } from 'next-intl';

export function POIDetailsModal({ poi, isOpen, onClose, onUpdate, onPOIUpdated, onPOIDeleted, mode = 'view' }: POIDetailsModalProps) {
  const t = useTranslations('Modals.POIDetails');
  const tCommon = useTranslations('Common');
  // Determine if we're in create mode: no POI or POI without ID
  const isCreateMode = !poi || !poi.id || mode === 'create'
  const [currentPoi, setCurrentPoi] = useState<POI | null>(poi)
  const [editedPoi, setEditedPoi] = useState<POI | null>(poi)
  
  // Ref to track when we have a local update that should not be overwritten by props
  const localUpdateRef = useRef<{ poiId: string; timestamp: number } | null>(null)
  const lastLoadedPoiId = useRef<string | null>(null)
  const lastContentInitializedPoiIdRef = useRef<string | null>(null)
  
  // Hook para chamar edge functions com autenticação
  const { callFunction } = useAuthenticatedFunctionCall()
  const poiMutations = usePoiMutations()

  // Helper to get the current POI (for editing) or null (for creation)
  // Memoized to prevent infinite loops in useEffect dependencies
  const getPoi = useCallback((): POI | null => currentPoi || poi, [currentPoi, poi])

  // Helper to assert POI exists (throws if null)
  const requirePoi = (): POI => {
    const p = getPoi()
    if (!p) throw new Error('POI is required but is null')
    return p
  }

  // Initialize reference links from poi if available
  const [referenceLinks, setReferenceLinks] = useState<string[]>(poi?.reference_links || [])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [descriptions, setDescriptions] = useState<any[]>([])
  const [images, setImages] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'create' | 'details' | 'boundary' | 'description' | 'trigger-points' | 'narration-audio' | 'group-pois' | 'review'>(isCreateMode ? 'create' : 'details')

  // Smooth unmounting state
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [animateClosing, setAnimateClosing] = useState(false)

  // Sync with prop
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
      setAnimateClosing(false)
    } else if (shouldRender) { // Only animate out if we are currently rendered
      setAnimateClosing(true)
      const timer = setTimeout(() => {
        setShouldRender(false)
        setAnimateClosing(false)
      }, 300) // Match the 300ms tailwind duration
      return () => clearTimeout(timer)
    }
  }, [isOpen, shouldRender])

  // Create mode state
  const [createName, setCreateName] = useState('')
  const [createCoordinates, setCreateCoordinates] = useState<{ lat: number; lng: number } | null>(null)
  const [createLocation, setCreateLocation] = useState<{ city: string | null; state: string | null; country: string | null; formatted_address?: string | null } | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isGeocoding, setIsGeocoding] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createBoundary, setCreateBoundary] = useState<Array<{ lat: number; lng: number }> | null>(null)
  const [isEnrichingOSM, setIsEnrichingOSM] = useState(false)
  const [createCategory, setCreateCategory] = useState<string>('tourist_attraction')
  const [createType, setCreateType] = useState<'standard' | 'geofence'>('standard')
  const [createOwnerId, setCreateOwnerId] = useState<string>('')
  const [createBusinessStatus, setCreateBusinessStatus] = useState<string>('ENTER_ONLY')
  const [clients, setClients] = useState<any[]>([])

  // compute CMS role / editing permissions for UI
  const { role: cmsUserRole, isViewer, isAdmin, canEdit } = useCmsUser()

  // Boundary drawing state
  const [boundaryPolygon, setBoundaryPolygon] = useState<Array<{ lat: number; lng: number }> | null>(null)
  const [isSavingBoundary, setIsSavingBoundary] = useState(false)
  const [existingBoundary, setExistingBoundary] = useState<Array<{ lat: number; lng: number }> | null>(null)
  const [isDrawingEnabled, setIsDrawingEnabled] = useState(false) // Drawing mode OFF by default

  // Fetch clients for Geofence owner selection
  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch('/api/clients/my-clients')
      if (res.ok) {
        const { clients: data } = await res.json()
        if (data) {
          setClients(data)
          // Default selection if not set
          if (!createOwnerId && data.length > 0) {
            const defaultClient = isAdmin 
              ? (data.find((c: any) => c.name.toLowerCase().includes('tuggi')) || data[0]) 
              : data[0];
            setCreateOwnerId(defaultClient.id)
          }
        }
      }
    } catch(err) {
      console.error('Failed to fetch clients', err)
    }
  }, [isAdmin])

  // Sync activeTab and reset fields when modal opens/mode changes
  useEffect(() => {
    if (isOpen) {
      fetchClients()
      
      // Only set initial tab if we haven't set one yet or if the POI ID changed
      if (lastLoadedPoiId.current !== poi?.id) {
        if (isCreateMode) {
          setActiveTab('create')
          // Clear creation form fields
          setCreateName('')
          setCreateCoordinates(null)
          setCreateLocation(null)
          setCreateBoundary(null)
          setCreateError(null)
          setIsDrawingEnabled(false)
        } else {
          setActiveTab('details')
        }
        lastLoadedPoiId.current = poi?.id || null
      }
    } else {
      lastLoadedPoiId.current = null
    }
  }, [isOpen, isCreateMode, fetchClients, poi?.id])

  // Update state when poi changes
  useEffect(() => {
    // Check if we have a recent local update that should be preserved
    if (localUpdateRef.current && poi?.id === localUpdateRef.current.poiId) {
      const timeSinceUpdate = Date.now() - localUpdateRef.current.timestamp
      // Ignore prop updates for 3 seconds after a local update
      if (timeSinceUpdate < 3000) {
        return
      } else {
        // Clear the ref after timeout
        localUpdateRef.current = null
      }
    }
    
    if (poi) {
      setCurrentPoi(poi)
      setEditedPoi(poi)
      // Note: We deliberately DO NOT reset boundaryPolygon, existingBoundary,
      // drawnPolygon, referenceLinks, or activeTab here.
      // Resetting these states is strictly the responsibility of the initialization 
      // effect when a NEW poi.id is loaded or the modal is closed.
    } else if (!currentPoi?.id) {
      // Only reset if we don't have a locally created POI
      setCurrentPoi(null)
      setEditedPoi(null)
    }
    // We intentionally exclude currentPoi from dependencies to avoid resetting
    // when local state changes - we only want to sync when the prop changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poi])


  // Reverse geocoding when coordinates change in create mode (with debounce)
  useEffect(() => {
    if (!isCreateMode || !createCoordinates || !createCoordinates.lat || !createCoordinates.lng) {
      return
    }

    // Debounce reverse geocoding to avoid race conditions
    const timeoutId = setTimeout(() => {
      handleReverseGeocode(createCoordinates.lat, createCoordinates.lng)
    }, 500) // 500ms debounce

    return () => clearTimeout(timeoutId)
  }, [createCoordinates, isCreateMode])

  // Request user's geolocation when opening the create modal to center the map
  useEffect(() => {
    if (!isCreateMode) return
    if (createCoordinates) return // already set by user

    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      console.warn('Geolocation not available in this environment')
      return
    }

    let didRespond = false
    const onSuccess = (pos: GeolocationPosition) => {
      if (didRespond) return
      didRespond = true
      const { latitude, longitude } = pos.coords
      setCreateCoordinates({ lat: latitude, lng: longitude })
      setCreateError(null)
    }

    const onError = (err: GeolocationPositionError) => {
      if (didRespond) return
      didRespond = true
      console.warn('Geolocation error:', err.message)
      // keep silent; user can click on map to set location
      setCreateError(t('alerts.auto_location_error'))
    }

    try {
      navigator.geolocation.getCurrentPosition(onSuccess, onError, { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 })
    } catch (err) {
      console.warn('Geolocation request failed:', err)
    }

    // Cleanup not necessary for getCurrentPosition
  }, [isCreateMode, createCoordinates])

  const handleReverseGeocode = async (lat: number, lng: number) => {
    setIsGeocoding(true)
    setCreateError(null)
    try {
      const response = await fetch('/api/pois/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng })
      })

      if (response.ok) {
        const data = await response.json()
        setCreateLocation(data)
      } else {
        console.warn('Reverse geocoding failed')
      }
    } catch (error) {
      console.error('Reverse geocoding error:', error)
    } finally {
      setIsGeocoding(false)
    }
  }

  const handleCreatePOI = async () => {
    if (!createName.trim()) {
      setCreateError(t('validation.name_required'))
      return
    }

    if (!createCoordinates) {
      setCreateError(t('validation.location_required'))
      return
    }

    setIsCreating(true)
    setCreateError(null)

    try {
      const response = await fetch('/api/pois/create-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          lat: createCoordinates.lat,
          lng: createCoordinates.lng,
          boundary: createBoundary, // Enviar boundary se foi desenhado
          category: createType === 'geofence' ? 'geofence' : 'point_of_interest',
          osm_category: createCategory,
          primary_category: createType === 'geofence' ? 'geofence' : 'point_of_interest',
          owner_id: createOwnerId || undefined,
          business_status: createBusinessStatus || undefined
        })
      })
      const result = await response.json()
      if (!response.ok || !result.success) {
        throw new Error(result.error || t('validation.error_create'))
      }

      // Update modal with created POI
      const createdPOI: POI = {
        // Ensure critical fields are present even if API response is partial
        id: result.data.id,
        name: result.data.name || createName.trim(),
        ...result.data,
        has_description: false,
        has_audio: false,
        description_count: 0,
        audio_count: 0,
        available_languages: [],
        trigger_points_count: 0,
        active_trigger_points_count: 0
      }
      setCurrentPoi(createdPOI)
      setEditedPoi(createdPOI)
      setActiveTab('details')


      // Invalidate queries to refresh the list and map
      invalidateAllPOICaches()

      // Call update callbacks
      if (onUpdate) onUpdate()
      if (onPOIUpdated) onPOIUpdated(createdPOI)

      // Reset create mode state
      setCreateName('')
      setCreateCoordinates(null)
      setCreateLocation(null)
      setCreateCategory('tourist_attraction')
      setCreateType('standard')
      setCreateOwnerId('')
      setCreateBusinessStatus('ENTER_ONLY')
    } catch (error) {
      console.error('Error creating POI:', error)
      setCreateError(error instanceof Error ? error.message : t('validation.error_create'))
    } finally {
      setIsCreating(false)
    }
  }

  const handleReEnrichOSM = async () => {
    if (!currentPoi) return

    setIsEnrichingOSM(true)
    try {
      const response = await fetch('/api/pois/enrich-osm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poi_id: currentPoi.id,
          name: currentPoi.name,
          city: currentPoi.city,
          country: currentPoi.country,
          google_place_id: currentPoi.google_place_id || undefined
        })
      })

      const result = await response.json()

      if (response.ok && result.success) {
        // Refresh POI data
        if (onUpdate) onUpdate()
        showFeedback(t('validation.enrich_success'), 'success')
      } else {
        throw new Error(result.error || t('validation.enrich_error'))
      }
    } catch (error) {
      console.error('Error enriching POI:', error)
      showFeedback(error instanceof Error ? error.message : t('validation.enrich_error'), 'error')
    } finally {
      setIsEnrichingOSM(false)
    }
  }

  // Description editing state
  const [currentDescription, setCurrentDescription] = useState('')
  const [originalDescription, setOriginalDescription] = useState('')
  const [generationLanguage, setGenerationLanguage] = useState('pt-br')
  const [audioDuration, setAudioDuration] = useState<number>(20)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSavingDescription, setIsSavingDescription] = useState(false)
  const [isSavingReferenceLinks, setIsSavingReferenceLinks] = useState(false)
  const [descriptionStats, setDescriptionStats] = useState({ play_count: 0, last_played_at: null })

  // Audio narration state
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null)
  const [audioMetadata, setAudioMetadata] = useState<{ fileName?: string, size?: number, lastUpdated?: string } | null>(null)
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false)
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null)


  // Translation state

  const [selectedGender, setSelectedGender] = useState<'male' | 'female'>('male')
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['pt-br', 'en-us', 'es-es']) // Default selection
  const [isTranslating, setIsTranslating] = useState(false)
  const [translatedDescriptions, setTranslatedDescriptions] = useState<any[]>([])

  // Audio progress state
  const [audioProgress, setAudioProgress] = useState({ current: 0, total: 0, currentTask: '' })
  const [audioResults, setAudioResults] = useState<string[]>([])
  const [showResults, setShowResults] = useState(false)

  // Feedback states for better UX
  const [showSuccessMessage, setShowSuccessMessage] = useState(false)
  const [showErrorMessage, setShowErrorMessage] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [confirmState, setConfirmState] = useState<{ message: string; resolve: (value: boolean) => void } | null>(null)

  // Add to the state

  // Sources information state
  const [lastGenerationSources, setLastGenerationSources] = useState<any[]>([])
  const [verificationInfo, setVerificationInfo] = useState<{
    mode: string;
    dynamicSourcesEnabled: boolean;
    sourcesCount: number;
  } | null>(null)

  // Historical dates state
  const [detectedDates, setDetectedDates] = useState<{
    dates: string[];
    reliable: string[];
    moderate: string[];
    total: number;
  } | null>(null)

  // Verification state
  const [verificationResult, setVerificationResult] = useState<{
    applied: boolean;
    approved: boolean;
    score: number;
    detected_dates: string[];
    verifiable_facts: string[];
    keywords?: string[];
    issues: string[];
    improvement_suggestion: string;
    improvement_applied: boolean;
  } | null>(null)

  // UI state
  const [showAdvancedInfo, setShowAdvancedInfo] = useState(false)

  // Grouping state
  const [nearbyPOIs, setNearbyPOIs] = useState<any[]>([])
  const [selectedPOIs, setSelectedPOIs] = useState<string[]>([])

  // Enhanced categories to ensure current POI category is always visible
  // even if it's not in the static constants list
  const enhancedCategories = useMemo(() => {
    const baseCategories = POI_CATEGORIES.filter(c => c.value !== 'all' && c.value !== 'geofence')
    const poiCategory = currentPoi?.osm_category || currentPoi?.category
    
    // If the POI has a category not in our list, add it dynamically
    if (poiCategory && !baseCategories.some(c => c.value === poiCategory)) {
        // Use the value itself as label if not found, with a special prefix or indicator
        const label = poiCategory.charAt(0).toUpperCase() + poiCategory.slice(1).replace(/_/g, ' ')
        
        return [
            ...baseCategories,
            { value: poiCategory, label: `${label} (Dynamic)`, icon: Info, color: 'bg-slate-500' }
        ]
    }
    return baseCategories
  }, [currentPoi?.osm_category, currentPoi?.category])
  const [groupInfo, setGroupInfo] = useState<any>(null)
  const [groupLoading, setGroupLoading] = useState(false)
  const [groupName, setGroupName] = useState(poi?.name || '') // Default to main POI name
  const [drawnPolygon, setDrawnPolygon] = useState<Array<{ lat: number; lng: number }> | null>(null)

  const queryClient = useQueryClient()
  const supabase = useSupabaseClient<any>()

  // Ref to track current description value to prevent stale closures in async callbacks
  const currentDescriptionRef = useRef(currentDescription)
  useEffect(() => {
    currentDescriptionRef.current = currentDescription
  }, [currentDescription])

  // Ref to track last generation time to prevent immediate background refresh from overwriting
  const lastGenerationTimeRef = useRef(0)

  // Helper to invalidate all POI-related caches for instant updates across all views
  const invalidateAllPOICaches = useCallback(async () => {
    // Clear internal service caches first
    poiService.clearCache()
    locationService.clearCache()

    // Use refetchQueries with exact: false to match all queries starting with these keys
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['pois'], exact: false, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['map-pois'], exact: false, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['pois-with-triggers'], exact: false, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['osm-pois'], exact: false, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['osm-map-pois'], exact: false, type: 'active' }),
      queryClient.refetchQueries({ queryKey: ['osm-filter-options'], exact: false, type: 'active' }),
    ])
  }, [queryClient])

  // Helper for optimistic updates - updates cache immediately without waiting for server
  const updatePOICacheOptimistically = useCallback((updatedPOI: any) => {
    // Update 'pois' list cache
    queryClient.setQueriesData({ queryKey: ['pois'], exact: false }, (oldData: any) => {
      if (!oldData || !oldData.data) return oldData
      
      return {
        ...oldData,
        data: oldData.data.map((p: any) => p.id === updatedPOI.id ? { ...p, ...updatedPOI } : p)
      }
    })
    
    // Update 'osm-pois' list cache
    queryClient.setQueriesData({ queryKey: ['osm-pois'], exact: false }, (oldData: any) => {
      if (!oldData || !oldData.data) return oldData
      
      return {
        ...oldData,
        data: oldData.data.map((p: any) => p.id === updatedPOI.id ? { ...p, ...updatedPOI } : p)
      }
    })
  }, [queryClient])






  // Function to detect and validate dates in description
  const detectHistoricalDates = (text: string) => {
    const datePatterns = [
      // Specific years
      /\b(1[0-9]{3}|20[0-9]{2})\b/g,
      // Century references
      /século\s+(XVIII|XIX|XX|XXI|18|19|20|21)/gi,
      // Decade references
      /anos?\s+(1[0-9]{3}0s?|20[0-9]0s?)/gi,
      /década\s+de\s+(1[0-9]{3}0|20[0-9]0)/gi,
      // Construction/inauguration verbs with dates
      /(construíd[ao]|inaugurad[ao]|fundad[ao]|restaurad[ao]|reformad[ao]|tombad[ao])\s+em\s+([0-9]{4}|[0-9]{1,2}\s+de\s+[a-z]+\s+de\s+[0-9]{4})/gi,
      // Month and year combinations
      /(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+([0-9]{4})/gi
    ]

    const foundDates = []

    for (const pattern of datePatterns) {
      const matches = text.match(pattern)
      if (matches) {
        foundDates.push(...matches)
      }
    }

    // Remove duplicates and return unique dates
    return [...new Set(foundDates)]
  }

  // Function to classify date reliability
  const classifyDateReliability = (dates: string[]) => {
    const reliable = dates.filter(date =>
      /\b(1[0-9]{3}|20[0-9]{2})\b/.test(date) || // Specific years
      /(construíd[ao]|inaugurad[ao]|fundad[ao]|restaurad[ao]|reformad[ao]|tombad[ao])\s+em/.test(date) // Action + date
    )

    const moderate = dates.filter(date =>
      /século\s+(XVIII|XIX|XX|XXI)/gi.test(date) || // Century references
      /(anos?\s+|década\s+de\s+)/gi.test(date) // Decade references
    )

    return { reliable, moderate, total: dates.length }
  }

  // Helper function to show feedback messages
  const showFeedback = (message: string, type: 'success' | 'error') => {
    if (type === 'success') {
      setSuccessMessage(message)
      setShowSuccessMessage(true)
      setShowErrorMessage(false)
      // Auto-hide after 5 seconds
      setTimeout(() => setShowSuccessMessage(false), 5000)
    } else {
      setErrorMessage(message)
      setShowErrorMessage(true)
      setShowSuccessMessage(false)
      // Auto-hide after 8 seconds for errors
      setTimeout(() => setShowErrorMessage(false), 8000)
    }
  }

  // Promise-based confirm dialog (replaces blocking native window.confirm).
  // Renders an in-modal overlay consistent with the UI / dark mode.
  const requestConfirm = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ message, resolve })
    })
  }, [])
  const resolveConfirm = useCallback((value: boolean) => {
    setConfirmState(prev => {
      prev?.resolve(value)
      return null
    })
  }, [])

  // Voice mapping for Google TTS
  const googleVoiceMap: Record<string, string> = {
    shimmer: 'pt-BR-Wavenet-B',
    nova: 'pt-BR-Wavenet-A',
    alloy: 'pt-BR-Wavenet-D',
    echo: 'pt-BR-Wavenet-E',
  }

  const fetchAdditionalData = useCallback(async (forcePoiId?: string, forceUpdate = false) => {
    // Determine which POI ID to use: explicitly passed, or from state/props
    const activePoiId = forcePoiId || getPoi()?.id
    if (!activePoiId) return // Skip if no POI ID (creation mode)

    setIsLoading(true)
    try {
      // Fetch descriptions with cache busting
      const descriptionsData = await fetchDescriptionsRemote(supabase, activePoiId, groupInfo?.id)

      setDescriptions(descriptionsData || [])

      // Separate Portuguese descriptions from translations
      const portugueseDescriptions = descriptionsData?.filter(desc =>
        desc.language === 'pt-br' || desc.language === 'pt' || desc.language?.toLowerCase().includes('pt')
      ) || []

      // Include ALL descriptions with audio_url in the available audios list
      const allAudiosAvailable = descriptionsData?.filter(desc => desc.audio_url) || []
      setTranslatedDescriptions(allAudiosAvailable)

      // 1. Try to find description in the selected language
      let currentDesc = descriptionsData?.find(desc => 
        desc.language?.toLowerCase() === generationLanguage.toLowerCase() ||
        desc.language?.toLowerCase() === generationLanguage.split('-')[0].toLowerCase()
      )

      // 2. Fallback to Portuguese if nothing found and we are not explicitly on another language
      if (!currentDesc && generationLanguage.toLowerCase().startsWith('pt')) {
         currentDesc = descriptionsData?.find(desc => desc.language?.toLowerCase().includes('pt'))
      }

      // 3. Last resort fallback to most recent record
      if (!currentDesc && descriptionsData && descriptionsData.length > 0) {
        currentDesc = descriptionsData[0]
      }

      // Track if this is a new POI being loaded to force update
      const isNewPoi = lastLoadedPoiId.current !== activePoiId
      lastLoadedPoiId.current = activePoiId

      if (currentDesc && currentDesc.description) {
        // Force update if it's a new POI, or if it's explicitly requested, or if editor is empty
        const isRecentlyGenerated = (Date.now() - lastGenerationTimeRef.current) < 8000
        const isEditorEmpty = !currentDescriptionRef.current.trim()

        if (forceUpdate || isNewPoi || (isEditorEmpty && !isRecentlyGenerated)) {
          setCurrentDescription(currentDesc.description || '')
          setOriginalDescription(currentDesc.description || '')
        }
        
        setDescriptionStats({
          play_count: currentDesc.play_count || 0,
          last_played_at: currentDesc.last_played_at
        })

        // Load audio information
        if (currentDesc.audio_url) {
          setCurrentAudioUrl(currentDesc.audio_url)
          const urlParts = currentDesc.audio_url.split('/')
          const fileName = urlParts[urlParts.length - 1]
          setAudioMetadata({
            fileName,
            lastUpdated: currentDesc.updated_at
          })
        } else {
          setCurrentAudioUrl(null)
          setAudioMetadata(null)
        }
      } else if (currentDesc && !currentDesc.description) {
        // Record exists but description is empty
        if (forceUpdate || isNewPoi) {
          setCurrentDescription('')
          setOriginalDescription('')
        }
        setDescriptionStats({
          play_count: currentDesc.play_count || 0,
          last_played_at: currentDesc.last_played_at
        })

        if (currentDesc.audio_url) {
          setCurrentAudioUrl(currentDesc.audio_url)
          const urlParts = currentDesc.audio_url.split('/')
          const fileName = urlParts[urlParts.length - 1]
          setAudioMetadata({
            fileName,
            lastUpdated: currentDesc.updated_at
          })
        } else {
          setCurrentAudioUrl(null)
          setAudioMetadata(null)
        }
      } else {
        // No record found at all
        const isRecentlyGenerated = (Date.now() - lastGenerationTimeRef.current) < 8000
        if (forceUpdate || isNewPoi || (!currentDescriptionRef.current.trim() && !isRecentlyGenerated)) {
          setCurrentDescription('')
          setOriginalDescription('')
        }
        setDescriptionStats({ play_count: 0, last_played_at: null })
        setCurrentAudioUrl(null)
        setAudioMetadata(null)
      }

      // Fetch additional images
      const { data: imagesData } = await supabase
        .schema('core')
        .from('attraction_image')
        .select('*')
        .eq('attraction_id', activePoiId)
        .order('created_at', { ascending: false })

      setImages(imagesData || [])
    } catch (error) {
      console.error('Error fetching additional data:', error)
    } finally {
      setIsLoading(false)
    }
  }, [getPoi, groupInfo?.id, supabase, generationLanguage])

  const fetchNearbyPOIsWithPolygon = useCallback(async (polygonCoords: Array<{ lat: number; lng: number }>) => {
    setGroupLoading(true)
    try {
      const filteredNearby = await fetchNearbyInPolygon(polygonCoords, getPoi()?.id)
      setNearbyPOIs(filteredNearby)
    } catch (error) {
      console.error('❌ MODAL: Error in fetchNearbyPOIsWithPolygon:', error);
      showFeedback(`${t('validation.nearby_error')}: ${error instanceof Error ? error.message : tCommon('error.unknown')}`, 'error');
    } finally {
      setGroupLoading(false)
    }
  }, [t, tCommon, getPoi])

  const fetchNearbyPOIs = useCallback(async (customPolygon?: any[]) => {
    // Use provided polygon, or fallback to drawnPolygon, or technical boundary
    const poly = customPolygon || drawnPolygon || boundaryPolygon || createBoundary
    
    if (poly && poly.length >= 3) {
      await fetchNearbyPOIsWithPolygon(poly)
    } else {
      setNearbyPOIs([])
    }
  }, [boundaryPolygon, createBoundary, drawnPolygon, fetchNearbyPOIsWithPolygon])

  const fetchGroupInfo = useCallback(async () => {
    const currentPoi = getPoi()
    if (!currentPoi) return // Skip if no POI (creation mode)

    setGroupLoading(true)
    try {
      const { group, members } = await fetchGroupOfPoi(currentPoi.id)

      setGroupInfo(group)
      setGroupName(group?.name || currentPoi.name) // Use main POI name as default

      // Always include the main POI in selectedPOIs, plus any existing group members
      const selectedPOIsList = members.includes(currentPoi.id) ? members : [currentPoi.id, ...members]

      setSelectedPOIs(selectedPOIsList)
    } catch (error) {
      console.error('❌ MODAL: Error in fetchGroupInfo:', error);
      // Fallback: at least include the main POI
      setSelectedPOIs([currentPoi.id])
    } finally {
      setGroupLoading(false)
    }
  }, [getPoi])

  // Função para buscar dados de verificação da descrição
  const fetchVerificationData = useCallback(async () => {
    const currentPoi = getPoi()
    if (!currentPoi) return // Skip if no POI (creation mode)

    try {

      // Usar a linguagem atual ou preferir pt-br para verificação
      const verificationLang = (generationLanguage === 'pt-br' || generationLanguage === 'pt-BR') ? 'pt-br' : generationLanguage

      // Usar o serviço (v_descriptions_with_last_score + description_scores/claims)
      const { descData, scoresData } = await fetchVerificationRaw(supabase, getPoi()?.id || '', verificationLang)

      if (!descData) {
        return;
      }

      if (scoresData) {

        // Score já está em escala de 0-100
        const score = scoresData.score_overall || 0;

        // Verificar se o score é aprovado (>= 75)
        const isApproved = score >= 75;

        // Extrair fatos verificáveis das claims
        const verifiableFacts = scoresData.description_claims
          ?.filter((claim: any) => claim.status === 'supported')
          .map((claim: any) => claim.value) || [];

        // Extrair datas das claims
        const detectedDates = scoresData.description_claims
          ?.filter((claim: any) => claim.claim_type === 'year')
          .map((claim: any) => claim.value) || [];

        // Classificar datas como confiáveis ou moderadas
        const reliableDates = detectedDates.filter((date: string) => /^\d{4}$/.test(date)); // Anos completos são confiáveis
        const moderateDates = detectedDates.filter((date: string) => !/^\d{4}$/.test(date)); // Outros formatos são moderados

        // Definir resultado da verificação
        setVerificationResult({
          applied: true,
          approved: isApproved,
          score: score,
          detected_dates: detectedDates,
          verifiable_facts: verifiableFacts,
          issues: [],
          improvement_suggestion: '',
          improvement_applied: false
        });

        if (detectedDates.length > 0) {
          const dateClassification = classifyDateReliability(detectedDates)
          setDetectedDates({
            dates: detectedDates,
            reliable: dateClassification.reliable,
            moderate: dateClassification.moderate,
            total: dateClassification.total
          });
        }
      } else {
        // Usar o score da própria descrição que já buscamos
        const score = descData?.last_score_overall || (descData?.verification_score ? Math.round(descData.verification_score * 100) : 0);
        
        if (score > 0) {
          // Se tiver score na tabela attraction_descriptions, usar esse valor
          const isApproved = descData.verification_status === 'verified' || descData.verification_status === 'approved' || score >= 75;

          setVerificationResult({
            applied: true,
            approved: isApproved,
            score: score,
            detected_dates: [],
            verifiable_facts: [],
            issues: [],
            improvement_suggestion: '',
            improvement_applied: false
          });

        } else {
          // Limpar o resultado de verificação para não mostrar dados antigos
          setVerificationResult(null);
        }
      }
    } catch (error) {
      console.error('❌ Erro ao buscar dados de verificação:', error);
    }
  }, [supabase, getPoi, generationLanguage]);

  // useEffect hooks after function declarations
  useEffect(() => {
    if (!isOpen) {
      // Limpar todos os estados quando o modal for fechado para evitar vazamento de dados de um POI para outro
      lastContentInitializedPoiIdRef.current = null
      setCurrentDescription('')
      setOriginalDescription('')
      setDescriptions([])
      setImages([])
      setCurrentAudioUrl(null)
      setAudioMetadata(null)
      setTranslatedDescriptions([])
      setVerificationResult(null)
      setDetectedDates(null)
      setNearbyPOIs([])
      setSelectedPOIs([])
      setLastGenerationSources([])
      setAudioPreviewUrl(null)
      setGroupInfo(null)
      setReferenceLinks([])
      
      // UI state and detailed messages
      setSuccessMessage('')
      setErrorMessage('')
      setGenerationLanguage('pt-br')
      setGroupName('')
      setIsSaving(false)
      setIsSavingBoundary(false)
      setIsDrawingEnabled(false)
      setActiveTab('details')
      
      // Reset UI processing and audio states
      setAudioProgress({ current: 0, total: 0, currentTask: '' })
      setAudioResults([])
      setShowResults(false)
      setShowSuccessMessage(false)
      setShowErrorMessage(false)
      setIsGenerating(false)
      setIsGeneratingAudio(false)
      setIsTranslating(false)
      setIsSavingDescription(false)
      setIsSavingReferenceLinks(false)
      return
    }

    // Modal is OPEN. Only initialize if it's a NEW poi.id
    if (lastContentInitializedPoiIdRef.current !== poi?.id) {
      lastContentInitializedPoiIdRef.current = poi?.id || null
      
      // Reset content-related states whenever opening a new POI
      setCurrentDescription('')
      setOriginalDescription('')
      setCurrentAudioUrl(null)
      setAudioMetadata(null)
      setDescriptions([])
      setImages([])
      setTranslatedDescriptions([])
      setNearbyPOIs([])
      setSelectedPOIs([])
      
      // UI state and detailed messages
      setSuccessMessage('')
      setErrorMessage('')
      setGenerationLanguage('pt-br')
      setGroupName(poi?.name || '')
      setIsSaving(false)
      setIsSavingBoundary(false)
      setIsDrawingEnabled(false)
      
      // Reset UI processing and audio states
      setAudioProgress({ current: 0, total: 0, currentTask: '' })
      setAudioResults([])
      setShowResults(false)
      setShowSuccessMessage(false)
      setShowErrorMessage(false)
      setIsGenerating(false)
      setIsGeneratingAudio(false)
      setIsTranslating(false)
      setIsSavingDescription(false)
      setIsSavingReferenceLinks(false)
      
      // Only set editedPoi from prop if poi prop exists
      // This prevents overwriting locally created POI state when poi prop is null
      if (poi) {
        setEditedPoi(poi)
        setReferenceLinks(poi.reference_links || [])
        // Always reset to details tab when opening a new existing POI
        setActiveTab('details')
        
        // Use explicit POI ID to bypass race conditions with currentPoi state
        fetchAdditionalData(poi.id, true)
      } else {
        setReferenceLinks([])
        fetchAdditionalData()
      }

      // Garantir que os dados de verificação sejam buscados após os dados da descrição
      setTimeout(() => {
        fetchVerificationData()
      }, 500)
    }
  }, [poi?.id, isOpen, fetchAdditionalData, fetchVerificationData])

  // Fetch existing boundary from database
  const fetchBoundary = useCallback(async () => {
    const currentId = getPoi()?.id;
    if (!currentId) return;

    try {
      const boundary = await fetchBoundaryRemote(currentId);
      if (boundary) {
        setExistingBoundary(boundary);
        setBoundaryPolygon(boundary);
      } else {
        setExistingBoundary(null);
        setBoundaryPolygon(null);
      }
    } catch (error) {
      console.error('Error fetching boundary:', error);
    }
  }, [getPoi]);

  const handleSaveBoundary = async () => {
    const currentPoi = getPoi()
    if (!currentPoi || !boundaryPolygon || boundaryPolygon.length < 3) {
      showFeedback('Por favor, desenhe um polígono válido (mínimo 3 pontos)', 'error')
      return
    }

    // Validate coordinates before sending
    const validCoords = sanitizeBoundary(boundaryPolygon)

    if (validCoords.length < 3) {
      showFeedback(`Polígono inválido: apenas ${validCoords.length} pontos válidos (mínimo 3)`, 'error')
      return
    }


    setIsSavingBoundary(true)
    try {
      const result = await saveBoundaryRemote(currentPoi.id, validCoords)

      // Refresh POI data to show updated boundary
      if (onPOIUpdated && result) {
        // Update local POI state with boundary info
        const updatedPoi = {
          ...currentPoi,
          boundary_area_m2: result.boundary_area_m2,
          boundary_centroid: result.boundary_centroid
        }
        onPOIUpdated(updatedPoi as POI)
      }

      // Automatically re-fetch boundary from DB so map rendering AND group search run instantly
      await fetchBoundary()
      
      // Stop drawing mode
      setIsDrawingEnabled(false)

      showFeedback(t('validation.boundary_success'), 'success')
    } catch (error) {
      console.error('Error saving boundary:', error)
      showFeedback(`${t('validation.boundary_error')}: ${error instanceof Error ? error.message : tCommon('error.unknown')}`, 'error')
    } finally {
      setIsSavingBoundary(false)
    }
  }

  const handleDeleteBoundary = async () => {
    const currentPoi = getPoi()
    if (!currentPoi) return
    
    if (!(await requestConfirm('Deseja realmente remover o polígono deste POI? Todos os dados geográficos deste local serão apagados.'))) {
      return
    }

    setIsSavingBoundary(true)
    try {
      await deleteBoundaryRemote(currentPoi.id)
      setBoundaryPolygon(null)
      setExistingBoundary(null)
      setDrawnPolygon(null)
      showFeedback('Boundary removido com sucesso!', 'success')
      setIsDrawingEnabled(false)
      if (onUpdate) onUpdate()
    } catch (error) {
      console.error('Error deleting boundary:', error)
      showFeedback('Erro ao remover boundary', 'error')
    } finally {
      setIsSavingBoundary(false)
    }
  }

  // Consolidate initialization: Fetch existing boundary and basic group info on open
  useEffect(() => {
    if (isOpen && poi?.id) {
      if (poi?.coordinates) {
        // We only fetch group info to check if it belongs to a group.
        // nearby POIs will be fetched only when the tab is actually opened.
        fetchGroupInfo()
      }
      fetchBoundary()
    }
  }, [isOpen, poi?.id]) // Only trigger when modal opens or POI identity changes

  // Tab-specific effect for Group POIs: Handle auto-fill and fetch
  useEffect(() => {
    if (activeTab === 'group-pois') {
      // Auto-fill drawnPolygon once if it's empty
      if (!drawnPolygon) {
        const boundaryToUse = boundaryPolygon || createBoundary
        if (boundaryToUse && boundaryToUse.length >= 3) {
          setDrawnPolygon(boundaryToUse)
        }
      }
      
      // Always fetch nearby POIs when tab is active
      fetchNearbyPOIs()
    }
  }, [activeTab, fetchNearbyPOIs]) 




  const handleTogglePOI = (id: string) => {
    setSelectedPOIs(prev => {
      const newSelection = prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
      return newSelection
    })
  }


  const handleSaveGroup = async () => {
    const currentPoi = getPoi()
    if (!currentPoi) {
      showFeedback('POI não encontrado', 'error')
      return
    }


    setGroupLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // Always include the main POI in the group
      const poiIds = [currentPoi.id, ...selectedPOIs.filter(id => id !== currentPoi.id)]

      await saveGroupRemote({
        groupId: groupInfo?.id,
        name: groupName || currentPoi.name,
        poiIds,
        userId: user?.id,
      })

      await fetchGroupInfo()
      await onUpdate()
      showFeedback('Group saved!', 'success')
    } catch (e) {
      console.error('❌ MODAL: Error in handleSaveGroup:', e);
      showFeedback(`Failed to save group: ${e instanceof Error ? e.message : 'Unknown error'}`, 'error')
    } finally {
      setGroupLoading(false)
    }
  }

  const handleSaveChanges = async () => {
    setIsSaving(true)
    try {
      const currentPoi = getPoi()
      if (!currentPoi || !editedPoi) {
        showFeedback('POI não encontrado', 'error')
        return
      }

      await poiMutations.savePoiChanges(currentPoi, editedPoi, referenceLinks)

      // Update local state instead of reloading all data
      const currentPoiData = getPoi()
      if (!currentPoiData || !editedPoi) return

      const updatedPOI: POI = {
        ...currentPoiData, // Keep original POI data
        ...editedPoi, // Merge with edited fields
        updated_at: new Date().toISOString(),
        id: currentPoiData.id // Ensure id is always present
      }
      
      // Small delay to ensure database has propagated the changes
      // This is necessary because the database may take a moment to replicate      
      // Update cache Optimistically (Instant UI update)
      updatePOICacheOptimistically(updatedPOI)
      
      // Small delay to ensure database has propagated the changes
      // This is necessary because the database may take a moment to replicate
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Now refetch to get the updated data (Eventual Consistency)
      invalidateAllPOICaches()
      
      if (onPOIUpdated) {
        onPOIUpdated(updatedPOI)
      }
      if (onUpdate) {
        await onUpdate()
      }
      onClose()


    } catch (error) {
      console.error('Error saving POI:', error)
      showFeedback(`Erro ao salvar POI: ${error instanceof Error ? error.message : 'Erro desconhecido'}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleApprove = async () => {
    const currentPoi = getPoi()
    if (!currentPoi) {
      showFeedback('POI não encontrado', 'error')
      return
    }

    setIsSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      await poiMutations.approvePoi(currentPoi, user?.id)

      // Update local state instead of reloading all data
      if (!editedPoi || !editedPoi.id) {
        throw new Error('Cannot approve POI: missing POI data')
      }
      const updatedPOI = {
        ...editedPoi,
        approved: true,
        approved_by: user?.id || null,
        approved_at: new Date().toISOString()
      }
      // Invalidate caches for instant updates
      invalidateAllPOICaches()
      
      if (onPOIUpdated) {
        onPOIUpdated(updatedPOI as POI)
      } else {
        await onUpdate()
      }
      onClose()
    } catch (error) {
      console.error('Error approving POI:', error)
      // Show user-friendly error message
      showFeedback(`Erro ao aprovar POI: ${error instanceof Error ? error.message : 'Erro desconhecido'}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleTogglePoiActive = async () => {
    const poi = getPoi()
    if (!poi) return

    const currentIsActive = poi.is_active ?? true
    const newIsActive = !currentIsActive
    
    // OPTIMISTIC UPDATE: Update UI immediately BEFORE database call
    const updatedPOI = {
      ...poi,
      is_active: newIsActive
    } as POI
    
    setCurrentPoi(updatedPOI)
    setEditedPoi(updatedPOI)
    
    // Mark this as a local update so useEffect doesn't overwrite it
    localUpdateRef.current = { poiId: poi.id, timestamp: Date.now() }
    
    setIsSaving(true)

    try {
      await poiMutations.setPoiActive(poi.id, newIsActive)

      // Invalidate caches
      invalidateAllPOICaches()
      
      if (onPOIUpdated) {
        onPOIUpdated(updatedPOI)
      } else {
        await onUpdate()
      }
      
      showFeedback(newIsActive ? t('validation.poi_activated') : t('validation.poi_deactivated'), 'success')
    } catch (error) {
      console.error('Error toggling POI active status:', error)
      // ROLLBACK: Revert to previous state on error
      setCurrentPoi(poi)
      setEditedPoi(poi)
      showFeedback(tCommon('error.unknown'), 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    const currentPoi = getPoi()
    if (!currentPoi) {
      showFeedback('POI não encontrado', 'error')
      return
    }

    if (!(await requestConfirm('Are you sure you want to delete this POI? This action cannot be undone.'))) {
      return
    }

    setIsSaving(true)
    try {
      await poiMutations.deletePoi(currentPoi)

      // Invalidate caches for instant updates
      invalidateAllPOICaches()

      // Notify parent component about deletion instead of reloading all data
      if (onPOIDeleted) {
        onPOIDeleted(currentPoi.id)
      } else {
        await onUpdate()
      }
      onClose()
    } catch (error) {
      console.error('Error deleting POI:', error)
      showFeedback(`Erro ao excluir POI: ${error instanceof Error ? error.message : 'Erro desconhecido'}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleGarbage = async () => {
    const currentPoi = getPoi()
    if (!currentPoi) return
    if (!(await requestConfirm('Tem certeza que deseja marcar este POI como LIXO? Ele será excluído e não poderá ser re-importado.'))) return

    setIsSaving(true)
    try {
      await poiMutations.garbagePoi(currentPoi)

      invalidateAllPOICaches()

      if (onPOIDeleted) {
        onPOIDeleted(currentPoi.id)
      }
      onClose()
    } catch (error: any) {
      console.error('Error marking POI as garbage:', error)
      showFeedback(error instanceof Error ? error.message : 'Falha ao marcar como lixo', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const openInGoogleMaps = () => {
    const currentPoi = getPoi()
    if (currentPoi?.coordinates) {
      const url = `https://www.google.com/maps/search/?api=1&query=${currentPoi.coordinates.latitude},${currentPoi.coordinates.longitude}`
      window.open(url, '_blank')
    }
  }

  const openWebsite = () => {
    const currentPoi = getPoi()
    if (currentPoi?.website) {
      window.open(currentPoi.website, '_blank')
    }
  }

  // Description management functions
  const generateDescription = async () => {
    const currentPoi = getPoi()
    if (!currentPoi) {
      showFeedback('POI não encontrado', 'error')
      return
    }

    setIsGenerating(true)
    try {
      // Buscar ID da descrição existente para persistir verificação
      let existingDescriptionId = null;
      const { data: existingDesc } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('id')
        .eq('attraction_id', getPoi()?.id || '')
        .eq('language', generationLanguage)
        .order('updated_at', { ascending: false })
        .maybeSingle();

      if (existingDesc) {
        existingDescriptionId = existingDesc.id;
      }

      // Prepare POI data for new Gemini Description Service
      const poiData = {
        id: currentPoi.id,
        name: currentPoi.name,
        city: currentPoi.city,
        country: currentPoi.country,
        state: currentPoi.state || undefined,
        formatted_address: currentPoi.formatted_address || undefined,
        vicinity: currentPoi.vicinity || undefined,
        google_types: currentPoi.google_types || (currentPoi.category ? [currentPoi.category] : ['tourist_attraction']),
        rating: currentPoi.rating || undefined,
        user_ratings_total: currentPoi.user_ratings_total || undefined,
        price_level: currentPoi.price_level || undefined,
        business_status: currentPoi.business_status || undefined,
        opening_hours: currentPoi.opening_hours || undefined,
        website: currentPoi.website || undefined,
        formatted_phone_number: currentPoi.formatted_phone_number || undefined,
        photos_references: currentPoi.photos_references || undefined,
        image_url: currentPoi.image_url || undefined,
        reference_links: referenceLinks.filter(link => !!link.trim()) || undefined,
        google_place_id: poi?.google_place_id || undefined,
        lat: poi?.coordinates?.latitude || undefined,
        lng: poi?.coordinates?.longitude || undefined
      }

      // Prepare additional context from reference links
      let additionalContext = ''
      if (referenceLinks.filter(link => !!link.trim()).length > 0) {
        additionalContext = `Links de referência fornecidos:\n${referenceLinks.filter(link => !!link.trim()).join('\n')}\n\n`
      }
      /* Removed referencing existing description to force fresh generation */
      if (referenceLinks.filter(link => !!link.trim()).length > 0) {
        additionalContext = `Links de referência fornecidos:\n${referenceLinks.filter(link => !!link.trim()).join('\n')}\n\n`
      }


      
      // Use generate-description (Master Mode) com autenticação
      const { data: result, error: invokeError } = await callFunction('generate-description', {
        poi_id: currentPoi.id,
        language: generationLanguage,
        generate_audio: false, // Only generate text, not audio
        audio_duration: audioDuration,
        raw_context: additionalContext.trim() || undefined,
        force: true // Force fresh generation
      })

      if (invokeError) {
        console.error('❌ POI MODAL: Edge Function error:', invokeError)
        throw new Error(`Failed to generate description: ${invokeError.message || 'Unknown error'}`)
      }

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to generate description')
      }

      const generatedData = result.data
      const generatedDescription = generatedData.description || ''
      const generatedAudioUrl = generatedData.audio_url || ''


      showFeedback('✅ Native Narration Script generated successfully.', 'success')

      // Mark generation time to prevent background fetches from overwriting for a few seconds
      lastGenerationTimeRef.current = Date.now()

      // 1. Atualizar a descrição atual para refletir no textarea
      if (generatedDescription) {
        setCurrentDescription(generatedDescription)
        setOriginalDescription(generatedDescription)
        
        // 2. Atualizar o resultado da verificação para mostrar o novo score
        setVerificationResult({
          score: generatedData.last_score_overall || 0,
          approved: generatedData.verification_status === 'approved',
          verifiable_facts: generatedData.metadata?.verified_facts || [],
          detected_dates: generatedData.metadata?.historical_dates || [],
          keywords: generatedData.metadata?.search_keywords || generatedData.metadata?.keywords || [],
          issues: generatedData.metadata?.issues || [],
          improvement_suggestion: generatedData.metadata?.improvement_suggestion || '',
          applied: true,
          improvement_applied: generatedData.metadata?.improvement_applied || false
        })

        // 2.5 Atualizar contadores locais para evitar que fetchAdditionalData ache que não tem conteúdo
        if (currentPoi) {
          const updated = {
            ...currentPoi,
            has_description: true,
            description_count: (currentPoi.description_count || 0) + 1,
            available_languages: [...new Set([...(currentPoi.available_languages || []), generationLanguage])]
          }
          setCurrentPoi(updated)
          setEditedPoi(updated)
        }

        // 3. Atualizar datas detectadas localmente para busca se necessário
        const detectedDatesArray = detectHistoricalDates(generatedDescription)
        if (detectedDatesArray.length > 0) {
            const dateClassification = classifyDateReliability(detectedDatesArray)
            setDetectedDates({
            dates: detectedDatesArray,
            reliable: dateClassification.reliable,
            moderate: dateClassification.moderate,
            total: dateClassification.total
            })
        }
      }

      // Handle Audio (URL provided by Master Generator)
      if (generatedAudioUrl) {
          setCurrentAudioUrl(generatedAudioUrl) 
          setAudioMetadata({
             fileName: generatedAudioUrl.split('/').pop() || 'generated.mp3',
             size: 0, // Unknown size from URL
             lastUpdated: new Date().toISOString()
          })
      }
      
      // Note: DB is already updated by the Edge Function (Master update)
      // Sync verification data (scores, etc)
      fetchVerificationData()

      // Invalidate caches so other components know about the new description
      invalidateAllPOICaches()
      
    } catch (error) {
      console.error('Error generating description:', error)
      showFeedback(`Failed to generate description: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  const saveReferenceLinks = async () => {
    setIsSavingReferenceLinks(true)
    try {
      // Check if this is a homolog POI (from homolog.pois table)
      const isHomologPOI = !!poi?._homologData

      if (isHomologPOI) {
        showFeedback('Reference links can only be saved for core attractions, not homolog POIs.', 'error')
        return
      }

      const validLinks = referenceLinks.filter(link => !!link.trim())

      if (validLinks.length === 0) {
        showFeedback('Please add at least one reference link before saving.', 'error')
        return
      }

      const { error: refLinksError } = await supabase
        .schema('core')
        .from('attractions')
        .update({
          reference_links: validLinks
        })
        .eq('id', getPoi()?.id || '')

      if (refLinksError) {
        console.error('⚠️ Error saving reference links:', refLinksError)
        showFeedback('Failed to save reference links. Please try again.', 'error')
      } else {
        showFeedback(`${validLinks.length} reference link(s) saved successfully!`, 'success')
      }
    } catch (error) {
      console.error('Error saving reference links:', error)
      showFeedback('Failed to save reference links. Please try again.', 'error')
    } finally {
      setIsSavingReferenceLinks(false)
    }
  }

  const saveDescription = async () => {
    if (!currentDescription.trim()) {
      showFeedback('Description cannot be empty.', 'error')
      return
    }

    setIsSavingDescription(true)
    try {
      const poiIdForSave = getPoi()?.id
      if (!poiIdForSave) return
      const { changed: descriptionChanged } = await upsertPortugueseDescription(supabase, poiIdForSave, currentDescription)

      // Update original description to match current
      setOriginalDescription(currentDescription)

      // Update the descriptions array locally to reflect the change
      const currentPoiForDescUpdate = getPoi()
      if (!currentPoiForDescUpdate) return
      setDescriptions(prevDescriptions => {
        const updatedDescriptions = prevDescriptions.map(desc => {
          if (desc.attraction_id === currentPoiForDescUpdate.id && desc.language === 'pt-br') {
            return {
              ...desc,
              description: currentDescription,
              updated_at: new Date().toISOString()
            }
          }
          return desc
        })
        return updatedDescriptions
      })

      // Don't refresh data immediately to avoid cache issues
      // The description is already saved and the local state is updated

      // If description changed and there are existing audios, offer to regenerate
      if (descriptionChanged && (currentAudioUrl || translatedDescriptions.length > 0)) {
        const shouldRegenerate = await requestConfirm(
          'A descrição foi alterada. Deseja regenerar todos os áudios (PT, EN, ES) para refletir as mudanças?\n\n' +
          'Isso irá substituir os áudios existentes com base na nova descrição.'
        )

        if (shouldRegenerate) {
          await regenerateAllAudios()
        }
      }

      showFeedback('Description saved successfully!', 'success')

      // Buscar dados de verificação atualizados após salvar
      setTimeout(() => {
        fetchVerificationData()
      }, 1000) // Pequeno delay para garantir que os dados estejam atualizados no banco
    } catch (error) {
      console.error('Error saving description:', error)
      showFeedback('Failed to save description. Please try again.', 'error')
    } finally {
      setIsSavingDescription(false)
    }
  }

  const resetDescription = () => {
    setCurrentDescription(originalDescription)
  }

  // Function to save description and proceed to next step
  const saveDescriptionAndNextStep = async () => {
    if (!currentDescription.trim()) {
      showFeedback('Description cannot be empty.', 'error')
      return
    }

    setIsSavingDescription(true)

    try {
      // First, save the description (shared upsert logic)
      const poiIdForSave = getPoi()?.id
      if (!poiIdForSave) {
        showFeedback('POI não encontrado. Por favor, recarregue a página.', 'error')
        return
      }
      await upsertPortugueseDescription(supabase, poiIdForSave, currentDescription)

      // Update original description to match current
      setOriginalDescription(currentDescription)

      // Update the descriptions array locally
      const currentPoiForDescUpdate2 = getPoi()
      if (currentPoiForDescUpdate2) {
        setDescriptions(prevDescriptions => {
          const updatedDescriptions = prevDescriptions.map(desc => {
            if (desc.attraction_id === currentPoiForDescUpdate2.id && desc.language === 'pt-br') {
              return {
                ...desc,
                description: currentDescription,
                updated_at: new Date().toISOString()
              }
            }
            return desc
          })
          return updatedDescriptions
        })
      }

      showFeedback('Description saved. Moving to narration audio...', 'success')
      
      // Move to the next tab
      setActiveTab('narration-audio')

      // Buscar dados de verificação atualizados após salvar
      setTimeout(() => {
        fetchVerificationData()
      }, 1000)
    } catch (error) {
      console.error('Error saving description:', error)
      showFeedback('Failed to save description. Please try again.', 'error')
    } finally {
      setIsSavingDescription(false)
    }
  }

  // Audio narration management functions
  const generateAudioNarration = async () => {
    // Determine text to use for audio generation
    let textForAudio = currentDescription.trim()

    if (!textForAudio) {
      if (currentAudioUrl) {
        // If audio exists but no description, create fallback text
        const fallbackPoi = getPoi()
        if (fallbackPoi) {
          textForAudio = `${fallbackPoi.name} é uma atração localizada em ${fallbackPoi.city}, ${fallbackPoi.country}.`
        }
        const proceed = await requestConfirm(
          `No description found. Using fallback text: "${textForAudio}"\n\n` +
          'For better audio quality, please add a proper description in the Description tab first.\n\n' +
          'Do you want to continue with this basic text?'
        )
        if (!proceed) return
      } else {
        showFeedback('Please save a description first before generating audio narration.', 'error')
        return
      }
    }

    // Show confirmation dialog if audio already exists
    if (currentAudioUrl) {
      const confirmReplace = await requestConfirm(
        'This will replace the existing audio narration. Are you sure you want to continue?\n\n' +
        'Note: You can adjust the voice and speed settings below before regenerating.'
      )
      if (!confirmReplace) {
        return
      }
    }

    setIsGeneratingAudio(true)
    try {

      // Use generate-description for audio too (it triggers TTS) com autenticação
      const { data: result, error: invokeError } = await callFunction('generate-description', {
         poi_id: getPoi()?.id,
         language: 'pt-br',
         force: false // Em Narration, preferimos traduzir o Master existente
      })

      if (invokeError) {
         throw new Error(invokeError.message || 'Failed to generate audio')
      }
      
      if (!result?.success) {
         throw new Error(result?.error || 'Failed to generate audio')
      }

      // Update UI with URL
      const audioUrl = result.data?.audio_url
      if (audioUrl) {
        setCurrentAudioUrl(audioUrl)
        setAudioMetadata({
            fileName: audioUrl.split('/').pop(),
            size: 0,
            lastUpdated: new Date().toISOString()
        })
        showFeedback('✅ Audio regenerated successfully', 'success')
      }

      // Refresh to ensure we get sync with DB eventually
      setTimeout(() => fetchAdditionalData(), 1000)

    } catch (error) {
      console.error('Error generating audio narration:', error)
      showFeedback(`Failed to generate audio narration: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
    } finally {
      setIsGeneratingAudio(false)
    }
  }

  const downloadAudio = () => {
    if (currentAudioUrl) {
      const link = document.createElement('a')
      link.href = currentAudioUrl
      link.download = audioMetadata?.fileName || 'narration-audio.mp3'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  const formatFileSize = (bytes: number | undefined): string => {
    if (!bytes) return 'Unknown size'
    const kb = bytes / 1024
    return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`
  }

  // Translation and audio generation function

  // Regenerate all audios for selected languages and gender
  const regenerateAllAudios = async () => {
    if (!currentDescription.trim()) {
      showFeedback('Please save an original description first.', 'error')
      return
    }

    if (selectedLanguages.length === 0) {
      showFeedback('Please select at least one language.', 'error')
      return
    }

    setIsGeneratingAudio(true)
    setIsTranslating(true)
    setShowResults(false)
    setAudioResults([])

    setAudioProgress({ current: 0, total: selectedLanguages.length, currentTask: 'Starting...' })

    try {
      const results = []
      const currentPoiForAudio = getPoi()
      if (!currentPoiForAudio) {
        throw new Error('POI not found')
      }

      // Generate audio for each selected language
      for (let i = 0; i < selectedLanguages.length; i++) {
        const langCode = selectedLanguages[i]
        const langName = {
          'pt-br': 'Portuguese (BR)',
          'pt-pt': 'Portuguese (PT)',
          'en-us': 'English (US)',
          'en-gb': 'English (UK)',
          'es-es': 'Spanish (ES)',
          'es-us': 'Spanish (US)',
          'de-de': 'German',
          'fr-fr': 'French',
          'it-it': 'Italian',
          'ja-jp': 'Japanese',
          'cmn-cn': 'Chinese',
          'ko-kr': 'Korean',
        }[langCode] || langCode.toUpperCase()

        setAudioProgress({
          current: i + 1,
          total: selectedLanguages.length,
          currentTask: `Generating ${langName} (${selectedGender}) audio...`
        })

        try {
          // Call generate-translated-audio para tradução e geração de áudio
          const { data: result, error: invokeError } = await callFunction('generate-translated-audio', {
            attractionId: currentPoiForAudio.id,
            targetLanguage: langCode,
            voiceGender: selectedGender
          })

          if (invokeError) {
            throw new Error(invokeError.message || 'Failed to generate audio')
          }

          if (!result?.success) {
            throw new Error(result?.error || 'Failed to generate audio')
          }

          results.push(`✅ ${langName} (${selectedGender}): generated successfully`)
        } catch (error) {
          results.push(`❌ ${langName} (${selectedGender}): failed - ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      setAudioProgress({ current: selectedLanguages.length, total: selectedLanguages.length, currentTask: 'Completed!' })
      setAudioResults(results)
      setShowResults(true)

      // Refresh data to show new audios
      setTimeout(() => fetchAdditionalData(), 1000)

    } catch (error) {
      console.error('Error regenerating all audios:', error)
      setAudioResults([`❌ General error: ${error instanceof Error ? error.message : 'Unknown error'}`])
      setShowResults(true)
    } finally {
      setIsGeneratingAudio(false)
      setIsTranslating(false)
      // Reset progress after a delay
      setTimeout(() => {
        setAudioProgress({ current: 0, total: 0, currentTask: '' })
      }, 3000)
    }
  }

  // Generate audio for a single language (SSOT: uses generate-description)
  const generateSingleLanguageAudio = async (language: string, gender: 'male' | 'female') => {
    // Get the session to verify user is authenticated
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      throw new Error('No active session')
    }

    const currentPoiForTranslation2 = getPoi()
    if (!currentPoiForTranslation2) {
       throw new Error('POI not found')
    }

    // SSOT: Use generate-description (masterPackGenerator) for all master description generation
    const { data: result, error: invokeError } = await callFunction('generate-description', {
      poi_id: currentPoiForTranslation2.id,
      language: language,
      gender: gender,
      force: true,
      generate_audio: true
    })

    if (invokeError) {
        throw new Error(invokeError.message || 'Failed to generate translated audio')
    }
    
    if (!result?.success) {
        throw new Error(result?.error || 'Failed to generate translated audio')
    }

    // Refresh data to show the new audio
    setTimeout(() => fetchAdditionalData(), 2000)
  }

  // Delete a translation
  const deleteTranslation = async (translationId: string, language: string, gender: string) => {
    const confirmDelete = await requestConfirm(
      `Are you sure you want to delete the ${language} (${gender}) translation? This action cannot be undone.`
    )
    if (!confirmDelete) return

    try {
      const { error } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .delete()
        .eq('id', translationId)

      if (error) {
        throw new Error(error.message)
      }

      showFeedback('Translation deleted successfully!', 'success')
      await fetchAdditionalData()
    } catch (error) {
      console.error('Error deleting translation:', error)
      showFeedback(`Failed to delete translation: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
    }
  }

  // Regenerate a single translation
  const regenerateTranslation = async (language: string, gender: 'male' | 'female') => {
    if (!currentDescription.trim()) {
      showFeedback('Please save a Portuguese description first.', 'error')
      return
    }

    const confirmRegenerate = await requestConfirm(
      `Regenerar áudio para ${language} (${gender})?\n\nIsso irá substituir o áudio existente.`
    )
    if (!confirmRegenerate) return

    setIsTranslating(true)
    try {
      await generateSingleLanguageAudio(language, gender)
      showFeedback(`Audio regenerated successfully for ${language} (${gender})!`, 'success')
    } catch (error) {
      console.error('Error regenerating translation:', error)
      showFeedback(`Failed to regenerate audio: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
    } finally {
      setIsTranslating(false)
    }
  }

  const handlePolygonComplete = (polygon: any) => {
    const coords = extractPolygonCoordinates(polygon)
    setDrawnPolygon(coords)
    fetchNearbyPOIsWithPolygon(coords)
  }

  // Handle boundary polygon completion (for POI boundary drawing)
  const handleBoundaryPolygonComplete = useCallback((polygon: any) => {
    const coords = extractPolygonCoordinates(polygon)

    // Validate coordinates (shared rule — see poi-boundary-service)
    const validCoords = sanitizeBoundary(coords)

    if (validCoords.length < 3) {
      console.error('❌ Not enough valid coordinates:', validCoords.length)
      showFeedback(`Polígono inválido: apenas ${validCoords.length} pontos válidos (mínimo 3)`, 'error')
      return
    }

    setBoundaryPolygon(validCoords)
  }, [])

  // Debug: Log when handleBoundaryPolygonComplete is created
  useEffect(() => {
  }, [handleBoundaryPolygonComplete])


  if (!shouldRender) return null

  return (
    <div className={`fixed inset-0 z-[100] flex justify-end bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${animateClosing ? 'opacity-0' : 'opacity-100'}`} onClick={onClose}>
      <div className={`w-[85vw] bg-white dark:bg-gray-900 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300 ${animateClosing ? 'animate-out slide-out-to-right ease-in' : ''}`} onClick={(e) => e.stopPropagation()}>
          {/* Feedback Messages */}
          {showSuccessMessage && (
            <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <CheckCircle className="h-5 w-5 text-green-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-green-700 dark:text-green-300">
                    {successMessage}
                  </p>
                </div>
                <div className="ml-auto pl-3">
                  <div className="-mx-1.5 -my-1.5">
                    <button
                      onClick={() => setShowSuccessMessage(false)}
                      className="inline-flex rounded-md bg-green-50 dark:bg-green-900/20 p-1.5 text-green-500 hover:bg-green-100 dark:hover:bg-green-900/40 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 focus:ring-offset-green-50 dark:focus:ring-offset-green-900/20"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {showErrorMessage && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-700 dark:text-red-300">
                    {errorMessage}
                  </p>
                </div>
                <div className="ml-auto pl-3">
                  <div className="-mx-1.5 -my-1.5">
                    <button
                      onClick={() => setShowErrorMessage(false)}
                      className="inline-flex rounded-md bg-red-50 dark:bg-red-900/20 p-1.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 focus:ring-offset-red-50 dark:focus:ring-offset-red-900/20"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Confirm dialog (replaces native window.confirm) */}
          {confirmState && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 p-6">
                <div className="flex items-start gap-3 mb-5">
                  <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded-xl flex-shrink-0">
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-line leading-relaxed pt-1.5">
                    {confirmState.message}
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => resolveConfirm(false)}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >
                    {tCommon('actions.cancel')}
                  </button>
                  <button
                    onClick={() => resolveConfirm(true)}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                  >
                    {tCommon('actions.confirm')}
                  </button>
                </div>
              </div>
            </div>
          )}
            {/* Modal Header - Fixed */}
            <header className="px-8 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-white/80 dark:bg-gray-900/80 backdrop-blur-md z-30">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-tuggi-blue/10 rounded-2xl">
                  <MapPin className="h-6 w-6 text-tuggi-blue" />
                </div>
                <div>
                  <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight leading-none mb-1">
                    {mode === 'create' ? t('actions.create_poi') : (currentPoi?.name || 'POI Details')}
                  </h2>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest leading-none">
                      {mode === 'create' ? 'NOVO REGISTRO' : (currentPoi?.city || 'LATITUDE / LONGITUDE')}
                    </span>
                    {currentPoi?.approved !== undefined && (
                      <div className={cn(
                        "px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border",
                        currentPoi.approved 
                          ? "bg-green-500/10 text-green-500 border-green-500/20" 
                          : "bg-orange-500/10 text-orange-500 border-orange-500/20"
                      )}>
                        {currentPoi.approved ? 'HOMOLOGADO' : 'EM ANÁLISE'}
                      </div>
                    )}

                    {/* Status Toggle (Active/Inactive) */}
                    {currentPoi?.id && mode !== 'create' && (
                      <div className="flex items-center gap-2 px-2 py-1 bg-gray-50 dark:bg-gray-800/55 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm ml-2">
                        <button
                          type="button"
                          onClick={() => handleTogglePoiActive()}
                          disabled={isSaving}
                          className={cn(
                            "relative inline-flex h-4 w-8 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-all duration-300 ease-in-out focus:outline-none ring-offset-2 focus:ring-2 focus:ring-tuggi-blue",
                            (currentPoi.is_active ?? true) ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600",
                            isSaving && "opacity-50 cursor-not-allowed"
                          )}
                          title={(currentPoi.is_active ?? true) ? t('labels.active') : t('labels.inactive')}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-md ring-0 transition duration-300 ease-in-out",
                              (currentPoi.is_active ?? true) ? "translate-x-4" : "translate-x-0"
                            )}
                          />
                        </button>
                        <span className={cn(
                          "text-[9px] font-extrabold uppercase tracking-[0.1em] transition-colors",
                          (currentPoi.is_active ?? true) ? "text-green-600 dark:text-green-400" : "text-gray-400"
                        )}>
                          {(currentPoi.is_active ?? true) ? t('labels.active') : t('labels.inactive')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-3 text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5 rounded-2xl transition-all"
              >
                <X className="h-6 w-6" />
              </button>
            </header>

            <div className="flex-1 flex overflow-hidden">
              {/* Lateral Menu (Sidebar) */}
              <aside className="w-72 bg-white dark:bg-gray-900 border-r border-gray-100/50 dark:border-gray-800 p-6 flex flex-col gap-2 z-20">
                <div className="mb-4">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3">{t('sidebar.navigation')}</span>
                </div>
                
                {mode === 'create' && (
                  <button
                    onClick={() => setActiveTab('create')}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                      activeTab === 'create' 
                        ? 'bg-tuggi-blue text-white' 
                        : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
                    )}
                  >
                    <Plus className={cn("h-5 w-5", activeTab === 'create' && "animate-pulse")} />
                    {t('tabs.create')}
                  </button>
                )}

                {mode === 'view' && (
                  <>
                    <button
                      onClick={() => setActiveTab('details')}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                        activeTab === 'details' 
                          ? 'bg-tuggi-blue text-white' 
                          : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
                      )}
                    >
                      <MapPin className={cn("h-5 w-5", activeTab === 'details' && "animate-pulse")} />
                      {t('tabs.details')}
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
                      {t('labels.geographic_boundaries')}
                    </button>
                    
                    {!(editedPoi?.record_type === 'geofence' || editedPoi?.category === 'geofence') && (
                      <button
                        onClick={() => setActiveTab('trigger-points')}
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                          activeTab === 'trigger-points' 
                            ? 'bg-tuggi-blue text-white' 
                            : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
                        )}
                      >
                        <Target className={cn("h-5 w-5", activeTab === 'trigger-points' && "animate-pulse")} />
                        {t('tabs.trigger_points')}
                      </button>
                    )}

                    <button
                      onClick={() => setActiveTab('group-pois')}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                        activeTab === 'group-pois' 
                          ? 'bg-tuggi-blue text-white' 
                          : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
                      )}
                    >
                      <Layers className={cn("h-5 w-5", activeTab === 'group-pois' && "animate-pulse")} />
                      {t('tabs.group_pois')}
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
                      {t('tabs.description')}
                    </button>
                    
                    <button
                      onClick={() => setActiveTab('narration-audio')}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                        activeTab === 'narration-audio' 
                          ? 'bg-tuggi-blue text-white' 
                          : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
                      )}
                    >
                      <Volume2 className={cn("h-5 w-5", activeTab === 'narration-audio' && "animate-pulse")} />
                      {t('tabs.audio')}
                    </button>
                    
                    <div className="my-4 border-t border-gray-100 dark:border-gray-800" />
                    
                    <button
                      onClick={() => setActiveTab('review')}
                      className={cn(
                        'flex items-center gap-3 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-300 text-left w-full',
                        activeTab === 'review' 
                          ? 'bg-tuggi-blue text-white' 
                          : 'text-gray-500 dark:text-gray-400 hover:text-tuggi-blue hover:bg-tuggi-blue/5'
                      )}
                    >
                      <CheckCircle className={cn("h-5 w-5", activeTab === 'review' && "animate-pulse")} />
                      {t('tabs.review')}
                    </button>
                  </>
                )}
                
                {/* Visual Accent */}
                <div className="mt-auto p-4 bg-gradient-to-br from-tuggi-blue/10 to-transparent rounded-2xl border border-tuggi-blue/5">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="h-4 w-4 text-tuggi-blue" />
                    <span className="text-[10px] font-bold text-tuggi-blue uppercase tracking-widest">Tuggi Engine</span>
                  </div>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 font-medium">{t('sidebar.engine_description')}</p>
                </div>
              </aside>

              {/* Main Content Area */}
              <main className="flex-1 bg-white dark:bg-gray-900 overflow-y-auto custom-scrollbar">
            <POIModalProvider value={{
              getPoi,
              canEdit,
              invalidateAllPOICaches,
              showFeedback,
              requestConfirm,
              boundaryPolygon,
              setBoundaryPolygon,
              existingBoundary,
              isDrawingEnabled,
              setIsDrawingEnabled,
              isSavingBoundary,
              handleBoundaryPolygonComplete,
              handleSaveBoundary,
              handleDeleteBoundary,
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
              isLoading,
              editedPoi,
              descriptions,
              currentDescription,
              setCurrentDescription,
              originalDescription,
              generationLanguage,
              setGenerationLanguage,
              verificationResult,
              referenceLinks,
              setReferenceLinks,
              isGeneratingAudio,
              audioDuration,
              setAudioDuration,
              isGenerating,
              isSavingDescription,
              isSavingReferenceLinks,
              generateDescription,
              resetDescription,
              saveDescriptionAndNextStep,
              saveReferenceLinks,
              currentAudioUrl,
              selectedGender,
              setSelectedGender,
              selectedLanguages,
              setSelectedLanguages,
              isTranslating,
              translatedDescriptions,
              audioProgress,
              audioResults,
              showResults,
              setShowResults,
              regenerateAllAudios,
              regenerateTranslation,
              deleteTranslation,
              fetchAdditionalData,
            } as POIModalContextValue}>
            {activeTab === 'create' ? (
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
                              color: '#FF6B35'
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
                            polygonOptions={{
                              strokeColor: '#FF6B35',
                              strokeOpacity: 0.8,
                              strokeWeight: 3,
                              fillColor: '#FF6B35',
                              fillOpacity: 0.2
                            }}
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
            ) : activeTab === 'details' ? (
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
                            onChange={(e) => setEditedPoi(prev => prev ? ({ ...prev, name: e.target.value }) : null)}
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
                              onChange={(e) => setEditedPoi(prev => prev ? ({ ...prev, city: e.target.value }) : null)}
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
                              onChange={(e) => setEditedPoi(prev => prev ? ({ ...prev, state: e.target.value || null }) : null)}
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
                              onChange={(e) => setEditedPoi(prev => prev ? ({ ...prev, country: e.target.value }) : null)}
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
                              setEditedPoi(prev => {
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
                            onChange={(e) => setEditedPoi(prev => prev ? ({ ...prev, category: e.target.value }) : null)}
                            className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-transparent rounded-xl focus:bg-white focus:ring-2 focus:ring-tuggi-blue transition-all dark:text-white text-sm"
                          >
                            {enhancedCategories.map(category => (
                              <option key={category.value} value={category.value}>
                                {category.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Google Types Badge Cloud */}
                        {getPoi()?.google_types && getPoi()!.google_types!.length > 0 && (
                          <div className="pt-2">
                             <label className="block text-[10px] font-black text-gray-400 uppercase tracking-tighter mb-3 ml-1">
                                {t('labels.google_types', { count: getPoi()!.google_types!.length })}
                              </label>
                            <div className="flex flex-wrap gap-1.5">
                              {getPoi()?.google_types?.slice(0, 8).map((type, index) => (
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
                            onChange={e => setEditedPoi(prev => prev ? ({ ...prev, owner_id: e.target.value }) : null)}
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
                              onChange={e => setEditedPoi(prev => prev ? ({ ...prev, business_status: e.target.value }) : null)}
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
            ) : activeTab === 'boundary' ? (
              <BoundaryTab />
            ) : activeTab === 'description' ? (
              <DescriptionTab />
            ) : activeTab === 'trigger-points' ? (
              <TriggerPointsTab />
            ) : activeTab === 'narration-audio' ? (
              <NarrationAudioTab />
            ) : activeTab === 'group-pois' ? (
              <GroupPoisTab />
            ) : activeTab === 'review' ? (
              <ReviewTab />
            ) : null}
                {/* Footer - Show buttons only for review tab - Now inside main/content area */}
                {activeTab === 'review' && (
                  <div className="bg-gray-50 dark:bg-gray-900 px-8 py-6 border-t border-gray-100 dark:border-gray-800 mt-auto">
                    <div className="flex items-center justify-between">
                      <div></div>
                      <div className="flex items-center space-x-4">
                        <button
                          onClick={onClose}
                          className="px-6 py-3 text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-2xl transition-all uppercase tracking-widest"
                        >
                          {t('actions.cancel')}
                        </button>
                        {!getPoi()?.approved && isAdmin && (
                          <button
                            onClick={handleApprove}
                            disabled={isSaving || !currentDescription.trim() || translatedDescriptions.length === 0}
                            className="inline-flex items-center px-8 py-3 bg-green-600 text-white rounded-2xl font-bold text-sm hover:shadow-xl hover:shadow-green-600/30 transition-all uppercase tracking-widest disabled:opacity-50 active:scale-95"
                          >
                             <CheckCircle className="h-4 w-4 mr-2" />
                             {isSaving ? t('labels.approving') : tCommon('actions.approve')}
                           </button>
                        )}
                        {getPoi()?.approved && isAdmin && (
                          <div className="inline-flex items-center px-6 py-3 text-sm font-bold text-green-700 bg-green-50 border border-green-200 rounded-2xl uppercase tracking-widest">
                             <CheckCircle className="h-4 w-4 mr-2" />
                             {t('labels.poi_approved')}
                           </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
            </POIModalProvider>
              </main>
            </div>
      </div>
    </div>
  )
}