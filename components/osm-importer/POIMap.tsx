/**
 * Local POI Map Component
 * 
 * Map view for POIs from local database using Google Maps
 * Reuses existing POIMapVisualization component
 * 
 * @module components/osm-importer/POIMap
 */

'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, Map as MapIcon } from 'lucide-react'
import { POIMapVisualization } from '@/components/poi-management/POIMapVisualization'
import { SimpleOSMPOI } from '@/lib/hooks/use-osm-importer-simple'

interface POIMapProps {
  features: SimpleOSMPOI[]
  selectedFeatures: Set<string>
  onToggleSelection: (id: string) => void
  onPOIClick?: (poi: SimpleOSMPOI) => void
  searchTerm?: string
  stateFilter?: string
  cityFilter?: string
  categoryFilter?: string
  height?: string
  className?: string
}

export function POIMap({ 
  features, 
  selectedFeatures, 
  onToggleSelection,
  onPOIClick,
  searchTerm = "",
  stateFilter = "",
  cityFilter = "",
  categoryFilter = "",
  height = "600px",
  className = ""
}: POIMapProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [mapPois, setMapPois] = useState<any[]>([])

  // Transform features to POI format expected by POIMapVisualization
  const transformFeaturesToPOIs = useCallback((features: SimpleOSMPOI[]) => {
    console.log('🔄 [POIMap] Transforming features to POIs:', {
      featuresCount: features.length,
      firstFeature: features[0]
    })
    
    return features.map(feature => {
      // Get coordinates from different data formats
      let latitude = 0
      let longitude = 0
      
      // Try database format first (lat/lon from homolog.pois table)
      if ((feature as any).lat !== undefined && (feature as any).lon !== undefined) {
        // Database format from homolog.pois (returns lat/lon)
        latitude = Number((feature as any).lat)
        longitude = Number((feature as any).lon)
        console.log('📍 [POIMap] Using database lat/lon coordinates:', { latitude, longitude })
      } else if ((feature as any).latitude !== undefined && (feature as any).longitude !== undefined) {
        // Alternative database format (latitude/longitude)
        latitude = Number((feature as any).latitude)
        longitude = Number((feature as any).longitude)
        console.log('📍 [POIMap] Using database latitude/longitude coordinates:', { latitude, longitude })
      } else if (feature.geometry?.coordinates) {
        // GeoJSON format
        longitude = Number(feature.geometry.coordinates[0])
        latitude = Number(feature.geometry.coordinates[1])
        console.log('📍 [POIMap] Using GeoJSON coordinates:', { latitude, longitude })
      } else {
        console.warn('⚠️ [POIMap] No coordinates found for feature:', feature)
        return null // Skip this feature
      }

      // Validate coordinates
      if (latitude === null || latitude === undefined || 
          longitude === null || longitude === undefined ||
          isNaN(latitude) || isNaN(longitude) ||
          latitude < -90 || latitude > 90 ||
          longitude < -180 || longitude > 180) {
        console.warn('⚠️ [POIMap] Invalid coordinates for feature:', { 
          feature, 
          latitude, 
          longitude,
          hasLat: latitude !== null && latitude !== undefined,
          hasLon: longitude !== null && longitude !== undefined
        })
        return null // Skip this feature
      }
      
      // Also skip if coordinates are exactly (0,0) which is in the ocean off Africa - unlikely to be a real POI
      if (latitude === 0 && longitude === 0) {
        console.warn('⚠️ [POIMap] Skipping POI with coordinates (0,0) - likely invalid:', feature)
        return null
      }

      // Get name from different formats
      const name = (feature as any).name || feature.properties?.name || 'Unnamed POI'
      
      // Get category info
      const category = (feature as any).primary_category || feature.properties?.primary_category || 'Unknown'
      const categoryType = (feature as any).primary_category_type || feature.properties?.primary_category_type || 'Unknown'

      const transformedPOI = {
        id: feature._id || (feature as any).id,
        name,
        city: (feature as any).city || feature.properties?.city || 'Unknown',
        country: (feature as any).country || feature.properties?.country || 'Unknown',
        state: (feature as any).state || feature.properties?.state || null,
        category: `${categoryType}: ${category}`,
        approved: true, // Local data is considered approved
        approved_by: null,
        approved_at: null,
        rating: null,
        image_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        user_ratings_total: null,
        formatted_address: null,
        vicinity: null,
        website: null,
        formatted_phone_number: null,
        business_status: null,
        price_level: null,
        opening_hours: null,
        google_types: null,
        photos_references: null,
        google_place_id: null,
        user_id: null,
        coordinates: {
          latitude,
          longitude
        },
        has_description: false,
        has_audio: false,
        description_count: 0,
        audio_count: 0,
        reference_links: [],
        // Selection state
        isSelected: selectedFeatures.has(feature._id || (feature as any).id)
      }
      
      console.log('🔄 [POIMap] Transformed POI:', {
        id: transformedPOI.id,
        name: transformedPOI.name,
        coordinates: transformedPOI.coordinates,
        hasValidCoords: transformedPOI.coordinates.latitude !== 0 || transformedPOI.coordinates.longitude !== 0
      })
      
      return transformedPOI
    }).filter(poi => {
      // Filter out null POIs and ensure coordinates are valid
      if (!poi) return false
      const { latitude, longitude } = poi.coordinates
      return latitude !== null && latitude !== undefined &&
             longitude !== null && longitude !== undefined &&
             !isNaN(latitude) && !isNaN(longitude) &&
             latitude >= -90 && latitude <= 90 &&
             longitude >= -180 && longitude <= 180 &&
             !(latitude === 0 && longitude === 0) // Skip (0,0) which is unlikely to be a real POI
    })
  }, [selectedFeatures])

  // Store mapping of transformed POI IDs to original features
  const [poiIdToFeatureMap, setPoiIdToFeatureMap] = useState<Map<string, SimpleOSMPOI>>(new Map())

  // Handle POI click - if onPOIClick is provided, use it; otherwise toggle selection
  const handlePOIClick = useCallback((poi: any) => {
    if (onPOIClick) {
      // Find the original feature by ID
      const originalFeature = poiIdToFeatureMap.get(poi.id)
      if (originalFeature) {
        onPOIClick(originalFeature)
      }
    } else {
      // Fallback to selection toggle
      onToggleSelection(poi.id)
    }
  }, [onToggleSelection, onPOIClick, poiIdToFeatureMap])

  // Transform features when they change - optimized for performance
  useEffect(() => {
    console.log('🗺️ [POIMap] Features changed:', {
      featuresCount: features.length,
      features: features.slice(0, 3) // Log first 3 features for debugging
    })
    
    if (features.length > 0) {
      // Transform immediately without delay for better performance
      const transformedPois = transformFeaturesToPOIs(features)
      console.log('🗺️ [POIMap] Transformed POIs:', {
        transformedCount: transformedPois.length,
        transformedPois: transformedPois.slice(0, 3) // Log first 3 for debugging
      })
      setMapPois(transformedPois)
      
      // Create mapping from POI ID to original feature
      const idMap = new Map<string, SimpleOSMPOI>()
      features.forEach(feature => {
        const isDbData = !feature.properties && !feature.geometry
        const poiId = isDbData ? (feature as any).id : feature._id
        idMap.set(poiId, feature)
      })
      setPoiIdToFeatureMap(idMap)
      
      setIsLoading(false)
    } else {
      setMapPois([])
      setPoiIdToFeatureMap(new Map())
      setIsLoading(false)
    }
  }, [features, transformFeaturesToPOIs])

  if (isLoading) {
    return (
      <div className={className} style={{ height }}>
        <div className="relative w-full h-full bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-2" />
            <p className="text-sm text-gray-600 dark:text-gray-400">Loading map...</p>
          </div>
        </div>
      </div>
    )
  }

  if (mapPois.length === 0) {
    return (
      <div className={className} style={{ height }}>
        <div className="relative w-full h-full bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center">
          <div className="text-center">
            <MapIcon className="h-12 w-12 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-600 dark:text-gray-400">No POIs to display</p>
            <p className="text-xs text-gray-500 dark:text-gray-500">Upload a GeoJSON file to see POIs on the map</p>
          </div>
        </div>
      </div>
    )
  }

  console.log('🗺️ [POIMap] Rendering POIMapVisualization with:', {
    poisCount: mapPois.length,
    firstPoi: mapPois[0],
    allPois: mapPois,
    firstPoiCoords: mapPois[0]?.coordinates,
    hasValidCoords: mapPois[0]?.coordinates?.latitude !== 0 && mapPois[0]?.coordinates?.longitude !== 0
  })

  return (
    <div className={className} style={{ height }}>
      <POIMapVisualization
        pois={mapPois}
        totalCount={mapPois.length}
        searchTerm={searchTerm}
        statusFilter="all"
        countryFilter=""
        stateFilter={stateFilter}
        cityFilter={cityFilter}
        contentStatusFilter="all"
        groupStatusFilter="all"
        triggerPointsFilter="all"
        onPOIClick={handlePOIClick}
        height={height}
        className="rounded-lg"
      />
    </div>
  )
}
