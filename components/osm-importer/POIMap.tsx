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
  height?: string
  className?: string
}

export function POIMap({ 
  features, 
  selectedFeatures, 
  onToggleSelection, 
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
      
      if ((feature as any).latitude !== undefined && (feature as any).longitude !== undefined) {
        // Database format
        latitude = (feature as any).latitude
        longitude = (feature as any).longitude
        console.log('📍 [POIMap] Using database coordinates:', { latitude, longitude })
      } else if (feature.geometry?.coordinates) {
        // GeoJSON format
        longitude = feature.geometry.coordinates[0]
        latitude = feature.geometry.coordinates[1]
        console.log('📍 [POIMap] Using GeoJSON coordinates:', { latitude, longitude })
      } else {
        console.warn('⚠️ [POIMap] No coordinates found for feature:', feature)
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
    }).filter(poi => poi.coordinates.latitude !== 0 || poi.coordinates.longitude !== 0)
  }, [selectedFeatures])

  // Handle POI click
  const handlePOIClick = useCallback((poi: any) => {
    onToggleSelection(poi.id)
  }, [onToggleSelection])

  // Transform features when they change
  useEffect(() => {
    console.log('🗺️ [POIMap] Features changed:', {
      featuresCount: features.length,
      features: features.slice(0, 3) // Log first 3 features for debugging
    })
    
    if (features.length > 0) {
      setIsLoading(true)
      
      // Simulate loading delay for better UX
      const timer = setTimeout(() => {
        const transformedPois = transformFeaturesToPOIs(features)
        console.log('🗺️ [POIMap] Transformed POIs:', {
          transformedCount: transformedPois.length,
          transformedPois: transformedPois.slice(0, 3) // Log first 3 for debugging
        })
        setMapPois(transformedPois)
        setIsLoading(false)
      }, 100)

      return () => clearTimeout(timer)
    } else {
      setMapPois([])
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
        searchTerm=""
        statusFilter="all"
        countryFilter=""
        stateFilter=""
        cityFilter=""
        googleTypesFilter=""
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
