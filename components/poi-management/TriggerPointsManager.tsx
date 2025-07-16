'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { 
  Plus, MapPin, Target, Trash2, Edit3, Save, X, 
  Navigation, Circle, Settings, AlertTriangle, 
  Check, RotateCcw, ZoomIn, Filter, ChevronDown, ChevronUp 
} from 'lucide-react'
import { TriggerPointsMap } from './TriggerPointsMap'
import { DirectionSelector } from './DirectionSelector'
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

  useEffect(() => {
    loadTriggerPoints()
  }, [loadTriggerPoints])

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
            zoom={16}
            height="100%"
            attractionName={attractionName}
            triggerPoints={filteredTriggerPoints}
            selectedTriggerPoint={selectedTriggerPoint}
            onMapClick={handleMapClick}
            onTriggerPointClick={handleTriggerPointClick}
            onTriggerPointDrag={handleTriggerPointDrag}
            isAddingMode={isAddingMode}
          />
        </div>

        {/* Sidebar */}
        <div className="w-80 border-l border-gray-200 dark:border-gray-700 flex flex-col">
          {/* Filter and Controls */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                Trigger Points ({filteredTriggerPoints.length})
              </h3>
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

              {/* Bearing */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Expected Bearing (degrees, optional)
                </label>
                <input
                  type="number"
                  min="0"
                  max="360"
                  value={formData.expected_bearing || ''}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    expected_bearing: e.target.value ? parseFloat(e.target.value) : null 
                  }))}
                  placeholder="Leave empty for omnidirectional"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>

              {/* Bearing Threshold */}
              {formData.expected_bearing !== null && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Bearing Threshold (degrees)
                  </label>
                  <input
                    type="range"
                    min="5"
                    max="90"
                    step="5"
                    value={formData.bearing_threshold || 30}
                    onChange={(e) => setFormData(prev => ({ ...prev, bearing_threshold: parseInt(e.target.value) }))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>5°</span>
                    <span className="font-medium">±{formData.bearing_threshold}°</span>
                    <span>90°</span>
                  </div>
                </div>
              )}

              {/* Description */}
              {availableDescriptions.length > 0 && (
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
              )}

              {/* Direction Selector */}
              <DirectionSelector 
                value={formData.direction || null}
                onChange={(direction) => setFormData(prev => ({ ...prev, direction }))}
                disabled={isLoading}
              />

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
    </div>
  )
} 