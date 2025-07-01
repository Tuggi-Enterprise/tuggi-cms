'use client'

import { useState, useEffect, useRef } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { 
  Search, Save, Upload, MapPin, Star, Clock, Globe, ExternalLink, 
  CheckCircle2, Loader2, ChevronDown, ChevronUp, Info, Users,
  Building2, Camera, Phone, Globe2, MapIcon, Target, X, Settings,
  Mountain, Church, TreePine, Utensils, ShoppingBag, Palette,
  Waves, Dumbbell, BookOpen, Landmark
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createGooglePlacesService, type PlaceSearchResult } from '@/lib/googlePlaces'
import { GoogleMapComponent, extractPolygonCoordinates, calculatePolygonCenter } from '@/components/ui/GoogleMapComponent'

interface SavedPolygon {
  id: string
  name: string
  paths: Array<{lat: number, lng: number}>
  created_at: string
}

const POI_CATEGORIES = [
  { value: 'all', label: 'All', icon: Target, color: 'bg-gray-500' },
  { value: 'tourist_attraction', label: 'Attractions', icon: Target, color: 'bg-blue-500' },
  { value: 'museum', label: 'Museums', icon: Building2, color: 'bg-purple-500' },
  { value: 'park', label: 'Parks', icon: TreePine, color: 'bg-green-500' },
  { value: 'church', label: 'Churches', icon: Church, color: 'bg-amber-600' },
  { value: 'stadium', label: 'Stadiums', icon: Dumbbell, color: 'bg-red-500' },
  { value: 'library', label: 'Historical', icon: BookOpen, color: 'bg-indigo-500' },
  { value: 'aquarium', label: 'Beaches', icon: Waves, color: 'bg-cyan-500' },
  { value: 'zoo', label: 'Natural', icon: Mountain, color: 'bg-emerald-500' },
]

const COUNTRIES = [
  { value: '', label: 'Auto-detect' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'FR', label: 'France' },
  { value: 'DE', label: 'Germany' },
  { value: 'IT', label: 'Italy' },
  { value: 'ES', label: 'Spain' },
  { value: 'PT', label: 'Portugal' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'BE', label: 'Belgium' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'AT', label: 'Austria' },
  { value: 'JP', label: 'Japan' },
  { value: 'AU', label: 'Australia' },
  { value: 'CA', label: 'Canada' },
  { value: 'BR', label: 'Brazil' },
]

interface PolygonStats {
  vertices: number
  area: number
}

interface EnhancedPlaceResult extends PlaceSearchResult {
  thumbnail?: string
  isSelected: boolean
  alreadyExists: boolean
}

export default function POIImporterPage() {
  const [isClient, setIsClient] = useState(false)
  
  // UI State
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  const [showResults, setShowResults] = useState(false)
  
  // Polygon Management
  const [polygonName, setPolygonName] = useState('')
  const [selectedCountry, setSelectedCountry] = useState('')
  const [currentPolygon, setCurrentPolygon] = useState<google.maps.Polygon | null>(null)
  const [currentPolygonCoords, setCurrentPolygonCoords] = useState<Array<{ lat: number; lng: number }>>([])
  const [polygonStats, setPolygonStats] = useState<PolygonStats>({ vertices: 0, area: 0 })
  const [savedPolygons, setSavedPolygons] = useState<SavedPolygon[]>([])
  const [selectedSavedPolygon, setSelectedSavedPolygon] = useState<string>('')
  
  // Search & Results
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchResults, setSearchResults] = useState<EnhancedPlaceResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchStatus, setSearchStatus] = useState<string>('')
  
  // City Search
  const [cityQuery, setCityQuery] = useState('')
  const [mapCenter, setMapCenter] = useState({ lat: 37.7749, lng: -122.4194 })
  const [mapZoom, setMapZoom] = useState(12)
  const [isSearchingCity, setIsSearchingCity] = useState(false)
  const [cityBoundary, setCityBoundary] = useState<Array<{ lat: number; lng: number }> | null>(null)
  const [currentCityName, setCurrentCityName] = useState('')
  
  // Import Management
  const [isImporting, setIsImporting] = useState(false)
  const [importStatus, setImportStatus] = useState<string>('')
  const [importedCount, setImportedCount] = useState(0)
  const [isSavingPolygon, setIsSavingPolygon] = useState(false)

  const supabase = useSupabaseClient()
  const placesService = createGooglePlacesService(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)

  useEffect(() => {
    setIsClient(true)
    fetchSavedPolygons()
  }, [])

  const fetchSavedPolygons = async () => {
    try {
      const { data, error } = await supabase
        .schema('core')
        .from('saved_polygons')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      const polygons = data
        .filter(item => item.geom && item.geom !== 'undefined')
        .map(item => {
          try {
            const geom = typeof item.geom === 'string' ? JSON.parse(item.geom) : item.geom
            return {
              id: item.id,
              name: item.name,
              paths: geom.coordinates[0].map((coord: number[]) => ({
                lat: coord[1],
                lng: coord[0]
              })),
              created_at: item.created_at
            }
          } catch (parseError) {
            console.error(`Error parsing polygon ${item.id}:`, parseError)
            return null
          }
        })
        .filter(polygon => polygon !== null)

      setSavedPolygons(polygons)
    } catch (error) {
      console.error('Error fetching saved polygons:', error)
    }
  }

  const calculatePolygonArea = (coords: Array<{ lat: number; lng: number }>): number => {
    if (coords.length < 3) return 0
    
    let area = 0
    for (let i = 0; i < coords.length; i++) {
      const j = (i + 1) % coords.length
      area += coords[i].lat * coords[j].lng
      area -= coords[j].lat * coords[i].lng
    }
    area = Math.abs(area) / 2
    
    return area * 111.32 * 111.32
  }

  const handlePolygonComplete = (polygon: google.maps.Polygon) => {
    setCurrentPolygon(polygon)
    const coordinates = extractPolygonCoordinates(polygon)
    setCurrentPolygonCoords(coordinates)
    setIsDrawingMode(false)
    
    const stats: PolygonStats = {
      vertices: coordinates.length,
      area: calculatePolygonArea(coordinates)
    }
    setPolygonStats(stats)
  }

  const saveCurrentPolygon = async () => {
    if (currentPolygonCoords.length === 0 || !polygonName.trim()) {
      alert('Please draw a polygon and enter a name')
      return
    }

    setIsSavingPolygon(true)

    try {
      const geom = {
        type: 'Polygon',
        coordinates: [currentPolygonCoords.map(coord => [coord.lng, coord.lat])]
      }

      const { data, error } = await supabase
        .schema('core')
        .from('saved_polygons')
        .insert({
          name: polygonName.trim(),
          geom: geom
        })
        .select()

      if (error) throw error

      await fetchSavedPolygons()
      setPolygonName('')
      setSearchStatus('Polygon saved successfully!')
      setTimeout(() => setSearchStatus(''), 3000)
    } catch (error) {
      console.error('Error saving polygon:', error)
      setSearchStatus('Error saving polygon')
    } finally {
      setIsSavingPolygon(false)
    }
  }

  const loadPolygon = (polygonId: string) => {
    const polygon = savedPolygons.find(p => p.id === polygonId)
    if (polygon) {
      setCurrentPolygonCoords(polygon.paths)
      setSelectedSavedPolygon(polygonId)
      
      const stats: PolygonStats = {
        vertices: polygon.paths.length,
        area: calculatePolygonArea(polygon.paths)
      }
      setPolygonStats(stats)
    }
  }

  const checkExistingPOIs = async (places: PlaceSearchResult[]): Promise<EnhancedPlaceResult[]> => {
    const enhancedResults: EnhancedPlaceResult[] = []
    
    for (const place of places) {
      const { data: existingAttraction } = await supabase
        .schema('core')
        .from('attractions')
        .select('id')
        .eq('place_id', place.place_id)
        .single()

      enhancedResults.push({
        ...place,
        isSelected: false,
        alreadyExists: !!existingAttraction,
        thumbnail: place.photos?.[0]?.photo_reference 
          ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=100&photo_reference=${place.photos[0].photo_reference}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`
          : undefined
      })
    }
    
    return enhancedResults
  }

  const searchPlacesInPolygon = async (category: string) => {
    if (currentPolygonCoords.length === 0) {
      setSearchStatus('Please draw a polygon first')
      return
    }

    if (category === 'all') {
      setSearchStatus('Please select a specific category')
      return
    }

    setIsSearching(true)
    setSearchStatus('Searching for places...')
    setSearchResults([])
    setShowResults(false)

    try {
      const results = await placesService.searchPlacesInPolygon(currentPolygonCoords, category)
      const enhancedResults = await checkExistingPOIs(results)

      setSearchResults(enhancedResults)
      setSearchStatus(`Found ${enhancedResults.length} places`)
      setShowResults(true)
    } catch (error) {
      console.error('Error searching places:', error)
      setSearchStatus('Error searching places')
    } finally {
      setIsSearching(false)
    }
  }

  const fetchCityBoundary = async (lat: number, lng: number, cityName?: string): Promise<boolean> => {
    try {
      console.log(`Searching for city boundary at coordinates: ${lat}, ${lng}`)
      
      // Use spatial query to find all city boundaries that contain the point
      // Filter for city-level boundaries (admin_level 8 is typically cities/towns)
      const spatialResult = await supabase
        .schema('core')
        .from('city_boundaries')
        .select('name, name_en, geom, admin_level')
        .overlaps('geom', `POINT(${lng} ${lat})`)
        .in('admin_level', [8, 9, 10]) // City/town/village levels
        .order('admin_level', { ascending: true }) // Prefer smaller admin levels first
        .limit(5) // Get multiple results to find the best match

      console.log('Spatial query result:', spatialResult.data, spatialResult.error)

      let data = null

      if (spatialResult.data && spatialResult.data.length > 0) {
        // If we have multiple results, try to find the one that matches our search query
        if (spatialResult.data.length > 1 && cityName) {
          const exactMatch = spatialResult.data.find(city => 
            (city.name && city.name.toLowerCase() === cityName.toLowerCase()) ||
            (city.name_en && city.name_en.toLowerCase() === cityName.toLowerCase())
          )
          
          if (exactMatch) {
            data = exactMatch
            console.log(`Found exact name match: ${data.name_en || data.name} (admin_level: ${data.admin_level})`)
          } else {
            // Try partial match
            const partialMatch = spatialResult.data.find(city => 
              (city.name && city.name.toLowerCase().includes(cityName.toLowerCase())) ||
              (city.name_en && city.name_en.toLowerCase().includes(cityName.toLowerCase()))
            )
            
            if (partialMatch) {
              data = partialMatch
              console.log(`Found partial name match: ${data.name_en || data.name} (admin_level: ${data.admin_level})`)
            } else {
              // Fall back to the first result
              data = spatialResult.data[0]
              console.log(`No name match found, using first spatial result: ${data.name_en || data.name} (admin_level: ${data.admin_level})`)
              console.log(`Available options were: ${spatialResult.data.map(c => c.name_en || c.name).join(', ')}`)
            }
          }
        } else {
          data = spatialResult.data[0]
          console.log(`Found city boundary using spatial query: ${data.name_en || data.name} (admin_level: ${data.admin_level})`)
        }
              } else {
          // Fallback: Try broader spatial search with different admin levels
          const spatialFallbackResult = await supabase
            .schema('core')
            .from('city_boundaries')
            .select('name, name_en, geom, admin_level')
            .overlaps('geom', `POINT(${lng} ${lat})`)
            .lte('admin_level', 10) // Include all city/town/village levels
            .order('admin_level', { ascending: true })
            .limit(5)

          if (spatialFallbackResult.data && spatialFallbackResult.data.length > 0) {
            // Find the smallest administrative unit (highest admin_level number that's still a city)
            const cityLevel = spatialFallbackResult.data.find(boundary => 
              boundary.admin_level >= 6 && boundary.admin_level <= 10
            )
            if (cityLevel) {
              data = cityLevel
              console.log(`Found city boundary using fallback spatial query: ${data.name_en || data.name} (admin_level: ${data.admin_level})`)
            }
          } else {
            // Final fallback: Name-based search with city filter
            console.log('Spatial queries failed, trying name-based fallback...')
            
            if (cityName) {
              const nameResult = await supabase
                .schema('core')
                .from('city_boundaries')
                .select('name, name_en, geom, admin_level')
                .ilike('name', `%${cityName}%`)
                .in('admin_level', [8, 9, 10])
                .limit(1)

              if (nameResult.data && nameResult.data.length > 0) {
                data = nameResult.data[0]
                console.log(`Found city using name fallback: ${data.name_en || data.name} (admin_level: ${data.admin_level})`)
              }
            }
          }
        }

      if (!data) {
        console.log(`City boundary not found for coordinates: ${lat}, ${lng}${cityName ? ` (${cityName})` : ''}`)
        
        // Better debugging - let's see what's actually in the database and any errors
        const debugResult = await supabase
          .schema('core')
          .from('city_boundaries')
          .select('name, name_en')
          .limit(5)
        
        console.log('Sample cities in database:', debugResult.data)
        console.log('Query error (if any):', debugResult.error)
        
        // This looks like a Row Level Security (RLS) issue
        // Let's try querying with different methods
        try {
          // Try counting all rows (sometimes counts work when selects don't)
          const countResult = await supabase
            .schema('core')
            .from('city_boundaries')
            .select('*', { count: 'exact', head: true })
          
          console.log('Row count result:', countResult.count, 'Error:', countResult.error)
          
          // Try a simple query without WHERE clause
          const simpleResult = await supabase
            .schema('core') 
            .from('city_boundaries')
            .select('name')
            .range(0, 2)
            
          console.log('Simple query result:', simpleResult.data, 'Error:', simpleResult.error)
          
        } catch (e) {
          console.log('RLS/Permission error:', e)
        }
        
        setCityBoundary(null)
        return false
      }

      // Parse the PostGIS geometry
      let boundary = null
      if (data.geom && typeof data.geom === 'object' && data.geom.coordinates) {
        // Handle different geometry types (Polygon, MultiPolygon)
        let coordinates = data.geom.coordinates
        
        if (data.geom.type === 'MultiPolygon') {
          // For MultiPolygon, take the first (largest) polygon
          coordinates = coordinates[0]
        }
        
        if (data.geom.type === 'Polygon' || data.geom.type === 'MultiPolygon') {
          // Convert [lng, lat] to {lat, lng} format
          boundary = coordinates[0].map((coord: number[]) => ({
            lat: coord[1],
            lng: coord[0]
          }))
        }
      }

      if (boundary && boundary.length > 0) {
        setCityBoundary(boundary)
        setCurrentCityName(data.name_en || data.name)
        console.log(`Found boundary for ${data.name_en || data.name} with ${boundary.length} points`)
        return true
      } else {
        setCityBoundary(null)
        return false
      }
    } catch (error) {
      console.error('Error fetching city boundary:', error)
      setCityBoundary(null)
      return false
    }
  }

  const searchCity = async () => {
    if (!cityQuery.trim()) {
      setSearchStatus('Please enter a city name')
      return
    }

    setIsSearchingCity(true)
    setSearchStatus('Searching for city...')
    
    // Clear existing city boundary
    setCityBoundary(null)
    setCurrentCityName('')

    try {
      const geocoder = new google.maps.Geocoder()
      
      const results = await new Promise<google.maps.GeocoderResult[]>((resolve, reject) => {
        geocoder.geocode(
          { 
            address: cityQuery.trim()
            // Note: Removed componentRestrictions to allow global city search for auto-detection
          },
          (results, status) => {
            if (status === google.maps.GeocoderStatus.OK && results) {
              resolve(results)
            } else {
              reject(new Error(`Geocoder failed: ${status}`))
            }
          }
        )
      })

      if (results.length > 0) {
        const result = results[0]
        const location = result.geometry.location
        const newCenter = {
          lat: location.lat(),
          lng: location.lng()
        }
        
        // Extract country from address components
        const countryComponent = result.address_components?.find(
          component => component.types.includes('country')
        )
        
        if (countryComponent) {
          const countryCode = countryComponent.short_name
          // Check if this country exists in our COUNTRIES list
          const foundCountry = COUNTRIES.find(country => country.value === countryCode)
          if (foundCountry) {
            setSelectedCountry(countryCode)
          }
        }

        // Extract city name for boundary search
        const cityComponent = result.address_components?.find(
          component => component.types.includes('locality') || 
                      component.types.includes('administrative_area_level_1') ||
                      component.types.includes('administrative_area_level_2')
        )
        
        const cityName = cityComponent?.long_name || cityQuery.trim()
        
        // Debug: Log all address components to understand the structure
        console.log('Geocoding result address components:', result.address_components)
        console.log('Extracted city name:', cityName)
        console.log('Original query:', cityQuery.trim())
        
        setMapCenter(newCenter)
        setMapZoom(12)
        
        // Fetch city boundary from database using coordinates
        const boundaryFound = await fetchCityBoundary(newCenter.lat, newCenter.lng, cityName)
        
        // Update status based on whether boundary was found
        if (boundaryFound) {
          setSearchStatus(`Found: ${result.formatted_address} • City boundary loaded`)
        } else {
          setSearchStatus(`Found: ${result.formatted_address} • Map centered (no boundary data available)`)
        }
        
        // Clear search status after 4 seconds
        setTimeout(() => setSearchStatus(''), 4000)
      } else {
        setSearchStatus('City not found')
        setCityBoundary(null)
      }
    } catch (error) {
      console.error('Error searching city:', error)
      setSearchStatus('Error searching city')
      setCityBoundary(null)
    } finally {
      setIsSearchingCity(false)
    }
  }

  const togglePlaceSelection = (placeId: string) => {
    setSearchResults(prev =>
      prev.map(place =>
        place.place_id === placeId
          ? { ...place, isSelected: !place.isSelected }
          : place
      )
    )
  }

  const getSelectedPlaces = (): EnhancedPlaceResult[] => {
    return searchResults.filter(place => place.isSelected && !place.alreadyExists)
  }

  const importSelectedPlaces = async () => {
    const selectedPlaces = getSelectedPlaces()
    
    if (selectedPlaces.length === 0) {
      setSearchStatus('Please select at least one place to import')
      return
    }

    setIsImporting(true)
    setImportStatus('Importing selected places...')
    setImportedCount(0)

    try {
      for (const place of selectedPlaces) {
        const placeDetails = await placesService.getPlaceDetails(place.place_id)
        const placeData = placeDetails || place

        const addressParts = placeData.formatted_address.split(', ')
        const country = selectedCountry || addressParts[addressParts.length - 1]
        const city = addressParts[addressParts.length - 2] || ''

        let imageUrl = null
        if (placeData.photos && placeData.photos.length > 0) {
          try {
            const photoResponse = await fetch(
              'https://tysnkzmljlmmqpbotkxv.supabase.co/functions/v1/photo-proxy',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  photo_reference: placeData.photos[0].photo_reference,
                  place_id: placeData.place_id
                })
              }
            )
            if (photoResponse.ok) {
              const photoData = await photoResponse.json()
              imageUrl = photoData.image_url
            }
          } catch (error) {
            console.error('Error fetching photo:', error)
          }
        }

        const { data: newAttraction, error: attractionError } = await supabase
          .schema('core')
          .from('attractions')
          .insert({
            name: placeData.name,
            place_id: placeData.place_id,
            city: city,
            country: country,
            approved: false,
            rating: placeData.rating || null,
            image_url: imageUrl
          })
          .select()
          .single()

        if (attractionError) throw attractionError

        const { error: coordinateError } = await supabase
          .schema('core')
          .from('attraction_coordinate')
          .insert({
            attraction_id: newAttraction.id,
            latitude: placeData.geometry.location.lat,
            longitude: placeData.geometry.location.lng
          })

        if (coordinateError) throw coordinateError

        setImportedCount(prev => prev + 1)
        setImportStatus(`Imported ${placeData.name}`)
      }

      setImportStatus(`Successfully imported ${selectedPlaces.length} places`)
      
      setSearchResults(prev =>
        prev.map(place =>
          place.isSelected
            ? { ...place, isSelected: false, alreadyExists: true }
            : place
        )
      )
      
      setTimeout(() => setImportStatus(''), 3000)
    } catch (error) {
      console.error('Error importing places:', error)
      setImportStatus('Error importing places')
    } finally {
      setIsImporting(false)
    }
  }

  if (!isClient) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          <div className="h-96 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50">
      {/* Left Sidebar */}
      <div className={cn(
        "bg-white border-r border-gray-200 transition-all duration-300 flex flex-col",
        sidebarCollapsed ? "w-16" : "w-80"
      )}>
        {/* Sidebar Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            {!sidebarCollapsed && (
              <h1 className="text-lg font-semibold text-gray-900">POI Importer</h1>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-2 rounded-md hover:bg-gray-100"
            >
              {sidebarCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {!sidebarCollapsed && (
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* Default Settings */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Default Country</h3>
              <select
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {COUNTRIES.map((country) => (
                  <option key={country.value} value={country.value}>
                    {country.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Controls */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-700">Search by city...</h3>
                <button 
                  onClick={searchCity}
                  disabled={isSearchingCity || !cityQuery.trim()}
                  className="px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  {isSearchingCity ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : null}
                  Go
                </button>
              </div>
              <input
                type="text"
                placeholder="Enter city name"
                value={cityQuery}
                onChange={(e) => setCityQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !isSearchingCity && cityQuery.trim() && searchCity()}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Categories */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Categories</h3>
              <div className="grid grid-cols-2 gap-2">
                {POI_CATEGORIES.map((category) => {
                  const Icon = category.icon
                  return (
                    <button
                      key={category.value}
                      onClick={() => {
                        setSelectedCategory(category.value)
                        if (category.value !== 'all') {
                          searchPlacesInPolygon(category.value)
                        }
                      }}
                      className={cn(
                        "flex items-center gap-2 p-2 rounded-md text-sm transition-colors",
                        selectedCategory === category.value
                          ? "bg-blue-100 text-blue-700 border border-blue-200"
                          : "hover:bg-gray-100 text-gray-700"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {category.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Polygon Controls */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Area Definition</h3>
              
              <button
                onClick={() => setIsDrawingMode(!isDrawingMode)}
                className={cn(
                  "w-full flex items-center gap-2 p-3 rounded-md text-sm font-medium transition-colors mb-3",
                  isDrawingMode 
                    ? "bg-orange-100 text-orange-700 border border-orange-200"
                    : "bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200"
                )}
              >
                <Target className="h-4 w-4" />
                {isDrawingMode ? "Stop Drawing" : "Draw Polygon"}
              </button>

              {currentPolygonCoords.length > 0 && (
                <div className="p-3 bg-gray-50 rounded-md mb-3">
                  <div className="text-xs text-gray-500">
                    {polygonStats.vertices} vertices • {polygonStats.area.toFixed(2)} km²
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Polygon name"
                  value={polygonName}
                  onChange={(e) => setPolygonName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
                
                <button
                  onClick={saveCurrentPolygon}
                  disabled={currentPolygonCoords.length === 0 || !polygonName.trim() || isSavingPolygon}
                  className="w-full px-3 py-2 bg-green-500 text-white rounded-md text-sm font-medium hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingPolygon ? (
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  ) : (
                    "Save Polygon"
                  )}
                </button>
              </div>

              {savedPolygons.length > 0 && (
                <div className="mt-3">
                  <select
                    value={selectedSavedPolygon}
                    onChange={(e) => e.target.value && loadPolygon(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">Load saved polygon...</option>
                    {savedPolygons.map((polygon) => (
                      <option key={polygon.id} value={polygon.id}>
                        {polygon.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Status Messages */}
            {(searchStatus || importStatus) && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                <p className="text-sm text-blue-700">{importStatus || searchStatus}</p>
              </div>
            )}

            {/* Import Controls */}
            {getSelectedPlaces().length > 0 && (
              <div>
                <button
                  onClick={importSelectedPlaces}
                  disabled={isImporting}
                  className="w-full px-4 py-2 bg-orange-500 text-white rounded-md font-medium hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isImporting ? (
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  ) : (
                    `Import ${getSelectedPlaces().length} Selected`
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Map Area */}
      <div className="flex-1 relative">
        <GoogleMapComponent
          center={mapCenter}
          zoom={mapZoom}
          height="100vh"
          enableDrawing={isDrawingMode}
          onPolygonComplete={handlePolygonComplete}
          markers={searchResults.map(place => ({
            id: place.place_id,
            position: place.geometry.location,
            title: place.name,
            description: `${place.formatted_address}${place.rating ? ` • ⭐ ${place.rating}` : ''}`,
            color: place.alreadyExists ? '#6B7280' : place.isSelected ? '#3B82F6' : '#F59E0B'
          }))}
          polygon={currentPolygonCoords}
          cityBoundary={cityBoundary}
          cityName={currentCityName}
        />

        {/* Results Overlay */}
        {showResults && searchResults.length > 0 && (
          <div className="absolute top-4 right-4 w-80 max-h-96 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-medium text-gray-900">
                {searchResults.length} Results Found
              </h3>
              <button
                onClick={() => setShowResults(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {searchResults.map((place) => (
                <div
                  key={place.place_id}
                  className={cn(
                    "p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50",
                    place.isSelected && "bg-blue-50",
                    place.alreadyExists && "opacity-60"
                  )}
                  onClick={() => !place.alreadyExists && togglePlaceSelection(place.place_id)}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                      {place.thumbnail ? (
                        <img
                          src={place.thumbnail}
                          alt={place.name}
                          className="w-10 h-10 rounded object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center">
                          <MapPin className="h-5 w-5 text-gray-400" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between">
                        <h4 className="text-sm font-medium text-gray-900 truncate">
                          {place.name}
                        </h4>
                        <div className="flex-shrink-0 ml-2">
                          {place.alreadyExists ? (
                            <CheckCircle2 className="h-4 w-4 text-gray-400" />
                          ) : place.isSelected ? (
                            <CheckCircle2 className="h-4 w-4 text-blue-500" />
                          ) : (
                            <div className="h-4 w-4 border-2 border-gray-300 rounded" />
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {place.formatted_address}
                      </p>
                      {place.rating && (
                        <div className="flex items-center gap-1 mt-1">
                          <Star className="h-3 w-3 text-yellow-400 fill-current" />
                          <span className="text-xs text-gray-600">{place.rating}</span>
                        </div>
                      )}
                      {place.alreadyExists && (
                        <div className="text-xs text-gray-500 mt-1">Already imported</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
} 