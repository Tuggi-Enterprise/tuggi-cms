'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { X, Save, CheckCircle, Trash2, MapPin, ExternalLink, Star, Calendar, User, Globe, Phone, Clock, Target, Info, FileText, Sparkles, RotateCcw, Play, Eye, Volume2, Download, Loader2, Users, Plus, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
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
  // Group status indicators
  group_status?: {
    is_in_group: boolean
    group_id?: string
    group_name?: string
    group_role?: 'main' | 'member'
    group_member_count?: number
  }
}

interface POIDetailsModalProps {
  poi: POI
  isOpen: boolean
  onClose: () => void
  onUpdate: () => void
}

export function POIDetailsModal({ poi, isOpen, onClose, onUpdate }: POIDetailsModalProps) {
  const [editedPoi, setEditedPoi] = useState<POI>(poi)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [descriptions, setDescriptions] = useState<any[]>([])
  const [images, setImages] = useState<any[]>([])
  const [activeTab, setActiveTab] = useState<'details' | 'description' | 'trigger-points' | 'narration-audio' | 'group-pois' | 'review'>('details')
  
  // Description editing state
  const [currentDescription, setCurrentDescription] = useState('')
  const [originalDescription, setOriginalDescription] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSavingDescription, setIsSavingDescription] = useState(false)
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
  const [referenceLinks, setReferenceLinks] = useState<string[]>(poi.reference_links || []);

  // Grouping state
  const [nearbyPOIs, setNearbyPOIs] = useState<any[]>([])
  const [selectedPOIs, setSelectedPOIs] = useState<string[]>([])
  const [groupInfo, setGroupInfo] = useState<any>(null)
  const [groupLoading, setGroupLoading] = useState(false)
  const [groupName, setGroupName] = useState(poi.name) // Default to main POI name
  const [drawnPolygon, setDrawnPolygon] = useState<Array<{ lat: number; lng: number }> | null>(null)

  const supabase = useSupabaseClient()

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
    setIsLoading(true)
    try {
      // Fetch descriptions with cache busting
      const { data: descriptionsData } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('*')
        .or(`attraction_id.eq.${poi.id},group_id.in.(${groupInfo?.id || ''})`)
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
      console.log('🔍 Fetched descriptions for POI:', poi.id, descriptionsData?.length || 0)
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
        const individualDescriptions = portugueseDescriptions?.filter(desc => desc.attraction_id === poi.id) || []
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
        console.log('❌ No description record found for POI:', poi.id)
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
        .eq('attraction_id', poi.id)
        .order('created_at', { ascending: false })

      setImages(imagesData || [])
    } catch (error) {
      console.error('Error fetching additional data:', error)
    } finally {
      setIsLoading(false)
    }
  }, [poi.id, groupInfo?.id, supabase])

  const fetchNearbyPOIs = useCallback(async () => {
    console.log('🔍 MODAL: fetchNearbyPOIs called');
    // Only fetch nearby POIs when a polygon is drawn
    // The initial load will be empty until user draws a polygon
    setNearbyPOIs([])
    console.log('🔍 MODAL: Set nearbyPOIs to empty array');
  }, [])

  const fetchGroupInfo = useCallback(async () => {
    console.log('🔍 MODAL: fetchGroupInfo called for POI:', poi.id);
    setGroupLoading(true)
    try {
      const res = await fetch(`/api/attraction-groups/of-poi?poiId=${poi.id}`)
      const data = await res.json()
      
      console.log('🔍 MODAL: API response:', data);
      
      setGroupInfo(data.group)
      setGroupName(data.group?.name || poi.name) // Use main POI name as default
      
      // Always include the main POI in selectedPOIs, plus any existing group members
      const members = data.members || []
      const selectedPOIsList = members.includes(poi.id) ? members : [poi.id, ...members]
      
      console.log('🔍 MODAL: Setting selectedPOIs to:', selectedPOIsList);
      setSelectedPOIs(selectedPOIsList)
    } catch (error) {
      console.error('❌ MODAL: Error in fetchGroupInfo:', error);
      // Fallback: at least include the main POI
      setSelectedPOIs([poi.id])
    } finally {
      setGroupLoading(false)
    }
  }, [poi.id, poi.name])

  // useEffect hooks after function declarations
  useEffect(() => {
    if (isOpen) {
      setEditedPoi(poi)
      fetchAdditionalData()
    }
  }, [poi, isOpen, fetchAdditionalData])

  // Fetch nearby POIs and group info on open
  useEffect(() => {
    if (isOpen && poi.coordinates) {
      fetchNearbyPOIs()
      fetchGroupInfo()
    }
  }, [isOpen, poi.id, poi.coordinates, fetchNearbyPOIs, fetchGroupInfo])

  // Debug effect for Group POIs tab
  useEffect(() => {
    if (activeTab === 'group-pois') {
      console.log('🔍 MODAL: Group POIs tab active');
      console.log('🔍 MODAL: POI coordinates:', poi.coordinates);
      console.log('🔍 MODAL: Current state:', { 
        nearbyPOIs: nearbyPOIs.length, 
        selectedPOIs, 
        groupInfo,
        groupName 
      });
    }
  }, [activeTab, poi.coordinates, nearbyPOIs, selectedPOIs, groupInfo, groupName])

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
    console.log('🔍 MODAL: handleSaveGroup called');
    console.log('🔍 MODAL: Current state:', { groupInfo, groupName, selectedPOIs, poiId: poi.id });
    
    setGroupLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      console.log('🔍 MODAL: Current user:', user?.id);
      
      // Always include the main POI in the group
      const poiIds = [poi.id, ...selectedPOIs.filter(id => id !== poi.id)]
      console.log('🔍 MODAL: POI IDs to save:', poiIds);
      
      const requestBody = {
        groupId: groupInfo?.id,
        name: groupName || poi.name,
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
        .eq('id', poi.id)

      if (error) throw error

      await onUpdate()
      onClose()
    } catch (error) {
      console.error('Error saving POI:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleApprove = async () => {
    setIsSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      console.log('🔍 Approving POI:', {
        poiId: poi.id,
        poiName: poi.name,
        currentUserId: user?.id,
        poiUserId: poi.user_id,
        isApproved: poi.approved
      })
      
      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .update({
          approved: true,
          approved_by: user?.id,
          approved_at: new Date().toISOString()
        })
        .eq('id', poi.id)

      if (error) {
        console.error('❌ Supabase error:', error)
        throw error
      }

      console.log('✅ POI approved successfully')
      await onUpdate()
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
    if (!window.confirm('Are you sure you want to delete this POI? This action cannot be undone.')) {
      return
    }

    setIsSaving(true)
    try {
      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .delete()
        .eq('id', poi.id)

      if (error) throw error

      await onUpdate()
      onClose()
    } catch (error) {
      console.error('Error deleting POI:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const openInGoogleMaps = () => {
    if (poi.coordinates) {
      const url = `https://www.google.com/maps/search/?api=1&query=${poi.coordinates.latitude},${poi.coordinates.longitude}`
      window.open(url, '_blank')
    }
  }

  const openWebsite = () => {
    if (poi.website) {
      window.open(poi.website, '_blank')
    }
  }

  // Description management functions
  const generateDescription = async () => {
    console.log('🚀 POI MODAL: Starting description generation...')
    setIsGenerating(true)
    try {
      console.log('📡 POI MODAL: Making request to /api/descriptions/generate')
      const response = await fetch('/api/descriptions/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: poi.id, // Add attraction id for coordinate lookup
          google_place_id: poi.google_place_id, // Add google_place_id for coordinate lookup
          lat: poi.coordinates?.latitude, // Add coordinates directly from UI
          lng: poi.coordinates?.longitude, // Add coordinates directly from UI
          name: poi.name,
          city: poi.city,
          country: poi.country,
          state: poi.state,
          formatted_address: poi.formatted_address,
          vicinity: poi.vicinity,
          google_types: poi.google_types || (poi.category ? [poi.category] : ['tourist_attraction']), // Prioritize google_types over category
          rating: poi.rating,
          user_ratings_total: poi.user_ratings_total,
          price_level: poi.price_level,
          business_status: poi.business_status,
          opening_hours: poi.opening_hours,
          website: poi.website,
          formatted_phone_number: poi.formatted_phone_number,
          photos_references: poi.photos_references?.length || 0,
          existing_description: currentDescription, // Current description for improvement
          image_url: poi.image_url,
          reference_links: referenceLinks.filter(link => !!link.trim()) // Add reference links
        })
      })

      console.log('📡 POI MODAL: Response status:', response.status)
      console.log('📡 POI MODAL: Response ok:', response.ok)
      console.log('📡 POI MODAL: Response headers:', Object.fromEntries(response.headers.entries()))
      
      if (!response.ok) {
        let errorData
        try {
          const responseText = await response.text()
          console.log('📡 POI MODAL: Response text:', responseText)
          errorData = responseText ? JSON.parse(responseText) : { error: 'Empty response' }
        } catch (parseError) {
          console.error('❌ POI MODAL: Failed to parse error response:', parseError)
          errorData = { error: 'Invalid response format' }
        }
        console.error('❌ POI MODAL: Response error:', errorData)
        throw new Error(`Failed to generate description: ${errorData.error || 'Unknown error'}`)
      }

      const data = await response.json()
      console.log('✅ POI MODAL: Description generated successfully:', data)
      setCurrentDescription(data.description)
    } catch (error) {
      console.error('Error generating description:', error)
      alert('Failed to generate description. Please try again.')
    } finally {
      setIsGenerating(false)
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
        .eq('attraction_id', poi.id)
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
        console.log('🔄 Updating existing description for POI:', poi.id)
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
        console.log('🆕 Creating new description for POI:', poi.id)
        console.log('📝 New description:', currentDescription.substring(0, 100) + '...')
        // Create new Portuguese description
        const { error } = await supabase
          .schema('core')
          .from('attraction_descriptions')
          .insert({
            attraction_id: poi.id,
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
      setDescriptions(prevDescriptions => {
        const updatedDescriptions = prevDescriptions.map(desc => {
          if (desc.attraction_id === poi.id && desc.language === 'pt-br') {
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
        .eq('attraction_id', poi.id)
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
        const { error } = await supabase
          .schema('core')
          .from('attraction_descriptions')
          .insert({
            attraction_id: poi.id,
            language: 'pt-br',
            description: currentDescription,
            play_count: 0
          })

        if (error) throw error
      }

      // Update original description to match current
      setOriginalDescription(currentDescription)
      
      // Update the descriptions array locally
      setDescriptions(prevDescriptions => {
        const updatedDescriptions = prevDescriptions.map(desc => {
          if (desc.attraction_id === poi.id && desc.language === 'pt-br') {
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
        textForAudio = `${poi.name} é uma atração localizada em ${poi.city}, ${poi.country}.`
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
          attractionId: poi.id,
          voice: voiceToSend,
          speed: audioSpeed,
          provider: audioProvider
        })
      })

      if (!ttsResponse.ok) {
        throw new Error('Failed to generate audio')
      }

      const ttsData = await ttsResponse.json()
      
      // Step 2: Upload audio to Supabase Storage
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('No active session')
      }

      const uploadResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/store-poi-audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          attractionId: poi.id,
          audioData: ttsData.audioData,
          mimeType: ttsData.mimeType,
          language: 'pt-br'
        })
      })

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload audio')
      }

      const uploadData = await uploadResponse.json()
      
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
      showFeedback('Please save a Portuguese description first before generating translations.', 'error')
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

      const requestBody = {
        attractionId: poi.id,
        targetLanguage: selectedLanguage,
        voiceGender: selectedGender
      }

      // Call the Edge Function using anon key
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-translated-audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorText = await response.text()
        
        let errorData
        try {
          errorData = JSON.parse(errorText)
        } catch (e) {
          errorData = { error: errorText }
        }
        
        throw new Error(`HTTP ${response.status}: ${errorData.error || errorText}`)
      }

      const result = await response.json()
      
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
      showFeedback('Please save a Portuguese description first.', 'error')
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

    const requestBody = {
      attractionId: poi.id,
      targetLanguage: language,
      voiceGender: gender
    }

    // Call the Edge Function
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-translated-audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorData
      try {
        errorData = JSON.parse(errorText)
      } catch (e) {
        errorData = { error: errorText }
      }
      throw new Error(`HTTP ${response.status}: ${errorData.error || errorText}`)
    }

    await response.json()
    
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
            {activeTab === 'details' ? (
              <div className="px-6 py-4 max-h-[80vh] overflow-y-auto">
            {isLoading ? (
              <div className="animate-pulse space-y-4">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Basic Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Name
                      </label>
                      <input
                        type="text"
                        value={editedPoi.name}
                        onChange={(e) => setEditedPoi(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                      />
                    </div>

                    {/* <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Category
                      </label>
                      <select
                        value={editedPoi.category || ''}
                        onChange={(e) => setEditedPoi(prev => ({ ...prev, category: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                      >
                        <option value="">Select Category</option>
                        {POI_CATEGORIES.filter(cat => cat.value !== 'all').map(category => (
                          <option key={category.value} value={category.value}>
                            {category.label}
                          </option>
                        ))}
                      </select>
                    </div> */}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          City
                        </label>
                        <input
                          type="text"
                          value={editedPoi.city}
                          onChange={(e) => setEditedPoi(prev => ({ ...prev, city: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Country
                        </label>
                        <input
                          type="text"
                          value={editedPoi.country}
                          onChange={(e) => setEditedPoi(prev => ({ ...prev, country: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                    </div>
                      <div className="space-y-4">
                        <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                          Contact & Details
                        </h4>

                        {poi.formatted_address && (
                          <div className="flex items-start space-x-">
                            <MapPin className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Address</div>
                              <div className="text-sm text-gray-900 dark:text-white">{poi.formatted_address}</div>
                            </div>
                          </div>
                        )}
                        {poi.formatted_phone_number && (
                            <div className="flex items-start space-x-2">
                              <Phone className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                              <div>
                                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Phone</div>
                                <div className="text-sm text-gray-900 dark:text-white">{poi.formatted_phone_number}</div>
                              </div>
                            </div>
                          )}

                          {poi.website && (
                            <div className="flex items-start space-x-2">
                              <Globe className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                              <div>
                                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Website</div>
                                <button
                                  onClick={openWebsite}
                                  className="text-sm text-tuggi-blue hover:text-tuggi-blue/80 underline"
                                >
                                  {poi.website}
                                </button>
                              </div>
                            </div>
                          )}

                          {poi.coordinates && (
                            <div className="flex items-start space-x-2">
                              <MapPin className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                              <div>
                                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Coordinates</div>
                                <div className="text-sm text-gray-900 dark:text-white">
                                  {poi.coordinates.latitude.toFixed(6)}, {poi.coordinates.longitude.toFixed(6)}
                                </div>
                                <button
                                  onClick={openInGoogleMaps}
                                  className="text-sm text-tuggi-blue hover:text-tuggi-blue/80 underline inline-flex items-center mt-1"
                                >
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  View on Google Maps
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                  </div>
                  

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-4">
                      {/* Image Preview */}
                      {(() => {
                        const fullSizeImageUrl = getFullSizeImageUrl(poi)
                        return (fullSizeImageUrl || images.length > 0) && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Images
                            </label>
                            <div className="space-y-4 mr-2">
                              {fullSizeImageUrl && (
                                <img
                                  src={fullSizeImageUrl}
                                  alt={poi.name}
                                  className="w-full h-full object-cover rounded-md border border-gray-200 dark:border-gray-700 max-h-[300px]"
                                  loading="eager"
                                />
                              )}
                              {images.slice(0, 0).map((image, index) => (
                                <img
                                  key={image.id}
                                  src={image.image_url}
                                  alt={`${poi.name} ${index + 1}`}
                                  className="w-full h-48 object-cover rounded-md border border-gray-200 dark:border-gray-700"
                                />
                              ))}
                            </div>
                          </div>
                        )
                      })()}

                      {/* Rating and Status */}
                      <div className="flex justify-between items-start space-x-4">
                        {poi.rating && (
                          <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Rating
                            </label>
                            <div className="flex items-center">
                              <Star className="h-5 w-5 text-yellow-400 mr-1" />
                              <span className="text-lg font-medium text-gray-900 dark:text-white">
                                {poi.rating.toFixed(1)}
                              </span>
                              {poi.user_ratings_total && (
                                <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                                  ({poi.user_ratings_total} reviews)
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Status */}
                        <div className="flex-1">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Status
                          </label>
                          <span className={cn(
                            'inline-flex items-center px-3 py-1 text-sm font-medium rounded-full',
                            poi.approved
                              ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                              : 'bg-tuggi-orange/10 text-tuggi-orange border border-tuggi-orange/20'
                          )}>
                            {poi.approved ? (
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
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                        Metadata
                      </h4>
                      <div className="flex items-start space-x-2">
                        <Calendar className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Created</div>
                          <div className="text-sm text-gray-900 dark:text-white">{formatDate(poi.created_at)}</div>
                        </div>
                      </div>

                      <div className="flex items-start space-x-2">
                        <Calendar className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Updated</div>
                          <div className="text-sm text-gray-900 dark:text-white">{formatDate(poi.updated_at)}</div>
                        </div>
                      </div>

                      {poi.approved && poi.approved_at && (
                        <div className="flex items-start space-x-2">
                          <User className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Approved</div>
                            <div className="text-sm text-gray-900 dark:text-white">{formatDate(poi.approved_at)}</div>
                          </div>
                        </div>
                      )}

                      {poi.google_types && poi.google_types.length > 0 && (
                        <div className="flex items-start space-x-2">
                          <Target className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Google Types</div>
                            <div className="text-sm text-gray-900 dark:text-white">
                              <div className="flex flex-wrap gap-1 mt-1">
                                {poi.google_types.slice(0, 6).map((type, index) => (
                                  <span 
                                    key={index}
                                    className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-tuggi-blue/10 text-tuggi-blue border border-tuggi-blue/20"
                                  >
                                    {type.replace(/_/g, ' ')}
                                  </span>
                                ))}
                                {poi.google_types.length > 6 && (
                                  <span className="text-xs text-gray-500 dark:text-gray-400">
                                    +{poi.google_types.length - 6} more
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {poi.business_status && (
                        <div className="flex items-start space-x-2">
                          <Clock className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Business Status</div>
                            <div className="text-sm text-gray-900 dark:text-white">{poi.business_status}</div>
                          </div>
                        </div>
                      )}

                      
                    </div>
                      
                  </div>
                  
                </div>
                    <div className="space-y-4">
                  
                    {/* Action Buttons */}
                    <div className="flex items-center space-x-3 pt-4 border-t border-gray-200 dark:border-gray-600">
                      <button
                        onClick={handleDelete}
                        disabled={isSaving}
                        className="inline-flex items-center px-4 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete POI
                      </button>
                      <button
                        onClick={onClose}
                        className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-tuggi-blue hover:bg-tuggi-blue/90 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50"
                      >
                        <Save className="h-4 w-4 mr-2" />
                        {isSaving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
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
                      {isGenerating ? 'Generating...' : 'Generate Description with AI'}
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
                    <button
                      type="button"
                      className="inline-flex items-center px-3 py-2 text-sm text-tuggi-blue hover:text-tuggi-blue/80 border border-tuggi-blue/30 rounded-md hover:bg-tuggi-blue/10"
                      onClick={() => setReferenceLinks([...referenceLinks, ''])}
                    >
                      + Add Reference Link
                    </button>
                  </div>
                </div>

                {/* Verification Section */}
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      Factual Verification Status
                    </h5>
                    <VerificationBadge 
                      attractionId={poi.id}
                      size="md"
                      showScore={true}
                      showVerifyButton={true}
                      onVerificationComplete={() => {
                        // Refresh modal data if needed
                        console.log('Verification completed for POI:', poi.id);
                      }}
                    />
                  </div>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Automatic verification checks factual claims against authoritative sources (Wikipedia, IPHAN, UNESCO).
                    Only original Portuguese descriptions are verified.
                  </p>
                </div>

                {/* Description Editor */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Attraction Description
                    </label>
                    <textarea
                      value={currentDescription}
                      onChange={(e) => setCurrentDescription(e.target.value)}
                      rows={6}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white resize-none"
                      placeholder="Enter a rich cultural and historical description for this attraction..."
                    />
                    <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      {currentDescription.length} characters
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
              attractionId={poi.id}
              attractionName={poi.name}
              attractionCoordinates={poi.coordinates ? { lat: poi.coordinates.latitude, lng: poi.coordinates.longitude } : { lat: 0, lng: 0 }}
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
                          className={`p-2 rounded text-sm ${
                            result.includes('✅') 
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
                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs ${
                                  desc.gender === 'male' 
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
                            ⚠️ Please save a Portuguese description first before generating translations.{' '}
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
            {poi.coordinates ? (
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
                        center={{ lat: poi.coordinates.latitude, lng: poi.coordinates.longitude }}
                        zoom={18}
                        height="100%"
                        markers={[
                          { id: poi.id, position: { lat: poi.coordinates.latitude, lng: poi.coordinates.longitude }, title: `${poi.name} (Main POI)`, color: '#10B981' },
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
                          Main POI: {poi.name}
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
                            if (id === poi.id) {
                              return (
                                <div key={id} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                  <Users className="h-3 w-3" />
                                  {poi.name} (Main)
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
              </div>

                            {/* POI Summary */}
              <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h5 className="text-base font-medium text-gray-900 dark:text-white mb-3">
                  POI Summary
                </h5>
                
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Name</p>
                    <p className="text-gray-900 dark:text-white truncate">{poi.name}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Types</p>
                    <div className="flex flex-wrap gap-1">
                      {poi.google_types && poi.google_types.length > 0 ? (
                        poi.google_types.slice(0, 3).map((type: string, index: number) => (
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
                      {poi.google_types && poi.google_types.length > 3 && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">+{poi.google_types.length - 3} more</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Location</p>
                    <p className="text-gray-900 dark:text-white truncate">{poi.city}, {poi.country}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Rating</p>
                    <div className="flex items-center gap-1">
                      <Star className="h-3 w-3 text-yellow-400" />
                      <span className="text-gray-900 dark:text-white">{poi.rating || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                {currentDescription.trim() && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Description</p>
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
                    <div className="flex items-center gap-1">
                      {currentDescription.trim() ? (
                        <>
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          <span className="text-xs text-green-600 dark:text-green-400">Complete</span>
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
                        Optional ({poi.trigger_points_count || 0} configured)
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
                  {!poi.approved && (
                    <button
                      onClick={handleApprove}
                      disabled={isSaving || !currentDescription.trim() || translatedDescriptions.length === 0}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      {isSaving ? 'Approving...' : 'Approve POI'}
                    </button>
                  )}
                  {poi.approved && (
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