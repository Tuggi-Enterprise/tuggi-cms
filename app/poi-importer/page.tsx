'use client'

import { useState, useEffect, useRef } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'

import { 
  Search, Save, Upload, MapPin, Star, Clock, Globe, ExternalLink, 
  CheckCircle2, Loader2, ChevronDown, ChevronUp, Info, Users,
  Building2, Camera, Phone, Globe2, MapIcon, Target, X, Settings,
  Mountain, Church, TreePine, Utensils, ShoppingBag, Palette,
  Waves, Dumbbell, BookOpen, Landmark, Gamepad2, UtensilsCrossed,
  Bed, Cross, GraduationCap
} from 'lucide-react'
import { cn, extractLocationFromAddressComponents, getCountryName } from '@/lib/utils'
import { createGooglePlacesService, type PlaceSearchResult } from '@/lib/googlePlaces'
import { GoogleMapComponent, extractPolygonCoordinates, calculatePolygonCenter } from '@/components/ui/GoogleMapComponent'

interface SavedPolygon {
  id: string
  name: string
  paths: Array<{lat: number, lng: number}>
  user_id: string
  created_at: string
  country_name?: string
}

const POI_CATEGORIES = [
  { value: 'all', label: 'All Categories', icon: Target, color: 'bg-gray-500' },
  { value: 'tourist_attraction', label: 'Tourist Attractions', icon: Target, color: 'bg-blue-500' },
  { value: 'museum', label: 'Museums', icon: Building2, color: 'bg-purple-500' },
  { value: 'park', label: 'Parks & Gardens', icon: TreePine, color: 'bg-green-500' },
  { value: 'beach', label: 'Beaches', icon: Waves, color: 'bg-blue-400' },
  { value: 'church', label: 'Religious Sites', icon: Church, color: 'bg-amber-600' },
  { value: 'stadium', label: 'Sports Venues', icon: Dumbbell, color: 'bg-red-500' },
  { value: 'library', label: 'Libraries', icon: BookOpen, color: 'bg-indigo-500' },
  { value: 'aquarium', label: 'Aquariums', icon: Waves, color: 'bg-cyan-500' },
  { value: 'zoo', label: 'Zoos & Wildlife', icon: Mountain, color: 'bg-emerald-500' },
  { value: 'amusement_park', label: 'Amusement Parks', icon: Gamepad2, color: 'bg-pink-500' },
  // { value: 'art_gallery', label: 'Art Galleries', icon: Palette, color: 'bg-violet-500' },
  { value: 'shopping_mall', label: 'Shopping Malls', icon: ShoppingBag, color: 'bg-orange-500' },
  // { value: 'restaurant', label: 'Restaurants', icon: UtensilsCrossed, color: 'bg-yellow-600' },
  // { value: 'lodging', label: 'Hotels & Lodging', icon: Bed, color: 'bg-teal-500' },
  // { value: 'hospital', label: 'Healthcare', icon: Cross, color: 'bg-red-600' },
  // { value: 'university', label: 'Universities', icon: GraduationCap, color: 'bg-blue-600' },
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
  const [scrollY, setScrollY] = useState(0)
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('up')
  const [lastScrollY, setLastScrollY] = useState(0)
  
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
  const [placesService] = useState(() => createGooglePlacesService(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, selectedCountry))

  // Update places service language when country changes
  useEffect(() => {
    if (selectedCountry && placesService && 'setLanguage' in placesService) {
      placesService.setLanguage(selectedCountry)
    }
  }, [selectedCountry, placesService])

  useEffect(() => {
    setIsClient(true)
    fetchSavedPolygons(true) // Auto-fit on initial load
  }, [])

  // Scroll tracking for parallax effect
  useEffect(() => {
    let ticking = false
    let lastY = 0
    
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const currentScrollY = window.scrollY
          
          // Determine scroll direction
          if (currentScrollY > lastY) {
            setScrollDirection('down')
          } else if (currentScrollY < lastY) {
            setScrollDirection('up')
          }
          
          setScrollY(currentScrollY)
          setLastScrollY(currentScrollY)
          lastY = currentScrollY
          ticking = false
        })
        ticking = true
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Calculate dynamic heights based on scroll
  const calculateMapHeight = () => {
    if (searchResults.length === 0) {
      return '70vh' // No results, give map more space
    }
    
    // Base height when results exist
    const baseHeight = 55
    const minHeight = 10 // Minimum map height when fully scrolled
    
    // Scroll threshold - how much scrolling triggers the effect
    const scrollThreshold = 150
    
    // Always respond to scroll position, regardless of direction
    if (scrollY > 30) {
      // Calculate how much to shrink based on scroll position
      const scrollProgress = Math.min((scrollY - 30) / scrollThreshold, 1)
      const dynamicHeight = baseHeight - (scrollProgress * (baseHeight - minHeight))
      return `${Math.max(dynamicHeight, minHeight)}vh`
    }
    
    return `${baseHeight}vh`
  }

  // Check if we're in full screen mode
  const isFullScreenMode = scrollY > 100 && calculateMapHeight() === '10vh'



  const fetchSavedPolygons = async (autoFitMap: boolean = false) => {
    try {
      const { data, error } = await supabase
        .schema('core')
        .from('saved_polygons')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error



      const polygons = data
        .filter(item => item.paths && item.paths !== 'undefined')
        .map(item => {
          try {
            const geom = typeof item.paths === 'string' ? JSON.parse(item.paths) : item.paths
            
            // Validate geometry structure
            if (!geom || !geom.coordinates || !Array.isArray(geom.coordinates)) {
              console.error(`Invalid geometry for polygon ${item.id}: missing coordinates array`)
              return null
            }
            
            if (geom.coordinates.length === 0 || !Array.isArray(geom.coordinates[0])) {
              console.error(`Invalid geometry for polygon ${item.id}: empty or invalid coordinates[0]`)
              return null
            }
            
            return {
              id: item.id,
              name: item.name,
              paths: geom.coordinates[0].map((coord: number[]) => ({
                lat: coord[1],
                lng: coord[0]
              })),
              user_id: item.user_id,
              created_at: item.created_at,
              country_name: item.country_name
            }
          } catch (parseError) {
            console.error(`Error parsing polygon ${item.id}:`, parseError)
            return null
          }
        })
        .filter(polygon => polygon !== null)

      setSavedPolygons(polygons)

      // Auto-fit map to show all saved polygons if any exist (only when requested)
      if (autoFitMap && polygons.length > 0) {
        let bounds = {
          north: -90,
          south: 90,
          east: -180,
          west: 180
        }

        polygons.forEach(polygon => {
          polygon.paths.forEach(point => {
            bounds.north = Math.max(bounds.north, point.lat)
            bounds.south = Math.min(bounds.south, point.lat)
            bounds.east = Math.max(bounds.east, point.lng)
            bounds.west = Math.min(bounds.west, point.lng)
          })
        })

        // Calculate center and zoom level for all polygons
        const centerLat = (bounds.north + bounds.south) / 2
        const centerLng = (bounds.east + bounds.west) / 2
        
        setMapCenter({ lat: centerLat, lng: centerLng })
        
        // Set zoom level based on bounds size (rough calculation)
        const latDiff = bounds.north - bounds.south
        const lngDiff = bounds.east - bounds.west
        const maxDiff = Math.max(latDiff, lngDiff)
        
        let zoomLevel = 10
        if (maxDiff < 0.01) zoomLevel = 16
        else if (maxDiff < 0.05) zoomLevel = 14
        else if (maxDiff < 0.1) zoomLevel = 12
        else if (maxDiff < 0.5) zoomLevel = 10
        else if (maxDiff < 1) zoomLevel = 8
        else if (maxDiff < 5) zoomLevel = 6
        else zoomLevel = 4
        
        setMapZoom(zoomLevel)
        
        console.log(`Auto-fitted map to show ${polygons.length} saved polygons`)
      }
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

  const handlePolygonComplete = async (polygon: google.maps.Polygon) => {
    console.log('Polygon completed! Auto-disabling drawing mode.')
    setCurrentPolygon(polygon)
    const coordinates = extractPolygonCoordinates(polygon)
    setCurrentPolygonCoords(coordinates)
    setIsDrawingMode(false) // Auto-disable drawing after completion
    
    const stats: PolygonStats = {
      vertices: coordinates.length,
      area: calculatePolygonArea(coordinates)
    }
    setPolygonStats(stats)

    // Clear existing name and auto-generate new one
    setPolygonName('')
    await generatePolygonName(coordinates)
  }

  const generatePolygonName = async (coordinates: Array<{ lat: number; lng: number }>) => {
    if (coordinates.length === 0) return

    console.log('🔍 Generating polygon name with:')
    console.log('  - currentCityName:', currentCityName)
    console.log('  - cityQuery:', cityQuery)
    console.log('  - selectedCountry:', selectedCountry)

    // Priority 1: Always use the original user input from city search field
    // This ensures we get "Rio de Janeiro" instead of neighborhoods like "Copacabana"
    if (cityQuery && cityQuery.trim()) {
      const countryCode = selectedCountry || ''
      let generatedName = cityQuery.trim()
      
      if (countryCode) {
        generatedName += ` (${countryCode})`
      }
      
      console.log('✅ Using original user input for polygon:', generatedName)
      setPolygonName(generatedName)
      setSearchStatus(`📍 Auto-named: "${generatedName}" (from your search)`)
      setTimeout(() => setSearchStatus(''), 3000)
      return
    }

    // Priority 2: Use the processed city name as fallback
    if (currentCityName && currentCityName.trim()) {
      const countryCode = selectedCountry || ''
      let generatedName = currentCityName
      
      if (countryCode) {
        generatedName += ` (${countryCode})`
      }
      
      console.log('✅ Using processed city name for polygon:', generatedName)
      setPolygonName(generatedName)
      setSearchStatus(`📍 Auto-named: "${generatedName}" (from geocoding)`)
      setTimeout(() => setSearchStatus(''), 3000)
      return
    }

    // Priority 3: Fallback to coordinate-based name
    try {
      const center = calculatePolygonCenter(coordinates)
      const coordName = `Area ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`
      
      console.log('⚠️ Using coordinate-based name for polygon:', coordName)
      setPolygonName(coordName)
      setSearchStatus(`📍 Auto-named: "${coordName}" (from coordinates)`)
      setTimeout(() => setSearchStatus(''), 3000)
      
    } catch (error) {
      console.error('❌ Error generating coordinate-based name:', error)
      setPolygonName('New Area')
      setSearchStatus(`📍 Auto-named: "New Area" (fallback)`)
      setTimeout(() => setSearchStatus(''), 3000)
    }
  }

  const saveCurrentPolygon = async () => {
    if (currentPolygonCoords.length === 0) {
      alert('Please draw a polygon first')
      return
    }

    // Auto-generate name if empty
    if (!polygonName.trim()) {
      await generatePolygonName(currentPolygonCoords)
      
      // If still no name after generation, use fallback
      if (!polygonName.trim()) {
        const center = calculatePolygonCenter(currentPolygonCoords)
        setPolygonName(`Area ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`)
      }
    }

    setIsSavingPolygon(true)

    try {
      // Create proper GeoJSON for PostGIS (ensure polygon is closed)
      const coords = [...currentPolygonCoords]
      // Ensure polygon is closed by adding first point at the end if needed
      if (coords.length > 0 && (coords[0].lat !== coords[coords.length - 1].lat || coords[0].lng !== coords[coords.length - 1].lng)) {
        coords.push(coords[0])
      }

      const geomGeoJSON = {
        type: 'Polygon',
        coordinates: [coords.map(coord => [coord.lng, coord.lat])]
      }

      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        throw new Error('User not authenticated')
      }

      console.log('Saving polygon with data:', {
        name: polygonName.trim(),
        paths: geomGeoJSON,
        user_id: user.id,
        country_name: selectedCountry || null
      })

      // Insert the polygon
      const { data, error } = await supabase
        .schema('core')
        .from('saved_polygons')
        .insert({
          name: polygonName.trim(),
          paths: geomGeoJSON,
          user_id: user.id,
          country_name: selectedCountry || null
        })
        .select()

      if (error) {
        console.error('Database error:', error)
        throw error
      }

      console.log('Polygon saved successfully:', data)
      
      // Save current map position before refreshing polygons
      const currentMapCenter = mapCenter
      const currentMapZoom = mapZoom
      
      await fetchSavedPolygons(false) // Don't auto-fit after saving
      
      // Restore the user's map position after loading saved polygons (with slight delay)
      setTimeout(() => {
        setMapCenter(currentMapCenter)
        setMapZoom(currentMapZoom)
        console.log('Map position restored after polygon save:', currentMapCenter, currentMapZoom)
      }, 100)
      
      setPolygonName('')
      setSearchStatus('Polygon saved successfully!')
      setTimeout(() => setSearchStatus(''), 3000)
    } catch (error) {
      console.error('Error saving polygon:', error)
      setSearchStatus(`Error saving polygon: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
      try {
        // Try the query with business_status first
        const { data: existingAttraction, error } = await supabase
          .schema('core')
          .from('attractions')
          .select('id, business_status')
          .eq('google_place_id', place.place_id)
          .maybeSingle() // Use maybeSingle instead of single to avoid errors when no match

        // If we got a 406 error or column doesn't exist, try without business_status
        if (error && (error.code === '42703' || error.message.includes('business_status'))) {
          console.log('business_status field not found, falling back to basic query')
          const { data: fallbackAttraction } = await supabase
            .schema('core')
            .from('attractions')
            .select('id')
            .eq('google_place_id', place.place_id)
            .maybeSingle()

          enhancedResults.push({
            ...place,
            isSelected: false,
            alreadyExists: !!fallbackAttraction,
            thumbnail: place.photos?.[0]?.photo_reference 
              ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=300&photo_reference=${place.photos[0].photo_reference}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`
              : undefined
          })
        } else {
          // Filter out permanently closed places if business_status is available
          const isExisting = existingAttraction && 
            (!existingAttraction.business_status || existingAttraction.business_status !== 'CLOSED_PERMANENTLY')

          enhancedResults.push({
            ...place,
            isSelected: false,
            alreadyExists: !!isExisting,
            thumbnail: place.photos?.[0]?.photo_reference 
              ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=300&photo_reference=${place.photos[0].photo_reference}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`
              : undefined
          })
        }
      } catch (error) {
        console.error('Error checking existing POI:', error)
        // If any error occurs, just mark as not existing to allow proceeding
        enhancedResults.push({
          ...place,
          isSelected: false,
          alreadyExists: false,
          thumbnail: place.photos?.[0]?.photo_reference 
            ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=300&photo_reference=${place.photos[0].photo_reference}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`
            : undefined
        })
      }
    }
    
    return enhancedResults
  }

  const searchPlacesInPolygon = async (category: string) => {
    if (currentPolygonCoords.length === 0) {
      setSearchStatus('Please draw a polygon first')
      return
    }

    setIsSearching(true)
    setSearchResults([])
    setSelectedPlaceDetails({})
    setLoadingDetails(new Set())
    
    // Set appropriate loading message based on category
    if (category === 'all') {
      setSearchStatus('🔍 Searching all categories in polygon area...')
    } else {
      const categoryLabel = POI_CATEGORIES.find(cat => cat.value === category)?.label || category
      setSearchStatus(`🔍 Searching for ${categoryLabel.toLowerCase()} in area...`)
    }

    try {
      console.log(`Starting search for category: ${category} in polygon with ${currentPolygonCoords.length} vertices`)
      
      const results = await placesService.searchPlacesInPolygon(currentPolygonCoords, category)
      console.log(`Raw search results: ${results.length} places found`)
      
      setSearchStatus('🔍 Checking for duplicate places...')
      const enhancedResults = await checkExistingPOIs(results)
      console.log(`Enhanced results: ${enhancedResults.length} places (${enhancedResults.filter(p => p.alreadyExists).length} already imported)`)

      setSearchResults(enhancedResults)
      
              // Provide detailed feedback
        if (enhancedResults.length === 0) {
          setSearchStatus('❌ No places found in this area. Try a different category or larger area.')
        } else {
          const newPlaces = enhancedResults.filter(p => !p.alreadyExists).length
          const existingPlaces = enhancedResults.filter(p => p.alreadyExists).length
          
          let statusMessage = `✅ Found ${enhancedResults.length} places`
          if (existingPlaces > 0) {
            statusMessage += ` (${newPlaces} new, ${existingPlaces} already imported)`
          }
          setSearchStatus(statusMessage)
        }
    } catch (error) {
      console.error('Error searching places:', error)
      setSearchStatus(`❌ Error searching places: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
            .from('es')
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
                .from('es')
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
        
        // Prioritize the user's original search query over geocoded components
        // This prevents getting neighborhood names instead of city names
        const cityName = cityQuery.trim() || cityComponent?.long_name || 'Unknown City'
        
        // Debug: Log all address components to understand the structure
        console.log('Geocoding result address components:', result.address_components)
        console.log('Geocoded city component:', cityComponent?.long_name)
        console.log('Original user query:', cityQuery.trim())
        console.log('Final city name used:', cityName)
        
        // Set the current city name for polygon naming (prioritizing user input)
        setCurrentCityName(cityName)
        console.log('Set currentCityName to:', cityName)
        
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

  const [selectedPlaceDetails, setSelectedPlaceDetails] = useState<{[placeId: string]: any}>({})
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set())

  const fetchPlaceDetails = async (placeId: string) => {
    if (selectedPlaceDetails[placeId] || loadingDetails.has(placeId)) return

    setLoadingDetails(prev => new Set([...prev, placeId]))
    
    try {
      const details = await placesService.getPlaceDetails(placeId)
      if (details) {
        setSelectedPlaceDetails(prev => ({
          ...prev,
          [placeId]: details
        }))
      }
    } catch (error) {
      console.error('Error fetching place details:', error)
    } finally {
      setLoadingDetails(prev => {
        const newSet = new Set(prev)
        newSet.delete(placeId)
        return newSet
      })
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

  // Create import batch for tracking
  const createImportBatch = async (selectedPlaces: EnhancedPlaceResult[]) => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      
      if (userError || !user) {
        console.warn('No authenticated user for import batch')
        return null
      }

      const { data: batch, error } = await supabase
        .schema('core')
        .from('import_batches')
        .insert({
          user_id: user.id,
          search_category: selectedCategory,
          total_found: searchResults.length,
          total_imported: selectedPlaces.length
        })
        .select()
        .single()

      if (error) {
        console.warn('Could not create import batch (continuing without tracking):', error)
        return null
      }

      return batch.id
    } catch (error) {
      console.warn('Import batch creation failed (continuing without tracking):', error)
      return null
    }
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
      // Get current user for ownership tracking
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      
      if (userError || !user) {
        setImportStatus('Authentication required for importing places')
        return
      }

      // Create import batch for tracking
      const batchId = await createImportBatch(selectedPlaces)

      for (const place of selectedPlaces) {
        const placeDetails = await placesService.getPlaceDetails(place.place_id)
        const placeData = placeDetails || place

        // Use the city from user's search instead of extracting from each place's address
        // This prevents saving neighborhood names instead of the main city
        let city = currentCityName || cityQuery.trim() || ''
        let country = ''
        let countryCode = selectedCountry || ''

        if ('address_components' in placeData && placeData.address_components) {
          const locationData = extractLocationFromAddressComponents(placeData.address_components)
          // Only extract country info, keep the user's searched city
          country = locationData.country
          countryCode = locationData.countryCode || selectedCountry || ''
        } else {
          // Fallback to formatted_address parsing for country only
          const addressParts = placeData.formatted_address.split(', ')
          country = selectedCountry ? getCountryName(selectedCountry) : addressParts[addressParts.length - 1]
        }

        console.log(`🏙️ Using city "${city}" for place "${placeData.name}" (from user search, not place address)`)

        // Handle photos - collect references for storage
        let imageUrl = null
        let photoReferences: string[] = []
        
        if (placeData.photos && placeData.photos.length > 0) {
          // Collect only the first photo reference for storage (primary image only)
          photoReferences = [placeData.photos[0].photo_reference]
          console.log(`Found ${placeData.photos.length} photos for ${placeData.name}, using only the primary image`)
        }

        // Enhanced attraction data with new database fields
        const attractionData = {
          name: placeData.name,
          google_place_id: placeData.place_id, // Updated field name
          city: city,
          country: country,
          approved: false,
          rating: placeData.rating || null,
          user_ratings_total: placeData.user_ratings_total || null,
          image_url: imageUrl,
          formatted_address: placeData.formatted_address,
          google_types: placeData.types || [],
          website: placeData.website || null,
          opening_hours: placeData.opening_hours || null,
          // New Google Places API fields
          price_level: placeData.price_level || null,
          formatted_phone_number: (placeData as any).formatted_phone_number || null,
          international_phone_number: (placeData as any).international_phone_number || null,
          business_status: (placeData as any).business_status || 'OPERATIONAL',
          vicinity: (placeData as any).vicinity || null,
          // Import tracking fields
          import_source: 'poi_importer',
          import_batch_id: batchId,
          user_id: user.id // Set the user who imported this place
        }

        const { data: newAttraction, error: attractionError } = await supabase
          .schema('core')
          .from('attractions')
          .insert(attractionData)
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

                // Use direct Google Places API URLs instead of processing in Vercel
        if (photoReferences.length > 0) {
          try {
            setImportStatus(`Setting up direct Google image URL for ${placeData.name}...`)
            
            // Generate direct Google Places API URL for the primary image
            const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
            if (googleApiKey) {
              // Use 800px width for main images (good quality without being too large)
              const directImageUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoReferences[0]}&key=${googleApiKey}`
              
              // Update attraction with direct Google image URL
              await supabase
                .schema('core')
                .from('attractions')
                .update({ image_url: directImageUrl })
                .eq('id', newAttraction.id)
              
              imageUrl = directImageUrl
              console.log(`✅ Set direct Google image URL for ${placeData.name}: ${directImageUrl}`)
              
              // Store photo reference for future use
              await storePhotoReferencesOnly(newAttraction.id, photoReferences)
            } else {
              console.warn('Google API key not available for direct image URLs')
              // Fallback to old system if no API key
              const { data: { session } } = await supabase.auth.getSession()
              const authToken = session?.access_token
              
              const imageResponse = await fetch(
                 `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/store-poi-images`,
                 {
                   method: 'POST',
                   headers: {
                     'Content-Type': 'application/json',
                     'Authorization': `Bearer ${authToken}`,
                     'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
                   },
                   body: JSON.stringify({
                     attractionId: newAttraction.id,
                     googlePlaceId: placeData.place_id,
                     photoReferences: photoReferences,
                     attractionName: placeData.name
                   })
                 }
               )

              if (imageResponse.ok) {
              const imageResult = await imageResponse.json()
              console.log(`Image processing result for ${placeData.name}:`, imageResult)
              
              if (imageResult.processed > 0) {
                console.log(`✅ Successfully stored ${imageResult.processed} images for ${placeData.name}`)
                
                // Update the attraction with the primary image URL if available
                if (imageResult.images && imageResult.images.length > 0) {
                  const primaryImage = imageResult.images[0] // First image is primary
                  imageUrl = primaryImage.url
                  
                  await supabase
                    .schema('core')
                    .from('attractions')
                    .update({ image_url: primaryImage.url })
                    .eq('id', newAttraction.id)
                    
                  console.log(`Updated attraction with primary image: ${primaryImage.url}`)
                }
              } else {
                console.warn(`⚠️ No images processed for ${placeData.name}. Errors:`, imageResult.errors)
                console.log('Falling back to photo references storage...')
                
                // Fallback: Store photo references in database for later processing
                await storePhotoReferencesOnly(newAttraction.id, photoReferences)
              }
            } else {
              const errorData = await imageResponse.text() // Use text() in case it's not JSON
              console.error('❌ Image storage request failed:', {
                status: imageResponse.status,
                statusText: imageResponse.statusText,
                error: errorData
              })
              console.log('Falling back to photo references storage...')
              
              // Fallback: Store photo references in database for later processing
              await storePhotoReferencesOnly(newAttraction.id, photoReferences)
              }
            }
          } catch (imageError) {
            console.error('Error storing images:', imageError)
            console.log('Falling back to photo references storage...')
            
            // Fallback: Store photo references in database for later processing
            try {
              await storePhotoReferencesOnly(newAttraction.id, photoReferences)
            } catch (fallbackError) {
              console.error('Failed to store photo references:', fallbackError)
            }
          }
        }

        // Helper function to store photo references only
        async function storePhotoReferencesOnly(attractionId: string, photoRefs: string[]) {
          const imageReferences = photoRefs.slice(0, 1).map((photoRef, index) => ({
            attraction_id: attractionId,
            storage_path: `pending/${placeData.place_id}/${photoRef}`, // Mark as pending
            photo_reference: photoRef
          }))

          const { error: imageRefError } = await supabase
            .schema('core')
            .from('attraction_image')
            .insert(imageReferences)

          if (imageRefError) {
            console.warn('Failed to save photo references:', imageRefError)
          } else {
            console.log(`Saved ${imageReferences.length} photo references for later processing`)
          }
        }

        setImportedCount(prev => prev + 1)
        setImportStatus(`Imported ${placeData.name}`)
      }

      setImportStatus(`Successfully imported ${selectedPlaces.length} places to Tuggi database`)
      
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
      setImportStatus('Error importing places. Please try again.')
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
    <div className="flex flex-col min-h-screen">
      {/* Top Section - Controls and Map - Dynamic Height */}
      <div 
        className={cn(
          "flex overflow-hidden transition-all duration-500 ease-out flex-shrink-0",
          isFullScreenMode && "shadow-lg border-b-2 border-blue-200"
        )}
        style={{ height: calculateMapHeight() }}
      >
        {/* Left Control Panel */}
        <div className={cn(
          "bg-white border-r border-gray-200 transition-all duration-300 flex flex-col",
          sidebarCollapsed ? "w-16" : "w-80"
        )}>
          {/* Header */}
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
          <div className="flex-1 overflow-y-auto">
            {/* Step 1: Define Search Area */}
            <div className="p-4 bg-blue-50 border-b border-blue-100">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                <h2 className="text-sm font-semibold text-blue-900">Define Search Area</h2>
              </div>
              
              {/* City Search */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-blue-800">Find by City</label>
                  <button 
                    onClick={searchCity}
                    disabled={isSearchingCity || !cityQuery.trim()}
                    className="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    {isSearchingCity ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Search className="h-3 w-3" />
                    )}
                    Go
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g., Barcelona, Madrid..."
                  value={cityQuery}
                  onChange={(e) => setCityQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !isSearchingCity && cityQuery.trim() && searchCity()}
                  className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>

              {/* Draw Polygon */}
              <div className="mb-4">
                <label className="text-xs font-medium text-blue-800 mb-2 block">Or Draw Custom Area</label>
                <button
                  onClick={() => setIsDrawingMode(!isDrawingMode)}
                  className={cn(
                    "w-full flex items-center gap-2 p-2 rounded-md text-sm font-medium transition-colors",
                    isDrawingMode 
                      ? "bg-orange-100 text-orange-700 border border-orange-200"
                      : "bg-white text-blue-700 border border-blue-200 hover:bg-blue-50"
                  )}
                >
                  <Target className="h-4 w-4" />
                  {isDrawingMode ? "Stop Drawing Polygon" : "Draw Polygon on Map"}
                </button>
              </div>

              {/* Polygon Stats */}
              {currentPolygonCoords.length > 0 && (
                <div className="p-2 bg-white rounded-md border border-blue-200">
                  <div className="text-xs text-blue-600 font-medium">
                    ✓ Area defined: {polygonStats.vertices} vertices • {polygonStats.area.toFixed(2)} km²
                  </div>
                </div>
              )}

              {/* Load Saved Polygon */}
              {savedPolygons.length > 0 && (
                <div className="mt-3">
                  <label className="text-xs font-medium text-blue-800 mb-2 block">Load Saved Area</label>
                  <select
                    value={selectedSavedPolygon}
                    onChange={(e) => e.target.value && loadPolygon(e.target.value)}
                    className="w-full px-3 py-2 border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    <option value="">Choose saved area...</option>
                    {savedPolygons.map((polygon) => (
                      <option key={polygon.id} value={polygon.id}>
                        {polygon.name}{polygon.country_name ? ` (${polygon.country_name})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Step 2: Select Category & Search */}
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center gap-2 mb-3">
                <div className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                  currentPolygonCoords.length > 0 
                    ? "bg-blue-500 text-white" 
                    : "bg-gray-300 text-gray-500"
                )}>2</div>
                <h2 className={cn(
                  "text-sm font-semibold",
                  currentPolygonCoords.length > 0 ? "text-gray-900" : "text-gray-500"
                )}>Select Category & Search</h2>
                {selectedCategory && currentPolygonCoords.length > 0 && (
                  <button
                    onClick={() => searchPlacesInPolygon(selectedCategory)}
                    disabled={isSearching}
                    className="ml-auto px-3 py-1 bg-orange-500 text-white text-xs rounded hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    {isSearching ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Search className="h-3 w-3" />
                    )}
                    Search
                  </button>
                )}
              </div>

              {currentPolygonCoords.length === 0 ? (
                <div className="text-center py-4 text-gray-400">
                  <Target className="h-6 w-6 mx-auto mb-2" />
                  <p className="text-xs">Define an area first to enable search</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {POI_CATEGORIES.map((category) => {
                    const Icon = category.icon
                    const isSelected = selectedCategory === category.value
                    return (
                      <button
                        key={category.value}
                        onClick={() => {
                          setSelectedCategory(category.value)
                          // Auto-search when polygon is available
                          if (currentPolygonCoords.length > 0 && !isSearching) {
                            // Clear previous results and analysis state
                            setSearchResults([])
                            setSelectedPlaceDetails({})
                            searchPlacesInPolygon(category.value)
                          }
                        }}
                        disabled={isSearching}
                        className={cn(
                          "flex items-center gap-2 p-2 rounded-md text-sm transition-colors relative",
                          isSelected
                            ? "bg-orange-100 text-orange-700 border border-orange-200"
                            : "hover:bg-gray-100 text-gray-700 border border-gray-200",
                          isSearching && isSelected && "opacity-75"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="truncate text-xs">{category.label}</span>
                        {category.value === 'all' && (
                          <div className="absolute top-1 right-1 w-2 h-2 bg-orange-400 rounded-full" title="Searches all categories" />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
              
              {selectedCategory === 'all' && currentPolygonCoords.length > 0 && (
                <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded-md">
                  <p className="text-xs text-orange-700">
                    ⚡ &quot;All Categories&quot; searches 15+ types and may take longer
                  </p>
                </div>
              )}
            </div>

            {/* Step 3: Analysis Status */}
            {searchResults.length > 0 && (
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
                  <h2 className="text-sm font-semibold text-gray-900">Analysis Progress</h2>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-600">Found:</span>
                    <span className="font-medium text-gray-900">{searchResults.length} places</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-600">Selected:</span>
                    <span className="font-medium text-green-600">{searchResults.filter(p => p.isSelected).length} for Tuggi</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-600">Already imported:</span>
                    <span className="font-medium text-gray-500">{searchResults.filter(p => p.alreadyExists).length} places</span>
                  </div>
                </div>
              </div>
            )}

            {/* Save Area & Settings */}
            <div className="p-4 space-y-4">
              {/* Save Current Polygon */}
              {currentPolygonCoords.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Save This Area</h3>
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-gray-600 mb-1 block">Area Name (auto-generated)</label>
                      <input
                        type="text"
                        placeholder="Auto-generating name..."
                        value={polygonName}
                        onChange={(e) => setPolygonName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        ✨ Name auto-generated from your city search. You can edit it before saving.
                      </p>
                    </div>
                    
                    <button
                      onClick={saveCurrentPolygon}
                      disabled={isSavingPolygon}
                      className="w-full px-3 py-2 bg-green-500 text-white rounded-md text-sm font-medium hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSavingPolygon ? (
                        <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                      ) : (
                        "Save Area for Future Use"
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Mapped Areas Summary */}
              {savedPolygons.length > 0 && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <span className="text-sm font-medium text-green-700">
                      {savedPolygons.length} Saved Area{savedPolygons.length > 1 ? 's' : ''} Visible
                    </span>
                  </div>
                  <p className="text-xs text-green-600 mt-1">
                    Showing coverage to avoid rework in same places
                  </p>
                </div>
              )}

              {/* Settings */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3">Settings</h3>
                <div>
                  <label className="text-xs text-gray-600">Default Country</label>
                  <select
                    value={selectedCountry}
                    onChange={(e) => setSelectedCountry(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  >
                    {COUNTRIES.map((country) => (
                      <option key={country.value} value={country.value}>
                        {country.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Status Messages */}
              {(searchStatus || importStatus) && (
                <div className={cn(
                  "p-3 rounded-md",
                  isSearching ? "bg-blue-50 border border-blue-200" :
                  searchStatus.includes('Error') ? "bg-red-50 border border-red-200" :
                  searchStatus.includes('Found') ? "bg-green-50 border border-green-200" :
                  "bg-blue-50 border border-blue-200"
                )}>
                  <div className="flex items-start gap-2">
                    {isSearching && <Loader2 className="h-4 w-4 animate-spin text-blue-500 mt-0.5 flex-shrink-0" />}
                    <p className={cn(
                      "text-sm",
                      isSearching ? "text-blue-700" :
                      searchStatus.includes('Error') ? "text-red-700" :
                      searchStatus.includes('Found') ? "text-green-700" :
                      "text-blue-700"
                    )}>
                      {importStatus || searchStatus}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

        {/* Main Map Area */}
        <div className="flex-1 relative">
          <GoogleMapComponent
            center={mapCenter}
            zoom={mapZoom}
            height="100%"
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
            savedPolygons={savedPolygons}
            cityBoundary={cityBoundary}
            cityName={currentCityName}
            isLoading={isSearching}
            loadingMessage={isSearching ? searchStatus || 'Searching for places...' : ''}
          />
        </div>
      </div>

            {/* Bottom Analysis Panel - Dynamic Height */}
      <div className="bg-white border-t border-gray-200 flex flex-col transition-all duration-500 ease-out flex-1" style={{ minHeight: '45vh' }}>
        {/* Analysis Header */}
        <div className="p-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900">Place Analysis</h2>
              {isFullScreenMode && (
                <div className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full flex items-center gap-1">
                  <ChevronUp className="h-3 w-3" />
                  Full Screen Mode
                </div>
              )}
            </div>
            {searchResults.length > 0 && (
              <div className="text-sm text-gray-500">
                {searchResults.filter(p => p.isSelected).length} / {searchResults.length} selected
              </div>
            )}
          </div>
          
          {searchResults.length > 0 && (
            <div className="mt-3 space-y-2">
              {/* Progress Bar */}
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ 
                      width: `${(searchResults.filter(p => p.isSelected || p.alreadyExists).length / searchResults.length) * 100}%` 
                    }}
                  />
                </div>
                <span className="text-xs text-gray-500 min-w-max">
                  {searchResults.filter(p => p.isSelected || p.alreadyExists).length} / {searchResults.length} reviewed
                </span>
              </div>
              
              {/* Analysis Summary */}
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-gray-600">
                    {searchResults.filter(p => p.isSelected).length} good for Tuggi
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                  <span className="text-gray-600">
                    {searchResults.filter(p => p.alreadyExists).length} already imported
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
                  <span className="text-gray-600">
                    {searchResults.filter(p => !p.isSelected && !p.alreadyExists).length} pending review
                  </span>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  💡 Review each place to determine if it&apos;s suitable for the Tuggi tourism platform
                </div>
                {scrollY < 50 && searchResults.length > 6 && (
                  <div className="text-xs text-blue-600 flex items-center gap-1">
                    <ChevronDown className="h-3 w-3 animate-bounce" />
                    Scroll down for full screen
                  </div>
                )}
                {isFullScreenMode && (
                  <div className="text-xs text-blue-600 flex items-center gap-1 cursor-pointer hover:text-blue-800" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                    <ChevronUp className="h-3 w-3 animate-bounce" />
                    Scroll up to see map
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Analysis Content */}
        <div className="flex-1">
          {searchResults.length === 0 ? (
            <div className="p-6 text-center text-gray-500 flex flex-col items-center justify-center" style={{ minHeight: '80vh' }}>
              <Target className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <h3 className="text-sm font-medium text-gray-900 mb-1">No places to analyze</h3>
              <p className="text-sm">Draw a polygon and search for places to start analyzing</p>
            </div>
          ) : (
            <div className="p-4 pb-32" style={{ minHeight: '120vh' }}>{/* Horizontal layout container with bottom padding for scrolling */}
              {/* Import Actions */}
              <div className="flex items-center gap-2 p-2 bg-gray-50 rounded mb-3">
                <button
                  onClick={() => {
                    setSearchResults(prev => prev.map(place => 
                      place.alreadyExists ? place : { ...place, isSelected: true }
                    ))
                  }}
                  className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  All
                </button>
                <button
                  onClick={() => {
                    setSearchResults(prev => prev.map(place => ({ ...place, isSelected: false })))
                  }}
                  className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
                >
                  None
                </button>
                {getSelectedPlaces().length > 0 && (
                  <button
                    onClick={importSelectedPlaces}
                    disabled={isImporting}
                    className="ml-auto px-3 py-1 bg-orange-500 text-white rounded text-xs font-medium hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    {isImporting ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Importing... ({importedCount}/{getSelectedPlaces().length})
                      </>
                    ) : (
                      <>
                        <Upload className="h-3 w-3" />
                        Import {getSelectedPlaces().length} Places
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Place Analysis Cards - Responsive Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6 gap-4 auto-rows-max" style={{ minHeight: '100vh' }}>
                {searchResults.map((place) => {
                const details = selectedPlaceDetails[place.place_id]
                const isLoadingDetails = loadingDetails.has(place.place_id)
                
                return (
                  <div
                    key={place.place_id}
                    className={cn(
                      "border rounded-lg overflow-hidden transition-all h-fit",
                      place.isSelected ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-white",
                      place.alreadyExists && "opacity-60"
                    )}
                  >
                    {/* Place Image - Compact */}
                    <div className="relative h-20 bg-gray-100">
                      {place.thumbnail ? (
                        <img
                          src={place.thumbnail}
                          alt={place.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement
                            target.style.display = 'none'
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <MapPin className="h-8 w-8 text-gray-400" />
                        </div>
                      )}
                      {place.alreadyExists && (
                        <div className="absolute top-2 right-2 bg-gray-800 text-white text-xs px-2 py-1 rounded">
                          Already Imported
                        </div>
                      )}
                      {place.rating && place.rating >= 4.0 && (
                        <div className="absolute top-2 left-2 bg-green-500 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                          <Star className="h-3 w-3 fill-current" />
                          Highly Rated
                        </div>
                      )}
                    </div>

                    {/* Place Details - Compact for grid layout */}
                    <div className="p-2">
                      <div className="flex items-start justify-between mb-1">
                        <h3 className="font-medium text-gray-900 flex-1 text-sm leading-tight">{place.name}</h3>
                        <button
                          onClick={() => fetchPlaceDetails(place.place_id)}
                          disabled={isLoadingDetails || !!details}
                          className="ml-1 text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-400 flex-shrink-0"
                        >
                          {isLoadingDetails ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : details ? (
                            <Info className="h-3 w-3" />
                          ) : (
                            'Info'
                          )}
                        </button>
                      </div>
                      
                      <p className="text-xs text-gray-600 mb-2 line-clamp-1">{place.formatted_address}</p>
                      
                      {/* Quick Info Grid */}
                      <div className="grid grid-cols-2 gap-1 mb-2">
                        {place.rating && (
                          <div className="flex items-center gap-1">
                            <Star className="h-3 w-3 text-yellow-400 fill-current" />
                            <span className="text-xs font-medium">{place.rating}</span>
                            {place.user_ratings_total && (
                              <span className="text-xs text-gray-500">({place.user_ratings_total})</span>
                            )}
                          </div>
                        )}
                        <div className="text-xs text-gray-500 bg-gray-100 px-1 py-0.5 rounded text-center">
                          {place.types[0]?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </div>
                      </div>

                      {/* Expanded Details - Ultra Compact */}
                                                 {details && (
                             <div className="mb-2 p-1.5 bg-gray-50 rounded text-xs space-y-0.5">
                               {/* Business Hours */}
                               {details.opening_hours && (
                                 <div className="flex items-center gap-1">
                                   <Clock className="h-2.5 w-2.5 text-gray-500" />
                                   <span className={details.opening_hours.open_now ? "text-green-600" : "text-red-600"}>
                                     {details.opening_hours.open_now ? "Open" : "Closed"}
                                   </span>
                                 </div>
                               )}
                               
                               {/* Phone Numbers */}
                               {(details as any).formatted_phone_number && (
                                 <div className="flex items-center gap-1">
                                   <Phone className="h-2.5 w-2.5 text-gray-500" />
                                   <a 
                                     href={`tel:${(details as any).formatted_phone_number}`}
                                     className="text-blue-600 hover:text-blue-800 truncate"
                                   >
                                     Phone
                                   </a>
                                 </div>
                               )}
                               
                               {/* Website */}
                               {details.website && (
                                 <div className="flex items-center gap-1">
                                   <Globe2 className="h-2.5 w-2.5 text-gray-500" />
                                   <a 
                                     href={details.website} 
                                     target="_blank" 
                                     rel="noopener noreferrer"
                                     className="text-blue-600 hover:text-blue-800 truncate"
                                   >
                                     Website
                                   </a>
                                 </div>
                               )}
                               
                               {/* Price Level */}
                               {details.price_level && (
                                 <div className="flex items-center gap-1">
                                   <span className="text-gray-700">
                                     {'$'.repeat(details.price_level)} 
                                     {details.price_level <= 2 ? ' Budget' : ' Premium'}
                                   </span>
                                 </div>
                               )}
                             </div>
                           )}

                                             {/* Analysis Indicators - Ultra Compact */}
                       <div className="mb-2">
                         <div className="flex flex-wrap gap-0.5">
                           {/* {place.rating && place.rating >= 4.0 && (
                             <span className="text-xs bg-green-100 text-green-700 px-1 py-0.5 rounded">⭐</span>
                           )}
                           {place.user_ratings_total && place.user_ratings_total >= 100 && (
                             <span className="text-xs bg-blue-100 text-blue-700 px-1 py-0.5 rounded">🔥</span>
                           )}
                           {place.types.includes('tourist_attraction') && (
                             <span className="text-xs bg-purple-100 text-purple-700 px-1 py-0.5 rounded">🎯</span>
                           )}
                           {details?.opening_hours?.open_now && (
                             <span className="text-xs bg-green-100 text-green-700 px-1 py-0.5 rounded">✅</span>
                           )}
                           {details?.website && (
                             <span className="text-xs bg-orange-100 text-orange-700 px-1 py-0.5 rounded">🌐</span>
                           )}
                           {(details as any)?.formatted_phone_number && (
                             <span className="text-xs bg-cyan-100 text-cyan-700 px-1 py-0.5 rounded">📞</span>
                           )}
                           {details?.price_level && details.price_level <= 2 && (
                             <span className="text-xs bg-green-100 text-green-700 px-1 py-0.5 rounded">💰</span>
                           )}
                           {place.photos && place.photos.length > 0 && (
                             <span className="text-xs bg-pink-100 text-pink-700 px-1 py-0.5 rounded">📸</span>
                           )} */}
                           {(details as any)?.business_status === 'CLOSED_PERMANENTLY' && (
                             <span className="text-xs bg-red-100 text-red-700 px-1 py-0.5 rounded">❌</span>
                           )}
                           {(details as any)?.business_status === 'CLOSED_TEMPORARILY' && (
                             <span className="text-xs bg-yellow-100 text-yellow-700 px-1 py-0.5 rounded">⏸️</span>
                           )}
                         </div>
                       </div>

                      {/* Decision Buttons - Ultra Compact */}
                      {!place.alreadyExists && (
                        <div className="space-y-1">
                          <button
                            onClick={() => togglePlaceSelection(place.place_id)}
                            className={cn(
                              "w-full py-1 px-2 rounded text-xs font-medium transition-colors",
                              place.isSelected
                                ? "bg-green-500 text-white hover:bg-green-600"
                                : "bg-green-100 text-green-700 hover:bg-green-200"
                            )}
                          >
                            {place.isSelected ? "✓ Perfect" : "Good for Tuggi?"}
                          </button>
                          
                          {/* {!place.isSelected && (
                            <div className="flex gap-0.5">
                              <button className="flex-1 text-xs py-0.5 px-1 bg-red-50 text-red-600 rounded hover:bg-red-100">
                                No
                              </button>
                              <button className="flex-1 text-xs py-0.5 px-1 bg-red-50 text-red-600 rounded hover:bg-red-100">
                                Poor
                              </button>
                              <button className="flex-1 text-xs py-0.5 px-1 bg-red-50 text-red-600 rounded hover:bg-red-100">
                                Closed
                              </button>
                            </div>
                          )} */}
                        </div>
                      )}
                    </div>
                  </div>
                )
                })}
              </div>
            </div>
          )}
        </div>


      </div>
    </div>
  )
}