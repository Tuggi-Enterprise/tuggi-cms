'use client'

import { useState, useEffect } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { X, Save, CheckCircle, Trash2, MapPin, ExternalLink, Star, Calendar, User, Globe, Phone, Clock, Target, Info, FileText, Sparkles, RotateCcw, Play, Eye } from 'lucide-react'
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
  coordinates?: {
    latitude: number
    longitude: number
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
  const [activeTab, setActiveTab] = useState<'details' | 'description' | 'trigger-points'>('details')
  
  // Description editing state
  const [currentDescription, setCurrentDescription] = useState('')
  const [originalDescription, setOriginalDescription] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSavingDescription, setIsSavingDescription] = useState(false)
  const [descriptionStats, setDescriptionStats] = useState({ play_count: 0, last_played_at: null })
  
  const supabase = useSupabaseClient()

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
      
      // Load Portuguese description for editing (prioritize PT, fallback to first available)
      const ptDesc = descriptionsData?.find(desc => desc.language === 'pt-Br')
      const currentDesc = ptDesc || descriptionsData?.[0]
      
      if (currentDesc) {
        setCurrentDescription(currentDesc.description || '')
        setOriginalDescription(currentDesc.description || '')
        setDescriptionStats({
          play_count: currentDesc.play_count || 0,
          last_played_at: currentDesc.last_played_at
        })
      } else {
        setCurrentDescription('')
        setOriginalDescription('')
        setDescriptionStats({ play_count: 0, last_played_at: null })
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
          updated_at: new Date().toISOString()
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
        .eq('language', 'pt')
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
          .eq('language', 'pt')

        if (error) throw error
      } else {
        // Create new Portuguese description
        const { error } = await supabase
          .schema('core')
          .from('attraction_descriptions')
          .insert({
            attraction_id: poi.id,
            language: 'pt', // Brazilian Portuguese as per your backend
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
                                {desc.language === 'pt' ? '🇧🇷 Portuguese' : 
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
                      Editing Brazilian Portuguese (pt) • {descriptions.length} language{descriptions.length !== 1 ? 's' : ''} available
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
        ) : (
          <div className="h-[80vh]">
            <TriggerPointsManager 
              attractionId={poi.id}
              attractionName={poi.name}
              attractionCoordinates={poi.coordinates ? { lat: poi.coordinates.latitude, lng: poi.coordinates.longitude } : { lat: 0, lng: 0 }}
            />
          </div>
        )}
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