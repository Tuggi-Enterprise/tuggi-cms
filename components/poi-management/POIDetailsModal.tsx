'use client'

import { useState, useEffect } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { X, Save, CheckCircle, Trash2, MapPin, ExternalLink, Star, Calendar, User, Globe, Phone, Clock, Target, Info, FileText, Sparkles, RotateCcw, Play, Eye, Volume2, Download, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import { POI_CATEGORIES } from '@/constants/poi-importer'
import { TriggerPointsManager } from './TriggerPointsManager'

interface POI {
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
  coordinates?: {
    latitude: number
    longitude: number
  }
  reference_links?: string[] // Add reference links field
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
  const [activeTab, setActiveTab] = useState<'details' | 'description' | 'trigger-points' | 'narration-audio'>('details')
  
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
  const [audioSpeed, setAudioSpeed] = useState<number>(1.1)
  const [audioProvider, setAudioProvider] = useState<'openai' | 'google'>('google')
  
  // Add to the state
  const [referenceLinks, setReferenceLinks] = useState<string[]>(poi.reference_links || []);

  const supabase = useSupabaseClient()

  // Voice mapping for Google TTS
  const googleVoiceMap: Record<string, string> = {
    shimmer: 'pt-BR-Wavenet-B',
    nova: 'pt-BR-Wavenet-A',
    alloy: 'pt-BR-Wavenet-D',
    echo: 'pt-BR-Wavenet-E',
  }

  useEffect(() => {
    if (isOpen) {
      setEditedPoi(poi)
      fetchAdditionalData()
    }
  }, [poi, isOpen])

  const fetchAdditionalData = async () => {
    setIsLoading(true)
    try {
      // Fetch descriptions
      const { data: descriptionsData } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('*')
        .eq('attraction_id', poi.id)
        .order('created_at', { ascending: false })

      setDescriptions(descriptionsData || [])
      
      // Debug: Log the fetched descriptions
      console.log('🔍 Fetched descriptions for POI:', poi.id, descriptionsData)
      
      // Load Portuguese description for editing (prioritize PT, fallback to first available)
      const ptDesc = descriptionsData?.find(desc => 
        desc.language === 'pt-br' || desc.language === 'pt' || desc.language === 'pt-br' || desc.language?.toLowerCase().includes('pt')
      )
      const currentDesc = ptDesc || descriptionsData?.[0]
      
      console.log('🔍 Selected description:', currentDesc)
      
      if (currentDesc && currentDesc.description) {
        console.log('✅ Loading description:', currentDesc.description.substring(0, 100) + '...')
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
      
      const { error } = await supabase
        .schema('core')
        .from('attractions')
        .update({
          approved: true,
          approved_by: user?.id,
          approved_at: new Date().toISOString()
        })
        .eq('id', poi.id)

      if (error) throw error

      await onUpdate()
      onClose()
    } catch (error) {
      console.error('Error approving POI:', error)
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
    setIsGenerating(true)
    try {
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
          image_url: poi.image_url
        })
      })

      if (!response.ok) {
        throw new Error('Failed to generate description')
      }

      const data = await response.json()
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
      alert('Description cannot be empty.')
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

      if (existingDescs) {
        // Update existing Portuguese description
        const { error } = await supabase
          .schema('core')
          .from('attraction_descriptions')
          .update({
            description: currentDescription,
            updated_at: new Date().toISOString()
          })
          .eq('attraction_id', poi.id)
          .eq('language', 'pt-br')

        if (error) throw error
      } else {
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
      }

      // Update original description to match current
      setOriginalDescription(currentDescription)
      
      // Refresh data
      await fetchAdditionalData()
      
      alert('Description saved successfully!')
    } catch (error) {
      console.error('Error saving description:', error)
      alert('Failed to save description. Please try again.')
    } finally {
      setIsSavingDescription(false)
    }
  }

  const resetDescription = () => {
    setCurrentDescription(originalDescription)
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
        alert('Please save a description first before generating audio narration.')
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose} />
        
        <div className="relative bg-white dark:bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all w-full max-w-6xl h-[90vh] flex flex-col">
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

                    <div>
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
                    </div>

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
                  </div>

                  <div className="space-y-4">
                    {/* Image Preview */}
                    {(poi.image_url || images.length > 0) && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Images
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {poi.image_url && (
                            <img
                              src={poi.image_url}
                              alt={poi.name}
                              className="w-full h-48 object-cover rounded-md border border-gray-200 dark:border-gray-700"
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
                    )}

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
                </div>

                {/* Additional Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                      Contact & Details
                    </h4>

                    {poi.formatted_address && (
                      <div className="flex items-start space-x-2">
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

                {/* Descriptions */}
                {descriptions.length > 0 && (
                  <div>
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

                {/* Reference Links */}
                <div className="mt-6">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Reference Links (URLs)</label>
                  <div className="space-y-2 mt-2">
                    {referenceLinks.map((link, idx) => (
                      <div key={idx} className="flex items-center space-x-2">
                        <input
                          type="url"
                          className="flex-1 border rounded px-2 py-1"
                          value={link}
                          onChange={e => {
                            const newLinks = [...referenceLinks];
                            newLinks[idx] = e.target.value;
                            setReferenceLinks(newLinks);
                          }}
                          placeholder="https://example.com"
                        />
                        <button
                          type="button"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => setReferenceLinks(referenceLinks.filter((_, i) => i !== idx))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="text-blue-600 hover:text-blue-800 text-sm mt-2"
                      onClick={() => setReferenceLinks([...referenceLinks, ''])}
                    >
                      + Add Link
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
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      Editing Brazilian Portuguese (pt-br) • {descriptions.length} language{descriptions.length !== 1 ? 's' : ''} available
                    </p>
                    <p className="text-xs text-tuggi-blue mt-1">
                      ✨ Enhanced AI with rich POI data: Google Types, location, ratings, business info
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={generateDescription}
                      disabled={isGenerating}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-tuggi-blue hover:bg-tuggi-blue/90 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50"
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      {isGenerating ? 'Generating...' : 'Generate Description with AI'}
                    </button>
                    {currentDescription !== originalDescription && (
                      <button
                        onClick={resetDescription}
                        className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
                      >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Reset
                      </button>
                    )}
                  </div>
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
                      rows={12}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-tuggi-blue dark:bg-gray-700 dark:text-white resize-none"
                      placeholder="Enter a rich cultural and historical description for this attraction..."
                    />
                    <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      {currentDescription.length} characters
                    </div>
                  </div>

                  {/* Statistics */}
                  <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-md">
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
                  </div>

                  {/* Save Actions */}
                  <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {currentDescription !== originalDescription && (
                        <span className="text-tuggi-orange">• Unsaved changes</span>
                      )}
                    </div>
                    <button
                      onClick={saveDescription}
                      disabled={isSavingDescription || currentDescription === originalDescription}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-tuggi-blue hover:bg-tuggi-blue/90 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {isSavingDescription ? 'Saving...' : 'Save Description'}
                    </button>
                  </div>
                </div>
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
                      onClick={generateAudioNarration}
                      disabled={isGeneratingAudio || (!currentDescription.trim() && !currentAudioUrl)}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-tuggi-blue hover:bg-tuggi-blue/90 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50"
                    >
                      {isGeneratingAudio ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Generating Audio...
                        </>
                      ) : (
                        <>
                          <Volume2 className="h-4 w-4 mr-2" />
                          {currentAudioUrl ? 'Regenerate Audio' : 'Generate Audio'}
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

                {/* Current Audio Section */}
                {currentAudioUrl ? (
                  <div className="bg-gray-50 dark:bg-gray-700 p-6 rounded-lg">
                    <div className="flex items-center justify-between mb-4">
                      <h5 className="text-lg font-medium text-gray-900 dark:text-white">
                        Current Audio
                      </h5>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={generateAudioNarration}
                          disabled={isGeneratingAudio || (!currentDescription.trim() && !currentAudioUrl)}
                          className="inline-flex items-center px-3 py-1.5 border border-tuggi-blue text-sm font-medium rounded-md text-tuggi-blue bg-tuggi-blue/10 hover:bg-tuggi-blue/20 focus:outline-none focus:ring-2 focus:ring-tuggi-blue disabled:opacity-50"
                        >
                          {isGeneratingAudio ? (
                            <>
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              Replacing...
                            </>
                          ) : (
                            <>
                              <Volume2 className="h-3 w-3 mr-1" />
                              Replace
                            </>
                          )}
                        </button>
                        <button
                          onClick={downloadAudio}
                          className="inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Download
                        </button>
                      </div>
                    </div>
                    
                    {/* Audio Player */}
                    <div className="mb-4">
                      <audio controls className="w-full" preload="metadata">
                        <source src={currentAudioUrl} type="audio/mpeg" />
                        Your browser does not support the audio element.
                      </audio>
                    </div>
                    
                    {/* Audio Metadata */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">File Name:</span>
                        <div className="text-gray-900 dark:text-white font-mono text-xs">
                          {audioMetadata?.fileName || 'Unknown'}
                        </div>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">Size:</span>
                        <div className="text-gray-900 dark:text-white">
                          {formatFileSize(audioMetadata?.size)}
                        </div>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">Last Updated:</span>
                        <div className="text-gray-900 dark:text-white">
                          {audioMetadata?.lastUpdated ? formatDate(audioMetadata.lastUpdated) : 'Unknown'}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-gray-50 dark:bg-gray-700 p-6 rounded-lg text-center">
                    <Volume2 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h5 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                      No Audio Available
                    </h5>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                      Generate audio narration from the attraction description to provide visitors with rich, spoken content.
                    </p>
                    {!currentDescription.trim() && !currentAudioUrl && (
                      <p className="text-sm text-tuggi-orange">
                        ⚠️ Please save a description first before generating audio narration.
                      </p>
                    )}
                    {!currentDescription.trim() && currentAudioUrl && (
                      <p className="text-sm text-tuggi-blue">
                        💡 No description found. Audio generation will use basic fallback text. Add a description in the Description tab for better quality.
                      </p>
                    )}
                  </div>
                )}

                {/* Audio Generation Settings */}
                <div className="bg-gray-50 dark:bg-gray-700 p-6 rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h5 className="text-lg font-medium text-gray-900 dark:text-white">
                      🎛️ Audio Generation Settings
                    </h5>
                    {currentAudioUrl && (
                      <span className="text-xs bg-tuggi-blue/10 text-tuggi-blue px-2 py-1 rounded-full">
                        💡 Try different settings and regenerate
                      </span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Provider Selection */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                        Audio Provider
                      </label>
                      <select
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

                {/* Debug Info */}
                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-200 dark:border-yellow-800">
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
                </div>

                {/* Audio Generation Info */}
                <div className="bg-tuggi-blue/10 p-4 rounded-lg">
                  <h5 className="text-sm font-medium text-tuggi-blue mb-2">
                    🎧 Smart Audio Optimizations
                  </h5>
                  <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <p>• <strong>Text Preprocessing:</strong> Optimizes Portuguese pronunciation and flow</p>
                    <p>• <strong>Smart Voice Selection:</strong> Automatically selects best voice for content type</p>
                    <p>• <strong>Natural Pacing:</strong> Adds appropriate pauses for better listening experience</p>
                    <p>• <strong>Tourism Optimized:</strong> Ideal speed and tone for cultural content</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}
          </div>

          {/* Footer - Only show for POI Details tab */}
          {activeTab === 'details' && (
            <div className="bg-gray-50 dark:bg-gray-900 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={handleDelete}
                    disabled={isSaving}
                    className="inline-flex items-center px-4 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete POI
                  </button>
                </div>
                <div className="flex items-center space-x-3">
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
                  {!poi.approved && (
                    <button
                      onClick={handleApprove}
                      disabled={isSaving}
                      className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                    >
                      <CheckCircle className="h-4 w-4 mr-2" />
                      {isSaving ? 'Approving...' : 'Approve POI'}
                    </button>
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