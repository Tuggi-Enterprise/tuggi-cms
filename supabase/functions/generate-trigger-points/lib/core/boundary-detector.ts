import { POIData, BoundaryData, GeographicContext } from '../types/interfaces.ts';
import { TRIGGER_POINTS_CONSTANTS } from '../config/trigger-points-config.ts';
import { calculatePolygonArea, calculatePolygonCenter, calculatePolygonPerimeter, calculateDistance } from '../utils/calculations.ts';
import { GoogleAPIsService } from '../services/google-apis.service.ts';
import { ElevationAnalysisService } from '../services/elevation-service.ts'; // ✅ Importar ElevationService
import { POIClassifierService } from '../services/poi-classifier.service.ts'; // ✅ Importar POIClassifier

export class BoundaryDetector {
  private googleAPIs: GoogleAPIsService;
  private poiClassifier: POIClassifierService; // ✅ Injetar Classifier
  
  constructor(googleAPIs: GoogleAPIsService) {
    this.googleAPIs = googleAPIs;
    this.poiClassifier = new POIClassifierService();
  }
  
  /**
   * Detecta ou constrói o boundary do POI
   */
  async detectBoundary(poiData: POIData, context?: GeographicContext): Promise<BoundaryData> {
    console.log(`🔍 Detecting boundary for ${poiData.name}...`);
    
    let boundary: BoundaryData | null = null;

    // 1. Tentar boundary MANUAL do banco (se houver, passar via poiData ou buscar aqui - por enquanto assumimos que poiData.osm_id é a chave)
    // Se poiData.osm_id for negativo/custom, talvez seja manual. Mas vamos focar no OSM real primeiro.

    // 2. Tentar buscar no OSM (Overpass)
    try {
      boundary = await this.fetchOSMBoundary(poiData);
      if (boundary) {
        console.log(`✅ OSM Boundary found via ${boundary.source}`);
      }
    } catch (e) {
      console.warn(`⚠️ OSM Boundary fetch failed: ${e}`);
    }

    // 3. Fallback: Construir boundary estimado (Viewport ou Círculo)
    if (!boundary) {
      console.log('⚠️ Using viewport/circular fallback boundary');
      boundary = this.constructBoundaryFromViewport(poiData);
    }

    // 4. Enriquecer boundary com dados adicionais (Elevação, Altura, Classificação)
    boundary = await this.enrichBoundaryData(boundary, poiData, context);

    return boundary;
  }

  /**
   * Busca boundary no OSM via Overpass API
   */
  private async fetchOSMBoundary(poiData: POIData): Promise<BoundaryData | null> {
    // A. Busca Direta por ID (mais confiável)
    if (poiData.osm_id && poiData.osm_type) {
        try {
            const boundary = await this.fetchOSMById(poiData.osm_id, poiData.osm_type);
            if (boundary) return boundary;
        } catch (e) {
            console.warn(`⚠️ Failed to fetch OSM by ID ${poiData.osm_id}: ${e}`);
        }
    }

    // B. Busca por Nome e Localização (Heurística)
    try {
        const boundary = await this.fetchOSMByName(poiData.name, poiData.location);
        if (boundary) return boundary;
    } catch (e) {
        console.warn(`⚠️ Failed to fetch OSM by Name: ${e}`);
    }

    return null;
  }

  private async fetchOSMById(osmId: string | number, osmType: string): Promise<BoundaryData | null> {
    // Normalizar tipo
    const type = osmType.toLowerCase() as 'node' | 'way' | 'relation';
    const id = osmId;

    // Query Overpass otimizada para geometria
    const query = `
      [out:json][timeout:25];
      ${type}(id:${id});
      out geom meta;
    `;

    return this.executeOverpassQuery(query, `osm_id:${id}`);
  }

  private async fetchOSMByName(name: string, location: {lat: number, lng: number}): Promise<BoundaryData | null> {
    // Sanitizar nome
    const cleanName = name.replace(/'/g, "\\'").replace(/"/g, '\\"');
    // Raio de busca (ex: 200m)
    const radius = 200;

    const query = `
      [out:json][timeout:25];
      (
        way["name"~"${cleanName}",i](around:${radius},${location.lat},${location.lng});
        relation["name"~"${cleanName}",i](around:${radius},${location.lat},${location.lng});
        nwr["tourism"](around:${radius},${location.lat},${location.lng}); // Tentar genericamente se for turístico
      );
      out geom meta;
    `;

    return this.executeOverpassQuery(query, 'osm_name_search');
  }

  private async executeOverpassQuery(query: string, sourceLabel: string): Promise<BoundaryData | null> {
    try {
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`
        });

        if (!response.ok) throw new Error(`Overpass API error: ${response.status}`);

        const result = await response.json();
        if (!result.elements || result.elements.length === 0) return null;

        // Pegar o melhor elemento (maior área ou primeiro)
        // Simplificação: pegar o primeiro way/relation válido
        const element = result.elements.find((e: any) => e.type === 'way' || e.type === 'relation') || result.elements[0];
        
        if (!element) return null;

        // Converter geometria OSM para BoundaryData
        return this.convertOSMToBoundary(element, sourceLabel);

    } catch (e) {
        console.warn(`⚠️ Overpass Query Error: ${e}`);
        return null;
    }
  }

  private convertOSMToBoundary(element: any, sourceLabel: string): BoundaryData {
      let coordinates: {lat: number, lng: number}[] = [];

      if (element.type === 'node') {
          // Node é um ponto, criar círculo pequeno
          return this.createCircularBoundary({ lat: element.lat, lng: element.lon }, 20);
      } else if (element.geometry) {
           coordinates = element.geometry.map((p: any) => ({ lat: p.lat, lng: p.lon }));
           // Garantir loop fechado
           if (coordinates.length > 0 && 
               (coordinates[0].lat !== coordinates[coordinates.length-1].lat || 
                coordinates[0].lng !== coordinates[coordinates.length-1].lng)) {
               coordinates.push(coordinates[0]);
           }
      }

      if (coordinates.length < 3) {
          // Fallback se geometria for inválida
          return this.createCircularBoundary({ 
              lat: element.bounds?.minlat || element.lat, 
              lng: element.bounds?.minlon || element.lon 
          }, 30);
      }

      const center = calculatePolygonCenter(coordinates);

      return {
          coordinates,
          center,
          area: calculatePolygonArea(coordinates),
          confidence: 0.9,
          source: 'osm',
          osmIdentified: true,
          osmTags: element.tags
      };
  }

  /**
   * Constrói boundary estimado a partir do Viewport do Google Places
   */
  private constructBoundaryFromViewport(poiData: POIData): BoundaryData {
    if (!poiData.geometry?.viewport) {
      // Super fallback: criar círculo de 50m
      return this.createCircularBoundary(poiData.location, 50);
    }
    
    const { northeast, southwest } = poiData.geometry.viewport;
    
    // Criar retângulo
    const coordinates = [
      { lat: northeast.lat, lng: southwest.lng }, // NW
      { lat: northeast.lat, lng: northeast.lng }, // NE
      { lat: southwest.lat, lng: northeast.lng }, // SE
      { lat: southwest.lat, lng: southwest.lng }, // SW
      { lat: northeast.lat, lng: southwest.lng }  // Close loop
    ];
    
    const center = calculatePolygonCenter(coordinates);
    const area = calculatePolygonArea(coordinates);
    
    return {
      coordinates,
      center,
      area,
      confidence: 0.4,
      source: 'google_places', // Corrigido para match interface
      osmIdentified: false,
      height: 10
    };
  }
  
  /**
   * Cria boundary circular (polígono aproximado)
   */
  private createCircularBoundary(center: { lat: number; lng: number }, radius: number): BoundaryData {
    const coordinates: { lat: number; lng: number }[] = [];
    const numPoints = 16;
    
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 360;
      // Simplificado - para produção usar biblioteca geodésica adequada
      const latOffset = (radius / 111111) * Math.cos(angle * Math.PI / 180);
      const lngOffset = (radius / (111111 * Math.cos(center.lat * Math.PI / 180))) * Math.sin(angle * Math.PI / 180);
      
      coordinates.push({
        lat: center.lat + latOffset,
        lng: center.lng + lngOffset
      });
    }
    
    // Close loop
    coordinates.push(coordinates[0]);
    
    return {
      coordinates,
      center,
      area: Math.PI * radius * radius,
      confidence: 0.3,
      source: 'estimated',
      osmIdentified: false,
      height: 10
    };
  }

  /**
   * Enriquece o boundary com dados adicionais (Elevação, Altura, Classificação)
   */
  private async enrichBoundaryData(
    boundary: BoundaryData, 
    poiData: POIData, 
    context?: GeographicContext
  ): Promise<BoundaryData> {
      
      // 1. Obter Elevação (Centro e Variação)
      // Se já vier do OSM tags (ele), usar
      // Senão, buscar via Google Elevation API ou OpenElevation (via ElevationService)
      
      // 🆕 Calcular pontos para amostragem de elevação (Centro + 4 pontos extremos)
      const samplingPoints = [boundary.center];
      if (boundary.coordinates.length >= 4) {
          samplingPoints.push(boundary.coordinates[0]); // N
          samplingPoints.push(boundary.coordinates[Math.floor(boundary.coordinates.length * 0.25)]); // E
          samplingPoints.push(boundary.coordinates[Math.floor(boundary.coordinates.length * 0.5)]); // S
          samplingPoints.push(boundary.coordinates[Math.floor(boundary.coordinates.length * 0.75)]); // W
      }

      const elevationResult = await this.googleAPIs.getElevation(samplingPoints);
      
      let elevationData = { min: 0, max: 0, average: 0, center: 0, highestPoint: boundary.center };

      if (elevationResult.success && elevationResult.data.results) {
          const elevations = elevationResult.data.results.map((r: any) => r.elevation);
          const min = Math.min(...elevations);
          const max = Math.max(...elevations);
          const average = elevations.reduce((a: number, b: number) => a + b, 0) / elevations.length;
          
          // Encontrar o ponto mais alto real
          const maxIndex = elevations.indexOf(max);
          const highestLoc = samplingPoints[maxIndex];

          elevationData = { 
             min, 
             max, 
             average, 
             center: elevations[0], // Assumindo que o primeiro ponto pedido foi o centro
             highestPoint: highestLoc 
          };
      } else {
          // Fallback para ElevationService global
          const centerEle = await ElevationAnalysisService.estimateRegionalBaseElevation(boundary.center, context as GeographicContext, poiData);
          elevationData = { min: centerEle, max: centerEle, average: centerEle, center: centerEle, highestPoint: boundary.center };
      }

      // 2. Estimar Altura da Estrutura (Height)
      // Tentar tags OSM 'height', 'building:levels'
      let height = 10; // Default
      if (boundary.osmTags) {
          if (boundary.osmTags.height) height = parseFloat(boundary.osmTags.height);
          else if (boundary.osmTags['building:levels']) height = parseInt(boundary.osmTags['building:levels']) * 3.5;
      }
      // Se for montanha/pico, height = proeminência ou max-min
      if (poiData.type.includes('mountain') || poiData.type.includes('peak')) {
          height = elevationData.max - elevationData.min;
      }

      // 3. Classificar POI (High, Medium, Canyon, Flat)
      const classification = await this.poiClassifier.classifyPOI(
          poiData,
          height,
          { center: elevationData.center },
          boundary.area,
          context || {} as GeographicContext,
          boundary.osmTags
      );

      return {
          ...boundary,
          elevation: elevationData,
          height,
          classification,
          // TODO: Preencher surroundingHeight e address se necessário
      };
  }
}
