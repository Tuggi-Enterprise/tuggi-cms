import { useState, useCallback, useMemo } from 'react'
import { SavedPolygon, PolygonStats } from '@/types/poi-importer'
import { PolygonService } from '@/lib/services/polygon-service'
import { useSupabaseClient } from '@supabase/auth-helpers-react'

export function usePolygonManagement() {
  const supabase = useSupabaseClient()
  const polygonService = useMemo(() => new PolygonService(supabase), [supabase])

  // State
  const [polygonName, setPolygonName] = useState('')
  const [currentPolygon, setCurrentPolygon] = useState<google.maps.Polygon | null>(null)
  const [currentPolygonCoords, setCurrentPolygonCoords] = useState<Array<{ lat: number; lng: number }>>([])
  const [polygonStats, setPolygonStats] = useState<PolygonStats>({ vertices: 0, area: 0 })
  const [savedPolygons, setSavedPolygons] = useState<SavedPolygon[]>([])
  const [selectedSavedPolygon, setSelectedSavedPolygon] = useState<string>('')
  const [isSavingPolygon, setIsSavingPolygon] = useState(false)

  // Fetch saved polygons
  const fetchSavedPolygons = useCallback(async (autoFitMap: boolean = false) => {
    try {
      const polygons = await polygonService.fetchSavedPolygons()
      setSavedPolygons(polygons)

      // Calculate map bounds if needed
      if (autoFitMap && polygons.length > 0) {
        const bounds = polygonService.calculateMapBounds(polygons)
        return bounds
      }
      return null
    } catch (error) {
      console.error('Error fetching saved polygons:', error)
      return null
    }
  }, [polygonService])

  // Handle polygon completion
  const handlePolygonComplete = useCallback(async (polygon: google.maps.Polygon) => {
    const path = polygon.getPath()
    const coords = []
    
    for (let i = 0; i < path.getLength(); i++) {
      const point = path.getAt(i)
      coords.push({ lat: point.lat(), lng: point.lng() })
    }

    setCurrentPolygon(polygon)
    setCurrentPolygonCoords(coords)
    
    // Calculate stats
    const stats = polygonService.calculatePolygonStats(coords)
    setPolygonStats(stats)

    // Generate name
    try {
      const generatedName = await polygonService.generatePolygonName(coords)
      setPolygonName(generatedName)
    } catch (error) {
      console.error('Error generating polygon name:', error)
      setPolygonName('Custom Area')
    }
  }, [polygonService])

  // Save current polygon
  const saveCurrentPolygon = useCallback(async (selectedCountry?: string) => {
    if (currentPolygonCoords.length === 0 || !polygonName.trim()) {
      throw new Error('Invalid polygon data')
    }

    setIsSavingPolygon(true)
    try {
      const savedPolygon = await polygonService.savePolygon(
        polygonName.trim(),
        currentPolygonCoords,
        selectedCountry
      )
      
      setSavedPolygons(prev => [savedPolygon, ...prev])
      return savedPolygon
    } catch (error) {
      console.error('Error saving polygon:', error)
      throw error
    } finally {
      setIsSavingPolygon(false)
    }
  }, [currentPolygonCoords, polygonName, polygonService])

  // Load a saved polygon
  const loadPolygon = useCallback((polygonId: string) => {
    const polygon = savedPolygons.find(p => p.id === polygonId)
    if (polygon) {
      setCurrentPolygonCoords(polygon.paths)
      setPolygonName(polygon.name)
      setSelectedSavedPolygon(polygonId)
      
      const stats = polygonService.calculatePolygonStats(polygon.paths)
      setPolygonStats(stats)

      // Calculate map center for this polygon
      const bounds = polygonService.calculateMapBounds([polygon])
      return bounds
    }
    return null
  }, [savedPolygons, polygonService])

  // Clear current polygon
  const clearCurrentPolygon = useCallback(() => {
    setCurrentPolygon(null)
    setCurrentPolygonCoords([])
    setPolygonName('')
    setPolygonStats({ vertices: 0, area: 0 })
    setSelectedSavedPolygon('')
  }, [])

  return {
    // State
    polygonName,
    setPolygonName,
    currentPolygon,
    currentPolygonCoords,
    polygonStats,
    savedPolygons,
    selectedSavedPolygon,
    setSelectedSavedPolygon,
    isSavingPolygon,

    // Actions
    fetchSavedPolygons,
    handlePolygonComplete,
    saveCurrentPolygon,
    loadPolygon,
    clearCurrentPolygon,
  }
} 