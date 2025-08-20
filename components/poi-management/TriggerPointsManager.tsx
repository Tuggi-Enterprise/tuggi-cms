'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { 
  Plus, MapPin, Target, Trash2, Edit3, Save, X, 
  Navigation, Circle, Settings, AlertTriangle, 
  Check, RotateCcw, ZoomIn, Filter, ChevronDown, ChevronUp, Sparkles, Loader2, AlertCircle, CheckCircle 
} from 'lucide-react'
import { TriggerPointsMap } from './TriggerPointsMap'
import { DirectionSelector } from './DirectionSelector'
import { BearingSelector } from './BearingSelector'

import { cn } from '@/lib/utils'
import { 
  TriggerPoint, 
  TriggerPointsManagerProps, 
  AttractionDescription, 
  TriggerPointFormData,
  TRIGGER_POINT_TYPES,
  DEFAULT_TRIGGER_POINT,
  DIRECTION_OPTIONS 
} from '@/types/trigger-points'

export function TriggerPointsManager({ 
  attractionId, 
  attractionName, 
  attractionCoordinates,
  attractionTypes = [],
  onClose 
}: TriggerPointsManagerProps) {
  const supabase = useSupabaseClient()
  
  // State
  const [triggerPoints, setTriggerPoints] = useState<TriggerPoint[]>([])
  const [selectedTriggerPoint, setSelectedTriggerPoint] = useState<TriggerPoint | null>(null)
  const [isAddingMode, setIsAddingMode] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [filterType, setFilterType] = useState<string>('all')
  const [availableDescriptions, setAvailableDescriptions] = useState<AttractionDescription[]>([])
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [autoGenerateRequested, setAutoGenerateRequested] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isUpdatingPOILocation, setIsUpdatingPOILocation] = useState(false)
  const [poiUpdateSuccess, setPoiUpdateSuccess] = useState(false)
  const [poiUpdateError, setPoiUpdateError] = useState<string | null>(null)
  const [showFeedbackModal, setShowFeedbackModal] = useState(false)
  const [feedbackSuggestion, setFeedbackSuggestion] = useState<any>(null)
  const [feedbackReason, setFeedbackReason] = useState('')
  const [feedbackAction, setFeedbackAction] = useState<'reject' | 'accept'>('reject')
  
  // Form state
  const [formData, setFormData] = useState<TriggerPointFormData>({
    ...DEFAULT_TRIGGER_POINT,
    latitude: attractionCoordinates.lat,
    longitude: attractionCoordinates.lng,
  })

  // Load trigger points and descriptions
  const loadTriggerPoints = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      // Load trigger points
      const { data: triggerPointsData, error: triggerPointsError } = await supabase
        .schema('core')
        .from('trigger_points_with_coords')
        .select('*')
        .eq('attraction_id', attractionId)
        .order('priority')

      if (triggerPointsError) {
        throw triggerPointsError
      }

      setTriggerPoints(triggerPointsData || [])

      // Load available descriptions
      const { data: descriptionsData, error: descriptionsError } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('id, description')
        .eq('attraction_id', attractionId)

      if (descriptionsError) {
        console.warn('Failed to load descriptions:', descriptionsError)
      } else {
        setAvailableDescriptions((descriptionsData || []).map(desc => ({
          ...desc,
          attraction_id: attractionId,
          type: 'audio',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })))
      }
    } catch (err) {
      console.error('Error loading trigger points:', err)
      setError('Failed to load trigger points')
    } finally {
      setIsLoading(false)
    }
  }, [attractionId, supabase])

  // Generate AI suggestions
  const generateSuggestions = useCallback(async () => {
    try {
      setIsLoading(true)
      setSuggestions([])
      
      const response = await fetch('/api/pov-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poi_id: attractionId,
          poi_name: attractionName,
          poi_lat: attractionCoordinates.lat,
          poi_lng: attractionCoordinates.lng,
          poi_types: attractionTypes || [],
          limit: 5,
          min_confidence: 70
        })
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to generate suggestions')
      }

      setSuggestions(result.data.suggestions || [])
      console.log(`✅ Generated ${result.data.suggestions?.length || 0} AI suggestions`)
      
    } catch (error) {
      console.error('Error generating suggestions:', error)
      setError('Failed to generate AI suggestions')
    } finally {
      setIsLoading(false)
    }
  }, [attractionId, attractionName, attractionCoordinates, attractionTypes])

  useEffect(() => {
    loadTriggerPoints()
  }, [loadTriggerPoints])

  // Auto-generate suggestions when there are no trigger points
  useEffect(() => {
    const shouldAutoGenerate = triggerPoints.length === 0 && !isLoading && !autoGenerateRequested
    
    if (shouldAutoGenerate) {
      // Show suggestions and auto-generate
      setShowSuggestions(true)
      setAutoGenerateRequested(true)
      generateSuggestions()
    }
  }, [triggerPoints.length, isLoading, autoGenerateRequested, generateSuggestions])

  // Handle map click for adding new trigger point
  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (isAddingMode) {
      setFormData(prev => ({
        ...prev,
        latitude: lat,
        longitude: lng
      }))
      setShowForm(true)
      setIsEditing(false)
    }
  }, [isAddingMode])

  // Handle trigger point selection
  const handleTriggerPointClick = useCallback((triggerPoint: TriggerPoint) => {
    setSelectedTriggerPoint(triggerPoint)
    setFormData(triggerPoint)
    setShowForm(true)
    setIsEditing(true)
    setIsAddingMode(false)
  }, [])

  // Handle trigger point drag
  const handleTriggerPointDrag = useCallback((triggerPoint: TriggerPoint, newLat: number, newLng: number) => {
    setTriggerPoints(prev => prev.map(tp => 
      tp.id === triggerPoint.id ? { ...tp, latitude: newLat, longitude: newLng } : tp
    ))
  }, [])

  // Handle suggestion drag
  const handleSuggestionDrag = useCallback((suggestionId: string, newLat: number, newLng: number, newDistance: number, newBearing: number) => {
    setSuggestions(prev => prev.map(suggestion => 
      suggestion.id === suggestionId 
        ? { ...suggestion, lat: newLat, lng: newLng, distance_m: newDistance, bearing_deg: newBearing }
        : suggestion
    ))
  }, [])



  // Handle rejecting a suggestion
  const handleRejectSuggestion = useCallback(async (suggestion: any) => {
    // Open feedback modal for rejection
    setFeedbackSuggestion(suggestion)
    setFeedbackAction('reject')
    setFeedbackReason('')
    setShowFeedbackModal(true)
  }, [])

  // Handle accepting a suggestion
  const handleAcceptSuggestion = useCallback(async (suggestion: any) => {
    // Open feedback modal for acceptance
    setFeedbackSuggestion(suggestion)
    setFeedbackAction('accept')
    setFeedbackReason('')
    setShowFeedbackModal(true)
  }, [])

  // Submit feedback
  const submitFeedback = useCallback(async () => {
    if (!feedbackSuggestion) return

    try {
      setIsLoading(true)
      
      // Send feedback to learning system
      await fetch('/api/pov-suggestions/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestionId: feedbackSuggestion.id,
          poiId: attractionId,
          action: feedbackAction,
          feedback: feedbackReason || `${feedbackAction === 'accept' ? 'Accepted' : 'Rejected'} without specific reason`,
          coordinates: { lat: feedbackSuggestion.lat, lng: feedbackSuggestion.lng }
        })
      })

      // If accepting, create trigger point
      if (feedbackAction === 'accept') {
        console.log('🎯 Creating trigger point from accepted suggestion')
        
        // Calculate bearing from trigger point to POI
        const bearing = calculateBearing(feedbackSuggestion.lat, feedbackSuggestion.lng, attractionCoordinates.lat, attractionCoordinates.lng)
        console.log('📐 Calculated bearing:', bearing)
        
        // Insert as trigger point using API
        const response = await fetch('/api/trigger-points/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attraction_id: attractionId,
            lat: feedbackSuggestion.lat,
            lng: feedbackSuggestion.lng,
            radius_meters: 50,
            expected_bearing: bearing,
            bearing_threshold: 30,
            type: 'primary',
            priority: 1,
            is_active: true,
            direction: null,
            access: feedbackSuggestion.access_type || 'both',
            name: `AI Generated - ${feedbackSuggestion.confidence_score.toFixed(1)}%`,
            description: feedbackSuggestion.reasoning || 'AI generated trigger point'
          })
        })

        const result = await response.json()

        if (!response.ok || !result.success) {
          console.error('❌ Error adding trigger point:', result.error)
          setError('Failed to add trigger point')
          return
        }
        
        console.log('✅ Trigger point created successfully:', result.data)
        
        // Reload trigger points to show the new one
        loadTriggerPoints()
      }

      // Remove suggestion from list
      setSuggestions(prev => prev.filter(s => s.id !== feedbackSuggestion.id))
      
      console.log(`✅ Suggestion ${feedbackAction}ed with feedback`)
      
      // Close modal
      setShowFeedbackModal(false)
      setFeedbackSuggestion(null)
      setFeedbackReason('')
      
    } catch (error) {
      console.error('Error submitting feedback:', error)
      setError('Failed to submit feedback')
    } finally {
      setIsLoading(false)
    }
  }, [feedbackSuggestion, feedbackAction, feedbackReason, attractionId, attractionCoordinates, loadTriggerPoints])

  // Handle POI location change
  const handlePOILocationChange = useCallback(async (newLat: number, newLng: number) => {
    try {
      setIsUpdatingPOILocation(true)
      setError(null)
      setPoiUpdateError(null)
      setPoiUpdateSuccess(false)

      console.log(`🗺️ Updating POI location: ${attractionName} -> ${newLat}, ${newLng}`)

      const response = await fetch('/api/pois/update-coordinates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attractionId,
          latitude: newLat,
          longitude: newLng
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update POI location')
      }

      console.log('✅ POI location updated successfully')
      
      // Show success notification
      setPoiUpdateSuccess(true)
      setTimeout(() => setPoiUpdateSuccess(false), 3000) // Hide after 3 seconds
      
    } catch (error) {
      console.error('Error updating POI location:', error)
      setPoiUpdateError('Failed to update POI location. Please try again.')
      setTimeout(() => setPoiUpdateError(null), 5000) // Hide after 5 seconds
    } finally {
      setIsUpdatingPOILocation(false)
    }
  }, [attractionId, attractionName])

  // Calculate bearing from point A to point B
  function calculateBearing(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
    const φ1 = fromLat * Math.PI / 180
    const φ2 = toLat * Math.PI / 180
    const Δλ = (toLng - fromLng) * Math.PI / 180

    const y = Math.sin(Δλ) * Math.cos(φ2)
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)

    let bearing = Math.atan2(y, x) * 180 / Math.PI
    bearing = (bearing + 360) % 360

    return Math.round(bearing)
  }

  // Validate form data
  const validateForm = useCallback(() => {
    if (!formData.latitude || !formData.longitude) {
      return 'Location is required'
    }
    if (!formData.radius_meters || formData.radius_meters <= 0) {
      return 'Radius must be greater than 0'
    }
    if (formData.expected_bearing && (formData.expected_bearing < 0 || formData.expected_bearing > 360)) {
      return 'Bearing must be between 0 and 360 degrees'
    }
    if (formData.bearing_threshold && (formData.bearing_threshold < 0 || formData.bearing_threshold > 180)) {
      return 'Bearing threshold must be between 0 and 180 degrees'
    }
    if (!formData.priority || formData.priority < 1) {
      return 'Priority must be at least 1'
    }
    return null
  }, [formData])

  // Save trigger point
  const saveTriggerPoint = useCallback(async () => {
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      if (isEditing && selectedTriggerPoint?.id) {
        // Update existing trigger point
        const { error: updateError } = await supabase
          .schema('core')
          .from('attraction_trigger_points')
          .update({
            location: `POINT(${formData.longitude} ${formData.latitude})`,
            radius_meters: formData.radius_meters,
            expected_bearing: formData.expected_bearing,
            bearing_threshold: formData.bearing_threshold,
            type: formData.type,
            priority: formData.priority,
            custom_description_id: formData.custom_description_id,
            is_active: formData.is_active,
            direction: formData.direction
          })
          .eq('id', selectedTriggerPoint.id)

        if (updateError) {
          throw updateError
        }
      } else {
        // Create new trigger point
        const { error: insertError } = await supabase
          .schema('core')
          .from('attraction_trigger_points')
          .insert({
            attraction_id: attractionId,
            location: `POINT(${formData.longitude} ${formData.latitude})`,
            radius_meters: formData.radius_meters,
            expected_bearing: formData.expected_bearing,
            bearing_threshold: formData.bearing_threshold,
            type: formData.type,
            priority: formData.priority,
            custom_description_id: formData.custom_description_id,
            is_active: formData.is_active,
            direction: formData.direction
          })

        if (insertError) {
          throw insertError
        }
      }

      await loadTriggerPoints()
      handleCloseForm()
    } catch (err) {
      console.error('Error saving trigger point:', err)
      setError('Failed to save trigger point')
    } finally {
      setIsLoading(false)
    }
  }, [formData, isEditing, selectedTriggerPoint, attractionId, supabase, loadTriggerPoints, validateForm])

  // Delete trigger point
  const deleteTriggerPoint = useCallback(async (triggerPointId: string) => {
    if (!confirm('Are you sure you want to delete this trigger point?')) {
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      const { error: deleteError } = await supabase
        .schema('core')
        .from('attraction_trigger_points')
        .delete()
        .eq('id', triggerPointId)

      if (deleteError) {
        throw deleteError
      }

      await loadTriggerPoints()
      if (selectedTriggerPoint?.id === triggerPointId) {
        handleCloseForm()
      }
    } catch (err) {
      console.error('Error deleting trigger point:', err)
      setError('Failed to delete trigger point')
    } finally {
      setIsLoading(false)
    }
  }, [supabase, loadTriggerPoints, selectedTriggerPoint])

  // Handle form close
  const handleCloseForm = useCallback(() => {
    setShowForm(false)
    setIsEditing(false)
    setIsAddingMode(false)
    setSelectedTriggerPoint(null)
    setFormData({
      ...DEFAULT_TRIGGER_POINT,
      latitude: attractionCoordinates.lat,
      longitude: attractionCoordinates.lng,
    })
    setError(null)
  }, [attractionCoordinates])

  // Filter trigger points
  const filteredTriggerPoints = triggerPoints.filter(tp => 
    filterType === 'all' || tp.type === filterType
  )

  // Get trigger point by type color
  const getTriggerTypeInfo = (type: string) => {
    return TRIGGER_POINT_TYPES.find(t => t.value === type) || TRIGGER_POINT_TYPES[0]
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Trigger Points Management
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {attractionName} • {triggerPoints.length} trigger points
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsAddingMode(!isAddingMode)}
            className={cn(
              "flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              isAddingMode
                ? "bg-tuggi-orange text-white hover:bg-orange-600"
                : "bg-tuggi-blue text-white hover:bg-blue-600"
            )}
          >
            {isAddingMode ? (
              <>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Add Trigger
              </>
            )}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mr-2" />
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        </div>
      )}

      {/* Instructions */}
      {isAddingMode && (
        <div className="mx-4 mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center">
            <Target className="h-4 w-4 text-blue-600 dark:text-blue-400 mr-2" />
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Click on the map to place a new trigger point
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 flex">
        {/* Map */}
        <div className="flex-1 relative">
          <TriggerPointsMap
            center={attractionCoordinates}
            zoom={14}
            height="100%"
            attractionName={attractionName}
            triggerPoints={filteredTriggerPoints}
            selectedTriggerPoint={selectedTriggerPoint}
            onMapClick={handleMapClick}
            onTriggerPointClick={handleTriggerPointClick}
            onTriggerPointDrag={handleTriggerPointDrag}
            isAddingMode={isAddingMode}
            suggestions={showSuggestions ? suggestions : []}
            onSuggestionDrag={handleSuggestionDrag}
            onSuggestionAccept={handleAcceptSuggestion}
            onSuggestionReject={handleRejectSuggestion}
            onPOILocationChange={handlePOILocationChange}
          />
        </div>

        {/* Sidebar */}
        <div className="w-80 border-l border-gray-200 dark:border-gray-700 flex flex-col">
          {/* Header with AI Suggestions Toggle */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Target className="h-5 w-5 mr-2 text-tuggi-blue" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  Trigger Points ({filteredTriggerPoints.length})
                </h3>
                {isUpdatingPOILocation && (
                  <div className="ml-2 flex items-center text-xs text-tuggi-orange">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Updating POI...
                  </div>
                )}
                {poiUpdateSuccess && (
                  <div className="ml-2 flex items-center text-xs text-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    POI Updated!
                  </div>
                )}
                {poiUpdateError && (
                  <div className="ml-2 flex items-center text-xs text-red-600">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    {poiUpdateError}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    // Call the reset function exposed by the map component
                    if ((window as any).__triggerPointsMapReset) {
                      (window as any).__triggerPointsMapReset()
                    }
                  }}
                  className="px-2 py-1.5 text-xs font-medium rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                  title="Reset map view to fit all trigger points"
                >
                  <ZoomIn className="h-3 w-3" />
                </button>
              <button
                onClick={() => {
                  if (showSuggestions && suggestions.length > 0) {
                    // If suggestions are visible and exist, hide them
                    setShowSuggestions(false)
                  } else {
                    // Show suggestions and generate if needed
                    setShowSuggestions(true)
                    if (suggestions.length === 0) {
                      generateSuggestions()
                    }
                  }
                }}
                disabled={isLoading}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center disabled:opacity-50 ${
                  showSuggestions
                    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <Sparkles className="h-4 w-4 mr-1" />
                {isLoading ? 'Generating...' : 'AI'}
                {suggestions.length > 0 && (
                  <span className="ml-1 bg-purple-500 text-white text-xs rounded-full px-1.5 py-0.5">
                    {suggestions.length}
                  </span>
                )}
              </button>
              </div>
            </div>
          </div>

          {/* Filter and Controls */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setFilterType('all')}
                className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                Show All
              </button>
            </div>
            
            <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="all">All Types</option>
                    {TRIGGER_POINT_TYPES.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
          </div>

          {/* Trigger Points List */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tuggi-blue"></div>
              </div>
            ) : filteredTriggerPoints.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-500 dark:text-gray-400">
                <Target className="h-8 w-8 mb-2" />
                <p className="text-sm">No trigger points found</p>
              </div>
            ) : (
              <div className="space-y-2 p-4">
                {filteredTriggerPoints.map((triggerPoint) => {
                  const typeInfo = getTriggerTypeInfo(triggerPoint.type)
                  const isSelected = selectedTriggerPoint?.id === triggerPoint.id
                  
                  return (
                    <div
                      key={triggerPoint.id}
                      onClick={() => handleTriggerPointClick(triggerPoint)}
                      className={cn(
                        "p-3 rounded-lg border cursor-pointer transition-colors",
                        isSelected
                          ? "border-tuggi-blue bg-blue-50 dark:bg-blue-900/20"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center">
                          <div
                            className="w-3 h-3 rounded-full mr-2"
                            style={{ backgroundColor: typeInfo.color }}
                          />
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {typeInfo.label}
                          </span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            Priority {triggerPoint.priority}
                          </span>
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded",
                            triggerPoint.is_active 
                              ? "bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400"
                              : "bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                          )}>
                            {triggerPoint.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </div>
                      
                      <div className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
                        <div className="flex items-center">
                          <Circle className="h-3 w-3 mr-1" />
                          <span>Radius: {triggerPoint.radius_meters}m</span>
                        </div>
                        {triggerPoint.direction && (
                          <div className="flex items-center">
                            <span className="text-xs mr-1">
                              {DIRECTION_OPTIONS.find(dir => dir.value === triggerPoint.direction)?.emoji}
                            </span>
                            <span>
                              Direction: {DIRECTION_OPTIONS.find(dir => dir.value === triggerPoint.direction)?.label}
                            </span>
                          </div>
                        )}
                        {triggerPoint.expected_bearing !== null && (
                          <div className="flex items-center">
                            <Navigation className="h-3 w-3 mr-1" />
                            <span>
                              Bearing: {triggerPoint.expected_bearing}° (±{triggerPoint.bearing_threshold}°)
                            </span>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {triggerPoint.latitude.toFixed(6)}, {triggerPoint.longitude.toFixed(6)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (triggerPoint.id) {
                              deleteTriggerPoint(triggerPoint.id)
                            }
                          }}
                          className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {isEditing ? 'Edit Trigger Point' : 'Add Trigger Point'}
              </h3>
              <button
                onClick={handleCloseForm}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              {/* Location */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Latitude
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    value={formData.latitude || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, latitude: parseFloat(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Longitude
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    value={formData.longitude || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, longitude: parseFloat(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Type and Priority */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Type
                  </label>
                  <select
                    value={formData.type || 'primary'}
                    onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as any }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    {TRIGGER_POINT_TYPES.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Priority
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.priority || 1}
                    onChange={(e) => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Radius */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Radius (meters)
                </label>
                <input
                  type="range"
                  min="10"
                  max="500"
                  step="10"
                  value={formData.radius_meters || 30}
                  onChange={(e) => setFormData(prev => ({ ...prev, radius_meters: parseInt(e.target.value) }))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>10m</span>
                  <span className="font-medium">{formData.radius_meters}m</span>
                  <span>500m</span>
                </div>
              </div>

              {/* Bearing Selector */}
              <BearingSelector
                value={formData.expected_bearing}
                onChange={(bearing) => setFormData(prev => ({ ...prev, expected_bearing: bearing }))}
                disabled={isLoading}
              />

              {/* Bearing Threshold */}
              {/* {formData.expected_bearing !== null && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Bearing Threshold (degrees)
                  </label>
                  <input
                    type="range"
                    min="5"
                    max="90"
                    step="5"
                    value={formData.bearing_threshold || 15}
                    onChange={(e) => setFormData(prev => ({ ...prev, bearing_threshold: parseInt(e.target.value) }))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>5°</span>
                    <span className="font-medium">±{formData.bearing_threshold}°</span>
                    <span>90°</span>
                  </div>
                </div>
              )} */}

              {/* Description */}
              {/* {availableDescriptions.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Custom Description (optional)
                  </label>
                  <select
                    value={formData.custom_description_id || ''}
                    onChange={(e) => setFormData(prev => ({ 
                      ...prev, 
                      custom_description_id: e.target.value || null 
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="">Default description</option>
                    {availableDescriptions.map(desc => (
                      <option key={desc.id} value={desc.id}>
                        {desc.description.substring(0, 50)}...
                      </option>
                    ))}
                  </select>
                </div>
              )} */}

              {/* Direction Selector - Hidden */}
              {/* <DirectionSelector 
                value={formData.direction || null}
                onChange={(direction) => setFormData(prev => ({ ...prev, direction }))}
                disabled={isLoading}
              /> */}

              {/* Active Status */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={formData.is_active !== false}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                  className="h-4 w-4 text-tuggi-blue rounded border-gray-300 dark:border-gray-600"
                />
                <label htmlFor="is_active" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                  Active trigger point
                </label>
              </div>
            </div>
            
            <div className="flex items-center justify-end space-x-3 p-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCloseForm}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={saveTriggerPoint}
                disabled={isLoading}
                className="px-4 py-2 text-sm font-medium text-white bg-tuggi-blue rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    {isEditing ? 'Update' : 'Create'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Modal */}
      {showFeedbackModal && feedbackSuggestion && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {feedbackAction === 'accept' ? 'Accept' : 'Reject'} Suggestion
              </h3>
              <button
                onClick={() => {
                  setShowFeedbackModal(false)
                  setFeedbackSuggestion(null)
                  setFeedbackReason('')
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              {/* Suggestion Info */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  <div className="flex items-center mb-2">
                    <MapPin className="h-4 w-4 mr-2" />
                    <span>Distance: {Math.round(feedbackSuggestion.distance_m)}m</span>
                  </div>
                  <div className="flex items-center mb-2">
                    <Navigation className="h-4 w-4 mr-2" />
                    <span>Direction: {feedbackSuggestion.bearing_deg}°</span>
                  </div>
                  <div className="flex items-center">
                    <Target className="h-4 w-4 mr-2" />
                    <span>Confidence: {feedbackSuggestion.confidence_score}%</span>
                  </div>
                </div>
              </div>

              {/* Feedback Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {feedbackAction === 'accept' ? 'Why did you accept this suggestion?' : 'Why did you reject this suggestion?'}
                </label>
                <textarea
                  value={feedbackReason}
                  onChange={(e) => setFeedbackReason(e.target.value)}
                  placeholder={feedbackAction === 'accept' 
                    ? "e.g., Good visibility, accessible location, appropriate distance..."
                    : "e.g., Poor visibility, too close/far, blocked by obstacles..."
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none"
                  rows={3}
                />
              </div>

              {/* Quick Feedback Options */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Quick feedback (optional):
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {feedbackAction === 'reject' ? [
                    'Poor visibility',
                    'Too close',
                    'Too far',
                    'Blocked by obstacles',
                    'Inaccessible location',
                    'Wrong direction'
                  ] : [
                    'Good visibility',
                    'Perfect distance',
                    'Easy access',
                    'Great angle',
                    'Safe location',
                    'Well positioned'
                  ].map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        
                        // Visual feedback
                        e.currentTarget.style.backgroundColor = '#3b82f6'
                        e.currentTarget.style.color = '#ffffff'
                        setTimeout(() => {
                          e.currentTarget.style.backgroundColor = '#ffffff'
                          e.currentTarget.style.color = '#374151'
                        }, 200)
                        
                        setFeedbackReason(prev => {
                          const newReason = prev ? `${prev}; ${option}` : option
                          console.log('Adding feedback option:', option, 'New reason:', newReason)
                          return newReason
                        })
                      }}
                      style={{
                        padding: '8px 12px',
                        fontSize: '12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        backgroundColor: '#ffffff',
                        color: '#374151',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f9fafb'
                        e.currentTarget.style.borderColor = '#9ca3af'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#ffffff'
                        e.currentTarget.style.borderColor = '#d1d5db'
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.outline = '2px solid #3b82f6'
                        e.currentTarget.style.outlineOffset = '2px'
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.outline = 'none'
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                {feedbackReason && (
                  <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        <strong>Current feedback:</strong> {feedbackReason}
                      </p>
                      <button
                        type="button"
                        onClick={() => setFeedbackReason('')}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 underline"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex items-center justify-end space-x-3 p-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => {
                  setShowFeedbackModal(false)
                  setFeedbackSuggestion(null)
                  setFeedbackReason('')
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={submitFeedback}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg flex items-center ${
                  feedbackAction === 'accept' 
                    ? 'bg-green-600 hover:bg-green-700' 
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {feedbackAction === 'accept' ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Accept
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 mr-2" />
                    Reject
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}