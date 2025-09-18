# City Boundaries Map Feature Implementation

## Overview
Implementation guide for displaying city boundaries on the map when users select a city filter. The system fetches boundaries from the database, validates city-state relationships, and renders polygons on Google Maps with automatic fit-to-bounds functionality.

## Feature Requirements
- Display city boundaries when city filter is selected
- Validate that the selected city belongs to the specified state
- Automatically fit map view to city boundaries
- Preserve map position when changing other filters
- Show loading states during boundary fetching

## Component Structure

### 1. **POIMapVisualization Component** 🗺️

Main component that handles map rendering and city boundaries display.

#### Props Interface
```typescript
interface POIMapVisualizationProps {
  pois: POI[]
  cityFilter?: string
  stateFilter?: string
  countryFilter?: string
  // ... other props
}

interface CityBoundary {
  osm_id: number
  name: string
  name_en: string | null
  boundary: string | null
  admin_level: number | null
  geojson: any // GeoJSON object
  coordinates?: Array<{lat: number, lng: number}> // Parsed coordinates
  validation_status?: 'validated' | 'unvalidated' | 'fallback' | 'failed'
  validation_message?: string
}
```

#### State Management
```typescript
const [cityBoundaries, setCityBoundaries] = useState<CityBoundary[]>([])
const [isLoadingBoundaries, setIsLoadingBoundaries] = useState(false)
const [isAutoFitting, setIsAutoFitting] = useState(false)
const boundariesRef = useRef<google.maps.Polygon[]>([])
```

### 2. **API Integration** 🔌

#### Fetch City Boundaries
```typescript
const fetchCityBoundaries = useCallback(async () => {
  if (!cityFilter || !map) return

  setIsLoadingBoundaries(true)
  setCityBoundaries([])

  try {
    const params = new URLSearchParams({
      city: cityFilter,
      ...(countryFilter && { country: countryFilter }),
      ...(stateFilter && { state: stateFilter })
    })

    const response = await fetch(`/api/city-boundaries?${params}`)
    const data = await response.json()

    if (data.success && data.data) {
      setCityBoundaries(data.data)
    }
  } catch (error) {
    console.error('Error fetching city boundaries:', error)
  } finally {
    setIsLoadingBoundaries(false)
  }
}, [cityFilter, countryFilter, stateFilter, map])
```

### 3. **Map Rendering Logic** 🎨

#### Render Boundaries on Map
```typescript
const updateCityBoundaries = useCallback(() => {
  if (!map || !cityBoundaries.length) return

  // Clear existing boundaries
  boundariesRef.current.forEach(boundary => boundary.setMap(null))
  boundariesRef.current = []

  cityBoundaries.forEach((boundary) => {
    if (!boundary.coordinates || boundary.coordinates.length === 0) return

    // Create Google Maps Polygon
    const polygon = new google.maps.Polygon({
      paths: boundary.coordinates,
      strokeColor: '#FF6B35',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: '#FF6B35',
      fillOpacity: 0.1,
      map: map
    })

    // Handle different geometry types
    if (boundary.geojson?.type === 'MultiPolygon') {
      // Handle MultiPolygon by creating multiple polygons
      boundary.geojson.coordinates.forEach((polygonCoords: any) => {
        const coords = polygonCoords[0].map((coord: any) => ({
          lat: coord[1],
          lng: coord[0]
        }))
        
        const multiPolygon = new google.maps.Polygon({
          paths: coords,
          strokeColor: '#FF6B35',
          strokeOpacity: 0.8,
          strokeWeight: 2,
          fillColor: '#FF6B35',
          fillOpacity: 0.1,
          map: map
        })
        
        boundariesRef.current.push(multiPolygon)
      })
    } else {
      boundariesRef.current.push(polygon)
    }
  })
}, [map, cityBoundaries])
```

### 4. **Auto Fit Functionality** 📐

#### Fit Map to Boundaries
```typescript
const autoFitMapToPOIs = useCallback(() => {
  if (!map) return

  setIsAutoFitting(true)

  // Priority 1: Fit to city boundaries if available
  if (cityBoundaries.length > 0) {
    const bounds = new google.maps.LatLngBounds()
    let hasValidBounds = false

    cityBoundaries.forEach(boundary => {
      if (boundary.coordinates && boundary.coordinates.length > 0) {
        boundary.coordinates.forEach(coord => {
          bounds.extend(new google.maps.LatLng(coord.lat, coord.lng))
          hasValidBounds = true
        })
      }
    })

    if (hasValidBounds) {
      setTimeout(() => {
        map.fitBounds(bounds)
        setIsAutoFitting(false)
      }, 200) // Allow time for boundaries to render
      return
    }
  }

  // Priority 2: Fallback to POIs if no boundaries
  if (filteredPOIs.length > 0) {
    const bounds = new google.maps.LatLngBounds()
    filteredPOIs.forEach(poi => {
      bounds.extend(new google.maps.LatLng(poi.latitude, poi.longitude))
    })

    setTimeout(() => {
      map.fitBounds(bounds)
      setIsAutoFitting(false)
    }, 200)
  } else {
    setIsAutoFitting(false)
  }
}, [map, cityBoundaries, filteredPOIs])
```

## useEffect Hooks & Event Handling

### 1. **Trigger Boundary Fetch on Filter Change**
```typescript
useEffect(() => {
  fetchCityBoundaries()
}, [cityFilter, countryFilter, stateFilter, fetchCityBoundaries])
```

### 2. **Update Map When Boundaries Change**
```typescript
useEffect(() => {
  updateCityBoundaries()
}, [cityBoundaries, updateCityBoundaries])
```

### 3. **Auto Fit When Data Changes**
```typescript
useEffect(() => {
  if (filteredPOIs.length > 0 || cityBoundaries.length > 0) {
    autoFitMapToPOIs()
  }
}, [filteredPOIs, cityBoundaries, autoFitMapToPOIs])
```

## Backend API Implementation

### 1. **API Route Structure**
```
/app/api/city-boundaries/route.ts
```

### 2. **Request Parameters**
```typescript
interface CityBoundariesRequest {
  city: string        // Required - city name to search
  state?: string      // Optional - state name for validation
  country?: string    // Optional - country filter
  lat?: number        // Optional - fallback coordinates
  lng?: number        // Optional - fallback coordinates
}
```

### 3. **Validation Logic Flow**
```typescript
// 1. Check cache first
const cacheKey = `${cityName}-${stateName}-${countryName}`

// 2. Find state boundary (admin_level = 4)
const stateQuery = await supabase
  .schema('core')
  .from('city_boundaries')
  .or(`name.eq.${stateName},name_en.eq.${stateName}`)
  .eq('admin_level', 4)

// 3. Find exact city matches (admin_level = 8)  
const exactMatchQuery = await supabase
  .schema('core')
  .from('city_boundaries')
  .or(`name.eq.${cityName},name_en.eq.${cityName}`)
  .eq('admin_level', 8)

// 4. Spatial validation using PostGIS
const spatialQuery = await supabase
  .rpc('st_within_check', {
    city_geom: city.geom,
    state_geom: state.geom
  })

// 5. Process geometry to coordinates
const geomData = await supabase
  .rpc('st_geom_to_coords', {
    geom_input: validCity.geom
  })
```

## Database Integration

### Required RPC Functions
The implementation uses existing PostGIS RPC functions in the `core` schema:
- `core.st_within_check(city_geom, state_geom)` - Spatial validation
- `core.st_geom_to_coords(geom_input)` - Geometry to coordinates conversion  
- `core.st_centroid_coords(geom_input)` - Centroid extraction

### Data Structure
Uses existing `core.city_boundaries` table with:
- `admin_level = 4` for states
- `admin_level = 8` for cities
- `geom` column for spatial data
- `name` and `name_en` for multilingual support

## UI Components & Loading States

### 1. **Loading Indicators**
```typescript
// In POIMapVisualization component
{isLoadingBoundaries && (
  <div className="absolute top-4 right-4 bg-white p-2 rounded shadow">
    <div className="flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">Loading city boundaries...</span>
    </div>
  </div>
)}

{isAutoFitting && (
  <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-white p-2 rounded shadow">
    <div className="flex items-center gap-2">
      <Target className="h-4 w-4" />
      <span className="text-sm">
        {cityBoundaries.length > 0 
          ? "Fitting to city boundaries..." 
          : "Adjusting map view..."
        }
      </span>
    </div>
  </div>
)}
```

### 2. **Boundary Info Display**
```typescript
{cityBoundaries.length > 0 && (
  <div className="absolute bottom-4 left-4 bg-white p-2 rounded shadow">
    <div className="text-sm">
      <span className="font-medium">City Boundaries:</span>
      <span className="ml-2">{cityBoundaries.length} loaded</span>
      {cityBoundaries[0]?.validation_status && (
        <span className={`ml-2 px-2 py-1 rounded text-xs ${
          cityBoundaries[0].validation_status === 'validated' 
            ? 'bg-green-100 text-green-800' 
            : 'bg-yellow-100 text-yellow-800'
        }`}>
          {cityBoundaries[0].validation_status}
        </span>
      )}
    </div>
  </div>
)}
```

## File Structure

```
/components/poi-management/
├── POIMapVisualization.tsx     # Main map component
├── POIDetailsModal.tsx         # Modal with POI edit/delete

/app/api/
├── city-boundaries/
│   └── route.ts               # City boundaries API endpoint

/lib/services/
├── location-resolver.ts       # Fallback location service

/supabase/functions/
└── spatial_validation.sql     # PostGIS RPC functions

/types/
└── poi-importer.ts           # Type definitions
```

## Key Implementation Summary

### 1. **Performance Optimizations**
- Exact name matching before spatial validation
- In-memory caching with 5-minute TTL
- Limited partial matches (max 10)
- Prioritized exact matches in validation loop

### 2. **User Experience**
- Loading states for boundaries and auto-fit
- Visual feedback with validation status
- Smooth map interactions without resets
- Automatic boundary fitting prioritizes city boundaries over POIs

### 3. **Map Position Preservation**
- Conditional loading prevents full map reload
- Dynamic POI updates without map restart
- State-based updates instead of full data refetch
