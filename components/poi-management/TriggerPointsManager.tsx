'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useCmsUser } from '@/lib/hooks/useCmsUser'
import { useSupabaseClient, useUser } from '@supabase/auth-helpers-react'
import {
  Plus, MapPin, Target, Trash2, Edit3, Save, X,
  Navigation, Circle, Settings, AlertTriangle,
  Check, ZoomIn, Filter, ChevronDown, ChevronUp, Loader2, AlertCircle, CheckCircle,
  Sparkles
} from 'lucide-react'
import { TriggerPointsMap } from './TriggerPointsMap'
import { DirectionSelector } from './DirectionSelector'
import { BearingSelector } from './BearingSelector'
import { BoundaryControls } from './BoundaryControls'

import { cn } from '@/lib/utils'
import { extractCoordinates } from '@/lib/core/poi-coordinates'
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
  onClose,
  onUpdate,
  boundary,
  isGeofence = false
}: TriggerPointsManagerProps) {
  const supabase = useSupabaseClient()
  const user = useUser()
  const t = useTranslations('Modals.TriggerPointsManager')
  // Boundary labels are owned by the POIDetails namespace — reuse them so the unified
  // Boundary mode stays in sync with the (now-folded) standalone boundary tab.
  const tPoi = useTranslations('Modals.POIDetails')

  // State
  const [triggerPoints, setTriggerPoints] = useState<TriggerPoint[]>([])
  const [selectedTriggerPoint, setSelectedTriggerPoint] = useState<TriggerPoint | null>(null)
  const [isAddingMode, setIsAddingMode] = useState(false)
  // Unified map workspace: which layer the operator is editing. Geofence POIs (polygon
  // triggering, no point TPs) start in — and stay locked to — Boundary mode.
  const [viewMode, setViewMode] = useState<'trigger-points' | 'boundary'>(
    boundary && isGeofence ? 'boundary' : 'trigger-points'
  )
  const [isEditing, setIsEditing] = useState(false)
  const { canEdit, isViewer } = useCmsUser()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [filterType, setFilterType] = useState<string>('all')
  const [showBearingDetails, setShowBearingDetails] = useState(false)
  const [availableDescriptions, setAvailableDescriptions] = useState<AttractionDescription[]>([])

  const [isUpdatingPOILocation, setIsUpdatingPOILocation] = useState(false)
  const [poiUpdateSuccess, setPoiUpdateSuccess] = useState(false)
  const [poiUpdateError, setPoiUpdateError] = useState<string | null>(null)

  // AI Suggestions state
  const [suggestedTriggerPoints, setSuggestedTriggerPoints] = useState<any[]>([])
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false)

  // Resolved attraction coordinate (SSOT). The `attractionCoordinates` prop is
  // only an optimistic initial — the authoritative value is fetched below from
  // core.attraction_coordinate. Trusting the prop (assembled across many code
  // paths) is what caused the 0,0/ocean bug when opening from the map view.
  const isValidLatLng = (c?: { lat: number; lng: number } | null): c is { lat: number; lng: number } =>
    !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && !(c.lat === 0 && c.lng === 0)

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    isValidLatLng(attractionCoordinates) ? attractionCoordinates : null
  )
  const [coordinateError, setCoordinateError] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState<TriggerPointFormData>({
    ...DEFAULT_TRIGGER_POINT,
    latitude: coords?.lat ?? 0,
    longitude: coords?.lng ?? 0,
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

  // SSOT: load the attraction's own coordinate from core.attraction_coordinate.
  // Coordinates are NOT columns on core.attraction, so this is the only reliable
  // source. If neither the prop nor the DB yields a valid coordinate, treat it as
  // a system/fetch error — never silently fall back to 0,0.
  useEffect(() => {
    if (!attractionId) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .schema('core')
        .from('attraction_coordinate')
        .select('latitude, longitude')
        .eq('attraction_id', attractionId)
        .maybeSingle()
      if (cancelled) return
      const c = extractCoordinates(data)
      if (c) {
        setCoords({ lat: c.latitude, lng: c.longitude })
        setCoordinateError(null)
      } else if (!isValidLatLng(attractionCoordinates)) {
        setCoordinateError(t('errors.missing_coordinates'))
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attractionId, supabase])

  // Keep the "new trigger point" default centered on the resolved coordinate,
  // but never clobber lat/lng while the user is actively placing/editing a TP.
  useEffect(() => {
    if (!coords || showForm) return
    setFormData(prev => ({ ...prev, latitude: coords.lat, longitude: coords.lng }))
  }, [coords, showForm])

  // Handle AI Trigger Point Generation
  const handleGenerateAISuggestions = useCallback(async () => {
    if (!coords) {
      setError(t('errors.missing_coordinates'))
      return
    }

    try {
      setIsGeneratingSuggestions(true)
      setError(null)
      
      const response = await fetch('/api/trigger-points/google/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poiData: {
            id: attractionId,
            name: attractionName,
            location: coords,
            type: attractionTypes?.[0] || 'tourist_attraction',
            country: 'Portugal', // Default/fallback if not strictly available
            city: 'Unknown'
          },
          options: {
            maxTriggerPoints: 3
          }
        })
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to generate suggestions')
      }

      if (result.data && result.data.triggerPoints) {
        // Map the backend TriggerPoint format to the UI suggestion format
        const newSuggestions = result.data.triggerPoints.map((tp: any, index: number) => ({
          ...tp,
          id: `suggestion-${Date.now()}-${index}`,
          lat: tp.location?.lat || tp.lat || 0,
          lng: tp.location?.lng || tp.lng || 0,
          bearing_deg: tp.expectedBearing !== undefined ? Math.round(tp.expectedBearing) : null,
          confidence_score: tp.confidence ? tp.confidence * 100 : (tp.quality ? tp.quality * 100 : 85),
          access_type: 'car', // Predictor generates driving triggers mostly
          distance_m: tp.distance ? Math.round(tp.distance) : 0,
          source: 'pattern_based' // Our AI engine
        }))
        setSuggestedTriggerPoints(newSuggestions)
      } else {
        setSuggestedTriggerPoints([])
      }
    } catch (err) {
      console.error('Error generating suggestions:', err)
      setError(err instanceof Error ? err.message : 'Failed to generate suggestions')
    } finally {
      setIsGeneratingSuggestions(false)
    }
  }, [attractionId, attractionName, coords, attractionTypes, t])

  const handleSuggestionDrag = useCallback((suggestionId: string, newLat: number, newLng: number, newDistance: number, newBearing: number) => {
    setSuggestedTriggerPoints(prev => prev.map(s => 
      s.id === suggestionId 
        ? { ...s, lat: newLat, lng: newLng, distance_m: newDistance, bearing_deg: newBearing } 
        : s
    ))
  }, [])

  const handleAcceptSuggestion = useCallback(async (suggestion: any) => {
    try {
      setIsLoading(true)
      setError(null)

      const headers: any = { 'Content-Type': 'application/json' }
      if (user?.id) headers['x-user-id'] = user.id

      // Calculate priority based on existing + 1
      const maxPriority = triggerPoints.length > 0 
        ? Math.max(...triggerPoints.map(tp => tp.priority || 0)) 
        : 0

      const response = await fetch('/api/trigger-points/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          attraction_id: attractionId,
          lat: suggestion.lat,
          lng: suggestion.lng,
          radius_meters: 30, // Default for generated
          expected_bearing: suggestion.bearing_deg !== null ? suggestion.bearing_deg : null,
          bearing_threshold: 30, // Relaxed threshold for generated
          type: 'primary',
          priority: maxPriority + 1,
          is_active: true,
          direction: suggestion.access_type === 'walk' ? 'front' : 'right', // Educated guess based on driving vs walking
          access: suggestion.access_type,
          name: `AI Generated - ${suggestion.access_type}`,
          description: `Generated by AI (${suggestion.source}). Confidence: ${Math.round(suggestion.confidence_score)}%`
        })
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to save suggested trigger point')
      }

      // Remove from suggestions list
      setSuggestedTriggerPoints(prev => prev.filter(s => s.id !== suggestion.id))
      
      // Refresh active list
      await loadTriggerPoints()
      if (onUpdate) onUpdate()

    } catch (err) {
      console.error('Error accepting suggestion:', err)
      setError(err instanceof Error ? err.message : 'Failed to accept suggestion')
    } finally {
      setIsLoading(false)
    }
  }, [attractionId, triggerPoints, user, loadTriggerPoints, onUpdate])

  const handleRejectSuggestion = useCallback((suggestionId: string) => {
    setSuggestedTriggerPoints(prev => prev.filter(s => s.id !== suggestionId))
  }, [])  // Handle map click for adding new trigger point
  const handleMapClick = useCallback((lat: number, lng: number, bearing?: number) => {
    if (isAddingMode) {
      setFormData(prev => ({
        ...prev,
        latitude: lat,
        longitude: lng,
        expected_bearing: bearing !== undefined ? bearing : prev.expected_bearing
      }))
      
      setShowForm(true)
      setIsEditing(false)
      
      // Auto-open details if bearing is set via map drag
      if (bearing !== undefined) {
         setShowBearingDetails(true)
      } else {
         setShowBearingDetails(false)
      }
    }
  }, [isAddingMode])

  // Handle trigger point selection
  const handleTriggerPointClick = useCallback((triggerPoint: TriggerPoint) => {
    setSelectedTriggerPoint(triggerPoint)
    setFormData(triggerPoint)
    setShowForm(true)
    setIsEditing(true)
    setIsAddingMode(false)
    // Open details if bearing is set
    setShowBearingDetails(!!triggerPoint.expected_bearing)
  }, [])

  // Handle trigger point drag
  const handleTriggerPointDrag = useCallback((triggerPoint: TriggerPoint, newLat: number, newLng: number) => {
    setTriggerPoints(prev => prev.map(tp =>
      tp.id === triggerPoint.id ? { ...tp, latitude: newLat, longitude: newLng } : tp
    ))
  }, [])



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
      if (onUpdate) onUpdate()
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
        // Update existing trigger point using API route (bypasses RLS issues)
        const headers: any = { 'Content-Type': 'application/json' }
        if (user?.id) {
          headers['x-user-id'] = user.id
        }

        const response = await fetch('/api/trigger-points/update', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            trigger_point_id: selectedTriggerPoint.id,
            lat: formData.latitude,
            lng: formData.longitude,
            radius_meters: formData.radius_meters,
            expected_bearing: formData.expected_bearing,
            bearing_threshold: formData.bearing_threshold,
            type: formData.type,
            priority: formData.priority,
            is_active: formData.is_active,
            direction: formData.direction,
            access: formData.access ?? 'car',
            name: `Manual - ${formData.type}`,
            description: `Manually updated trigger point by ${user?.email || 'unknown user'}`
          })
        })

        const result = await response.json()

        if (!response.ok || !result.success) {
          console.error('❌ Error updating trigger point:', result.error)
          throw new Error(result.error || 'Failed to update trigger point')
        }

        console.log('✅ Trigger point updated successfully:', result.data)
      } else {
        // Create new trigger point using API route (bypasses RLS issues)
        const headers: any = { 'Content-Type': 'application/json' }
        if (user?.id) {
          headers['x-user-id'] = user.id
        }

        const response = await fetch('/api/trigger-points/create', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            attraction_id: attractionId,
            lat: formData.latitude,
            lng: formData.longitude,
            radius_meters: formData.radius_meters,
            expected_bearing: formData.expected_bearing,
            bearing_threshold: formData.bearing_threshold,
            type: formData.type,
            priority: formData.priority,
            is_active: formData.is_active,
            direction: formData.direction,
            access: formData.access ?? 'car',
            name: `Manual - ${formData.type}`,
            description: `Manually created trigger point by ${user?.email || 'unknown user'}`
          })
        })

        const result = await response.json()

        if (!response.ok || !result.success) {
          console.error('❌ Error creating trigger point:', result)
          // Build a more detailed error message
          let errorMessage = result.error || 'Failed to create trigger point'
          if (result.details) {
            errorMessage += `: ${result.details}`
          }
          if (result.hint) {
            errorMessage += ` (${result.hint})`
          }
          throw new Error(errorMessage)
        }

      console.log('✅ Trigger point created successfully:', result.data)
      }

      if (onUpdate) onUpdate()
      await loadTriggerPoints()
      handleCloseForm()
    } catch (err) {
      console.error('Error saving trigger point:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to save trigger point'
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }, [formData, isEditing, selectedTriggerPoint, attractionId, loadTriggerPoints, validateForm])

  // Delete trigger point
  const deleteTriggerPoint = useCallback(async (triggerPointId: string) => {
    if (!confirm('Are you sure you want to delete this trigger point?')) {
      return
    }

    try {
      setIsLoading(true)
      setError(null)

      // Use API route to delete trigger point (bypasses RLS issues)
      const response = await fetch('/api/trigger-points/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trigger_point_id: triggerPointId,
          attraction_id: attractionId
        })
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        console.error('❌ Error deleting trigger point:', result.error)
        throw new Error(result.error || 'Failed to delete trigger point')
      }

      console.log('✅ Trigger point deleted successfully:', result.data)

      if (onUpdate) onUpdate()
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
  }, [loadTriggerPoints, selectedTriggerPoint])

  // Toggle trigger point active status
  const toggleTriggerPointStatus = useCallback(async (triggerPointId: string, currentStatus: boolean) => {
    try {
      setIsLoading(true)
      setError(null)

      // Use API route to update trigger point status (bypasses RLS issues)
      const headers: any = { 'Content-Type': 'application/json' }
      if (user?.id) {
        headers['x-user-id'] = user.id
      }

      const response = await fetch('/api/trigger-points/update', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          trigger_point_id: triggerPointId,
          is_active: !currentStatus,
          description: `Status ${!currentStatus ? 'activated' : 'deactivated'} by ${user?.email || 'unknown user'}`
        })
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        console.error('❌ Error toggling trigger point status:', result.error)
        throw new Error(result.error || 'Failed to toggle trigger point status')
      }

      console.log(`✅ Trigger point ${!currentStatus ? 'activated' : 'deactivated'} successfully:`, result.data)
      if (onUpdate) onUpdate()
      await loadTriggerPoints()

    } catch (err) {
      console.error('Error toggling trigger point status:', err)
      setError('Failed to toggle trigger point status')
    } finally {
      setIsLoading(false)
    }
  }, [loadTriggerPoints])

  // Handle form close
  const handleCloseForm = useCallback(() => {
    setShowForm(false)
    setIsEditing(false)
    setIsAddingMode(false)
    setSelectedTriggerPoint(null)
    setFormData({
      ...DEFAULT_TRIGGER_POINT,
      latitude: coords?.lat ?? 0,
      longitude: coords?.lng ?? 0,
    })
    setError(null)
  }, [coords])

  // Filter trigger points
  const filteredTriggerPoints = triggerPoints.filter(tp =>
    filterType === 'all' || tp.type === filterType
  )

  // Get trigger point by type color
  const getTriggerTypeInfo = (type: string) => {
    return TRIGGER_POINT_TYPES.find(t => t.value === type) || TRIGGER_POINT_TYPES[0]
  }

  // Create a preview trigger point from formData
  const previewTriggerPoint = showForm ? {
    ...formData,
    id: (isEditing && selectedTriggerPoint?.id) ? selectedTriggerPoint.id : 'temp-preview',
    attraction_id: attractionId,
    // Ensure all required fields for TriggerPoint are present
    bearing_threshold: formData.bearing_threshold || 15, // Default if missing
  } : null

  // Calculate trigger points to display
  // If editing, replace the selected point with the preview
  // If creating, append the preview
  // Always respect the filter
  const displayTriggerPoints = (() => {
    let points = [...triggerPoints]
    
    if (showForm && previewTriggerPoint) {
      if (isEditing && selectedTriggerPoint) {
        // Replace existing point with preview
        points = points.map(tp => tp.id === selectedTriggerPoint.id ? (previewTriggerPoint as TriggerPoint) : tp)
      } else {
        // Add new point (if valid location set)
        if (previewTriggerPoint.latitude && previewTriggerPoint.longitude) {
           points.push(previewTriggerPoint as TriggerPoint)
        }
      }
    }
    
    // Apply filter
    return points.filter(tp => filterType === 'all' || tp.type === filterType)
  })()

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('labels.title')}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {attractionName} • {triggerPoints.length} trigger points
            </p>
          </div>
          {/* Mode toggle — kept on the LEFT so it never shifts when the mode-specific
              action buttons on the right appear/disappear per mode. */}
          {!!boundary && !isGeofence && (
            <div className="flex items-center rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
              <button
                onClick={() => setViewMode('trigger-points')}
                className={cn(
                  "flex items-center px-3 py-1.5 rounded-md text-xs font-semibold transition-colors",
                  viewMode === 'trigger-points'
                    ? "bg-white dark:bg-gray-700 text-tuggi-blue shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                )}
              >
                <Target className="h-3.5 w-3.5 mr-1.5" />
                {t('mode.trigger_points')}
              </button>
              <button
                onClick={() => { handleCloseForm(); setViewMode('boundary') }}
                className={cn(
                  "flex items-center px-3 py-1.5 rounded-md text-xs font-semibold transition-colors",
                  viewMode === 'boundary'
                    ? "bg-white dark:bg-gray-700 text-tuggi-blue shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                )}
              >
                <MapPin className="h-3.5 w-3.5 mr-1.5" />
                {t('mode.boundary')}
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {viewMode === 'trigger-points' && canEdit && !isViewer && (
            <button
              onClick={handleGenerateAISuggestions}
              disabled={isGeneratingSuggestions || isLoading || !coords}
              className={cn(
                "flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                "bg-gradient-to-r from-purple-500 to-indigo-600 text-white hover:from-purple-600 hover:to-indigo-700 shadow-sm border border-purple-400"
              )}
            >
              {isGeneratingSuggestions ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Auto-Generate
                </>
              )}
            </button>
          )}

          {viewMode === 'trigger-points' && (
            <button
              onClick={() => setIsAddingMode(!isAddingMode)}
              disabled={isGeneratingSuggestions || !coords}
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
          )}
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

      {/* Coordinate fetch error — system error, not a POI without coordinates */}
      {coordinateError && !coords && (
        <div className="mx-4 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mr-2" />
            <p className="text-sm text-red-700 dark:text-red-300">{coordinateError}</p>
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

      <div className="flex-1 flex min-h-0">
        {/* Map */}
        <div className="flex-1 relative">
          {!coords ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900/40">
              <div className="flex flex-col items-center text-center px-6">
                {coordinateError ? (
                  <>
                    <AlertCircle className="h-6 w-6 text-red-500 mb-2" />
                    <p className="text-sm text-red-600 dark:text-red-400 max-w-xs">{coordinateError}</p>
                  </>
                ) : (
                  <>
                    <Loader2 className="h-6 w-6 text-gray-400 mb-2 animate-spin" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">Loading POI location…</p>
                  </>
                )}
              </div>
            </div>
          ) : (
          <TriggerPointsMap
            center={coords}
            zoom={14}
            height="100%"
            attractionName={attractionName}
            triggerPoints={viewMode === 'boundary' ? triggerPoints : displayTriggerPoints}
            selectedTriggerPoint={viewMode === 'boundary' ? null : (showForm ? (previewTriggerPoint as TriggerPoint) : selectedTriggerPoint)}
            suggestions={viewMode === 'boundary' ? [] : suggestedTriggerPoints}
            onSuggestionDrag={handleSuggestionDrag}
            onSuggestionAccept={handleAcceptSuggestion}
            onSuggestionReject={handleRejectSuggestion}
            onMapClick={handleMapClick}
            onTriggerPointClick={handleTriggerPointClick}
            onTriggerPointDrag={handleTriggerPointDrag}
            isAddingMode={viewMode === 'boundary' ? false : isAddingMode}
            onPOILocationChange={handlePOILocationChange}
            boundaryPolygon={boundary?.boundaryPolygon ?? boundary?.existingBoundary ?? null}
            boundaryEditable={viewMode === 'boundary' && !!boundary && canEdit && !isViewer}
            isDrawingBoundary={viewMode === 'boundary' && !!boundary?.isDrawingEnabled && canEdit && !isViewer}
            onBoundaryChange={(coords) => boundary?.setBoundaryPolygon(coords)}
            onBoundaryComplete={(poly) => {
              boundary?.handleBoundaryPolygonComplete(poly)
              boundary?.setIsDrawingEnabled(false)
            }}
            disableTriggerInteractions={viewMode === 'boundary'}
          />
          )}
        </div>

        {/* Sidebar */}
        <div className="w-80 border-l border-gray-200 dark:border-gray-700 flex flex-col h-full overflow-hidden">
          {viewMode === 'boundary' && boundary ? (
            <div className="flex flex-col h-full overflow-y-auto">
              {/* Boundary editing panel — replaces the TP list while editing the boundary */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center">
                <MapPin className="h-5 w-5 mr-2 text-tuggi-blue" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  {tPoi('labels.geographic_boundaries')}
                </h3>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {boundary.isDrawingEnabled
                    ? tPoi('labels.drawing_instruction')
                    : tPoi('labels.drawing_disabled_instruction')}
                </p>

                <BoundaryControls
                  boundaryPolygon={boundary.boundaryPolygon}
                  existingBoundary={boundary.existingBoundary}
                  isDrawingEnabled={boundary.isDrawingEnabled}
                  isSaving={boundary.isSavingBoundary}
                  canEdit={canEdit && !isViewer}
                  onReset={() => {
                    boundary.setBoundaryPolygon(boundary.existingBoundary)
                    boundary.setIsDrawingEnabled(false)
                  }}
                  onDelete={boundary.handleDeleteBoundary}
                  onSave={boundary.handleSaveBoundary}
                  onToggleDrawing={() => boundary.setIsDrawingEnabled(!boundary.isDrawingEnabled)}
                />

                {triggerPoints.length > 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 pt-2 border-t border-gray-100 dark:border-gray-800">
                    {t('mode.tp_reference_hint', { count: triggerPoints.length })}
                  </p>
                )}
              </div>
            </div>
          ) : (
          <>
          {/* Header with AI Suggestions Toggle */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Target className="h-5 w-5 mr-2 text-tuggi-blue" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  {t('labels.trigger_points_with_count', { count: filteredTriggerPoints.length })}
                </h3>
                {isUpdatingPOILocation && (
                  <div className="ml-2 flex items-center text-xs text-tuggi-orange">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    {t('labels.updating_poi_location')}
                  </div>
                )}
                {poiUpdateSuccess && (
                  <div className="ml-2 flex items-center text-xs text-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {t('labels.poi_location_updated')}
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

              </div>
            </div>
          </div>





          {/* Inline Form (Replaces Modal) */}
          {showForm && (
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 overflow-y-auto max-h-[60vh]">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
                  {isEditing ? t('actions.save') : t('actions.create')} {t('labels.trigger')}
                </h3>
  
                {/* Lat/Lng hidden (state kept) */}
                <div className="hidden">
                  <input type="number" readOnly value={formData.latitude || ''} />
                  <input type="number" readOnly value={formData.longitude || ''} />
                </div>
  
                <div className="grid grid-cols-2 gap-3">
                  {/* Type */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('labels.type')}
                    </label>
                    <select
                      value={formData.type || 'primary'}
                      onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as any }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    >
                      {TRIGGER_POINT_TYPES.filter(t => ['primary', 'fallback'].includes(t.value)).map(type => (
                        <option key={type.value} value={type.value}>
                          {t(`types.${type.value}`)}
                        </option>
                      ))}
                    </select>
                  </div>
    
                  {/* Radius */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('labels.radius')}
                    </label>
                    <select
                      value={formData.radius_meters || 30}
                      onChange={(e) => setFormData(prev => ({ ...prev, radius_meters: parseInt(e.target.value) }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                    >
                      <option value={5}>5m</option>
                      <option value={10}>10m</option>
                      <option value={20}>20m</option>
                      <option value={30}>30m</option>
                      <option value={40}>40m</option>
                      <option value={50}>50m</option>
                    </select>
                  </div>
                </div>

                {/* Access mode: quando o TP dispara (drive-only vs walk+drive) */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {'Modo'}
                  </label>
                  <select
                    value={formData.access || 'car'}
                    onChange={(e) => setFormData(prev => ({ ...prev, access: e.target.value as 'car' | 'both' }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    <option value="car">🚗 Sobre rodas (drive)</option>
                    <option value="both">🚶🚗 A pé + Sobre rodas (both)</option>
                  </select>
                </div>

                {/* Bearing (Collapsible) */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowBearingDetails(!showBearingDetails)}
                    className="flex items-center text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-2 transition-colors"
                  >
                    {showBearingDetails ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                    {t('labels.details')}
                  </button>
                  
                  {showBearingDetails && (
                    <div className="flex justify-center bg-white dark:bg-gray-800 rounded-lg p-2 border border-blue-100 dark:border-gray-700 animate-in fade-in slide-in-from-top-1 duration-200">
                      <BearingSelector
                        value={formData.expected_bearing}
                        onChange={(bearing) => setFormData(prev => ({ ...prev, expected_bearing: bearing }))}
                        disabled={isLoading}
                      />
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-4 mt-2 border-t border-gray-100 dark:border-gray-800 gap-2">
                   <div className="flex items-center gap-2">
                     {isEditing && selectedTriggerPoint?.id && canEdit && (
                      <button
                        onClick={() => deleteTriggerPoint(selectedTriggerPoint.id!)}
                        disabled={isLoading || isViewer}
                        className="px-3 py-2 text-xs font-medium text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    
                    {/* Status Toggle */}
                    <div className="flex items-center gap-2 px-2 py-1 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700">
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, is_active: !prev.is_active }))}
                        className={cn(
                          "relative inline-flex h-4 w-8 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                          formData.is_active ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
                        )}
                        title={formData.is_active ? t('labels.active') : t('labels.inactive')}
                      >
                        <span
                          className={cn(
                            "pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                            formData.is_active ? "translate-x-4" : "translate-x-0"
                          )}
                        />
                      </button>
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-widest",
                        formData.is_active ? "text-green-600 dark:text-green-400" : "text-gray-400"
                      )}>
                        {formData.is_active ? t('labels.active') : t('labels.inactive')}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCloseForm}
                      className="px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      {t('actions.cancel')}
                    </button>
                    <button
                      onClick={saveTriggerPoint}
                      disabled={isLoading || !canEdit || isViewer}
                      className="flex-1 px-4 py-2 text-xs font-medium text-white bg-tuggi-blue rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[80px]"
                    >
                      {isLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Save className="h-3 w-3 mr-1.5" />
                          {isEditing ? t('actions.save') : t('actions.create')}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Filter and Controls */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setFilterType('all')}
                className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                {t('labels.show_all')}
              </button>
            </div>

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              <option value="all">{t('labels.all_types')}</option>
              {TRIGGER_POINT_TYPES.map(type => (
                <option key={type.value} value={type.value}>
                  {t(`types.${type.value}`)}
                </option>
              ))}
            </select>
          </div>

          {/* Trigger Points List */}
          <div className="flex-1 overflow-y-auto min-h-0">
          
            {/* AI Suggestions Section */}
            {suggestedTriggerPoints.length > 0 && (
              <div className="mb-4">
                <div className="sticky top-0 z-10 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 p-2 text-xs font-semibold text-purple-700 dark:text-purple-300 border-b border-purple-100 dark:border-purple-800/30 flex items-center shadow-sm">
                  <Sparkles className="h-3 w-3 mr-1" />
                  AI Suggestions ({suggestedTriggerPoints.length})
                </div>
                <div className="divide-y divide-purple-100 dark:divide-purple-800/20">
                  {suggestedTriggerPoints.map(suggestion => (
                    <div key={suggestion.id} className="p-4 bg-white dark:bg-gray-800 border-l-4 border-purple-500 hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-colors">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center">
                          <div className="h-6 w-6 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center mr-2">
                            <span className="text-sm">{suggestion.access_type === 'walk' ? '🚶' : suggestion.access_type === 'car' ? '🚗' : '🚶🚗'}</span>
                          </div>
                          <span className="text-sm font-semibold text-gray-900 dark:text-white capitalize">
                            {suggestion.access_type} Access
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleAcceptSuggestion(suggestion)}
                            disabled={isLoading}
                            className="p-1.5 rounded-md bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors"
                            title="Accept Suggestion"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleRejectSuggestion(suggestion.id)}
                            disabled={isLoading}
                            className="p-1.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 transition-colors"
                            title="Reject Suggestion"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      
                      <div className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <Circle className="h-3 w-3 mr-1" />
                            Radius: 30m
                          </div>
                          <div className="font-medium text-purple-600 dark:text-purple-400">
                            {Math.round(suggestion.confidence_score)}% Confidence
                          </div>
                        </div>
                        {suggestion.bearing_deg !== null && (
                          <div className="flex items-center">
                            <Navigation className="h-3 w-3 mr-1" />
                            Bearing: {suggestion.bearing_deg}°
                          </div>
                        )}
                        <div className="text-[10px] text-gray-500 truncate pt-1">
                          {Number(suggestion.lat || 0).toFixed(6)}, {Number(suggestion.lng || 0).toFixed(6)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Existing Trigger Points */}
            <div className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800/80 backdrop-blur-sm p-2 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 uppercase tracking-wider">
              Active Triggers
            </div>
            
            {isLoading && !isGeneratingSuggestions ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tuggi-blue"></div>
              </div>
            ) : filteredTriggerPoints.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-500 dark:text-gray-400">
                <Target className="h-8 w-8 mb-2" />
                <p className="text-sm">{t('labels.no_triggers_found')}</p>
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
                        "p-3 rounded-lg border transition-colors cursor-pointer",
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

                        {/* User tracking information */}
                        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                          <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                            {(triggerPoint as any).created_by_email && (
                              <div>
                                <span className="font-medium">Created:</span> {(triggerPoint as any).created_at_formatted} by {(triggerPoint as any).created_by_email}
                              </div>
                            )}
                            {(triggerPoint as any).updated_by_email && (triggerPoint as any).updated_by !== (triggerPoint as any).created_by && (
                              <div>
                                <span className="font-medium">Updated:</span> {(triggerPoint as any).updated_at_formatted} by {(triggerPoint as any).updated_by_email}
                              </div>
                            )}
                            {!(triggerPoint as any).created_by_email && (
                              <div className="text-gray-400">
                                <span className="font-medium">Created:</span> {(triggerPoint as any).created_at_formatted || 'Unknown date'}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {triggerPoint.latitude.toFixed(6)}, {triggerPoint.longitude.toFixed(6)}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (triggerPoint.id) {
                                toggleTriggerPointStatus(triggerPoint.id, triggerPoint.is_active)
                              }
                            }}
                            className={cn(
                              "p-1 rounded",
                              triggerPoint.is_active
                                ? "text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                                : "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-400"
                            )}
                            title={triggerPoint.is_active ? 'Deactivate trigger point' : 'Activate trigger point'}
                          >
                            <Circle className={cn("h-3 w-3", triggerPoint.is_active && "fill-current")} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              if (triggerPoint.id) {
                                deleteTriggerPoint(triggerPoint.id)
                              }
                            }}
                            className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                            title="Delete trigger point"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          </>
          )}
        </div>
      </div>






    </div>
  )
}