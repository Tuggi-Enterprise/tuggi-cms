import { useState, useCallback } from 'react'
import { MapState } from '@/types/poi-importer'
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from '@/constants/poi-importer'
import { geoJSONToPaths } from '@/lib/maps/geojson-paths'
import { geocodeAddress } from '@/lib/maps/geocode-address'

export function useMapState() {
  // State
  const [mapCenter, setMapCenter] = useState(DEFAULT_MAP_CENTER)
  const [mapZoom, setMapZoom] = useState(DEFAULT_MAP_ZOOM)
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  
  // City search related state
  const [cityQuery, setCityQuery] = useState('')
  const [isSearchingCity, setIsSearchingCity] = useState(false)
  const [cityBoundary, setCityBoundary] = useState<Array<{ lat: number; lng: number }> | null>(null)
  const [currentCityName, setCurrentCityName] = useState('')

  // Update map center and zoom
  const updateMapView = useCallback((center: { lat: number; lng: number }, zoom: number) => {
    setMapCenter(center)
    setMapZoom(zoom)
  }, [])

  // Toggle drawing mode
  const toggleDrawingMode = useCallback(() => {
    setIsDrawingMode(prev => !prev)
  }, [])

  // Search for city
  const searchCity = useCallback(async () => {
    if (!cityQuery.trim()) return

    setIsSearchingCity(true)
    
    try {
      // ONE forward geocoder in the CMS — `lib/maps/geocode-address.ts`. This call used to be the
      // only one, and #371 needed a second surface (the place's map centre); lifting it out is
      // what keeps them from drifting (CLAUDE.md §6, DRY).
      const place = await geocodeAddress(cityQuery)

      if (place) {
        const newCenter = { lat: place.lat, lng: place.lng }

        setMapCenter(newCenter)
        setMapZoom(12)
        setCurrentCityName(place.formattedAddress)

        // Try to fetch city boundary
        const boundaryFetched = await fetchCityBoundary(
          newCenter.lat, 
          newCenter.lng, 
          place.formattedAddress
        )
        
        return { center: newCenter, zoom: 12, boundaryFetched }
      }
      
      return null
    } catch (error) {
      console.error('Error searching city:', error)
      throw error
    } finally {
      setIsSearchingCity(false)
    }
  }, [cityQuery])

  // Fetch city boundary
  const fetchCityBoundary = useCallback(async (
    lat: number, 
    lng: number, 
    cityName?: string
  ): Promise<boolean> => {
    try {
      // Use OpenStreetMap Nominatim API to get city boundary
      const query = cityName || `${lat},${lng}`
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&addressdetails=1&q=${encodeURIComponent(query)}&limit=1`
      )
      
      if (!response.ok) {
        console.warn('Nominatim API request failed')
        return false
      }
      
      const data = await response.json()
      
      if (data && data.length > 0 && data[0].geojson) {
        const geojson = data[0].geojson
        
        // Polygon and MultiPolygon alike. cityBoundary is a single ring, so a multi-part
        // boundary contributes its largest ring -- the previous code took part [0], which is
        // arbitrary and often a sliver.
        const paths = geoJSONToPaths(geojson)
        if (paths.length > 0) {
          const largest = paths.reduce((a, b) => (b.length > a.length ? b : a))
          setCityBoundary(largest)
          setCurrentCityName(data[0].display_name || cityName || 'Unknown City')
          return true
        }
      }
      
      console.warn('No valid boundary found for city')
      return false
    } catch (error) {
      console.error('Error fetching city boundary:', error)
      return false
    }
  }, [])

  // Clear city data
  const clearCityData = useCallback(() => {
    setCityBoundary(null)
    setCurrentCityName('')
    setCityQuery('')
  }, [])

  // Reset to default view
  const resetMapView = useCallback(() => {
    setMapCenter(DEFAULT_MAP_CENTER)
    setMapZoom(DEFAULT_MAP_ZOOM)
    setIsDrawingMode(false)
    clearCityData()
  }, [clearCityData])

  return {
    // State
    mapCenter,
    mapZoom,
    isDrawingMode,
    cityQuery,
    setCityQuery,
    isSearchingCity,
    cityBoundary,
    currentCityName,

    // Actions
    updateMapView,
    toggleDrawingMode,
    setIsDrawingMode,
    searchCity,
    fetchCityBoundary,
    clearCityData,
    resetMapView,
  }
} 