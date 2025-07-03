'use client'

import { useState, useEffect } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { X, Save, CheckCircle, Trash2, MapPin, ExternalLink, Star, Calendar, User, Globe, Phone, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import { POI_CATEGORIES } from '@/constants/poi-importer'

interface POI {
  id: string
  name: string
  city: string
  country: string
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
  website: string | null
  formatted_phone_number: string | null
  business_status: string | null
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
        .from('attraction_description')
        .select('*')
        .eq('attraction_id', poi.id)
        .order('created_at', { ascending: false })

      setDescriptions(descriptionsData || [])

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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={onClose} />
        
        <div className="inline-block align-bottom bg-white dark:bg-gray-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
          {/* Header */}
          <div className="bg-white dark:bg-gray-800 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                POI Details
              </h3>
              <button
                onClick={onClose}
                className="rounded-md text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-tuggi-blue"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="bg-white dark:bg-gray-800 px-6 py-4 max-h-[80vh] overflow-y-auto">
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
                              className="w-full h-32 object-cover rounded-md border border-gray-200 dark:border-gray-700"
                            />
                          )}
                          {images.slice(0, 3).map((image, index) => (
                            <img
                              key={image.id}
                              src={image.image_url}
                              alt={`${poi.name} ${index + 1}`}
                              className="w-full h-32 object-cover rounded-md border border-gray-200 dark:border-gray-700"
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Rating */}
                    {poi.rating && (
                      <div>
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
                    <div>
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
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                              Description {index + 1}
                            </span>
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

          {/* Footer */}
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
        </div>
      </div>
    </div>
  )
} 