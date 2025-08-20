import { POIInput, POVItem } from '@/types/pov-types'

interface ViewpointSource {
  source: 'OSM' | 'Google_Places' | 'Foursquare' | 'Wikidata' | 'TripAdvisor'
  confidence: number
  data: any
}

interface ReliableViewpoint {
  name: string
  lat: number
  lng: number
  source: string
  confidence: number
  tags: string[]
  distance_m: number
  bearing_deg: number
  verified: boolean
}

export class ReliableDataSourcesService {
  
  // 1. OpenStreetMap Overpass API - Focado em infraestrutura rodoviária
  async queryOSMViewpoints(poi: POIInput, radius: number = 25000): Promise<ReliableViewpoint[]> {
    console.log(`🗺️ Querying OSM road infrastructure within ${radius}m of ${poi.name}`)
    
    const overpassQuery = `
      [out:json][timeout:25];
      (
        way["highway"="motorway"](around:${radius},${poi.lat},${poi.lng});
        way["highway"="trunk"](around:${radius},${poi.lat},${poi.lng});
        way["highway"="primary"](around:${radius},${poi.lat},${poi.lng});
        way["highway"="motorway_link"](around:${radius},${poi.lat},${poi.lng});
        way["man_made"="bridge"](around:${radius},${poi.lat},${poi.lng});
        node["highway"="rest_area"](around:${radius},${poi.lat},${poi.lng});
        node["tourism"="viewpoint"]["access"!="private"](around:${radius},${poi.lat},${poi.lng});
        way["man_made"="observation_deck"]["access"!="private"](around:${radius},${poi.lat},${poi.lng});
      );
      out center meta;
    `
    
    try {
      // Simulação - na implementação real usaria fetch para Overpass API
      console.log('📡 OSM Overpass query would be executed here')
      return this.mockOSMViewpoints(poi)
    } catch (error) {
      console.error('❌ OSM query failed:', error)
      return []
    }
  }
  
  // 2. Google Places API - Focado em infraestrutura de transporte
  async queryGooglePlacesViewpoints(poi: POIInput, radius: number = 25000): Promise<ReliableViewpoint[]> {
    console.log(`🏢 Querying Google Places transport infrastructure within ${radius}m`)
    
    const searchTypes = [
      'transit_station',
      'gas_station',
      'rest_area'
    ]
    
    const keywords = [
      'bridge', 'overpass', 'highway', 'elevated', 'viaduct',
      'marginal', 'rest area', 'scenic route', 'interchange'
    ]
    
    try {
      // Simulação - na implementação real usaria Google Places API
      console.log('📡 Google Places API query would be executed here')
      return this.mockGooglePlacesViewpoints(poi)
    } catch (error) {
      console.error('❌ Google Places query failed:', error)
      return []
    }
  }
  
  // 3. Wikidata SPARQL - Dados estruturados confiáveis
  async queryWikidataViewpoints(poi: POIInput, radius: number = 25000): Promise<ReliableViewpoint[]> {
    console.log(`📚 Querying Wikidata viewpoints within ${radius}m`)
    
    const sparqlQuery = `
      SELECT ?item ?itemLabel ?coord ?image WHERE {
        ?item wdt:P31/wdt:P279* wd:Q1509831 .  # observation deck
        ?item wdt:P625 ?coord .
        SERVICE wikibase:around {
          ?item wdt:P625 ?coord .
          bd:serviceParam wikibase:center "Point(${poi.lng} ${poi.lat})"^^geo:wktLiteral .
          bd:serviceParam wikibase:radius "${radius/1000}" .
        }
        OPTIONAL { ?item wdt:P18 ?image }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en" }
      }
    `
    
    try {
      // Simulação - na implementação real usaria SPARQL endpoint
      console.log('📡 Wikidata SPARQL query would be executed here')
      return this.mockWikidataViewpoints(poi)
    } catch (error) {
      console.error('❌ Wikidata query failed:', error)
      return []
    }
  }
  
  // 4. Consolidar todas as fontes com scoring
  async gatherReliableViewpoints(poi: POIInput): Promise<ReliableViewpoint[]> {
    console.log(`🔍 Gathering reliable viewpoints for ${poi.name}`)
    
    const [osmViewpoints, googleViewpoints, wikidataViewpoints] = await Promise.all([
      this.queryOSMViewpoints(poi),
      this.queryGooglePlacesViewpoints(poi),
      this.queryWikidataViewpoints(poi)
    ])
    
    // Combinar e deduplicate
    const allViewpoints = [
      ...osmViewpoints,
      ...googleViewpoints, 
      ...wikidataViewpoints
    ]
    
    // Deduplicar por proximidade (500m threshold)
    const deduplicated = this.deduplicateViewpoints(allViewpoints)
    
    // Scoring baseado em múltiplas fontes
    const scored = this.scoreViewpointReliability(deduplicated)
    
    // Ordenar por confiabilidade
    const sorted = scored.sort((a, b) => b.confidence - a.confidence)
    
    console.log(`✅ Found ${sorted.length} reliable viewpoints`)
    return sorted.slice(0, 20) // Top 20 mais confiáveis
  }
  
  private deduplicateViewpoints(viewpoints: ReliableViewpoint[]): ReliableViewpoint[] {
    const deduplicated: ReliableViewpoint[] = []
    
    for (const viewpoint of viewpoints) {
      const isDuplicate = deduplicated.some(existing => 
        this.calculateDistance(viewpoint.lat, viewpoint.lng, existing.lat, existing.lng) < 500
      )
      
      if (!isDuplicate) {
        deduplicated.push(viewpoint)
      }
    }
    
    return deduplicated
  }
  
  private scoreViewpointReliability(viewpoints: ReliableViewpoint[]): ReliableViewpoint[] {
    return viewpoints.map(viewpoint => {
      let confidence = 0.5 // Base score
      
      // Bonus por fonte confiável
      switch (viewpoint.source) {
        case 'OSM': confidence += 0.3; break
        case 'Wikidata': confidence += 0.25; break
        case 'Google_Places': confidence += 0.2; break
        case 'Foursquare': confidence += 0.15; break
        case 'TripAdvisor': confidence += 0.1; break
      }
      
      // Bonus por tags relevantes
      const relevantTags = ['viewpoint', 'observation', 'scenic', 'overlook', 'mirante']
      const hasRelevantTags = viewpoint.tags.some(tag => 
        relevantTags.some(relevant => tag.toLowerCase().includes(relevant))
      )
      if (hasRelevantTags) confidence += 0.2
      
      // Penalty por distância excessiva
      if (viewpoint.distance_m > 20000) confidence -= 0.1
      if (viewpoint.distance_m > 30000) confidence -= 0.2
      
      return {
        ...viewpoint,
        confidence: Math.min(1.0, Math.max(0.0, confidence))
      }
    })
  }
  
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000 // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c
  }
  
  private calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLng = (lng2 - lng1) * Math.PI / 180
    const lat1Rad = lat1 * Math.PI / 180
    const lat2Rad = lat2 * Math.PI / 180
    
    const y = Math.sin(dLng) * Math.cos(lat2Rad)
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng)
    
    const bearing = Math.atan2(y, x) * 180 / Math.PI
    return (bearing + 360) % 360
  }
  
  // Mock data para desenvolvimento - remover na implementação final
  private mockOSMViewpoints(poi: POIInput): ReliableViewpoint[] {
    return [
      {
        name: `Highway approach to ${poi.name}`,
        lat: poi.lat + 0.005, lng: poi.lng + 0.003,
        source: 'OSM',
        confidence: 0.95,
        tags: ['highway=motorway', 'ref=SP-348'],
        distance_m: 2500,
        bearing_deg: 60,
        verified: true
      },
      {
        name: `Bridge crossing near ${poi.name}`,
        lat: poi.lat + 0.002, lng: poi.lng - 0.001,
        source: 'OSM', 
        confidence: 0.90,
        tags: ['man_made=bridge', 'highway=primary'],
        distance_m: 800,
        bearing_deg: 270,
        verified: true
      }
    ]
  }
  
  private mockGooglePlacesViewpoints(poi: POIInput): ReliableViewpoint[] {
    return [
      {
        name: 'Parque Estadual do Jaraguá Viewpoint',
        lat: -23.4588, lng: -46.7688,
        source: 'Google_Places',
        confidence: 0.8,
        tags: ['tourist_attraction', 'park', 'scenic'],
        distance_m: 400,
        bearing_deg: 180,
        verified: true
      }
    ]
  }
  
  private mockWikidataViewpoints(poi: POIInput): ReliableViewpoint[] {
    return [
      {
        name: 'Pico do Jaraguá Observatory',
        lat: -23.4582, lng: -46.7669,
        source: 'Wikidata',
        confidence: 0.95,
        tags: ['observation_deck', 'peak', 'highest_point'],
        distance_m: 50,
        bearing_deg: 0,
        verified: true
      }
    ]
  }
}
