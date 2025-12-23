'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { X, Save, CheckCircle, Trash2, MapPin, ExternalLink, Star, Calendar, User, Globe, Phone, Clock, Target, Info, FileText, Sparkles, RotateCcw, Play, Eye, Volume2, Download, Loader2, Users, Plus, AlertTriangle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getScoreDescription, getScoreColor, getScoreBackgroundColor } from '@/lib/score/compute'
import { formatDate } from '@/lib/utils'
import { POI_CATEGORIES } from '@/constants/poi-importer'
import { TriggerPointsManager } from './TriggerPointsManager'
import { GoogleMapComponent, extractPolygonCoordinates } from '@/components/ui/GoogleMapComponent'
import { VerificationBadge } from '@/components/verification/VerificationBadge'
import { getFullSizeImageUrl } from '@/lib/imageUtils'

export interface POI {
  id: string
  name: string
  city: string
  country: string
  state: string | null
  category: string
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

export function POIDetailsModal({ poi, isOpen, onClose, onUpdate, onPOIUpdated, onPOIDeleted, mode = 'view' }: POIDetailsModalProps) {
  // Determine if we're in create mode: no POI or POI without ID
  const isCreateMode = !poi || !poi.id || mode === 'create'
  const [currentPoi, setCurrentPoi] = useState<POI | null>(poi)
  const [editedPoi, setEditedPoi] = useState<POI | null>(poi)

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
  const [activeTab, setActiveTab] = useState<'create' | 'details' | 'description' | 'trigger-points' | 'narration-audio' | 'group-pois' | 'review'>(isCreateMode ? 'create' : 'details')

  // Create mode state
  const [createName, setCreateName] = useState('')
  const [createCoordinates, setCreateCoordinates] = useState<{ lat: number; lng: number } | null>(null)
  const [createLocation, setCreateLocation] = useState<{ city: string | null; state: string | null; country: string | null; formatted_address?: string | null } | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isGeocoding, setIsGeocoding] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createBoundary, setCreateBoundary] = useState<Array<{ lat: number; lng: number }> | null>(null)
  const [isEnrichingOSM, setIsEnrichingOSM] = useState(false)
  const [cmsUserRole, setCmsUserRole] = useState<string | null>(null)

  // Boundary drawing state
  const [boundaryPolygon, setBoundaryPolygon] = useState<Array<{ lat: number; lng: number }> | null>(null)
  const [isSavingBoundary, setIsSavingBoundary] = useState(false)
  const [existingBoundary, setExistingBoundary] = useState<Array<{ lat: number; lng: number }> | null>(null)

  // Update state when poi changes
  useEffect(() => {
    if (poi) {
      setCurrentPoi(poi)
      setEditedPoi(poi)
    } else {
      setCurrentPoi(null)
      setEditedPoi(null)
    }
  }, [poi])

  // Fetch CMS user role (for client-side UI decisions)
  useEffect(() => {
    const fetchRole = async () => {
      try {
        const res = await fetch('/api/auth/check')
        if (!res.ok) return
        const data = await res.json()
        setCmsUserRole(data?.user?.role || null)
      } catch (err) {
        console.warn('Failed to fetch cms user role:', err)
      }
    }
    fetchRole()
  }, [])

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
      setCreateError('Nome é obrigatório')
      return
    }

    if (!createCoordinates) {
      setCreateError('Por favor, selecione uma localização no mapa')
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
          boundary: createBoundary // Enviar boundary se foi desenhado
        })
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Falha ao criar POI')
      }

      // Update modal with created POI
      const createdPOI: POI = {
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

      // Call update callbacks
      if (onUpdate) onUpdate()
      if (onPOIUpdated) onPOIUpdated(createdPOI)

      // Reset create mode state
      setCreateName('')
      setCreateCoordinates(null)
      setCreateLocation(null)
    } catch (error) {
      console.error('Error creating POI:', error)
      setCreateError(error instanceof Error ? error.message : 'Erro ao criar POI')
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
        alert('POI enriquecido com sucesso!')
      } else {
        throw new Error(result.error || 'Falha ao enriquecer POI')
      }
    } catch (error) {
      console.error('Error enriching POI:', error)
      alert(error instanceof Error ? error.message : 'Erro ao enriquecer POI')
    } finally {
      setIsEnrichingOSM(false)
    }
  }

  // Description editing state
  const [currentDescription, setCurrentDescription] = useState('')
  const [originalDescription, setOriginalDescription] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSavingDescription, setIsSavingDescription] = useState(false)
  const [isSavingReferenceLinks, setIsSavingReferenceLinks] = useState(false)
  const [descriptionStats, setDescriptionStats] = useState({ play_count: 0, last_played_at: null })

  // Audio narration state
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null)
  const [audioMetadata, setAudioMetadata] = useState<{ fileName?: string, size?: number, lastUpdated?: string } | null>(null)
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false)
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null)
  const [selectedVoice, setSelectedVoice] = useState<string>('shimmer')
  const [audioSpeed, setAudioSpeed] = useState<number>(1.2)
  const [audioProvider, setAudioProvider] = useState<'openai' | 'google'>('google')

  // Translation state
  const [selectedLanguage, setSelectedLanguage] = useState<string>('en-us')
  const [selectedGender, setSelectedGender] = useState<'male' | 'female'>('male')
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
    issues: string[];
    improvement_suggestion: string;
    improvement_applied: boolean;
  } | null>(null)

  // UI state
  const [showAdvancedInfo, setShowAdvancedInfo] = useState(false)

  // Grouping state
  const [nearbyPOIs, setNearbyPOIs] = useState<any[]>([])
  const [selectedPOIs, setSelectedPOIs] = useState<string[]>([])
  const [groupInfo, setGroupInfo] = useState<any>(null)
  const [groupLoading, setGroupLoading] = useState(false)
  const [groupName, setGroupName] = useState(poi?.name || '') // Default to main POI name
  const [drawnPolygon, setDrawnPolygon] = useState<Array<{ lat: number; lng: number }> | null>(null)

  const supabase = useSupabaseClient<any>()

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

  // Voice mapping for Google TTS
  const googleVoiceMap: Record<string, string> = {
    shimmer: 'pt-BR-Wavenet-B',
    nova: 'pt-BR-Wavenet-A',
    alloy: 'pt-BR-Wavenet-D',
    echo: 'pt-BR-Wavenet-E',
  }

  const fetchAdditionalData = useCallback(async () => {
    const currentPoi = getPoi()
    if (!currentPoi) return // Skip if no POI (creation mode)

    setIsLoading(true)
    try {
      // Fetch descriptions with cache busting
      const { data: descriptionsData } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('*')
        .or(`attraction_id.eq.${currentPoi.id},group_id.in.(${groupInfo?.id || ''})`)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })

      setDescriptions(descriptionsData || [])

      // Separate Portuguese descriptions from translations
      const portugueseDescriptions = descriptionsData?.filter(desc =>
        desc.language === 'pt-br' || desc.language === 'pt' || desc.language?.toLowerCase().includes('pt')
      ) || []

      const translations = descriptionsData?.filter(desc =>
        desc.language !== 'pt-br' && desc.language !== 'pt' && !desc.language?.toLowerCase().includes('pt')
      ) || []

      // Include ALL descriptions with audio_url in the available audios list
      const allAudiosAvailable = descriptionsData?.filter(desc => desc.audio_url) || []
      setTranslatedDescriptions(allAudiosAvailable)

      // Debug: Log the fetched descriptions
      console.log('🔍 Fetched descriptions for POI:', currentPoi.id, descriptionsData?.length || 0)
      descriptionsData?.forEach((desc, index) => {
        console.log(`  ${index + 1}. ID: ${desc.id}, Language: ${desc.language}, Attraction: ${desc.attraction_id}, Updated: ${desc.updated_at}`)
      })
      console.log('🔍 Portuguese descriptions:', portugueseDescriptions?.length || 0)
      console.log('🔍 Translations:', translations?.length || 0)

      // Prefer group description/audio if available, then most recently updated
      let currentDesc = null
      if (groupInfo && groupInfo.id) {
        currentDesc = portugueseDescriptions?.find(desc => desc.group_id === groupInfo.id)
        console.log('🔍 Using group description:', currentDesc?.id)
      }
      if (!currentDesc) {
        // Fallback to individual POI description - get the most recently updated one
        const individualDescriptions = portugueseDescriptions?.filter(desc => desc.attraction_id === currentPoi.id) || []
        console.log('🔍 Found individual descriptions:', individualDescriptions.length)
        individualDescriptions.forEach((desc, index) => {
          console.log(`  ${index + 1}. ID: ${desc.id}, Updated: ${desc.updated_at}, Created: ${desc.created_at}`)
        })

        if (individualDescriptions.length > 0) {
          // Sort by updated_at to get the most recent
          individualDescriptions.sort((a, b) => {
            const dateA = new Date(a.updated_at || a.created_at)
            const dateB = new Date(b.updated_at || b.created_at)
            return dateB.getTime() - dateA.getTime()
          })
          currentDesc = individualDescriptions[0]
          console.log('🔍 Selected most recent individual description:', currentDesc.id)
        } else {
          currentDesc = portugueseDescriptions?.[0] || descriptionsData?.[0]
          console.log('🔍 Using fallback description:', currentDesc?.id)
        }
      }

      console.log('🔍 Selected description:', currentDesc)

      if (currentDesc && currentDesc.description) {
        console.log('✅ Loading description from DB:', currentDesc.description.substring(0, 100) + '...')
        console.log('🔍 Description ID:', currentDesc.id, 'Updated at:', currentDesc.updated_at)
        setCurrentDescription(currentDesc.description || '')
        setOriginalDescription(currentDesc.description || '')
        setDescriptionStats({
          play_count: currentDesc.play_count || 0,
          last_played_at: currentDesc.last_played_at
        })

        // Load audio information
        if (currentDesc.audio_url) {
          setCurrentAudioUrl(currentDesc.audio_url)
          // Extract metadata from URL/path
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
        // Found a description record but description field is empty
        console.log('⚠️ Found description record but description field is empty:', currentDesc)
        setCurrentDescription('')
        setOriginalDescription('')
        setDescriptionStats({
          play_count: currentDesc.play_count || 0,
          last_played_at: currentDesc.last_played_at
        })

        // Still load audio information if it exists
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
        // No description record found at all
        console.log('❌ No description record found for POI:', currentPoi.id)
        setCurrentDescription('')
        setOriginalDescription('')
        setDescriptionStats({ play_count: 0, last_played_at: null })
        setCurrentAudioUrl(null)
        setAudioMetadata(null)
      }

      // Fetch additional images
      const { data: imagesData } = await supabase
        .schema('core')
        .from('attraction_image')
        .select('*')
        .eq('attraction_id', getPoi()?.id || '')
        .order('created_at', { ascending: false })

      setImages(imagesData || [])
    } catch (error) {
      console.error('Error fetching additional data:', error)
    } finally {
      setIsLoading(false)
    }
  }, [getPoi, groupInfo?.id, supabase])

  const fetchNearbyPOIs = useCallback(async () => {
    console.log('🔍 MODAL: fetchNearbyPOIs called');
    // Only fetch nearby POIs when a polygon is drawn
    // The initial load will be empty until user draws a polygon
    setNearbyPOIs([])
    console.log('🔍 MODAL: Set nearbyPOIs to empty array');
  }, [])

  const fetchGroupInfo = useCallback(async () => {
    const currentPoi = getPoi()
    if (!currentPoi) return // Skip if no POI (creation mode)

    console.log('🔍 MODAL: fetchGroupInfo called for POI:', currentPoi.id);
    setGroupLoading(true)
    try {
      const res = await fetch(`/api/attraction-groups/of-poi?poiId=${currentPoi.id}`)
      const data = await res.json()

      console.log('🔍 MODAL: API response:', data);

      setGroupInfo(data.group)
      setGroupName(data.group?.name || currentPoi.name) // Use main POI name as default

      // Always include the main POI in selectedPOIs, plus any existing group members
      const members = data.members || []
      const selectedPOIsList = members.includes(currentPoi.id) ? members : [currentPoi.id, ...members]

      console.log('🔍 MODAL: Setting selectedPOIs to:', selectedPOIsList);
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
      console.log('🔍 Buscando dados de verificação para POI:', currentPoi.id);

      // Usar a view existente v_descriptions_with_last_score que já consolida os dados
      const { data: descData, error: descError } = await supabase
        .schema('core')
        .from('v_descriptions_with_last_score')
        .select('*')
        .eq('attraction_id', getPoi()?.id || '')
        .eq('language', 'pt-BR')
        .eq('is_original', true)
        .maybeSingle();

      if (descError) {
        console.error('❌ Erro ao buscar descrição:', descError);
        return;
      }

      if (!descData) {
        console.log('ℹ️ Nenhuma descrição encontrada para este POI');
        return;
      }

      console.log('✅ Descrição encontrada:', descData.id);

      // Agora buscar o score mais recente para esta descrição
      const { data: scoresData, error: scoresError } = await supabase
        .schema('core')
        .from('description_scores')
        .select(`
          id,
          description_id,
          attraction_id,
          score_overall,
          subscores,
          flags,
          confidence,
          created_at,
          description_claims (
            id,
            claim_text,
            claim_type,
            status,
            confidence
          )
        `)
        .eq('description_id', descData.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (scoresError) {
        console.error('❌ Erro ao buscar scores:', scoresError);
        return;
      }

      if (scoresData) {
        console.log('✅ Score encontrado na tabela description_scores:', scoresData);

        // Score já está em escala de 0-100
        const score = scoresData.score_overall || 0;

        // Verificar se o score é aprovado (>= 70)
        const isApproved = score >= 70;

        // Extrair fatos verificáveis das claims
        const verifiableFacts = scoresData.description_claims
          ?.filter(claim => claim.status === 'supported')
          .map(claim => claim.claim_text) || [];

        // Extrair datas das claims
        const detectedDates = scoresData.description_claims
          ?.filter(claim => claim.claim_type === 'year')
          .map(claim => claim.claim_text) || [];

        // Classificar datas como confiáveis ou moderadas
        const reliableDates = detectedDates.filter(date => /^\d{4}$/.test(date)); // Anos completos são confiáveis
        const moderateDates = detectedDates.filter(date => !/^\d{4}$/.test(date)); // Outros formatos são moderados

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

        // Definir datas detectadas para exibição
        if (detectedDates.length > 0) {
          setDetectedDates({
            dates: detectedDates,
            reliable: reliableDates,
            moderate: moderateDates,
            total: detectedDates.length
          });
        }

        console.log('✅ Dados de verificação carregados:', {
          score,
          approved: isApproved,
          facts: verifiableFacts.length,
          dates: detectedDates.length
        });
      } else {
        console.log('ℹ️ Nenhum score encontrado na tabela description_scores');

        // Usar o score da própria descrição que já buscamos
        if (descData?.verification_score) {
          // Se tiver score na tabela attraction_descriptions, usar esse valor
          // Converter score de 0-1 para 0-100
          const score = Math.round((descData.verification_score || 0) * 100);
          const isApproved = descData.verification_status === 'verified' || score >= 70;

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

          console.log('✅ Usando score da tabela attraction_descriptions:', score, 'Status:', descData.verification_status, 'Aprovado:', isApproved);
        } else {
          console.log('ℹ️ Nenhum dado de verificação encontrado');
          // Limpar o resultado de verificação para não mostrar dados antigos
          setVerificationResult(null);
        }
      }
    } catch (error) {
      console.error('❌ Erro ao buscar dados de verificação:', error);
    }
  }, [supabase, getPoi]);

  // useEffect hooks after function declarations
  useEffect(() => {
    if (isOpen) {
      console.log('🔄 Modal aberto: carregando dados...');
      setEditedPoi(poi)
      fetchAdditionalData()

      // Garantir que os dados de verificação sejam buscados após os dados da descrição
      setTimeout(() => {
        console.log('🔄 Buscando dados de verificação após carregar descrição...');
        fetchVerificationData()
      }, 500)
    } else {
      // Limpar dados de verificação quando o modal for fechado
      setVerificationResult(null);
      setDetectedDates(null);
    }
  }, [poi, isOpen, fetchAdditionalData, fetchVerificationData])

  // Fetch existing boundary from database
  const fetchBoundary = useCallback(async () => {
    const currentPoi = getPoi();
    if (!currentPoi?.id) return;

    try {
      // Use RPC or raw query to convert GEOGRAPHY to GeoJSON
      // Since Supabase client doesn't directly support ST_AsGeoJSON, we'll use a workaround
      const { data: coordData, error } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('boundary_type, boundary_area_m2, boundary_centroid_lat, boundary_centroid_lng')
        .eq('attraction_id', getPoi()?.id || '')
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching boundary metadata:', error);
        return;
      }

      // If boundary exists, fetch the geometry using a custom query
      if (coordData?.boundary_type) {
        try {
          // Use RPC function to get boundary as GeoJSON (function is in core schema)
          const { data: geoJsonData, error: geoJsonError } = await supabase
            .schema('core')
            .rpc('get_boundary_geometry', { p_attraction_id: currentPoi.id });

          if (!geoJsonError && geoJsonData) {
            const geoJson = typeof geoJsonData === 'string' ? JSON.parse(geoJsonData) : geoJsonData;

            // Extract coordinates from GeoJSON Polygon
            if (geoJson?.type === 'Polygon' && geoJson.coordinates?.[0]) {
              const coords = geoJson.coordinates[0].map(([lng, lat]: [number, number]) => ({
                lat,
                lng
              }));
              setExistingBoundary(coords);
              setBoundaryPolygon(coords);
              console.log('✅ Loaded existing boundary:', coords.length, 'points');
            }
          } else {
            // Fallback: Try direct query (may not work if boundary_geometry is GEOGRAPHY)
            const { data: directData } = await supabase
              .schema('core')
              .from('attraction_coordinate')
              .select('boundary_geometry')
              .eq('attraction_id', getPoi()?.id || '')
              .single();

            if (directData?.boundary_geometry) {
              let geoJson: any;
              if (typeof directData.boundary_geometry === 'string') {
                geoJson = JSON.parse(directData.boundary_geometry);
              } else {
                geoJson = directData.boundary_geometry;
              }

              if (geoJson?.type === 'Polygon' && geoJson.coordinates?.[0]) {
                const coords = geoJson.coordinates[0].map(([lng, lat]: [number, number]) => ({
                  lat,
                  lng
                }));
                setExistingBoundary(coords);
                setBoundaryPolygon(coords);
                console.log('✅ Loaded existing boundary (fallback):', coords.length, 'points');
              }
            }
          }
        } catch (parseError) {
          console.error('Error parsing boundary geometry:', parseError);
        }
      }
    } catch (error) {
      console.error('Error fetching boundary:', error);
    }
  }, [getPoi]);

  // Fetch nearby POIs and group info on open
  useEffect(() => {
    if (isOpen && poi?.id && poi?.coordinates) {
      fetchNearbyPOIs()
      fetchGroupInfo()
      fetchBoundary()
    }
  }, [isOpen, poi?.id, fetchNearbyPOIs, fetchGroupInfo, fetchBoundary])

  // Debug effect for Group POIs tab
  useEffect(() => {
    if (activeTab === 'group-pois') {
      const currentPoi = getPoi()
      console.log('🔍 MODAL: Group POIs tab active');
      console.log('🔍 MODAL: POI coordinates:', currentPoi?.coordinates);
      console.log('🔍 MODAL: Current state:', {
        nearbyPOIs: nearbyPOIs.length,
        selectedPOIs,
        groupInfo,
        groupName
      });
    }
  }, [activeTab, getPoi, nearbyPOIs, selectedPOIs, groupInfo, groupName])

  const handleTogglePOI = (id: string) => {
    console.log('🔍 MODAL: handleTogglePOI called with id:', id);
    console.log('🔍 MODAL: Current selectedPOIs:', selectedPOIs);

    setSelectedPOIs(prev => {
      const newSelection = prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
      console.log('🔍 MODAL: New selectedPOIs:', newSelection);
      return newSelection
    })
  }

  const handleSaveGroup = async () => {
    const currentPoi = getPoi()
    if (!currentPoi) {
      alert('POI não encontrado')
      return
    }

    console.log('🔍 MODAL: handleSaveGroup called');
    console.log('🔍 MODAL: Current state:', { groupInfo, groupName, selectedPOIs, poiId: currentPoi.id });

    setGroupLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      console.log('🔍 MODAL: Current user:', user?.id);

      // Always include the main POI in the group
      const poiIds = [currentPoi.id, ...selectedPOIs.filter(id => id !== currentPoi.id)]
      console.log('🔍 MODAL: POI IDs to save:', poiIds);

      const requestBody = {
        groupId: groupInfo?.id,
        name: groupName || currentPoi.name,
        poiIds: poiIds,
        userId: user?.id
      }
      console.log('🔍 MODAL: Request body:', requestBody);

      const res = await fetch('/api/attraction-groups/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      console.log('🔍 MODAL: API response status:', res.status);

      if (!res.ok) {
        const errorText = await res.text();
        console.error('❌ MODAL: API error response:', errorText);
        throw new Error(`Failed to save group: ${errorText}`)
      }

      const responseData = await res.json();
      console.log('🔍 MODAL: API response data:', responseData);

      await fetchGroupInfo()
      await onUpdate()
      alert('Group saved!')
    } catch (e) {
      console.error('❌ MODAL: Error in handleSaveGroup:', e);
      alert(`Failed to save group: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setGroupLoading(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      // Check if this is a homolog POI (from homolog.pois table)
      const isHomologPOI = !!(poi as any)._homologData

      const currentPoi = getPoi()
      if (!currentPoi || !editedPoi) {
        alert('POI não encontrado')
        return
      }

      if (isHomologPOI) {
        // Use API route for homolog POIs
        // Note: homolog.pois has both 'category' and 'primary_category' fields
        // We'll update both to keep them in sync
        const updates: any = {
          name: editedPoi.name,
          city: editedPoi.city,
          country: editedPoi.country,
          state: editedPoi.state,
          updated_at: new Date().toISOString()
        }

        // Update category field (primary_category is the main field, but category is also used)
        if (editedPoi.category) {
          updates.category = editedPoi.category
          updates.primary_category = editedPoi.category
        } else if ((currentPoi as any)._homologData?.primary_category) {
          // Keep existing primary_category if category is not provided
          updates.primary_category = (currentPoi as any)._homologData.primary_category
        }

        const response = await fetch('/api/supabase/pois/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: currentPoi.id, updates })
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Update failed')
        }
      } else {
        // Use direct Supabase for core.attractions POIs
        const { error } = await supabase
          .schema('core')
          .from('attractions')
          .update({
            name: editedPoi.name,
            category: editedPoi.category,
            city: editedPoi.city,
            country: editedPoi.country,
            updated_at: new Date().toISOString(),
            reference_links: referenceLinks.filter(link => !!link.trim()) // Save only non-empty links
          })
          .eq('id', getPoi()?.id)

        if (error) throw error
      }

      // Update local state instead of reloading all data
      const currentPoiData = getPoi()
      if (!currentPoiData || !editedPoi) return

      const updatedPOI: POI = {
        ...currentPoiData, // Keep original POI data
        ...editedPoi, // Merge with edited fields
        updated_at: new Date().toISOString(),
        id: currentPoiData.id // Ensure id is always present
      }
      if (onPOIUpdated) {
        onPOIUpdated(updatedPOI)
      } else {
        await onUpdate()
      }
      onClose()
    } catch (error) {
      console.error('Error saving POI:', error)
      alert(`Erro ao salvar POI: ${error instanceof Error ? error.message : 'Erro desconhecido'}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleApprove = async () => {
    const currentPoi = getPoi()
    if (!currentPoi) {
      alert('POI não encontrado')
      return
    }

    setIsSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      console.log('🔍 Approving POI:', {
        poiId: currentPoi.id,
        poiName: currentPoi.name,
        currentUserId: user?.id,
        poiUserId: currentPoi.user_id,
        isApproved: currentPoi.approved
      })

      // Check if this is a homolog POI (from homolog.pois table)
      const isHomologPOI = !!(poi as any)._homologData

      if (isHomologPOI) {
        // Use API route for homolog POIs
        // Note: homolog.pois only has 'approved' field (boolean), not approved_by or approved_at
        const updates = {
          approved: true
        }

        const response = await fetch('/api/supabase/pois/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: currentPoi.id, updates })
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Update failed')
        }
      } else {
        // Use direct Supabase for core.attractions POIs
        const { error } = await supabase
          .schema('core')
          .from('attractions')
          .update({
            approved: true,
            approved_by: user?.id,
            approved_at: new Date().toISOString()
          })
          .eq('id', currentPoi.id)

        if (error) {
          console.error('❌ Supabase error:', error)
          throw error
        }
      }

      console.log('✅ POI approved successfully')

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
      if (onPOIUpdated) {
        onPOIUpdated(updatedPOI as POI)
      } else {
        await onUpdate()
      }
      onClose()
    } catch (error) {
      console.error('Error approving POI:', error)
      // Show user-friendly error message
      alert(`Erro ao aprovar POI: ${error instanceof Error ? error.message : 'Erro desconhecido'}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    const currentPoi = getPoi()
    if (!currentPoi) {
      alert('POI não encontrado')
      return
    }

    if (!window.confirm('Are you sure you want to delete this POI? This action cannot be undone.')) {
      return
    }

    setIsSaving(true)
    try {
      // Check if this is a homolog POI (from homolog.pois table)
      const isHomologPOI = !!(currentPoi as any)._homologData

      if (isHomologPOI) {
        // Use API route for homolog POIs
        const response = await fetch('/api/supabase/pois/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [currentPoi.id] })
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Delete failed')
        }
      } else {
        // Use direct Supabase for core.attractions POIs
        const { error } = await supabase
          .schema('core')
          .from('attractions')
          .delete()
          .eq('id', currentPoi.id)

        if (error) throw error
      }

      // Notify parent component about deletion instead of reloading all data
      if (onPOIDeleted) {
        onPOIDeleted(currentPoi.id)
      } else {
        await onUpdate()
      }
      onClose()
    } catch (error) {
      console.error('Error deleting POI:', error)
      alert(`Erro ao excluir POI: ${error instanceof Error ? error.message : 'Erro desconhecido'}`)
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
      alert('POI não encontrado')
      return
    }

    console.log('🚀 POI MODAL: Starting description generation with new Gemini Description Service...')
    setIsGenerating(true)
    try {
      // Buscar ID da descrição existente para persistir verificação
      let existingDescriptionId = null;
      const { data: existingDesc } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('id')
        .eq('attraction_id', getPoi()?.id || '')
        .eq('language', 'pt-br')
        .order('updated_at', { ascending: false })
        .maybeSingle();

      if (existingDesc) {
        console.log('🔍 Encontrado ID de descrição existente:', existingDesc.id);
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


      console.log('📡 POI MODAL: Making request to generate-description Edge Function')

      const { data: result, error: invokeError } = await supabase.functions.invoke('generate-description', {
        body: {
          poi_id: currentPoi.id,
          language: 'pt-br',
          raw_context: additionalContext.trim() || undefined,
          force: true // Force fresh generation as it's an explicit action in CMS
        }
      })

      if (invokeError) {
        console.error('❌ POI MODAL: Edge Function error:', invokeError)
        throw new Error(`Failed to generate description: ${invokeError.message || 'Unknown error'}`)
      }

      if (!result?.success) {
        throw new Error(result?.error || 'Falha ao gerar descrição')
      }

      const generatedData = result.data
      console.log('✅ POI MODAL: Description generated successfully with Edge Function:', generatedData)

      // Show feedback about generation
      showFeedback('✅ Descrição mestre gerada com sucesso. O áudio está sendo processado em background.', 'success')

      // Handle facts if returned
      if (generatedData.facts_pack_json) {
        console.log('📊 Fatos extraídos:', generatedData.facts_pack_json)
      }

      // Reset verification since it's a new master version
      setVerificationResult(null)

      // Analyze historical dates in the generated description
      const detectedDatesArray = detectHistoricalDates(generatedData.description)
      if (detectedDatesArray.length > 0) {
        const dateClassification = classifyDateReliability(detectedDatesArray)
        setDetectedDates({
          dates: detectedDatesArray,
          reliable: dateClassification.reliable,
          moderate: dateClassification.moderate,
          total: dateClassification.total
        })

        console.log('📅 Historical dates detected:', {
          total: dateClassification.total,
          reliable: dateClassification.reliable.length,
          moderate: dateClassification.moderate.length,
          dates: detectedDatesArray
        })
      } else {
        setDetectedDates(null)
      }

      setCurrentDescription(generatedData.description)
    } catch (error) {
      console.error('Error generating description:', error)
      alert('Failed to generate description. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  const saveReferenceLinks = async () => {
    setIsSavingReferenceLinks(true)
    try {
      // Check if this is a homolog POI (from homolog.pois table)
      const isHomologPOI = !!(poi as any)._homologData

      if (isHomologPOI) {
        showFeedback('Reference links can only be saved for core attractions, not homolog POIs.', 'error')
        return
      }

      const validLinks = referenceLinks.filter(link => !!link.trim())

      if (validLinks.length === 0) {
        showFeedback('Please add at least one reference link before saving.', 'error')
        return
      }

      console.log('💾 Saving reference links:', validLinks)
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
        console.log('✅ Reference links saved successfully')
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
      // Look for existing Portuguese description first
      const { data: existingDescs } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('*')
        .eq('attraction_id', getPoi()?.id || '')
        .eq('language', 'pt-br')
        .maybeSingle()

      console.log('🔍 Existing description found:', !!existingDescs)
      if (existingDescs) {
        console.log('📝 Existing description:', existingDescs.description?.substring(0, 100) + '...')
        console.log('📝 Current description:', currentDescription.substring(0, 100) + '...')
      }

      // Check if description has changed
      const descriptionChanged = existingDescs && existingDescs.description !== currentDescription
      console.log('🔄 Description changed:', descriptionChanged)

      if (existingDescs) {
        console.log('🔄 Updating existing description for POI:', getPoi()?.id)
        console.log('📝 New description:', currentDescription.substring(0, 100) + '...')
        console.log('🔍 Updating description ID:', existingDescs.id)

        // Update existing Portuguese description
        const { data: updateResult, error } = await supabase
          .schema('core')
          .from('attraction_descriptions')
          .update({
            description: currentDescription,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingDescs.id) // Use the specific ID instead of attraction_id + language
          .select()

        if (error) {
          console.error('❌ Error updating description:', error)
          throw error
        }

        console.log('✅ Description updated successfully:', updateResult)

        // Verify the update by fetching the record again
        const { data: verifyData, error: verifyError } = await supabase
          .schema('core')
          .from('attraction_descriptions')
          .select('*')
          .eq('id', existingDescs.id)
          .single()

        if (verifyError) {
          console.error('❌ Error verifying update:', verifyError)
        } else {
          console.log('🔍 Verification - Updated description:', verifyData?.description?.substring(0, 100) + '...')
        }
      } else {
        const currentPoiForDesc = getPoi()
        if (!currentPoiForDesc) return
        console.log('🆕 Creating new description for POI:', currentPoiForDesc.id)
        console.log('📝 New description:', currentDescription.substring(0, 100) + '...')
        // Create new Portuguese description
        const { error } = await supabase
          .schema('core')
          .from('attraction_descriptions')
          .insert({
            attraction_id: currentPoiForDesc.id,
            language: 'pt-br', // Brazilian Portuguese
            description: currentDescription,
            play_count: 0
          })

        if (error) throw error
        console.log('✅ New description created successfully')
      }

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
        const shouldRegenerate = window.confirm(
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

  // New function to save description and generate audios
  const saveDescriptionAndGenerateAudios = async () => {
    if (!currentDescription.trim()) {
      showFeedback('Description cannot be empty.', 'error')
      return
    }

    setIsSavingDescription(true)
    setIsGeneratingAudio(true)
    setIsTranslating(true)

    try {
      // First, save the description (reuse the logic from saveDescription)
      const { data: existingDescs } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('*')
        .eq('attraction_id', getPoi()?.id || '')
        .eq('language', 'pt-br')
        .maybeSingle()

      if (existingDescs) {
        // Update existing Portuguese description
        const { error } = await supabase
          .schema('core')
          .from('attraction_descriptions')
          .update({
            description: currentDescription,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingDescs.id)
          .select()

        if (error) throw error
      } else {
        // Create new Portuguese description
        const currentPoiForAudioInsert = getPoi()
        if (!currentPoiForAudioInsert) {
          alert('POI não encontrado. Por favor, recarregue a página.')
          return
        }
        const { error } = await supabase
          .schema('core')
          .from('attraction_descriptions')
          .insert({
            attraction_id: currentPoiForAudioInsert.id,
            language: 'pt-br',
            description: currentDescription,
            play_count: 0
          })

        if (error) throw error
      }

      // Update original description to match current
      setOriginalDescription(currentDescription)

      // Update the descriptions array locally
      const currentPoiForDescUpdate2 = getPoi()
      if (!currentPoiForDescUpdate2) return
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

      // Now generate all audios
      setAudioProgress({ current: 0, total: 3, currentTask: 'Starting audio generation...' })
      setAudioResults([])

      const languages = [
        { code: 'pt-br', name: 'Portuguese' },
        { code: 'en-us', name: 'English' },
        { code: 'es-es', name: 'Spanish' }
      ]

      const results = []

      // Generate Portuguese audio (base language)
      setAudioProgress({ current: 1, total: 3, currentTask: 'Generating Portuguese audio...' })
      try {
        await generateAudioNarration()
        results.push('✅ Portuguese: audio generated successfully')
      } catch (error) {
        results.push(`❌ Portuguese: failed - ${error instanceof Error ? error.message : 'Unknown error'}`)
      }

      // Generate translations for EN and ES (male only)
      for (let i = 0; i < languages.slice(1).length; i++) {
        const lang = languages.slice(1)[i]
        setAudioProgress({
          current: i + 2,
          total: 3,
          currentTask: `Generating ${lang.name} (male) audio...`
        })

        try {
          await generateSingleLanguageAudio(lang.code, 'male')
          results.push(`✅ ${lang.name} (male): generated successfully`)
        } catch (error) {
          results.push(`❌ ${lang.name} (male): failed - ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      setAudioProgress({ current: 3, total: 3, currentTask: 'Completed!' })
      setAudioResults(results)
      setShowResults(true)

      showFeedback('Description saved and audios generated successfully!', 'success')

      // Buscar dados de verificação atualizados após salvar
      setTimeout(() => {
        fetchVerificationData()
      }, 1000) // Pequeno delay para garantir que os dados estejam atualizados no banco
    } catch (error) {
      console.error('Error saving description and generating audios:', error)
      showFeedback('Failed to save description and generate audios. Please try again.', 'error')
    } finally {
      setIsSavingDescription(false)
      setIsGeneratingAudio(false)
      setIsTranslating(false)
      // Reset progress after a delay
      setTimeout(() => {
        setAudioProgress({ current: 0, total: 0, currentTask: '' })
      }, 3000)
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
        const proceed = window.confirm(
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
      const confirmReplace = window.confirm(
        'This will replace the existing audio narration. Are you sure you want to continue?\n\n' +
        'Note: You can adjust the voice and speed settings below before regenerating.'
      )
      if (!confirmReplace) {
        return
      }
    }

    setIsGeneratingAudio(true)
    try {
      // Step 1: Generate audio using selected provider
      const voiceToSend = audioProvider === 'google' ? googleVoiceMap[selectedVoice] || 'pt-BR-Wavenet-A' : selectedVoice;
      const ttsResponse = await fetch('/api/audio/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: textForAudio,
          attractionId: getPoi()?.id || '',
          voice: voiceToSend,
          speed: audioSpeed,
          provider: audioProvider
        })
      })

      if (!ttsResponse.ok) {
        throw new Error('Failed to generate audio')
      }

      const ttsData = await ttsResponse.json()

      // Step 2: Upload audio to Supabase Storage using invoke
      const { data: uploadData, error: uploadError } = await supabase.functions.invoke('store-poi-audio', {
        body: {
          attractionId: getPoi()?.id || '',
          audioData: ttsData.audioData,
          mimeType: ttsData.mimeType,
          language: 'pt-br'
        }
      })

      if (uploadError) {
        console.error('❌ POI MODAL: Store Audio Edge Function error:', uploadError)
        throw new Error(`Failed to upload audio: ${uploadError.message || 'Unknown error'}`)
      }

      if (!uploadData?.success) {
        throw new Error(uploadData?.error || 'Failed to upload audio')
      }

      // Step 3: Update UI with new audio
      setCurrentAudioUrl(uploadData.audio.url)
      setAudioMetadata({
        fileName: uploadData.audio.storage_path.split('/').pop(),
        size: uploadData.audio.size,
        lastUpdated: new Date().toISOString()
      })

      // Refresh descriptions to get updated audio_url
      await fetchAdditionalData()

    } catch (error) {
      console.error('Error generating audio narration:', error)
      alert(`Failed to generate audio narration: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
  const translateAndGenerateAudio = async () => {
    // Validation: Check if Portuguese base description exists
    if (!currentDescription.trim()) {
      showFeedback('Please save an original description first before generating translations.', 'error')
      return
    }

    // Validation: Check if this language + gender combination already exists
    const existingTranslation = translatedDescriptions.find(desc =>
      desc.language === selectedLanguage && desc.gender === selectedGender
    )

    if (existingTranslation) {
      const confirmReplace = window.confirm(
        `A ${selectedGender} voice translation in ${selectedLanguage} already exists. Do you want to replace it?`
      )
      if (!confirmReplace) return
    }

    setIsTranslating(true)
    try {
      // Get the session to verify user is authenticated
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('No active session')
      }

      const currentPoiForTranslation = getPoi()
      if (!currentPoiForTranslation) {
        alert('POI não encontrado. Por favor, recarregue a página.')
        return
      }
      const requestBody = {
        attractionId: currentPoiForTranslation.id,
        targetLanguage: selectedLanguage,
        voiceGender: selectedGender
      }

      // Call the Edge Function using invoke
      const { data: result, error: invokeError } = await supabase.functions.invoke('generate-translated-audio', {
        body: requestBody
      })

      if (invokeError) {
        console.error('❌ POI MODAL: Translation Edge Function error:', invokeError)
        throw new Error(`Failed to translate: ${invokeError.message || 'Unknown error'}`)
      }

      if (!result?.success) {
        throw new Error(result?.error || 'Falha ao traduzir e gerar áudio')
      }

      // Show success message
      showFeedback(`Translation and audio generation completed successfully for ${selectedLanguage} (${selectedGender})!`, 'success')

      // Refresh the data to show the new translation
      await fetchAdditionalData()

    } catch (error) {
      console.error('Error translating and generating audio:', error)
      showFeedback(`Failed to translate and generate audio: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
    } finally {
      setIsTranslating(false)
    }
  }

  // Regenerate all audios (PT, EN, ES) with both genders
  const regenerateAllAudios = async () => {
    if (!currentDescription.trim()) {
      showFeedback('Please save an original description first.', 'error')
      return
    }

    setIsGeneratingAudio(true)
    setIsTranslating(true)
    setShowResults(false)
    setAudioResults([])

    const languages = [
      { code: 'pt-br', name: 'Portuguese' },
      { code: 'en-us', name: 'English' },
      { code: 'es-es', name: 'Spanish' }
    ]

    setAudioProgress({ current: 0, total: languages.length, currentTask: 'Starting...' })

    try {
      const results = []

      // First, regenerate Portuguese audio (base language)
      setAudioProgress({ current: 1, total: languages.length, currentTask: 'Generating Portuguese audio...' })
      try {
        await generateAudioNarration()
        results.push('✅ Portuguese: audio regenerated successfully')
      } catch (error) {
        results.push(`❌ Portuguese: failed - ${error instanceof Error ? error.message : 'Unknown error'}`)
      }

      // Then regenerate translations for EN and ES (male only)
      for (let i = 0; i < languages.slice(1).length; i++) {
        const lang = languages.slice(1)[i]
        setAudioProgress({
          current: i + 2,
          total: languages.length,
          currentTask: `Generating ${lang.name} (male) audio...`
        })

        try {
          await generateSingleLanguageAudio(lang.code, 'male')
          results.push(`✅ ${lang.name} (male): regenerated successfully`)
        } catch (error) {
          results.push(`❌ ${lang.name} (male): failed - ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      setAudioProgress({ current: languages.length, total: languages.length, currentTask: 'Completed!' })
      setAudioResults(results)
      setShowResults(true)

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

  // Generate audio for a single language
  const generateSingleLanguageAudio = async (language: string, gender: 'male' | 'female') => {
    if (!currentDescription.trim()) {
      throw new Error('No Portuguese description available')
    }

    // Get the session to verify user is authenticated
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      throw new Error('No active session')
    }

    const currentPoiForTranslation2 = getPoi()
    if (!currentPoiForTranslation2) {
      alert('POI não encontrado. Por favor, recarregue a página.')
      return
    }
    const requestBody = {
      attractionId: currentPoiForTranslation2.id,
      targetLanguage: language,
      voiceGender: gender
    }

    // Call the Edge Function using invoke
    const { data: result, error: invokeError } = await supabase.functions.invoke('generate-translated-audio', {
      body: requestBody
    })

    if (invokeError) {
      console.error('❌ POI MODAL: Translation Edge Function error:', invokeError)
      throw new Error(`Failed to translate: ${invokeError.message || 'Unknown error'}`)
    }

    if (!result?.success) {
      throw new Error(result?.error || 'Falha ao traduzir e gerar áudio')
    }

    // Refresh data to show the new audio
    await fetchAdditionalData()
  }

  // Delete a translation
  const deleteTranslation = async (translationId: string, language: string, gender: string) => {
    const confirmDelete = window.confirm(
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

    const confirmRegenerate = window.confirm(
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
    console.log('🔍 MODAL: handlePolygonComplete called with polygon:', polygon);
    const coords = extractPolygonCoordinates(polygon)
    console.log('🔍 MODAL: Extracted coordinates:', coords);
    setDrawnPolygon(coords)
    fetchNearbyPOIsWithPolygon(coords)
  }

  // Handle boundary polygon completion (for POI boundary drawing)
  const handleBoundaryPolygonComplete = useCallback((polygon: any) => {
    console.log('🗺️ [POIDetailsModal] handleBoundaryPolygonComplete called!', polygon);
    const coords = extractPolygonCoordinates(polygon)
    console.log('🗺️ Boundary coordinates extracted:', {
      count: coords.length,
      first: coords[0],
      last: coords[coords.length - 1],
      is_closed: coords.length > 0 &&
        coords[0].lat === coords[coords.length - 1].lat &&
        coords[0].lng === coords[coords.length - 1].lng,
      all_coords: coords,
      sample_values: coords.slice(0, 3).map(c => ({ lat: typeof c.lat, lng: typeof c.lng, lat_val: c.lat, lng_val: c.lng }))
    });

    // Validate coordinates
    const validCoords = coords.filter(coord =>
      typeof coord.lat === 'number' &&
      typeof coord.lng === 'number' &&
      !isNaN(coord.lat) &&
      !isNaN(coord.lng) &&
      coord.lat >= -90 && coord.lat <= 90 &&
      coord.lng >= -180 && coord.lng <= 180
    )

    if (validCoords.length !== coords.length) {
      console.error('❌ Invalid coordinates detected:', {
        total: coords.length,
        valid: validCoords.length,
        invalid: coords.filter(c => !validCoords.includes(c))
      })
    }

    if (validCoords.length < 3) {
      console.error('❌ Not enough valid coordinates:', validCoords.length)
      alert(`Polígono inválido: apenas ${validCoords.length} pontos válidos (mínimo 3)`)
      return
    }

    console.log('✅ Valid coordinates:', validCoords.length)
    setBoundaryPolygon(validCoords)
  }, [])

  // Debug: Log when handleBoundaryPolygonComplete is created
  useEffect(() => {
    console.log('🔄 [POIDetailsModal] handleBoundaryPolygonComplete created/updated:', {
      hasFunction: !!handleBoundaryPolygonComplete,
      type: typeof handleBoundaryPolygonComplete,
      isFunction: typeof handleBoundaryPolygonComplete === 'function'
    })
  }, [handleBoundaryPolygonComplete])

  // Save boundary to database
  const handleSaveBoundary = async () => {
    const currentPoi = getPoi()
    if (!currentPoi || !boundaryPolygon || boundaryPolygon.length < 3) {
      alert('Por favor, desenhe um polígono válido (mínimo 3 pontos)')
      return
    }

    // Validate coordinates before sending
    const validCoords = boundaryPolygon.filter(coord =>
      typeof coord.lat === 'number' &&
      typeof coord.lng === 'number' &&
      !isNaN(coord.lat) &&
      !isNaN(coord.lng) &&
      coord.lat >= -90 && coord.lat <= 90 &&
      coord.lng >= -180 && coord.lng <= 180
    )

    if (validCoords.length < 3) {
      alert(`Polígono inválido: apenas ${validCoords.length} pontos válidos (mínimo 3)`)
      return
    }

    console.log('💾 Saving boundary:', {
      attractionId: currentPoi.id,
      coordinates_count: boundaryPolygon.length,
      valid_coordinates_count: validCoords.length,
      coordinates: boundaryPolygon,
      first_coord: boundaryPolygon[0],
      last_coord: boundaryPolygon[boundaryPolygon.length - 1],
      is_closed: boundaryPolygon.length > 0 &&
        boundaryPolygon[0].lat === boundaryPolygon[boundaryPolygon.length - 1].lat &&
        boundaryPolygon[0].lng === boundaryPolygon[boundaryPolygon.length - 1].lng,
      coordinate_types: boundaryPolygon.map(c => ({ lat: typeof c.lat, lng: typeof c.lng })),
      coordinate_values_sample: boundaryPolygon.slice(0, 3)
    })

    setIsSavingBoundary(true)
    try {
      const requestBody = {
        attractionId: currentPoi.id,
        coordinates: validCoords // Use validated coordinates
      }

      console.log('📤 Sending request:', {
        url: '/api/pois/update-boundary',
        method: 'POST',
        body: requestBody,
        body_stringified: JSON.stringify(requestBody),
        body_stringified_length: JSON.stringify(requestBody).length
      })

      const response = await fetch('/api/pois/update-boundary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      console.log('📥 Response status:', response.status, response.statusText)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ Error response:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        })
        let error
        try {
          error = JSON.parse(errorText)
        } catch {
          error = { error: errorText }
        }
        throw new Error(error.error || error.message || 'Failed to save boundary')
      }

      const result = await response.json()
      console.log('✅ Boundary saved:', result)
      console.log('✅ Full response:', JSON.stringify(result, null, 2))

      // Refresh POI data to show updated boundary
      if (onPOIUpdated && result.data) {
        // Update local POI state with boundary info
        const updatedPoi = {
          ...currentPoi,
          boundary_area_m2: result.data.boundary_area_m2,
          boundary_centroid: result.data.boundary_centroid
        }
        onPOIUpdated(updatedPoi as POI)
      }

      alert('Boundary salvo com sucesso!')
    } catch (error) {
      console.error('Error saving boundary:', error)
      alert(`Erro ao salvar boundary: ${error instanceof Error ? error.message : 'Erro desconhecido'}`)
    } finally {
      setIsSavingBoundary(false)
    }
  }

  const fetchNearbyPOIsWithPolygon = async (polygonCoords: Array<{ lat: number; lng: number }>) => {
    console.log('🔍 MODAL: fetchNearbyPOIsWithPolygon called with coords:', polygonCoords);
    setGroupLoading(true)
    try {
      // Use the correct port (3001) instead of 3000
      const res = await fetch('/api/attraction-groups/nearby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ polygon: polygonCoords })
      })

      console.log('🔍 MODAL: Nearby API response status:', res.status);
      console.log('🔍 MODAL: Nearby API response headers:', Object.fromEntries(res.headers.entries()));

      if (!res.ok) {
        const errorText = await res.text();
        console.error('❌ MODAL: API error response:', errorText);
        throw new Error(`API error ${res.status}: ${errorText}`);
      }

      const data = await res.json()
      console.log('🔍 MODAL: Nearby API response data:', data);

      setNearbyPOIs(data.nearby || [])
      console.log('🔍 MODAL: Set nearbyPOIs to:', data.nearby?.length || 0, 'POIs');
    } catch (error) {
      console.error('❌ MODAL: Error in fetchNearbyPOIsWithPolygon:', error);
      // Show user-friendly error message
      alert(`Erro ao buscar POIs próximos: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    } finally {
      setGroupLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose} />

        <div className="relative bg-white dark:bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all w-[80vw] h-[95vh] flex flex-col">
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

          {/* Header */}
          <div className="bg-white dark:bg-gray-800 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                POI Management
              </h3>
              <button
                onClick={onClose}
                className="rounded-md text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Tabs */}
            <div className="mt-4 border-b border-gray-200 dark:border-gray-700">
              <nav className="-mb-px flex space-x-8">
                {/* Show 'create' tab only if POI doesn't exist or has no ID */}
                {(!currentPoi || !currentPoi.id) && (
                  <button
                    onClick={() => setActiveTab('create')}
                    className={cn(
                      'whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm',
                      activeTab === 'create'
                        ? 'border-tuggi-blue text-tuggi-blue'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                    )}
                  >
                    <Plus className="h-4 w-4 inline mr-2" />
                    Create POI
                  </button>
                )}
                {/* Show 'details' tab only if POI exists and has ID */}
                {currentPoi && currentPoi.id && (
                  <button
                    onClick={() => setActiveTab('details')}
                    className={cn(
                      'whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm',
                      activeTab === 'details'
                        ? 'border-tuggi-blue text-tuggi-blue'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                    )}
                  >
                    <Info className="h-4 w-4 inline mr-2" />
                    POI Details
                  </button>
                )}
                {/* Other tabs appear always - they're part of the creation/editing flow */}
                <button
                  onClick={() => setActiveTab('group-pois')}
                  className={cn(
                    'whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm',
                    activeTab === 'group-pois'
                      ? 'border-tuggi-blue text-tuggi-blue'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  )}
                >
                  <Users className="h-4 w-4 inline mr-2" />
                  Group POIs
                </button>
                <button
                  onClick={() => setActiveTab('description')}
                  className={cn(
                    'whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm',
                    activeTab === 'description'
                      ? 'border-tuggi-blue text-tuggi-blue'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  )}
                >
                  <FileText className="h-4 w-4 inline mr-2" />
                  Description
                </button>

                <button
                  onClick={() => setActiveTab('narration-audio')}
                  className={cn(
                    'whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm',
                    activeTab === 'narration-audio'
                      ? 'border-tuggi-blue text-tuggi-blue'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  )}
                >
                  <Volume2 className="h-4 w-4 inline mr-2" />
                  Narration Audio
                </button>
                <button
                  onClick={() => setActiveTab('trigger-points')}
                  className={cn(
                    'whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm',
                    activeTab === 'trigger-points'
                      ? 'border-tuggi-blue text-tuggi-blue'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  )}
                >
                  <Target className="h-4 w-4 inline mr-2" />
                  Trigger Points
                </button>
                <button
                  onClick={() => setActiveTab('review')}
                  className={cn(
                    'whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm',
                    activeTab === 'review'
                      ? 'border-tuggi-blue text-tuggi-blue'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  )}
                >
                  <CheckCircle className="h-4 w-4 inline mr-2" />
                  Review
                </button>

              </nav>
            </div>
          </div>

          {/* Content */}
          <div className="bg-white dark:bg-gray-800 flex-1 overflow-hidden">
            {activeTab === 'create' ? (
              <div className="px-6 py-4 max-h-[80vh] overflow-y-auto">
                <div className="space-y-6">
                  <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                      <Plus className="h-5 w-5 mr-2 text-tuggi-blue" />
                      Criar Novo POI
                    </h3>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Nome do POI *
                        </label>
                        <input
                          type="text"
                          value={createName}
                          onChange={(e) => setCreateName(e.target.value)}
                          placeholder="Digite o nome do ponto de interesse"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Localização e Boundary do POI *
                        </label>

                        <div className="h-96 w-full rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
                          <GoogleMapComponent
                            componentId="create-poi-map"
                            center={createCoordinates || { lat: -23.5505, lng: -46.6333 }}
                            zoom={createCoordinates ? 18 : 10}
                            height="100%"
                            markers={createCoordinates ? [{
                              id: 'poi-location',
                              position: createCoordinates,
                              title: createName || 'Nova localização',
                              color: '#FF6B35'
                            }] : []}
                            polygon={createBoundary || undefined}
                            enableDrawing={true}
                            onMapClick={(lat: number, lng: number) => {
                              setCreateCoordinates({ lat, lng })
                            }}
                            onPolygonComplete={(polygon: any) => {
                              const coords = extractPolygonCoordinates(polygon)
                              console.log('🗺️ [Create POI] Boundary drawn:', coords.length, 'points')
                              setCreateBoundary(coords)
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
                            <div className="flex items-center text-sm text-green-800 dark:text-green-300">
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Boundary desenhado: {createBoundary.length} pontos
                            </div>
                          </div>
                        )}
                      </div>

                      {isGeocoding && (
                        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Detectando cidade e estado...
                        </div>
                      )}

                      {createLocation && !isGeocoding && (
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                          <h4 className="text-sm font-medium text-blue-900 dark:text-blue-200 mb-2">
                            Localização Detectada:
                          </h4>
                          <div className="space-y-1 text-sm text-blue-800 dark:text-blue-300">
                            {createLocation.city && (
                              <p><strong>Cidade:</strong> {createLocation.city}</p>
                            )}
                            {createLocation.state && (
                              <p><strong>Estado:</strong> {createLocation.state}</p>
                            )}
                            {createLocation.country && (
                              <p><strong>País:</strong> {createLocation.country}</p>
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
                          Cancelar
                        </button>
                        <button
                          onClick={handleCreatePOI}
                          disabled={isCreating || !createName.trim() || !createCoordinates}
                          className="px-4 py-2 text-sm font-medium text-white bg-tuggi-blue rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                        >
                          {isCreating ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Criando...
                            </>
                          ) : (
                            <>
                              <Plus className="h-4 w-4 mr-2" />
                              Criar POI
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : activeTab === 'details' ? (
              <div className="px-6 py-4 max-h-[80vh] overflow-y-auto">
                {(() => {
                  console.log('🔍 [POIDetailsModal] Details tab rendering:', {
                    activeTab,
                    isLoading,
                    hasPoi: !!poi,
                    hasCurrentPoi: !!currentPoi,
                    hasEditedPoi: !!editedPoi,
                    poiId: poi?.id,
                    currentPoiId: currentPoi?.id
                  })
                  return null
                })()}
                {isLoading ? (
                  <div className="animate-pulse space-y-4">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                    <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* SECTION 1: Basic Information & Categories - PRIORITY */}
                    <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                          <Target className="h-5 w-5 mr-2 text-tuggi-blue" />
                          Basic Information & Categories
                        </h3>
                        {currentPoi && (
                          <button
                            onClick={handleReEnrichOSM}
                            disabled={isEnrichingOSM}
                            className="px-3 py-1.5 text-sm font-medium text-white bg-tuggi-blue rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                          >
                            {isEnrichingOSM ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Enriquecendo...
                              </>
                            ) : (
                              <>
                                <Sparkles className="h-4 w-4 mr-2" />
                                Enriquecer com OSM
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Left Column: Editable Fields */}
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Name *
                            </label>
                            <input
                              type="text"
                              value={editedPoi?.name || ''}
                              onChange={(e) => setEditedPoi(prev => prev ? ({ ...prev, name: e.target.value }) : null)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Category
                            </label>
                            <select
                              value={editedPoi?.category || ''}
                              onChange={(e) => setEditedPoi(prev => prev ? ({ ...prev, category: e.target.value }) : null)}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                            >
                              <option value="">Select Category</option>
                              {POI_CATEGORIES.filter(cat => cat.value !== 'all').map(category => (
                                <option key={category.value} value={category.value}>
                                  {category.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                City *
                              </label>
                              <input
                                type="text"
                                value={editedPoi?.city || ''}
                                onChange={(e) => setEditedPoi(prev => prev ? ({ ...prev, city: e.target.value }) : null)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                State
                              </label>
                              <input
                                type="text"
                                value={editedPoi?.state || ''}
                                onChange={(e) => setEditedPoi(prev => prev ? ({ ...prev, state: e.target.value || null }) : null)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Country *
                              </label>
                              <input
                                type="text"
                                value={editedPoi?.country || ''}
                                onChange={(e) => setEditedPoi(prev => prev ? ({ ...prev, country: e.target.value }) : null)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Right Column: Categories Display */}
                        <div className="space-y-4">
                          {/* Google Types */}
                          {getPoi()?.google_types && getPoi()!.google_types!.length > 0 && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Google Types ({getPoi()!.google_types!.length})
                              </label>
                              <div className="flex flex-wrap gap-2 p-3 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700">
                                {getPoi()?.google_types?.map((type, index) => (
                                  <span
                                    key={index}
                                    className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-tuggi-blue/10 text-tuggi-blue border border-tuggi-blue/20"
                                  >
                                    {type.replace(/_/g, ' ')}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Content Status Summary */}
                          <div className="bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 p-4">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                              Content Status
                            </label>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="flex items-center space-x-2">
                                <FileText className="h-4 w-4 text-gray-400" />
                                <div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Descriptions</div>
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{getPoi()?.description_count || 0}</div>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Volume2 className="h-4 w-4 text-gray-400" />
                                <div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Audio Files</div>
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{getPoi()?.audio_count || 0}</div>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Target className="h-4 w-4 text-gray-400" />
                                <div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Trigger Points</div>
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{getPoi()?.trigger_points_count || 0}</div>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <CheckCircle className="h-4 w-4 text-gray-400" />
                                <div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">Active TPs</div>
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{getPoi()?.active_trigger_points_count || 0}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* SECTION 2: Status & Ratings - Two Column Layout */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Left Column: Status & Ratings */}
                      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                          <CheckCircle className="h-5 w-5 mr-2 text-green-600" />
                          Status & Ratings
                        </h3>

                        <div className="grid grid-cols-2 gap-4">
                          {/* Approval Status */}
                          <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Approval Status</div>
                            <span className={cn(
                              'inline-flex items-center px-3 py-1 text-sm font-medium rounded-full',
                              getPoi()?.approved
                                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                                : 'bg-tuggi-orange/10 text-tuggi-orange border border-tuggi-orange/20'
                            )}>
                              {getPoi()?.approved ? (
                                <>
                                  <CheckCircle className="h-4 w-4 mr-1" />
                                  Approved
                                </>
                              ) : (
                                <>
                                  <Clock className="h-4 w-4 mr-1" />
                                  Pending
                                </>
                              )}
                            </span>
                          </div>

                          {/* Rating */}
                          {getPoi()?.rating ? (
                            <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Rating</div>
                              <div className="flex items-center">
                                <Star className="h-5 w-5 text-yellow-400 mr-1" />
                                <span className="text-lg font-semibold text-gray-900 dark:text-white">
                                  {getPoi()!.rating!.toFixed(1)}
                                </span>
                                {getPoi()?.user_ratings_total && (
                                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                                    ({getPoi()!.user_ratings_total})
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Rating</div>
                              <div className="text-sm text-gray-500 dark:text-gray-400">N/A</div>
                            </div>
                          )}

                          {/* Verification Score */}
                          {getPoi()?.verification_score !== null && getPoi()?.verification_score !== undefined ? (
                            <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Verification Score</div>
                              <div className="flex items-center">
                                <span className={cn(
                                  "text-lg font-semibold",
                                  getPoi()!.verification_score! >= 0.8 ? "text-green-600 dark:text-green-400" :
                                    getPoi()!.verification_score! >= 0.6 ? "text-yellow-600 dark:text-yellow-400" :
                                      "text-red-600 dark:text-red-400"
                                )}>
                                  {(getPoi()!.verification_score! * 100).toFixed(0)}%
                                </span>
                              </div>
                            </div>
                          ) : null}

                          {/* Group Status */}
                          {getPoi()?.group_status && getPoi()!.group_status!.is_in_group ? (
                            <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Group</div>
                              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                                {getPoi()!.group_status!.group_role === 'main' ? 'Main' : 'Member'}
                              </div>
                              {getPoi()!.group_status!.group_name && (
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                  {getPoi()!.group_status!.group_name}
                                </div>
                              )}
                            </div>
                          ) : null}

                          {/* Business Status */}
                          {getPoi()?.business_status ? (
                            <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Business Status</div>
                              <div className="text-sm font-semibold text-gray-900 dark:text-white capitalize">
                                {getPoi()!.business_status!.replace(/_/g, ' ')}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {/* Right Column: Importance & Classification */}
                      {(poi as any)._homologData ? (
                        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                            <Star className="h-5 w-5 mr-2 text-amber-600" />
                            Importance & Classification
                          </h3>

                          <div className="space-y-3">
                            {/* Importance Score */}
                            {((poi as any)._homologData.importance !== null && (poi as any)._homologData.importance !== undefined) ? (
                              <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Importance Score</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                      {Number((poi as any)._homologData.importance).toFixed(2)}
                                      {(poi as any)._homologData.importance_level && ` • ${(poi as any)._homologData.importance_level}`}
                                    </div>
                                  </div>
                                  <div className="flex items-center">
                                    <span className={cn(
                                      "text-lg font-semibold",
                                      Number((poi as any)._homologData.importance) >= 0.7 ? "text-green-600 dark:text-green-400" :
                                        Number((poi as any)._homologData.importance) >= 0.4 ? "text-yellow-600 dark:text-yellow-400" :
                                          "text-gray-600 dark:text-gray-400"
                                    )}>
                                      {Number((poi as any)._homologData.importance).toFixed(2)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ) : null}

                            {/* Importance Level (if no importance score but has level) */}
                            {((poi as any)._homologData.importance === null || (poi as any)._homologData.importance === undefined) &&
                              (poi as any)._homologData.importance_level ? (
                              <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Importance Level</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Classification level</div>
                                  </div>
                                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 capitalize">
                                    {(poi as any)._homologData.importance_level}
                                  </span>
                                </div>
                              </div>
                            ) : null}

                            {/* Historic Classification */}
                            {(() => {
                              const isHistoric = (poi as any)._homologData?.is_historic;
                              // Debug: uncomment to check values
                              // console.log('is_historic value:', isHistoric, 'type:', typeof isHistoric);
                              return isHistoric === true || isHistoric === 'true' || isHistoric === 1 ? (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Historic Site</div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">This POI is classified as historic</div>
                                    </div>
                                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                                      <Calendar className="h-4 w-4 mr-1" />
                                      Historic
                                    </span>
                                  </div>
                                </div>
                              ) : null;
                            })()}

                            {/* Touristic Classification */}
                            {(() => {
                              const isTouristic = (poi as any)._homologData?.is_touristic;
                              // Debug: uncomment to check values
                              // console.log('is_touristic value:', isTouristic, 'type:', typeof isTouristic);
                              return isTouristic === true || isTouristic === 'true' || isTouristic === 1 ? (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Touristic Site</div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">This POI is classified as touristic</div>
                                    </div>
                                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                      <Target className="h-4 w-4 mr-1" />
                                      Touristic
                                    </span>
                                  </div>
                                </div>
                              ) : null;
                            })()}

                            {/* Show message if no data available */}
                            {(() => {
                              const hasImportance = (poi as any)._homologData.importance !== null && (poi as any)._homologData.importance !== undefined;
                              const hasImportanceLevel = !!(poi as any)._homologData.importance_level;
                              const isHistoric = (poi as any)._homologData?.is_historic;
                              const isTouristic = (poi as any)._homologData?.is_touristic;
                              const hasHistoric = isHistoric === true || isHistoric === 'true' || isHistoric === 1;
                              const hasTouristic = isTouristic === true || isTouristic === 'true' || isTouristic === 1;

                              if (!hasImportance && !hasImportanceLevel && !hasHistoric && !hasTouristic) {
                                return (
                                  <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                    <div className="text-sm text-gray-500 dark:text-gray-400 text-center">
                                      No importance or classification data available
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            })()}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* SECTION 3: Location Details & Image - Two Column Layout */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Left Column: Location Details */}
                      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                          <MapPin className="h-5 w-5 mr-2 text-red-600" />
                          Location Details
                        </h3>

                        <div className="space-y-4">
                          {getPoi()?.formatted_address && (
                            <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                              <div className="flex items-start space-x-3">
                                <MapPin className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1">
                                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Address</div>
                                  <div className="text-sm text-gray-900 dark:text-white">{getPoi()!.formatted_address}</div>
                                </div>
                              </div>
                            </div>
                          )}

                          {getPoi()?.vicinity && (
                            <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                              <div className="flex items-start space-x-3">
                                <MapPin className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1">
                                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Vicinity</div>
                                  <div className="text-sm text-gray-900 dark:text-white">{getPoi()!.vicinity}</div>
                                </div>
                              </div>
                            </div>
                          )}

                          {getPoi()?.coordinates && (
                            <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                              <div className="flex items-start space-x-3">
                                <MapPin className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1">
                                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Coordinates</div>
                                  <div className="text-sm text-gray-900 dark:text-white font-mono">
                                    {getPoi()!.coordinates!.latitude.toFixed(6)}, {getPoi()!.coordinates!.longitude.toFixed(6)}
                                  </div>
                                  <button
                                    onClick={openInGoogleMaps}
                                    className="text-sm text-tuggi-blue hover:text-tuggi-blue/80 underline inline-flex items-center mt-2"
                                  >
                                    <ExternalLink className="h-3 w-3 mr-1" />
                                    View on Google Maps
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Boundary Drawing Section */}
                      {(() => {
                        const currentPoi = getPoi()
                        console.log('🗺️ [POIDetailsModal] Boundary section rendering check:', {
                          activeTab,
                          isDetailsTab: activeTab === 'details',
                          isLoading,
                          hasPoi: !!currentPoi,
                          hasCurrentPoi: !!currentPoi,
                          poiId: currentPoi?.id,
                          hasCoordinates: !!currentPoi?.coordinates,
                          coordinates: currentPoi?.coordinates ? {
                            lat: currentPoi.coordinates.latitude,
                            lng: currentPoi.coordinates.longitude
                          } : null,
                          // Also check prop poi
                          hasPropPoi: !!poi,
                          propPoiId: poi?.id,
                          hasPropCoordinates: !!poi?.coordinates
                        })
                        return null
                      })()}
                      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700 mt-6 col-span-full">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
                            <MapPin className="h-5 w-5 mr-2 text-tuggi-blue" />
                            POI Boundary
                          </h3>
                          {boundaryPolygon && boundaryPolygon.length >= 3 && (
                            <button
                              onClick={handleSaveBoundary}
                              disabled={isSavingBoundary}
                              className="px-4 py-2 text-sm font-medium text-white bg-tuggi-blue rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                            >
                              {isSavingBoundary ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Salvando...
                                </>
                              ) : (
                                <>
                                  <Save className="h-4 w-4 mr-2" />
                                  Salvar Boundary
                                </>
                              )}
                            </button>
                          )}
                        </div>

                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                          Desenhe o boundary (fronteira) do POI no mapa abaixo. Clique no mapa para começar a desenhar um polígono.
                        </p>

                        {existingBoundary && (
                          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
                            <div className="flex items-center text-sm text-blue-800 dark:text-blue-300">
                              <CheckCircle className="h-4 w-4 mr-2" />
                              Boundary existente carregado ({existingBoundary.length} pontos)
                            </div>
                          </div>
                        )}

                        <div className="w-full h-96 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                          {(() => {
                            const currentPoi = getPoi()
                            if (!currentPoi || !currentPoi.coordinates) {
                              console.log('🗺️ [POIDetailsModal] Cannot render boundary map: POI or coordinates missing', {
                                hasPoi: !!currentPoi,
                                hasCoordinates: !!currentPoi?.coordinates
                              })
                              return (
                                <div className="w-full h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
                                  POI coordinates not available
                                </div>
                              )
                            }
                            console.log('🗺️ [POIDetailsModal] Rendering GoogleMapComponent with:', {
                              componentId: 'boundary-drawing',
                              hasHandleBoundaryPolygonComplete: !!handleBoundaryPolygonComplete,
                              handleBoundaryPolygonCompleteType: typeof handleBoundaryPolygonComplete,
                              isFunction: typeof handleBoundaryPolygonComplete === 'function',
                              hasPoiCoordinates: !!currentPoi.coordinates,
                              poiId: currentPoi.id,
                              handleBoundaryPolygonCompleteValue: handleBoundaryPolygonComplete,
                              willPassOnPolygonComplete: true
                            })

                            // CRITICAL: Verify the callback is actually a function before passing
                            if (typeof handleBoundaryPolygonComplete !== 'function') {
                              console.error('❌ CRITICAL: handleBoundaryPolygonComplete is NOT a function!', {
                                type: typeof handleBoundaryPolygonComplete,
                                value: handleBoundaryPolygonComplete
                              })
                            }

                            return (
                              <GoogleMapComponent
                                componentId="boundary-drawing"
                                center={{ lat: currentPoi.coordinates.latitude, lng: currentPoi.coordinates.longitude }}
                                zoom={18}
                                height="100%"
                                markers={[
                                  {
                                    id: currentPoi.id,
                                    position: { lat: currentPoi.coordinates.latitude, lng: currentPoi.coordinates.longitude },
                                    title: currentPoi.name,
                                    color: '#10B981'
                                  }
                                ]}
                                polygon={boundaryPolygon || existingBoundary || undefined}
                                onPolygonComplete={handleBoundaryPolygonComplete}
                                enableDrawing={true}
                                polygonOptions={{
                                  strokeColor: '#3B82F6',
                                  strokeOpacity: 0.8,
                                  strokeWeight: 3,
                                  fillColor: '#3B82F6',
                                  fillOpacity: 0.2
                                }}
                              />
                            )
                          })()}
                        </div>

                        {boundaryPolygon && boundaryPolygon.length >= 3 && (
                          <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-md border border-green-200 dark:border-green-800">
                            <div className="flex items-center justify-between text-sm">
                              <div className="text-green-800 dark:text-green-300">
                                <CheckCircle className="h-4 w-4 inline mr-2" />
                                Polígono desenhado: {boundaryPolygon.length} pontos
                              </div>
                              <button
                                onClick={() => {
                                  setBoundaryPolygon(null);
                                  setExistingBoundary(null);
                                }}
                                className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                              >
                                Limpar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right Column: Image Preview */}
                      <div>
                        {(() => {
                          const currentPoiForImage = getPoi()
                          if (!currentPoiForImage) return null
                          const fullSizeImageUrl = getFullSizeImageUrl(currentPoiForImage)
                          return (fullSizeImageUrl || images.length > 0) && (
                            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700 h-full">
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Images
                              </label>
                              <div className="space-y-2">
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
                    {(poi as any)._homologData && (
                      <>
                        {/* OSM Categories & Metadata - Two Column Layout */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* Left Column: OSM Categories */}
                          {((poi as any)._homologData.primary_category || (poi as any)._homologData.categories?.length > 0) && (
                            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                <Target className="h-5 w-5 mr-2 text-tuggi-blue" />
                                OSM Categories
                              </h3>

                              <div className="space-y-4">
                                {(poi as any)._homologData.primary_category && (
                                  <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Primary Category</div>
                                    <div className="text-sm text-gray-900 dark:text-white font-semibold capitalize">{(poi as any)._homologData.primary_category}</div>
                                    {(poi as any)._homologData.primary_category_type && (
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Type: {(poi as any)._homologData.primary_category_type}</div>
                                    )}
                                  </div>
                                )}

                                {(poi as any)._homologData.categories && (poi as any)._homologData.categories.length > 0 && (
                                  <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">All Categories</div>
                                    <div className="flex flex-wrap gap-2">
                                      {(poi as any)._homologData.categories.map((cat: string, idx: number) => (
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
                              Metadata
                            </h3>

                            <div className="space-y-4">
                              <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                <div className="flex items-start space-x-3">
                                  <Calendar className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Created</div>
                                    <div className="text-sm text-gray-900 dark:text-white">{getPoi()?.created_at ? formatDate(getPoi()!.created_at) : 'N/A'}</div>
                                  </div>
                                </div>
                              </div>

                              <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                <div className="flex items-start space-x-3">
                                  <Calendar className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Updated</div>
                                    <div className="text-sm text-gray-900 dark:text-white">{getPoi()?.updated_at ? formatDate(getPoi()!.updated_at) : 'N/A'}</div>
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
                                        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Approved At</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{formatDate(approvedAt)}</div>
                                        {poi?.approved_by && (
                                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">By: {poi.approved_by}</div>
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
                                      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Google Place ID</div>
                                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono break-all">{getPoi()!.google_place_id}</div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Detailed Address & Extended Contact - Two Column Layout */}
                        {(((poi as any)._homologData.neighborhood || (poi as any)._homologData.street_name || (poi as any)._homologData.house_number || (poi as any)._homologData.postal_code) ||
                          ((poi as any)._homologData.contact_email || (poi as any)._homologData.operator_name)) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {/* Detailed Address */}
                              {((poi as any)._homologData.neighborhood || (poi as any)._homologData.street_name || (poi as any)._homologData.house_number || (poi as any)._homologData.postal_code) && (
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                    <MapPin className="h-5 w-5 mr-2 text-red-600" />
                                    Detailed Address
                                  </h3>

                                  <div className="space-y-4">
                                    {(poi as any)._homologData.neighborhood && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Neighborhood</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{(poi as any)._homologData.neighborhood}</div>
                                      </div>
                                    )}

                                    {(poi as any)._homologData.street_name && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Street</div>
                                        <div className="text-sm text-gray-900 dark:text-white">
                                          {(poi as any)._homologData.street_name}
                                          {(poi as any)._homologData.house_number && `, ${(poi as any)._homologData.house_number}`}
                                        </div>
                                      </div>
                                    )}

                                    {(poi as any)._homologData.postal_code && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Postal Code</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{(poi as any)._homologData.postal_code}</div>
                                      </div>
                                    )}

                                    {(poi as any)._homologData.description && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Description</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{(poi as any)._homologData.description}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Extended Contact Info */}
                              {((poi as any)._homologData.contact_email || (poi as any)._homologData.operator_name) && (
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                    <Globe className="h-5 w-5 mr-2 text-blue-600" />
                                    Extended Contact
                                  </h3>

                                  <div className="space-y-4">
                                    {(poi as any)._homologData.contact_email && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="flex items-start space-x-3">
                                          <Globe className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                          <div className="flex-1">
                                            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</div>
                                            <a
                                              href={`mailto:${(poi as any)._homologData.contact_email}`}
                                              className="text-sm text-tuggi-blue hover:text-tuggi-blue/80 underline break-all"
                                            >
                                              {(poi as any)._homologData.contact_email}
                                            </a>
                                          </div>
                                        </div>
                                      </div>
                                    )}

                                    {(poi as any)._homologData.operator_name && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="flex items-start space-x-3">
                                          <User className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                                          <div className="flex-1">
                                            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Operator</div>
                                            <div className="text-sm text-gray-900 dark:text-white">{(poi as any)._homologData.operator_name}</div>
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
                        {((poi as any)._homologData.brand ||
                          ((poi as any)._homologData.wheelchair_accessible || (poi as any)._homologData.wheelchair_toilets || (poi as any)._homologData.accessibility_notes || (poi as any)._homologData.has_wheelchair_access)) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {/* Brand Information */}
                              {(poi as any)._homologData.brand && (
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                    <Star className="h-5 w-5 mr-2 text-yellow-600" />
                                    Brand Information
                                  </h3>

                                  <div className="space-y-4">
                                    <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Brand</div>
                                      <div className="text-sm font-semibold text-gray-900 dark:text-white">{(poi as any)._homologData.brand}</div>
                                    </div>

                                    {(poi as any)._homologData.brand_wikidata && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Wikidata ID</div>
                                        <div className="text-sm text-gray-900 dark:text-white font-mono">{(poi as any)._homologData.brand_wikidata}</div>
                                      </div>
                                    )}

                                    {(poi as any)._homologData.brand_wikipedia && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Wikipedia</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{(poi as any)._homologData.brand_wikipedia}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Accessibility */}
                              {((poi as any)._homologData.wheelchair_accessible || (poi as any)._homologData.wheelchair_toilets || (poi as any)._homologData.accessibility_notes || (poi as any)._homologData.has_wheelchair_access) && (
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                    <Users className="h-5 w-5 mr-2 text-green-600" />
                                    Accessibility
                                  </h3>

                                  <div className="space-y-4">
                                    {((poi as any)._homologData.wheelchair_accessible || (poi as any)._homologData.has_wheelchair_access) && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Wheelchair Access</div>
                                        <div className="text-sm text-gray-900 dark:text-white capitalize">
                                          {(poi as any)._homologData.wheelchair_accessible || ((poi as any)._homologData.has_wheelchair_access ? 'Yes' : 'No')}
                                        </div>
                                      </div>
                                    )}

                                    {(poi as any)._homologData.wheelchair_toilets && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Wheelchair Toilets</div>
                                        <div className="text-sm text-gray-900 dark:text-white capitalize">{(poi as any)._homologData.wheelchair_toilets}</div>
                                      </div>
                                    )}

                                    {(poi as any)._homologData.accessibility_notes && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Accessibility Notes</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{(poi as any)._homologData.accessibility_notes}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                        {/* Physical Characteristics */}
                        {((poi as any)._homologData.height || (poi as any)._homologData.building_material || (poi as any)._homologData.building_colour || (poi as any)._homologData.architectural_style) && (
                          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                              <Target className="h-5 w-5 mr-2 text-indigo-600" />
                              Physical Characteristics
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {(poi as any)._homologData.height && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Height</div>
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">
                                    {Number((poi as any)._homologData.height).toFixed(2)} m
                                  </div>
                                </div>
                              )}

                              {(poi as any)._homologData.building_material && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Building Material</div>
                                  <div className="text-sm text-gray-900 dark:text-white capitalize">{(poi as any)._homologData.building_material}</div>
                                </div>
                              )}

                              {(poi as any)._homologData.building_colour && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Building Colour</div>
                                  <div className="text-sm text-gray-900 dark:text-white capitalize">{(poi as any)._homologData.building_colour}</div>
                                </div>
                              )}

                              {(poi as any)._homologData.architectural_style && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Architectural Style</div>
                                  <div className="text-sm text-gray-900 dark:text-white capitalize">{(poi as any)._homologData.architectural_style}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Historical & Heritage - Two Column Layout */}
                        {((poi as any)._homologData.heritage_status || (poi as any)._homologData.unesco_status || (poi as any)._homologData.landmark_type || (poi as any)._homologData.architect || (poi as any)._homologData.start_date || (poi as any)._homologData.historic_period) && (
                          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                              <Calendar className="h-5 w-5 mr-2 text-amber-600" />
                              Historical & Heritage Details
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {(poi as any)._homologData.heritage_status && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Heritage Status</div>
                                  <div className="text-sm text-gray-900 dark:text-white capitalize">{(poi as any)._homologData.heritage_status}</div>
                                </div>
                              )}

                              {(poi as any)._homologData.unesco_status && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">UNESCO Status</div>
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white capitalize">{(poi as any)._homologData.unesco_status}</div>
                                  {(poi as any)._homologData.unesco_inscription_date && (
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                      Inscribed: {(poi as any)._homologData.unesco_inscription_date}
                                    </div>
                                  )}
                                </div>
                              )}

                              {(poi as any)._homologData.landmark_type && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Landmark Type</div>
                                  <div className="text-sm text-gray-900 dark:text-white capitalize">{(poi as any)._homologData.landmark_type}</div>
                                  {(poi as any)._homologData.landmark_level && (
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                      Level: {(poi as any)._homologData.landmark_level}
                                    </div>
                                  )}
                                </div>
                              )}

                              {(poi as any)._homologData.architect && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Architect</div>
                                  <div className="text-sm text-gray-900 dark:text-white">{(poi as any)._homologData.architect}</div>
                                </div>
                              )}

                              {(poi as any)._homologData.start_date && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Start Date</div>
                                  <div className="text-sm text-gray-900 dark:text-white">{(poi as any)._homologData.start_date}</div>
                                </div>
                              )}

                              {(poi as any)._homologData.historic_period && (
                                <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Historic Period</div>
                                  <div className="text-sm text-gray-900 dark:text-white capitalize">{(poi as any)._homologData.historic_period}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Type-Specific & Infrastructure - Two Column Layout */}
                        {(((poi as any)._homologData.museum_type || (poi as any)._homologData.leisure_type || (poi as any)._homologData.monument_type) ||
                          ((poi as any)._homologData.parking_capacity || (poi as any)._homologData.entrance_fee)) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {/* Type-Specific Information */}
                              {((poi as any)._homologData.museum_type || (poi as any)._homologData.leisure_type || (poi as any)._homologData.monument_type) && (
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                    <Target className="h-5 w-5 mr-2 text-blue-600" />
                                    Type-Specific Information
                                  </h3>

                                  <div className="space-y-4">
                                    {(poi as any)._homologData.museum_type && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Museum Type</div>
                                        <div className="text-sm text-gray-900 dark:text-white capitalize">{(poi as any)._homologData.museum_type}</div>
                                      </div>
                                    )}

                                    {(poi as any)._homologData.leisure_type && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Leisure Type</div>
                                        <div className="text-sm text-gray-900 dark:text-white capitalize">{(poi as any)._homologData.leisure_type}</div>
                                      </div>
                                    )}

                                    {(poi as any)._homologData.monument_type && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Monument Type</div>
                                        <div className="text-sm text-gray-900 dark:text-white capitalize">{(poi as any)._homologData.monument_type}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Infrastructure & Facilities */}
                              {((poi as any)._homologData.parking_capacity || (poi as any)._homologData.entrance_fee) && (
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                                    <Info className="h-5 w-5 mr-2 text-teal-600" />
                                    Infrastructure & Facilities
                                  </h3>

                                  <div className="space-y-4">
                                    {(poi as any)._homologData.parking_capacity && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Parking Capacity</div>
                                        <div className="text-sm text-gray-900 dark:text-white">{(poi as any)._homologData.parking_capacity}</div>
                                      </div>
                                    )}

                                    {(poi as any)._homologData.entrance_fee && (
                                      <div className="bg-white dark:bg-gray-800 rounded-md p-4 border border-gray-200 dark:border-gray-700">
                                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Entrance Fee</div>
                                        <div className="text-sm text-gray-900 dark:text-white capitalize">{(poi as any)._homologData.entrance_fee}</div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                        {/* Additional Flags */}
                        {(poi as any)._homologData.is_building && (
                          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="h-5 w-5 text-green-600" />
                              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200">
                                Building
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center space-x-3 pt-4 border-t border-gray-200 dark:border-gray-600">
                      {cmsUserRole === 'admin' && (
                        <button
                          onClick={handleDelete}
                          disabled={isSaving}
                          className="inline-flex items-center px-4 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete POI
                        </button>
                      )}
                      <button
                        onClick={onClose}
                        className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
                      >
                        Cancel
                      </button>
                      {(isCreateMode || cmsUserRole === 'admin') && (
                        <button
                          onClick={handleSave}
                          disabled={isSaving}
                          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-tuggi-blue hover:bg-tuggi-blue/90 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50"
                        >
                          <Save className="h-4 w-4 mr-2" />
                          {isSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : activeTab === 'description' ? (
              <div className="px-6 py-4 max-h-[80vh] overflow-y-auto">
                {isLoading ? (
                  <div className="animate-pulse space-y-4">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                    <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                  </div>
                ) : (
                  <div className="space-y-6">


                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                          Description Editor
                        </h4>
                        {/* <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      Editing Brazilian Portuguese (pt-br) • {descriptions.length} language{descriptions.length !== 1 ? 's' : ''} available
                    </p>
                    <p className="text-xs text-tuggi-blue mt-1">
                      ✨ Enhanced AI with rich POI data: Google Types, location, ratings, business info
                    </p> */}
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={generateDescription}
                          disabled={isGenerating || isSavingDescription || isGeneratingAudio}
                          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-tuggi-blue hover:bg-tuggi-blue/90 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50"
                        >
                          <Sparkles className="h-4 w-4 mr-2" />
                          {isGenerating ? 'Generating...' : 'Generate Description with Historical Dates'}
                        </button>
                        {currentDescription !== originalDescription && (
                          <button
                            onClick={resetDescription}
                            disabled={isGenerating || isSavingDescription || isGeneratingAudio}
                            className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50"
                          >
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Reset
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Reference Links Section */}
                    <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                        Reference Links (URLs)
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                        Add authoritative sources (Wikipedia, official sites, etc.) to help AI generate more accurate descriptions
                      </p>
                      <div className="space-y-2">
                        {referenceLinks.map((link, idx) => (
                          <div key={idx} className="flex items-center space-x-2">
                            <input
                              type="url"
                              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-800 dark:text-white"
                              value={link}
                              onChange={e => {
                                const newLinks = [...referenceLinks];
                                newLinks[idx] = e.target.value;
                                setReferenceLinks(newLinks);
                              }}
                              placeholder="https://en.wikipedia.org/wiki/example or https://officialsite.com"
                            />
                            <button
                              type="button"
                              className="px-3 py-2 text-sm text-red-600 hover:text-red-800 border border-red-300 rounded-md hover:bg-red-50"
                              onClick={() => setReferenceLinks(referenceLinks.filter((_, i) => i !== idx))}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            className="inline-flex items-center px-3 py-2 text-sm text-tuggi-blue hover:text-tuggi-blue/80 border border-tuggi-blue/30 rounded-md hover:bg-tuggi-blue/10"
                            onClick={() => setReferenceLinks([...referenceLinks, ''])}
                          >
                            + Add Reference Link
                          </button>
                          <button
                            type="button"
                            onClick={saveReferenceLinks}
                            disabled={isSavingReferenceLinks || !!(poi as any)._homologData}
                            className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-tuggi-blue hover:bg-tuggi-blue/90 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Save className="h-4 w-4 mr-2" />
                            {isSavingReferenceLinks ? 'Saving...' : 'Save Reference Links'}
                          </button>
                        </div>
                        {(poi as any)._homologData && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                            Note: Reference links can only be saved for core attractions, not homolog POIs.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* "Learn more" button to display advanced information */}
                    <div className="flex justify-center my-4">
                      <button
                        onClick={() => setShowAdvancedInfo(!showAdvancedInfo)}
                        className="flex items-center px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <Info className="h-4 w-4 mr-2" />
                        {showAdvancedInfo ? 'Hide advanced details' : 'Learn more about this description'}
                        <span className="ml-2">{showAdvancedInfo ? '▲' : '▼'}</span>
                      </button>
                    </div>

                    {/* Seções detalhadas que só aparecem quando showAdvancedInfo é true */}
                    {showAdvancedInfo && (
                      <div className="space-y-4 border-t border-gray-200 dark:border-gray-700 pt-4 mt-2">
                        {/* Sources Information Section */}
                        {verificationInfo && (
                          <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
                            <div className="flex items-center justify-between mb-3">
                              <h5 className="text-sm font-medium text-green-900 dark:text-green-100 flex items-center">
                                <Info className="h-4 w-4 mr-2" />
                                Source Information
                              </h5>
                              <div className="flex items-center space-x-2">
                                {verificationInfo.dynamicSourcesEnabled && (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                    Dynamic Sources
                                  </span>
                                )}
                                <span className={cn(
                                  "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
                                  verificationInfo.mode === 'maximum'
                                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                    : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                                )}>
                                  {verificationInfo.mode === 'maximum' ? 'Maximum Verification' : 'Standard Verification'}
                                </span>
                              </div>
                            </div>
                            <div className="text-sm text-green-700 dark:text-green-300 mb-3">
                              Last generation used {verificationInfo.sourcesCount} verified sources for enhanced accuracy
                            </div>

                            {lastGenerationSources.length > 0 && (
                              <div className="space-y-2">
                                <h6 className="text-xs font-medium text-green-800 dark:text-green-200 uppercase tracking-wide">
                                  Sources Used:
                                </h6>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  {lastGenerationSources.map((source, idx) => (
                                    <div key={idx} className="flex items-center justify-between bg-white dark:bg-gray-800 p-2 rounded border border-green-200 dark:border-green-700">
                                      <div className="flex items-center space-x-2">
                                        <span className={cn(
                                          "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium",
                                          source.type === 'heritage' || source.type === 'government'
                                            ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                                            : source.type === 'academic' || source.type === 'official'
                                              ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                                              : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
                                        )}>
                                          {source.type}
                                        </span>
                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                          {source.name}
                                        </span>
                                      </div>
                                      <div className="flex items-center space-x-1">
                                        {source.layer && (
                                          <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">
                                            {source.layer}
                                          </span>
                                        )}
                                        <span className="text-xs text-gray-400 dark:text-gray-500">
                                          P{source.priority}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Historical Dates Section */}
                        {detectedDates && (
                          <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg border border-amber-200 dark:border-amber-800">
                            <div className="flex items-center justify-between mb-3">
                              <h5 className="text-sm font-medium text-amber-900 dark:text-amber-100 flex items-center">
                                <Calendar className="h-4 w-4 mr-2" />
                                Date Detection
                              </h5>
                              <div className="flex items-center space-x-2">
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                                  {detectedDates.total} dates found
                                </span>
                                {detectedDates.reliable.length > 0 && (
                                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                    {detectedDates.reliable.length} verified
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="text-sm text-amber-700 dark:text-amber-300 mb-3">
                              Enhanced date-focused generation successfully identified historical references
                            </div>

                            <div className="space-y-3">
                              {detectedDates.reliable.length > 0 && (
                                <div>
                                  <h6 className="text-xs font-medium text-green-800 dark:text-green-200 uppercase tracking-wide mb-2">
                                    ✅ Verified Dates:
                                  </h6>
                                  <div className="flex flex-wrap gap-2">
                                    {detectedDates.reliable.map((date, idx) => (
                                      <span key={idx} className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border border-green-200 dark:border-green-700">
                                        {date}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {detectedDates.moderate.length > 0 && (
                                <div>
                                  <h6 className="text-xs font-medium text-blue-800 dark:text-blue-200 uppercase tracking-wide mb-2">
                                    📅 Period References:
                                  </h6>
                                  <div className="flex flex-wrap gap-2">
                                    {detectedDates.moderate.map((date, idx) => (
                                      <span key={idx} className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-700">
                                        {date}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {detectedDates.total === 0 && (
                                <div className="text-center py-3">
                                  <span className="text-sm text-amber-600 dark:text-amber-400">
                                    No historical dates detected in current description
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Verification Results Section */}
                        {verificationResult && (
                          <div className={cn(
                            "p-4 rounded-lg border",
                            verificationResult.approved
                              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                              : "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800"
                          )}>
                            <div className="flex items-center justify-between mb-3">
                              <h5 className="text-sm font-medium flex items-center">
                                <CheckCircle className={cn(
                                  "h-4 w-4 mr-2",
                                  verificationResult.approved
                                    ? "text-green-600 dark:text-green-400"
                                    : "text-orange-600 dark:text-orange-400"
                                )} />
                                <span className={cn(
                                  verificationResult.approved
                                    ? "text-green-900 dark:text-green-100"
                                    : "text-orange-900 dark:text-orange-100"
                                )}>
                                  Quality Verification
                                </span>
                              </h5>
                              <div className="flex items-center">
                                <span className={cn(
                                  "inline-flex items-center px-3 py-1 rounded-full text-sm font-medium",
                                  verificationResult.score >= 80 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                                    verificationResult.score >= 60 ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" :
                                      "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                                )}>
                                  Score: {verificationResult.score}/100
                                </span>
                              </div>
                            </div>

                            {/* Verifiable facts */}
                            {verificationResult.verifiable_facts && verificationResult.verifiable_facts.length > 0 && (
                              <div className="mb-4">
                                <h6 className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">
                                  ✅ Verifiable Facts:
                                </h6>
                                <div className="bg-white dark:bg-gray-800 rounded-md p-3 border border-gray-200 dark:border-gray-700">
                                  <ul className="list-disc pl-5 space-y-1">
                                    {verificationResult.verifiable_facts.map((fact, idx) => (
                                      <li key={idx} className="text-sm text-gray-700 dark:text-gray-300">
                                        {fact}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            )}

                            {/* Datas detectadas pela verificação */}
                            {verificationResult.detected_dates && verificationResult.detected_dates.length > 0 && (
                              <div className="mb-4">
                                <h6 className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">
                                  📅 Detected Dates:
                                </h6>
                                <div className="flex flex-wrap gap-2">
                                  {verificationResult.detected_dates.map((date, idx) => (
                                    <span key={idx} className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-700">
                                      {date}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Problemas encontrados */}
                            {!verificationResult.approved && verificationResult.issues && verificationResult.issues.length > 0 && (
                              <div className="mb-4">
                                <h6 className="text-xs font-medium text-red-700 dark:text-red-300 uppercase tracking-wide mb-2">
                                  ⚠️ Issues Found:
                                </h6>
                                <div className="bg-red-50 dark:bg-red-900/20 rounded-md p-3 border border-red-200 dark:border-red-700">
                                  <ul className="list-disc pl-5 space-y-1">
                                    {verificationResult.issues.map((issue, idx) => (
                                      <li key={idx} className="text-sm text-red-700 dark:text-red-300">
                                        {issue}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            )}

                            {/* Sugestão de melhoria */}
                            {!verificationResult.approved && verificationResult.improvement_suggestion && (
                              <div className="mb-2">
                                <h6 className="text-xs font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wide mb-2">
                                  💡 Improvement Suggestion:
                                </h6>
                                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-md p-3 border border-blue-200 dark:border-blue-700">
                                  <p className="text-sm text-blue-700 dark:text-blue-300">
                                    {verificationResult.improvement_suggestion}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Status da melhoria */}
                            {verificationResult.improvement_applied && (
                              <div className="mt-3 text-sm text-green-700 dark:text-green-300 flex items-center">
                                <CheckCircle className="h-4 w-4 mr-1" />
                                Improvements applied automatically
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Verification Section */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                      <div className="flex items-center justify-between mb-3">
                        <h5 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                          Factual Verification Status
                        </h5>
                        <VerificationBadge
                          attractionId={getPoi()?.id}
                          size="md"
                          showScore={true}
                          showVerifyButton={true}
                          onVerificationComplete={() => {
                            // Refresh modal data if needed
                            console.log('Verification completed for POI:', getPoi()?.id);
                          }}
                        />
                      </div>
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        Automatic verification checks factual claims against authoritative sources (Wikipedia, IPHAN, UNESCO).
                        Only original descriptions are verified.
                      </p>
                    </div>

                    {/* Description Editor */}
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <div className="flex items-center">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                              Attraction Description
                            </label>
                            {/* Score badge - always visible */}
                            {verificationResult && (
                              <div className="ml-3">
                                <span className={cn(
                                  "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
                                  getScoreBackgroundColor(verificationResult.score / 100),
                                  getScoreColor(verificationResult.score / 100)
                                )}>
                                  <span className="font-bold">Score: {verificationResult.score}</span>
                                  {verificationResult.approved && <CheckCircle className="h-3 w-3 ml-1 text-green-600" />}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        <textarea
                          value={currentDescription}
                          onChange={(e) => setCurrentDescription(e.target.value)}
                          rows={6}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white resize-none"
                          placeholder="Enter a rich cultural and historical description for this attraction..."
                        />
                        <div className="flex justify-between items-center mt-2">
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {currentDescription.length} characters
                          </div>
                          {verificationResult && (
                            <div className="flex items-center">
                              {verificationResult.approved ? (
                                <span className="text-xs text-green-600 dark:text-green-400 flex items-center">
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Verified quality
                                </span>
                              ) : (
                                <span className="text-xs text-orange-600 dark:text-orange-400 flex items-center">
                                  <AlertCircle className="h-3 w-3 mr-1" />
                                  Review suggested
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Statistics */}
                      {/* <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-md">
                    <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                      Description Statistics
                    </h5>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex items-center space-x-2">
                        <Play className="h-4 w-4 text-tuggi-orange" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          Play Count: <span className="font-medium text-tuggi-orange">{descriptionStats.play_count}</span>
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Clock className="h-4 w-4 text-tuggi-orange" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          Last Played: <span className="font-medium text-tuggi-orange">
                            {descriptionStats.last_played_at 
                              ? formatDate(descriptionStats.last_played_at)
                              : 'Never'
                            }
                          </span>
                        </span>
                      </div>
                    </div>
                  </div> */}

                      {/* Save Actions */}
                      <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {currentDescription !== originalDescription && (
                            <span className="text-tuggi-orange">• Unsaved changes</span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={saveDescription}
                            disabled={isSavingDescription || isGeneratingAudio || isGenerating || currentDescription === originalDescription}
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-tuggi-blue hover:bg-tuggi-blue/90 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50"
                          >
                            <Save className="h-4 w-4 mr-2" />
                            {isSavingDescription ? 'Saving...' : 'Save Description'}
                          </button>
                          <button
                            onClick={saveDescriptionAndGenerateAudios}
                            disabled={isSavingDescription || isGeneratingAudio || isGenerating || currentDescription === originalDescription}
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-tuggi-orange hover:bg-tuggi-orange/90 focus:outline-none focus:ring-2 focus:ring-tuggi-orange disabled:opacity-50"
                            title="Save description and generate audios in Portuguese, English, and Spanish"
                          >
                            <Volume2 className="h-4 w-4 mr-2" />
                            {isSavingDescription || isGeneratingAudio ? 'Processing...' : 'Save & Generate Audios'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Descriptions */}
                    {descriptions.length > 0 && (
                      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                        <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                          Descriptions
                        </h4>
                        <div className="space-y-3">
                          {descriptions.map((desc, index) => (
                            <div key={desc.id} className="bg-gray-50 dark:bg-gray-700 p-4 rounded-md">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center space-x-2">
                                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    {desc.language === 'pt-br' ? '🇧🇷 Portuguese (BR)' :
                                      desc.language === 'pt' ? '🇧🇷 Portuguese' :
                                        desc.language === 'en' ? '🇺🇸 English' :
                                          desc.language === 'es' ? '🇪🇸 Spanish' :
                                            `${desc.language.toUpperCase()}`}
                                  </span>
                                  {desc.play_count > 0 && (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-tuggi-orange/10 text-tuggi-orange">
                                      <Play className="h-3 w-3 mr-1" />
                                      {desc.play_count} plays
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {formatDate(desc.created_at)}
                                </span>
                              </div>
                              <p className="text-sm text-gray-900 dark:text-white">{desc.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : activeTab === 'trigger-points' ? (
              <div className="h-[80vh]">
                <TriggerPointsManager
                  attractionId={getPoi()?.id || ''}
                  attractionName={getPoi()?.name || ''}
                  attractionCoordinates={getPoi()?.coordinates ? { lat: getPoi()!.coordinates!.latitude, lng: getPoi()!.coordinates!.longitude } : { lat: 0, lng: 0 }}
                  attractionTypes={getPoi()?.google_types || []}
                />
              </div>
            ) : activeTab === 'narration-audio' ? (
              <div className="px-6 py-4 max-h-[80vh] overflow-y-auto">
                {isLoading ? (
                  <div className="animate-pulse space-y-4">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                    <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                          Narration Audio
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          Generate audio narration from attraction descriptions using OpenAI TTS
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => {
                            console.log('🔄 Refreshing descriptions data...')
                            fetchAdditionalData()
                          }}
                          className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Refresh
                        </button>
                        <button
                          onClick={() => {
                            // Always regenerate all audios (PT, EN, ES)
                            regenerateAllAudios()
                          }}
                          disabled={isGeneratingAudio || isTranslating || (!currentDescription.trim() && !currentAudioUrl)}
                          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-tuggi-blue hover:bg-tuggi-blue/90 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50"
                        >
                          {(isGeneratingAudio || isTranslating) ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Generating All Audios...
                            </>
                          ) : (
                            <>
                              <Volume2 className="h-4 w-4 mr-2" />
                              {currentAudioUrl ? 'Regenerate All Audios' : 'Generate All Audios'}
                            </>
                          )}
                        </button>
                        {currentAudioUrl && (
                          <span className="text-xs text-tuggi-orange">
                            ⚠️ This will replace the existing audio
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Audio Progress Bar */}
                    {(isGeneratingAudio || isTranslating) && audioProgress.total > 0 && (
                      <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="flex items-center justify-between mb-2">
                          <h6 className="text-sm font-medium text-blue-900 dark:text-blue-300">
                            Audio Generation Progress
                          </h6>
                          <span className="text-sm text-blue-700 dark:text-blue-400">
                            {audioProgress.current}/{audioProgress.total}
                          </span>
                        </div>
                        <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2 mb-2">
                          <div
                            className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all duration-300 ease-out"
                            style={{ width: `${(audioProgress.current / audioProgress.total) * 100}%` }}
                          ></div>
                        </div>
                        <p className="text-sm text-blue-700 dark:text-blue-400">
                          {audioProgress.currentTask}
                        </p>
                      </div>
                    )}

                    {/* Audio Results */}
                    {showResults && audioResults.length > 0 && (
                      <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between mb-3">
                          <h6 className="text-sm font-medium text-gray-900 dark:text-white">
                            🎯 Generation Results
                          </h6>
                          <button
                            onClick={() => setShowResults(false)}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="space-y-2">
                          {audioResults.map((result, index) => (
                            <div
                              key={index}
                              className={`p-2 rounded text-sm ${result.includes('✅')
                                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                                }`}
                            >
                              {result}
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">
                              Success: {audioResults.filter(r => r.includes('✅')).length}/{audioResults.length}
                            </span>
                            <button
                              onClick={() => fetchAdditionalData()}
                              className="inline-flex items-center px-2 py-1 text-xs bg-tuggi-blue text-white rounded hover:bg-tuggi-blue/90"
                            >
                              <RotateCcw className="h-3 w-3 mr-1" />
                              Refresh List
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Available Audios Section */}
                    {translatedDescriptions.length > 0 && (
                      <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center justify-between mb-4">
                          <h5 className="text-lg font-medium text-gray-900 dark:text-white">
                            🎵 Available Audios
                          </h5>
                          <button
                            onClick={regenerateAllAudios}
                            disabled={isGeneratingAudio || isTranslating || isSavingDescription || isGenerating || !currentDescription.trim()}
                            className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-tuggi-orange hover:bg-tuggi-orange/90 focus:outline-none focus:ring-2 focus:ring-tuggi-orange disabled:opacity-50"
                          >
                            {(isGeneratingAudio || isTranslating) ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Regenerating All...
                              </>
                            ) : (
                              <>
                                <RotateCcw className="h-4 w-4 mr-2" />
                                Regenerate All Audios
                              </>
                            )}
                          </button>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full table-auto">
                            <thead>
                              <tr className="border-b border-gray-200 dark:border-gray-600">
                                <th className="text-left py-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-300">Language</th>
                                <th className="text-left py-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-300">Gender</th>
                                <th className="text-left py-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-300">Description</th>
                                <th className="text-left py-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-300">Audio</th>
                                <th className="text-left py-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-300">Stats</th>
                                <th className="text-left py-2 px-3 text-sm font-medium text-gray-700 dark:text-gray-300">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {translatedDescriptions.map((desc, index) => (
                                <tr key={desc.id} className={index % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800'}>
                                  <td className="py-3 px-3 text-sm">
                                    <div className="flex items-center space-x-2">
                                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300">
                                        {desc.language === 'pt-br' ? '🇧🇷 PT-BR' :
                                          desc.language === 'pt' ? '🇧🇷 PT' :
                                            desc.language === 'en-us' ? '🇺🇸 EN-US' :
                                              desc.language === 'es-es' ? '🇪🇸 ES-ES' :
                                                desc.language?.toUpperCase()}
                                      </span>
                                      {(() => {
                                        // Check if audio might be outdated
                                        const ptDesc = descriptions.find(d => d.language === 'pt-br' || d.language === 'pt')
                                        const isOutdated = ptDesc && desc.updated_at && ptDesc.updated_at &&
                                          new Date(ptDesc.updated_at) > new Date(desc.updated_at)

                                        if (isOutdated) {
                                          return (
                                            <span className="inline-flex items-center px-1 py-0.5 rounded text-xs bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300" title="Audio may be outdated - Portuguese description was updated after this audio">
                                              ⚠️
                                            </span>
                                          )
                                        }
                                        return null
                                      })()}
                                    </div>
                                  </td>
                                  <td className="py-3 px-3 text-sm">
                                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${desc.gender === 'male'
                                      ? 'bg-indigo-100 dark:bg-indigo-900/20 text-indigo-800 dark:text-indigo-300'
                                      : 'bg-pink-100 dark:bg-pink-900/20 text-pink-800 dark:text-pink-300'
                                      }`}>
                                      {desc.gender === 'male' ? '♂️ Male' : '♀️ Female'}
                                    </span>
                                  </td>
                                  <td className="py-3 px-3 text-sm">
                                    <div className="max-w-xs overflow-hidden">
                                      <p className="text-gray-900 dark:text-white truncate" title={desc.description}>
                                        {desc.description?.substring(0, 50) || 'No description'}...
                                      </p>
                                    </div>
                                  </td>
                                  <td className="py-3 px-3 text-sm">
                                    {desc.audio_url ? (
                                      <button
                                        onClick={() => {
                                          const audio = new Audio(desc.audio_url)
                                          audio.play()
                                        }}
                                        className="inline-flex items-center px-2 py-1 text-xs bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300 rounded hover:bg-green-200 dark:hover:bg-green-800/30"
                                      >
                                        <Volume2 className="h-3 w-3 mr-1" />
                                        Play
                                      </button>
                                    ) : (
                                      <span className="text-xs text-gray-500 dark:text-gray-400">No audio</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-3 text-sm">
                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                      <p>Plays: {desc.play_count || 0}</p>
                                      {desc.last_played_at && (
                                        <p>Last: {formatDate(desc.last_played_at)}</p>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-3 px-3 text-sm">
                                    <div className="flex items-center space-x-2">
                                      {desc.audio_url && (
                                        <button
                                          onClick={() => window.open(desc.audio_url, '_blank')}
                                          className="inline-flex items-center px-2 py-1 text-xs bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300 rounded hover:bg-green-200 dark:hover:bg-green-800/30"
                                        >
                                          <Download className="h-3 w-3 mr-1" />
                                          Download
                                        </button>
                                      )}
                                      <button
                                        onClick={() => regenerateTranslation(desc.language, desc.gender)}
                                        disabled={isTranslating || isSavingDescription || isGeneratingAudio || isGenerating}
                                        className="inline-flex items-center px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-800/30 disabled:opacity-50"
                                      >
                                        <RotateCcw className="h-3 w-3 mr-1" />
                                        Regenerate
                                      </button>
                                      <button
                                        onClick={() => deleteTranslation(desc.id, desc.language, desc.gender)}
                                        disabled={isTranslating || isSavingDescription || isGeneratingAudio || isGenerating}
                                        className="inline-flex items-center px-2 py-1 text-xs bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-800/30 disabled:opacity-50"
                                      >
                                        <Trash2 className="h-3 w-3 mr-1" />
                                        Delete
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Current Audio Section - Fallback for when no translations exist */}
                    {translatedDescriptions.length === 0 && (
                      <div className="bg-gray-50 dark:bg-gray-700 p-6 rounded-lg text-center">
                        <Volume2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h5 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                          No Audio Available
                        </h5>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                          Generate audio narration from the attraction description to provide visitors with rich, spoken content.
                        </p>
                        {!currentDescription.trim() && (
                          <p className="text-sm text-tuggi-orange">
                            ⚠️ Please save a description first before generating audio narration.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Audio Management Info */}
                    {/* {(currentAudioUrl || translatedDescriptions.length > 0) && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div className="flex items-start space-x-3">
                      <div className="flex-shrink-0">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300">
                          <Volume2 className="h-4 w-4" />
                        </span>
                      </div>
                      <div className="flex-1">
                        <h6 className="text-sm font-medium text-blue-900 dark:text-blue-200 mb-2">
                          🤖 Intelligent Audio Regeneration System
                        </h6>
                        <div className="text-sm text-blue-800 dark:text-blue-300 space-y-1">
                          <p>• <strong>Automatic Detection:</strong> When you save a modified description, the system will offer to regenerate all audios automatically</p>
                          <p>• <strong>Individual Regeneration:</strong> Use the "Regenerate" button next to each audio to update only a specific language/gender</p>
                          <p>• <strong>Complete Regeneration:</strong> Use "Regenerate All Audios" to recreate all audios (PT, EN, ES) based on the current description</p>
                          <p>• <strong>Visual Indicators:</strong> The ⚠️ symbol indicates audios that may be outdated relative to the Portuguese description</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )} */}

                    {/* Divider above the two-column section */}
                    <div className="my-6 border-t border-gray-200 dark:border-gray-700" />

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                      {/* Right Column: Translate & Generate Audio (order-1 on mobile) */}
                      <div className="order-1 lg:order-2 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 p-4 lg:p-6 rounded-lg border border-purple-200 dark:border-purple-800 h-full flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-200">
                              <Globe className="h-4 w-4" />
                            </span>
                            <h5 className="text-lg font-medium text-purple-900 dark:text-purple-200">
                              Translate & Generate Audio
                            </h5>
                          </div>
                        </div>
                        <p className="text-sm text-purple-700 dark:text-purple-300 mb-4">
                          Generate translated descriptions and audio using Gemini 1.5 Pro and Google TTS
                        </p>
                        <div className="space-y-6 flex-1">
                          {/* Language Selector */}
                          <div>
                            <label className="block text-sm font-medium text-purple-700 dark:text-purple-300 mb-2" htmlFor="target-language">
                              Target Language
                            </label>
                            <select
                              id="target-language"
                              value={selectedLanguage}
                              onChange={(e) => setSelectedLanguage(e.target.value)}
                              disabled={isTranslating || isSavingDescription || isGeneratingAudio || isGenerating}
                              className="w-full px-3 py-2 border border-purple-300 dark:border-purple-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 dark:bg-gray-700 dark:text-white disabled:opacity-50"
                            >
                              {/* <option value="en-us">🇺🇸 English (US)</option>
                          <option value="es-es">🇪🇸 Spanish (Spain)</option> */}
                              <option value="fr-fr">🇫🇷 French (France)</option>
                              <option value="it-it">🇮🇹 Italian (Italy)</option>
                              <option value="de-de">🇩🇪 German (Germany)</option>
                            </select>
                          </div>
                          {/* Gender Selector */}
                          <div>
                            <label className="block text-sm font-medium text-purple-700 dark:text-purple-300 mb-2">
                              Voice Gender
                            </label>
                            <div className="space-y-2">
                              <label className="flex items-center">
                                <input
                                  type="radio"
                                  name="gender"
                                  value="male"
                                  checked={selectedGender === 'male'}
                                  onChange={(e) => setSelectedGender(e.target.value as 'male' | 'female')}
                                  disabled={isTranslating || isSavingDescription || isGeneratingAudio || isGenerating}
                                  className="mr-2 text-purple-600 focus:ring-purple-500"
                                />
                                <span className="text-sm text-purple-700 dark:text-purple-300">
                                  Male (Default)
                                </span>
                              </label>
                              <label className="flex items-center">
                                <input
                                  type="radio"
                                  name="gender"
                                  value="female"
                                  checked={selectedGender === 'female'}
                                  onChange={(e) => setSelectedGender(e.target.value as 'male' | 'female')}
                                  disabled={isTranslating || isSavingDescription || isGeneratingAudio || isGenerating}
                                  className="mr-2 text-purple-600 focus:ring-purple-500"
                                />
                                <span className="text-sm text-purple-700 dark:text-purple-300">
                                  Female
                                </span>
                              </label>
                            </div>
                          </div>
                          {/* Generate Button */}
                          <div>
                            <label className="block text-sm font-medium text-purple-700 dark:text-purple-300 mb-2">
                              Action
                            </label>
                            <button
                              aria-label="Translate and generate audio"
                              onClick={async () => {
                                await translateAndGenerateAudio();
                                // Show toast on success (pseudo-code, replace with your toast system)
                                // showToast('Translation and audio generated successfully!', 'success');
                              }}
                              disabled={isTranslating || isSavingDescription || isGeneratingAudio || isGenerating || !currentDescription.trim()}
                              className="w-full inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isTranslating ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Translating...
                                </>
                              ) : (
                                <>
                                  <Volume2 className="h-4 w-4 mr-2" />
                                  Translate & Generate
                                </>
                              )}
                            </button>
                          </div>
                          {/* Validation Messages */}
                          {!currentDescription.trim() && (
                            <div className="bg-amber-100 dark:bg-amber-900/10 p-3 rounded-md border border-amber-200 dark:border-amber-800 flex items-center gap-2 mt-2">
                              <span className="text-amber-600 dark:text-amber-300">
                                <AlertTriangle className="h-4 w-4" />
                              </span>
                              <span className="text-sm text-amber-800 dark:text-amber-200">
                                ⚠️ Please save an original description first before generating translations.{' '}
                                <button
                                  type="button"
                                  className="underline text-amber-800 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100 ml-1"
                                  onClick={() => setActiveTab('description')}
                                >
                                  Go to Description
                                </button>
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Left Column: Audio Generation Settings (order-2 on mobile) */}
                      <div className="order-2 lg:order-1 bg-gray-50 dark:bg-gray-700 p-4 lg:p-6 rounded-lg h-full flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
                              <Globe className="h-4 w-4" />
                            </span>
                            <h5 className="text-lg font-medium text-gray-900 dark:text-white">
                              Audio Generation Settings
                            </h5>
                          </div>
                          {currentAudioUrl && (
                            <span className="text-xs bg-tuggi-blue/10 text-tuggi-blue px-2 py-1 rounded-full">
                              💡 Try different settings and regenerate
                            </span>
                          )}
                        </div>
                        <div className="space-y-6 flex-1">
                          {/* Provider Selection */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3" htmlFor="audio-provider">
                              Audio Provider
                            </label>
                            <select
                              id="audio-provider"
                              value={audioProvider}
                              onChange={e => setAudioProvider(e.target.value as 'openai' | 'google')}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                            >
                              <option value="openai">OpenAI</option>
                              <option value="google">Google</option>
                            </select>
                          </div>
                          {/* Voice Selection */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                              Voice Selection
                            </label>
                            <div className="space-y-2">
                              {audioProvider === 'google' ? (
                                <>
                                  <label className="flex items-center">
                                    <input
                                      type="radio"
                                      name="voice"
                                      value="shimmer"
                                      checked={selectedVoice === 'shimmer'}
                                      onChange={(e) => setSelectedVoice(e.target.value)}
                                      className="mr-2 text-tuggi-blue focus:ring-tuggi-blue"
                                    />
                                    <span className="text-sm">
                                      <strong>Shimmer</strong> - Google: Wavenet-B (Energetic, engaging)
                                    </span>
                                  </label>
                                  <label className="flex items-center">
                                    <input
                                      type="radio"
                                      name="voice"
                                      value="nova"
                                      checked={selectedVoice === 'nova'}
                                      onChange={(e) => setSelectedVoice(e.target.value)}
                                      className="mr-2 text-tuggi-blue focus:ring-tuggi-blue"
                                    />
                                    <span className="text-sm">
                                      <strong>Nova</strong> - Google: Wavenet-A (Professional, clear female)
                                    </span>
                                  </label>
                                  <label className="flex items-center">
                                    <input
                                      type="radio"
                                      name="voice"
                                      value="alloy"
                                      checked={selectedVoice === 'alloy'}
                                      onChange={(e) => setSelectedVoice(e.target.value)}
                                      className="mr-2 text-tuggi-blue focus:ring-tuggi-blue"
                                    />
                                    <span className="text-sm">
                                      <strong>Alloy</strong> - Google: Wavenet-D (Warm, friendly)
                                    </span>
                                  </label>
                                  <label className="flex items-center">
                                    <input
                                      type="radio"
                                      name="voice"
                                      value="echo"
                                      checked={selectedVoice === 'echo'}
                                      onChange={(e) => setSelectedVoice(e.target.value)}
                                      className="mr-2 text-tuggi-blue focus:ring-tuggi-blue"
                                    />
                                    <span className="text-sm">
                                      <strong>Echo</strong> - Google: Wavenet-E (Calm, soothing)
                                    </span>
                                  </label>
                                </>
                              ) : (
                                <>
                                  <label className="flex items-center">
                                    <input
                                      type="radio"
                                      name="voice"
                                      value="shimmer"
                                      checked={selectedVoice === 'shimmer'}
                                      onChange={(e) => setSelectedVoice(e.target.value)}
                                      className="mr-2 text-tuggi-blue focus:ring-tuggi-blue"
                                    />
                                    <span className="text-sm">
                                      <strong>Shimmer</strong> - Energetic, engaging voice
                                    </span>
                                  </label>
                                  <label className="flex items-center">
                                    <input
                                      type="radio"
                                      name="voice"
                                      value="nova"
                                      checked={selectedVoice === 'nova'}
                                      onChange={(e) => setSelectedVoice(e.target.value)}
                                      className="mr-2 text-tuggi-blue focus:ring-tuggi-blue"
                                    />
                                    <span className="text-sm">
                                      <strong>Nova</strong> - Professional, clear female voice
                                    </span>
                                  </label>
                                  <label className="flex items-center">
                                    <input
                                      type="radio"
                                      name="voice"
                                      value="alloy"
                                      checked={selectedVoice === 'alloy'}
                                      onChange={(e) => setSelectedVoice(e.target.value)}
                                      className="mr-2 text-tuggi-blue focus:ring-tuggi-blue"
                                    />
                                    <span className="text-sm">
                                      <strong>Alloy</strong> - Warm, friendly voice for nature content
                                    </span>
                                  </label>
                                  <label className="flex items-center">
                                    <input
                                      type="radio"
                                      name="voice"
                                      value="echo"
                                      checked={selectedVoice === 'echo'}
                                      onChange={(e) => setSelectedVoice(e.target.value)}
                                      className="mr-2 text-tuggi-blue focus:ring-tuggi-blue"
                                    />
                                    <span className="text-sm">
                                      <strong>Echo</strong> - Calm, soothing voice
                                    </span>
                                  </label>
                                </>
                              )}
                            </div>
                          </div>
                          {/* Speed Control */}
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                              Speaking Speed: {audioSpeed.toFixed(1)}x
                            </label>
                            <input
                              type="range"
                              min="0.7"
                              max="1.3"
                              step="0.1"
                              value={audioSpeed}
                              onChange={(e) => setAudioSpeed(parseFloat(e.target.value))}
                              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                            />
                            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                              <span>0.7x (Slower)</span>
                              <span>1.0x (Normal)</span>
                              <span>1.3x (Faster)</span>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                              {audioSpeed < 0.9 ? "Slower speed for better comprehension" :
                                audioSpeed > 1.1 ? "Faster speed for quick listening" :
                                  "Optimal speed for tourism content"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>



                    {/* Debug Info */}
                    {/* <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-200 dark:border-yellow-800">
                  <h5 className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                    🔍 Debug Information
                  </h5>
                  <div className="text-xs text-yellow-700 dark:text-yellow-300 space-y-1">
                    <p><strong>Current Description Length:</strong> {currentDescription.length} characters</p>
                    <p><strong>Descriptions Found:</strong> {descriptions.length} records</p>
                    <p><strong>Available Languages:</strong> {descriptions.map(d => d.language).join(', ') || 'None'}</p>
                    <p><strong>Has Audio URL:</strong> {currentAudioUrl ? 'Yes' : 'No'}</p>
                    {descriptions.length > 0 && (
                      <p><strong>First Description Preview:</strong> {descriptions[0]?.description?.substring(0, 50) || 'Empty'}...</p>
                    )}
                  </div>
                </div> */}
                  </div>
                )}
              </div>
            ) : activeTab === 'group-pois' ? (
              <div className="px-6 py-4 max-h-[80vh] overflow-y-auto">
                {getPoi()?.coordinates ? (
                  <div className="space-y-6">
                    {/* Header Section */}
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                          <Users className="h-5 w-5 text-tuggi-blue" />
                          Group Management
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                          Create or manage groups of nearby POIs for combined audio experiences
                        </p>
                      </div>
                      {groupInfo && (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800">
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Grouped
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
                              This POI is part of a group. Group descriptions will be shared across all members.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Map Section */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h5 className="font-medium text-gray-900 dark:text-white">
                          Select Area & POIs
                        </h5>
                        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                          <MapPin className="h-4 w-4" />
                          Draw polygon to find nearby POIs
                        </div>
                      </div>

                      <div className="relative">
                        <div className="w-full h-80 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
                          <GoogleMapComponent
                            center={{ lat: getPoi()!.coordinates!.latitude, lng: getPoi()!.coordinates!.longitude }}
                            zoom={18}
                            height="100%"
                            markers={[
                              { id: getPoi()!.id, position: { lat: getPoi()!.coordinates!.latitude, lng: getPoi()!.coordinates!.longitude }, title: `${getPoi()!.name} (Main POI)`, color: '#10B981' },
                              ...nearbyPOIs.filter((p: any) => p.coordinates && p.coordinates.latitude && p.coordinates.longitude).map((p: any) => ({
                                id: p.id,
                                position: { lat: p.coordinates.latitude, lng: p.coordinates.longitude },
                                title: p.name,
                                color: selectedPOIs.includes(p.id) ? '#FF6F00' : '#888'
                              }))
                            ]}
                            onMarkerClick={handleTogglePOI}
                            onPolygonComplete={handlePolygonComplete}
                          />
                        </div>

                        {/* Legend */}
                        <div className="absolute top-3 right-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-3">
                          <div className="space-y-2 text-xs">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                              <span className="text-gray-700 dark:text-gray-300">Main POI</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 bg-tuggi-orange rounded-full"></div>
                              <span className="text-gray-700 dark:text-gray-300">Selected</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
                              <span className="text-gray-700 dark:text-gray-300">Available</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* POI Selection Section */}
                    <div className="space-y-3">
                      <h5 className="font-medium text-gray-900 dark:text-white">
                        Nearby POIs ({nearbyPOIs.length} found)
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
                          <p className="text-sm font-medium">No nearby POIs found</p>
                          <p className="text-xs mt-1">Draw a polygon on the map to search for POIs in a specific area</p>
                        </div>
                      )}
                    </div>

                    {/* Group Configuration */}
                    <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                      <h5 className="font-medium text-gray-900 dark:text-white">
                        Group Configuration
                      </h5>

                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Group Name
                          </label>
                          <input
                            type="text"
                            value={groupName}
                            onChange={e => setGroupName(e.target.value)}
                            placeholder="Enter group name"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                          />
                        </div>

                        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                              Main POI: {getPoi()?.name || 'N/A'}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              This POI will hold the group description
                            </p>
                          </div>
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300">
                            Main
                          </span>
                        </div>

                        {selectedPOIs.length > 0 && (
                          <div className="p-3 bg-tuggi-blue/5 dark:bg-tuggi-blue/10 rounded-lg">
                            <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                              Selected POIs ({selectedPOIs.length})
                            </p>
                            <div className="space-y-1">
                              {selectedPOIs.map(id => {
                                // First check if it's the main POI
                                if (id === getPoi()?.id) {
                                  return (
                                    <div key={id} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                      <Users className="h-3 w-3" />
                                      {getPoi()?.name || 'N/A'} (Main)
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
                          <span>Select at least 1 POI to create a group</span>
                        ) : (
                          <span>Ready to {groupInfo ? 'update' : 'create'} group with {selectedPOIs.length + 1} POIs</span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        {groupInfo && (
                          <button
                            onClick={() => {
                              // Handle group deletion
                              if (window.confirm('Are you sure you want to disband this group?')) {
                                // Add delete group logic here
                              }
                            }}
                            className="inline-flex items-center px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Disband Group
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
                    <p className="text-lg font-medium">No coordinates available</p>
                    <p className="text-sm mt-1">This POI needs coordinates to create groups with nearby POIs</p>
                  </div>
                )}
              </div>
            ) : activeTab === 'review' ? (
              <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
                <div className="space-y-4">
                  {/* Header */}
                  <div className="text-center">
                    <h4 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center justify-center gap-2">
                      <CheckCircle className="h-5 w-5 text-tuggi-blue" />
                      Review for Approval
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      Verify all information is correct before approving the POI
                    </p>

                    {/* Score Badge - Always visible */}
                    <div className="mt-4 mb-2">
                      <div className={cn(
                        "inline-flex items-center px-4 py-2 rounded-lg text-base font-medium shadow-sm border",
                        verificationResult ? getScoreBackgroundColor(verificationResult.score / 100) : "bg-gray-100 dark:bg-gray-800",
                        verificationResult ? getScoreColor(verificationResult.score / 100) : "text-gray-800 dark:text-gray-200",
                        verificationResult ? "border-current" : "border-gray-300 dark:border-gray-700"
                      )}>
                        <div className="flex flex-col items-center">
                          <div className="flex items-center">
                            <span className="font-bold text-lg">
                              {verificationResult ? `${verificationResult.score}/100` : 'Not Verified'}
                            </span>
                            {verificationResult?.approved && <CheckCircle className="h-5 w-5 ml-2 text-green-600" />}
                          </div>
                          <span className="text-sm mt-1">
                            {verificationResult ? getScoreDescription(verificationResult.score / 100) : 'Not Verified'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* POI Summary */}
                  <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                    <h5 className="text-base font-medium text-gray-900 dark:text-white mb-3">
                      POI Summary
                    </h5>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Name</p>
                        <p className="text-gray-900 dark:text-white truncate">{getPoi()?.name || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Types</p>
                        <div className="flex flex-wrap gap-1">
                          {getPoi()?.google_types && getPoi()!.google_types!.length > 0 ? (
                            getPoi()!.google_types!.slice(0, 3).map((type: string, index: number) => (
                              <span
                                key={index}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
                              >
                                {type.replace(/_/g, ' ')}
                              </span>
                            ))
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400 text-xs">No types</span>
                          )}
                          {getPoi()?.google_types && getPoi()!.google_types!.length > 3 && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">+{getPoi()!.google_types!.length - 3} more</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Location</p>
                        <p className="text-gray-900 dark:text-white truncate">{getPoi()?.city || 'N/A'}, {getPoi()?.state || getPoi()?.country || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Rating</p>
                        <div className="flex items-center gap-1">
                          <Star className="h-3 w-3 text-yellow-400" />
                          <span className="text-gray-900 dark:text-white">{getPoi()?.rating?.toFixed(1) || 'N/A'}</span>
                        </div>
                      </div>
                    </div>

                    {currentDescription.trim() && (
                      <div className="mt-3">
                        <div className="flex justify-between items-center mb-1">
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Description</p>
                          {verificationResult && (
                            <span className={cn(
                              "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                              verificationResult.score >= 80 ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                                verificationResult.score >= 60 ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" :
                                  "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                            )}>
                              Score: {verificationResult.score}/100
                              {verificationResult.approved && <CheckCircle className="h-3 w-3 ml-1 text-green-600" />}
                            </span>
                          )}
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-800 rounded p-2 max-h-20 overflow-y-auto">
                          <p className="text-xs text-gray-900 dark:text-white">{currentDescription}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Validation Summary */}
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                    <h5 className="text-base font-medium text-gray-900 dark:text-white mb-3">
                      Validation Status
                    </h5>

                    <div className="space-y-2">
                      {/* Description Check */}
                      <div className="flex items-center justify-between p-2 rounded border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-gray-500" />
                          <span className="text-sm font-medium text-gray-900 dark:text-white">Description</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Status badge */}
                          {currentDescription.trim() ? (
                            <>
                              <div className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                                (verificationResult?.score || 0) >= 80 ? "bg-green-100 text-green-800" :
                                  (verificationResult?.score || 0) >= 60 ? "bg-yellow-100 text-yellow-800" :
                                    (verificationResult?.score || 0) > 0 ? "bg-orange-100 text-orange-800" :
                                      "bg-blue-100 text-blue-800"
                              )}>
                                {verificationResult ?
                                  verificationResult.approved ? 'Verified' :
                                    `Score: ${verificationResult.score}/100`
                                  : 'Complete'}
                              </div>

                              {/* Icon */}
                              {verificationResult?.approved ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (verificationResult?.score || 0) >= 60 ? (
                                <CheckCircle className="h-4 w-4 text-yellow-500" />
                              ) : (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              )}
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="h-4 w-4 text-red-500" />
                              <span className="text-xs text-red-600 dark:text-red-400">Required</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Audio Check */}
                      <div className="flex items-center justify-between p-2 rounded border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-2">
                          <Volume2 className="h-4 w-4 text-gray-500" />
                          <span className="text-sm font-medium text-gray-900 dark:text-white">Audio</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {translatedDescriptions.length > 0 ? (
                            <>
                              <CheckCircle className="h-4 w-4 text-green-500" />
                              <span className="text-xs text-green-600 dark:text-green-400">
                                {translatedDescriptions.length} audio(s) available
                              </span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="h-4 w-4 text-red-500" />
                              <span className="text-xs text-red-600 dark:text-red-400">Minimum 1 audio required</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Trigger Points Check */}
                      <div className="flex items-center justify-between p-2 rounded border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-2">
                          <Target className="h-4 w-4 text-gray-500" />
                          <span className="text-sm font-medium text-gray-900 dark:text-white">Trigger Points</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Info className="h-4 w-4 text-blue-500" />
                          <span className="text-xs text-blue-600 dark:text-blue-400">
                            Optional ({translatedDescriptions.length || 0} configured)
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>



                  {/* Approval Status */}
                  <div className={cn(
                    "rounded-lg p-4 border",
                    currentDescription.trim() && translatedDescriptions.length > 0
                      ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                      : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                  )}>
                    <div className="flex items-center gap-2">
                      {currentDescription.trim() && translatedDescriptions.length > 0 ? (
                        <>
                          <CheckCircle className="h-5 w-5 text-green-500" />
                          <div>
                            <h6 className="text-sm font-medium text-green-900 dark:text-green-200">
                              Ready for Approval
                            </h6>
                            <p className="text-xs text-green-700 dark:text-green-300">
                              All required criteria have been met
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-5 w-5 text-red-500" />
                          <div>
                            <h6 className="text-sm font-medium text-red-900 dark:text-red-200">
                              Pending Requirements
                            </h6>
                            <p className="text-xs text-red-700 dark:text-red-300">
                              Complete required criteria before approval
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Footer - Show buttons only for review tab */}
          {activeTab === 'review' && (
            <div className="bg-gray-50 dark:bg-gray-900 px-6 py-4">
              <div className="flex items-center justify-between">
                <div></div>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
                  >
                    Cancel
                  </button>
                  {!getPoi()?.approved && cmsUserRole === 'admin' && (
                    <button
                      onClick={handleApprove}
                      disabled={isSaving || !currentDescription.trim() || translatedDescriptions.length === 0}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      {isSaving ? 'Approving...' : 'Approve POI'}
                    </button>
                  )}
                  {getPoi()?.approved && cmsUserRole === 'admin' && (
                    <div className="inline-flex items-center px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-md">
                      <CheckCircle className="h-4 w-4 mr-2" />
                      POI Approved
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}