import { SupabaseClient } from '@supabase/supabase-js'
import { EnhancedPlaceResult, ImportBatch } from '@/types/poi-importer'
import { createGooglePlacesService, type PlaceSearchResult } from '@/lib/googlePlaces'

export class POIImportService {
  private placesService: ReturnType<typeof createGooglePlacesService>

  constructor(
    private supabase: SupabaseClient, 
    apiKey: string,
    language: string = ''
  ) {
    this.placesService = createGooglePlacesService(apiKey, language)
  }

  setLanguage(language: string) {
    if (this.placesService && 'setLanguage' in this.placesService) {
      this.placesService.setLanguage(language)
    }
  }

  async checkExistingPOIs(places: PlaceSearchResult[]): Promise<EnhancedPlaceResult[]> {
    try {
      const { data: existingPOIs, error } = await this.supabase
        .schema('core')
        .from('attractions')
        .select('google_place_id')
        .in('google_place_id', places.map(p => p.place_id))

      if (error) {
        console.error('Error checking existing POIs:', error)
        return places.map(place => ({
          ...place,
          isSelected: false,
          alreadyExists: false
        }))
      }

      const existingPlaceIds = new Set(existingPOIs.map(poi => poi.google_place_id))

      return places.map(place => ({
        ...place,
        isSelected: !existingPlaceIds.has(place.place_id),
        alreadyExists: existingPlaceIds.has(place.place_id)
      }))
    } catch (error) {
      console.error('Error in checkExistingPOIs:', error)
      return places.map(place => ({
        ...place,
        isSelected: false,
        alreadyExists: false
      }))
    }
  }

  async searchPlacesInPolygon(
    category: string,
    polygonCoords: Array<{ lat: number; lng: number }>
  ): Promise<{ results: EnhancedPlaceResult[]; status: string }> {
    if (!this.placesService || polygonCoords.length === 0) {
      return { results: [], status: 'Invalid search parameters' }
    }

    try {
      const categories = category === 'all' 
        ? ['tourist_attraction', 'museum', 'park', 'church', 'stadium', 'library', 'aquarium', 'zoo', 'amusement_park', 'art_gallery', 'shopping_mall', 'restaurant', 'lodging', 'hospital', 'university']
        : [category]

      let allResults: PlaceSearchResult[] = []
      let searchStatus = ''

      for (const cat of categories) {
        try {
          const results = await this.placesService.searchPlacesInPolygon(
            polygonCoords,
            cat
          )

          if (results.length > 0) {
            const filteredResults = this.filterPlacesInPolygon(results, polygonCoords)
            allResults = [...allResults, ...filteredResults]
            searchStatus = category === 'all' 
              ? `Searching ${cat}... found ${filteredResults.length} places`
              : `Found ${filteredResults.length} places in polygon`
          }
        } catch (catError) {
          console.warn(`Error searching category ${cat}:`, catError)
        }
      }

      // Remove duplicates based on place_id
      const uniqueResults = allResults.filter((place, index, self) => 
        index === self.findIndex(p => p.place_id === place.place_id)
      )

      const enhancedResults = await this.checkExistingPOIs(uniqueResults)
      
      const finalStatus = uniqueResults.length > 0 
        ? `Found ${uniqueResults.length} unique places in area${enhancedResults.filter(p => p.alreadyExists).length > 0 ? ` (${enhancedResults.filter(p => p.alreadyExists).length} already imported)` : ''}`
        : 'No places found in the selected area'

      return { results: enhancedResults, status: finalStatus }
    } catch (error) {
      console.error('Error searching places:', error)
      return { results: [], status: `Search error: ${error instanceof Error ? error.message : 'Unknown error'}` }
    }
  }

  private calculatePolygonCenter(coords: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
    const latSum = coords.reduce((sum, coord) => sum + coord.lat, 0)
    const lngSum = coords.reduce((sum, coord) => sum + coord.lng, 0)
    
    return {
      lat: latSum / coords.length,
      lng: lngSum / coords.length
    }
  }

  private calculateSearchRadius(coords: Array<{ lat: number; lng: number }>): number {
    if (coords.length < 2) return 1000

    const center = this.calculatePolygonCenter(coords)
    let maxDistance = 0

    coords.forEach(coord => {
      const distance = this.calculateDistance(center, coord)
      maxDistance = Math.max(maxDistance, distance)
    })

    return Math.min(Math.max(maxDistance * 1000, 500), 50000)
  }

  private calculateDistance(point1: { lat: number; lng: number }, point2: { lat: number; lng: number }): number {
    const R = 6371 // Earth's radius in kilometers
    const dLat = this.toRadians(point2.lat - point1.lat)
    const dLng = this.toRadians(point2.lng - point1.lng)
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(point1.lat)) * Math.cos(this.toRadians(point2.lat)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2)
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180)
  }

  private filterPlacesInPolygon(
    places: PlaceSearchResult[], 
    polygonCoords: Array<{ lat: number; lng: number }>
  ): PlaceSearchResult[] {
    return places.filter(place => 
      this.isPointInPolygon(place.geometry.location, polygonCoords)
    )
  }

  private isPointInPolygon(
    point: { lat: number; lng: number }, 
    polygon: Array<{ lat: number; lng: number }>
  ): boolean {
    let inside = false
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (((polygon[i].lat > point.lat) !== (polygon[j].lat > point.lat)) &&
          (point.lng < (polygon[j].lng - polygon[i].lng) * (point.lat - polygon[i].lat) / (polygon[j].lat - polygon[i].lat) + polygon[i].lng)) {
        inside = !inside
      }
    }
    
    return inside
  }

  async fetchPlaceDetails(placeId: string): Promise<PlaceSearchResult | null> {
    if (!this.placesService) return null

    try {
      const details = await this.placesService.getPlaceDetails(placeId)
      return details
    } catch (error) {
      console.error('Error fetching place details:', error)
      return null
    }
  }

  async createImportBatch(_selectedPlaces: EnhancedPlaceResult[]): Promise<string> {
    // import_batches removida (tracking de import legado). Gera um id local só
    // para o fluxo seguir; não há mais persistência do batch.
    return (globalThis.crypto?.randomUUID?.() ?? `batch-${Date.now()}`)
  }

  async importPOI(place: EnhancedPlaceResult, batchId: string): Promise<{ success: boolean; attractionId?: string; error?: string }> {
    try {
      // Get detailed place information
      const placeDetails = await this.fetchPlaceDetails(place.place_id)
      if (!placeDetails) {
        return { success: false, error: 'Could not fetch place details' }
      }

      // Extract address parts
      const addressParts = placeDetails.formatted_address.split(', ')
      const country = addressParts[addressParts.length - 1]
      const state = addressParts.length > 2 ? addressParts[addressParts.length - 2] : ''
      const city = addressParts.length > 3 ? addressParts[addressParts.length - 3] : addressParts[0]

      // Prepare attraction data matching new schema
      const attractionData = {
        name: placeDetails.name,
        description: null,
        formatted_address: placeDetails.formatted_address,
        city,
        state,
        country,
        google_place_id: placeDetails.place_id,
        rating: (placeDetails as any).rating || null,
        price_level: (placeDetails as any).price_level || null,
        google_types: placeDetails.types || [],
        opening_hours: (placeDetails as any).opening_hours?.weekday_text || null,
        formatted_phone_number: (placeDetails as any).formatted_phone_number || null,
        international_phone_number: (placeDetails as any).international_phone_number || null,
        website: (placeDetails as any).website || null,
        import_batch_id: batchId,
        processing_status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      // Insert attraction
      const { data: attraction, error: attractionError } = await this.supabase
        .schema('core')
        .from('attractions')
        .insert([attractionData])
        .select('id')
        .single()

      if (attractionError) {
        console.error('Error inserting attraction:', attractionError)
        return { success: false, error: attractionError.message }
      }

      // Insert coordinates into attraction_coordinate table
      const { error: coordError } = await this.supabase
        .schema('core')
        .from('attraction_coordinate')
        .insert({
          attraction_id: attraction.id,
          latitude: placeDetails.geometry.location.lat,
          longitude: placeDetails.geometry.location.lng,
          show_in_map: true
        })

      if (coordError) {
        console.error('Error inserting coordinates:', coordError)
        // We don't fail the whole import if coordinates fail, but we log it
      }

      // Store photo reference if available (primary image only)
      if (placeDetails.photos && placeDetails.photos.length > 0) {
        const photoRefs = placeDetails.photos
          .slice(0, 1) // Limit to 1 photo (primary image only)
          .map(photo => photo.photo_reference)
        
        await this.storePhotoReferencesOnly(attraction.id, photoRefs)
      }

      return { success: true, attractionId: attraction.id }
    } catch (error) {
      console.error('Error importing POI:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  private async storePhotoReferencesOnly(attractionId: string, photoRefs: string[]): Promise<void> {
    try {
      const photoInserts = photoRefs.map((photoRef, index) => ({
        attraction_id: attractionId,
        photo_reference: photoRef,
        photo_order: index + 1,
        status: 'pending',
        created_at: new Date().toISOString()
      }))

      const { error } = await this.supabase
        .schema('core')
        .from('attraction_photos')
        .insert(photoInserts)

      if (error) {
        console.error('Error storing photo references:', error)
      }
    } catch (error) {
      console.error('Error in storePhotoReferencesOnly:', error)
    }
  }

  async updateImportBatchProgress(_batchId: string, _processedCount: number, _totalCount: number): Promise<void> {
    // import_batches removida — sem tracking de progresso de batch (no-op).
  }
}