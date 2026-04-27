/**
 * 🌍 OSM DATA FETCHER SERVICE
 * ===========================
 * 
 * Busca TODOS os dados necessários do OpenStreetMap em UMA chamada consolidada.
 * Implementa retry com backoff exponencial para resiliência contra 504/429.
 * 
 * Princípios:
 * - SSOT: Uma única fonte de dados geográficos
 * - DRY: Não repete chamadas que já foram feitas
 * - PRECISÃO > PERFORMANCE: Pode demorar, mas deve ser correto
 */

import { POIData, BoundaryData, StreetData } from '../types/interfaces';
import { 
  calculatePolygonArea, 
  calculatePolygonCenter, 
  calculateDistance 
} from '../utils/calculations';

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

export interface BuildingData {
  id: string;
  geometry: Array<{ lat: number; lng: number }>;
  height: number;
  tags?: Record<string, string>;
}

export interface OSMDataBundle {
  boundary: BoundaryData | null;
  streets: StreetData[];
  buildings: BuildingData[];
  osmTags: Record<string, string>;
  fetchedAt: Date;
  searchRadius: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// OSM DATA FETCHER
// ═══════════════════════════════════════════════════════════════════════════

export class OSMDataFetcher {
  private static MAX_RETRIES = 3;
  private static RETRY_DELAYS = [2000, 5000, 15000]; // ms - PODE ESPERAR
  private static OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
  private static QUERY_TIMEOUT = 60; // segundos - aumentado para resiliência

  /**
   * Busca TODOS os dados necessários em UMA chamada Overpass
   */
  async fetchAllRequiredData(
    poiData: POIData,
    streetSearchRadius: number = 250
  ): Promise<OSMDataBundle> {
    
    const query = this.buildConsolidatedQuery(poiData, streetSearchRadius);
    
    for (let attempt = 0; attempt < OSMDataFetcher.MAX_RETRIES; attempt++) {
      try {
        console.log(`🌍 OSM Fetch attempt ${attempt + 1}/${OSMDataFetcher.MAX_RETRIES}...`);
        const result = await this.executeQuery(query);
        const bundle = this.parseOSMResponse(result, poiData, streetSearchRadius);
        console.log(`✅ OSM Fetch successful: ${bundle.streets.length} streets, ${bundle.buildings.length} buildings`);
        return bundle;
      } catch (error) {
        console.warn(`⚠️ OSM attempt ${attempt + 1} failed: ${error}`);
        
        if (attempt < OSMDataFetcher.MAX_RETRIES - 1) {
          const delay = OSMDataFetcher.RETRY_DELAYS[attempt];
          console.log(`⏳ Waiting ${delay/1000}s before retry...`);
          await this.sleep(delay);
        }
      }
    }
    
    // Todas as tentativas falharam
    throw new Error('OSM_FETCH_FAILED: Unable to retrieve geographic data after all retries');
  }

  /**
   * Busca ruas adicionais para POIs grandes (FLAT + área > 50.000m²)
   */
  async fetchExtendedStreets(
    center: { lat: number; lng: number },
    radius: number
  ): Promise<StreetData[]> {
    const query = `
      [out:json][timeout:150];
      (
        way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified)$"]
           ["access"!~"^(no|private)$"]
           ["tunnel"!="yes"]
           (around:${radius},${center.lat},${center.lng});
      );
      out geom meta;
    `;
    
    try {
      console.log(`🛣️ Fetching extended streets (radius: ${radius}m)...`);
      const result = await this.executeQuery(query);
      const streets = this.parseStreets(result.elements || []);
      console.log(`✅ Extended streets: ${streets.length} found`);
      return streets;
    } catch (error) {
      console.warn(`⚠️ Extended streets fetch failed: ${error}`);
      return [];
    }
  }

  /**
   * Constrói query consolidada ultra-otimizada
   */
  private buildConsolidatedQuery(poiData: POIData, radius: number): string {
    const { lat, lng } = poiData.location;
    
    // Raio otimizado: Reduzido para focar na estrutura principal, mas permitindo contexto
    const optimizedRadius = Math.min(radius, 500); 
    
    // Cláusula para busca por ID
    const osmIdClause = poiData.osm_id && poiData.osm_type
      ? `${poiData.osm_type}(id:${poiData.osm_id});` 
      : '';
    
    return `
      [out:json][timeout:${OSMDataFetcher.QUERY_TIMEOUT}];
      (
        // 1. BOUNDARY CANDIDATES (Foco em polígonos com nomes e categorias relevantes)
        ${osmIdClause}
        way(around:400,${lat},${lng})["name"];
        relation(around:400,${lat},${lng})["name"];
        way(around:400,${lat},${lng})["leisure"~"^(stadium|park|sports_centre)$"];
        way(around:400,${lat},${lng})["tourism"~"^(attraction|museum)$"];
        
        // 2. RUAS ACESSÍVEIS (Raio moderado)
        way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential)$"]
           ["access"!~"^(no|private)$"]
           ["tunnel"!="yes"]
           (around:400,${lat},${lng});
        
        // 3. BUILDINGS ESSENCIAIS (Apenas raio imediato)
        way["building"](around:300,${lat},${lng});
      );
      out geom;
    `;
  }

  /**
   * Executa query no Overpass API com suporte a Mirror em caso de falha
   */
  private async executeQuery(query: string): Promise<any> {
    const servers = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter'
    ];

    let lastError: any;

    for (const server of servers) {
      try {
        const response = await fetch(server, {
          method: 'POST',
          headers: { 
            'Content-Type': 'text/plain',
            'User-Agent': 'TuggiCMS/1.0 (trigger-points-generation)'
          },
          body: `data=${encodeURIComponent(query)}`
        });

        if (response.ok) {
          return await response.json();
        }
        console.warn(`⚠️ Overpass Mirror ${server} returned status: ${response.status}`);
      } catch (error) {
        console.warn(`⚠️ Failed to connect to Overpass Mirror ${server}: ${error}`);
        lastError = error;
      }
    }

    throw lastError || new Error(`All Overpass servers failed`);
  }

  /**
   * Parseia resposta do OSM e separa em boundary, streets, buildings
   */
  private parseOSMResponse(
    result: any, 
    poiData: POIData,
    searchRadius: number
  ): OSMDataBundle {
    const elements = result.elements || [];
    
    // ═══════════════════════════════════════════════════════════════
    // 1. IDENTIFICAR BOUNDARY
    // ═══════════════════════════════════════════════════════════════
    const boundary = this.extractBoundary(elements, poiData);
    
    // ═══════════════════════════════════════════════════════════════
    // 2. EXTRAIR RUAS
    // ═══════════════════════════════════════════════════════════════
    const streetElements = elements.filter((e: any) => 
      e.tags?.highway && 
      !e.tags?.tunnel &&
      !e.tags?.access?.includes('private')
    );
    const streets = this.parseStreets(streetElements);
    
    // ═══════════════════════════════════════════════════════════════
    // 3. EXTRAIR BUILDINGS
    // ═══════════════════════════════════════════════════════════════
    const buildingElements = elements.filter((e: any) => e.tags?.building);
    const buildings = this.parseBuildings(buildingElements);
    
    // ═══════════════════════════════════════════════════════════════
    // 4. EXTRAIR OBSTRUÇÕES NATURAIS (tratar como buildings)
    // ═══════════════════════════════════════════════════════════════
    const naturalElements = elements.filter((e: any) => 
      e.tags?.natural === 'wood' || 
      e.tags?.landuse === 'forest' ||
      e.tags?.barrier === 'wall'
    );
    const naturalObstructions = this.parseNaturalObstructions(naturalElements);
    buildings.push(...naturalObstructions);

    return {
      boundary,
      streets,
      buildings,
      osmTags: boundary?.osmTags || {},
      fetchedAt: new Date(),
      searchRadius
    };
  }

  /**
   * Extrai o boundary do POI dos elementos OSM com sistema de ranking
   */
  private extractBoundary(elements: any[], poiData: POIData): BoundaryData | null {
    // 1. Prioridade Absoluta: OSM ID
    if (poiData.osm_id) {
      const byId = elements.find((e: any) => 
        String(e.id) === String(poiData.osm_id)
      );
      if (byId) return this.elementToBoundary(byId);
    }
    
    // 2. Sistema de Ranking para Candidatos (Seleção Inteligente)
    const candidates = elements.filter(e => 
      (e.type === 'way' || e.type === 'relation')
    );

    if (candidates.length === 0) return null;

    const rankedCandidates = candidates.map(e => {
      let score = 0;
      
      // Obter geometria real (trabalha com Relation ou Way)
      const geometry = this.extractElementGeometry(e);
      if (!geometry || geometry.length < 3) return { element: e, score: -1, area: 0 };

      // A. Similaridade de Nome (Até 100 pontos)
      // 🚀 MELHORIA SÊNIOR: Verificar múltiplos campos de nome (Name, Official Name, Alt Name)
      const osmName = e.tags?.name || '';
      const officialName = e.tags?.official_name || '';
      const altName = e.tags?.alt_name || '';
      const shortName = e.tags?.short_name || '';
      
      const similarity = Math.max(
        this.calculateNameSimilarity(poiData.name, osmName),
        this.calculateNameSimilarity(poiData.name, officialName),
        this.calculateNameSimilarity(poiData.name, altName),
        this.calculateNameSimilarity(poiData.name, shortName)
      );
      score += similarity * 100;

      // B. Proximidade ao Centro (Até 50 pontos)
      const center = calculatePolygonCenter(geometry.map((p: any) => ({ lat: p.lat, lng: p.lon || p.lng })));
      const distance = calculateDistance(poiData.location, center);
      const distanceScore = Math.max(0, 50 - (distance / 2)); // Degrada a cada 2m
      score += distanceScore;

      // C. Relevância da Estrutura (Até 50 pontos)
      // Se for estádio, shopping ou atração, ganha bônus
      const isStadium = e.tags?.building === 'stadium' || e.tags?.leisure === 'stadium' || e.tags?.sport === 'soccer';
      if (isStadium) score += 50; 
      else if (e.tags?.tourism === 'attraction') score += 20;
      else if (e.tags?.amenity) score += 10;
      
      // D. Penalidade por Área muito pequena (Evitar "salinhas")
      const area = calculatePolygonArea(geometry.map((p: any) => ({ lat: p.lat, lng: p.lon || p.lng })));
      if (area < 150) score -= 60; 
      else if (area > 10000) score += 30; // Grandes estruturas coerentes (estádios, parques) ganham bônus
      return { element: e, score, area };
    });

    // Ordenar por score descendente
    const bestMatch = rankedCandidates
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    
    // Threshold mínimo de confiança
    if (bestMatch && bestMatch.score > 40) {
      console.log(`🎯 Best Boundary Match: ${bestMatch.element.tags?.name || bestMatch.element.id} (Score: ${bestMatch.score.toFixed(1)})`);
      return this.elementToBoundary(bestMatch.element);
    }
    
    return null;
  }

  /**
   * Converte elemento OSM para BoundaryData
   */
  private elementToBoundary(element: any): BoundaryData | null {
    const geometry = this.extractElementGeometry(element);

    if (!geometry || geometry.length < 3) {
      return null;
    }
    
    const coordinates = geometry.map((p: any) => ({
      lat: p.lat,
      lng: p.lon
    }));
    
    // Garantir loop fechado
    if (coordinates.length > 0 && 
        (coordinates[0].lat !== coordinates[coordinates.length-1].lat || 
         coordinates[0].lng !== coordinates[coordinates.length-1].lng)) {
      coordinates.push(coordinates[0]);
    }
    
    const center = calculatePolygonCenter(coordinates);
    const area = calculatePolygonArea(coordinates);
    
    return {
      id: element.id ? String(element.id) : undefined,
      type: 'polygon',
      coordinates,
      center,
      area_m2: area,
      perimeter_m: 0,
      confidence: 0.9,
      source: 'osm',
      osmIdentified: true,
      osmTags: element.tags || {}
    };
  }

  /**
   * Parseia elementos de rua para StreetData
   */
  private parseStreets(elements: any[]): StreetData[] {
    const streets: StreetData[] = [];
    
    for (const element of elements) {
      if (!element.geometry || element.geometry.length < 2) continue;
      
      const coordinates = element.geometry.map((p: any) => ({
        lat: p.lat,
        lng: p.lon
      }));
      
      streets.push({
        id: `osm_way_${element.id}`,
        name: element.tags?.name || element.tags?.ref || 'Unnamed Street',
        type: this.classifyHighway(element.tags?.highway || 'unclassified'),
        coordinates,
        accessibility: this.determineAccessibility(element.tags),
        confidence: 0.9,
        tags: {
          tunnel: element.tags?.tunnel,
          bridge: element.tags?.bridge,
          layer: element.tags?.layer,
          oneway: element.tags?.oneway,
          maxspeed: element.tags?.maxspeed,
          surface: element.tags?.surface,
          lanes: element.tags?.lanes
        }
      });
    }
    
    return streets;
  }

  /**
   * Parseia elementos de building para BuildingData
   */
  private parseBuildings(elements: any[]): BuildingData[] {
    const buildings: BuildingData[] = [];
    
    for (const element of elements) {
      const geometry = this.extractElementGeometry(element);
      if (!geometry || geometry.length < 3) continue;
      
      // 🛡️ NORMALIZAÇÃO CRÍTICA: Garantir formato {lat, lng}
      // Overpass retorna 'lon', mas a aplicação usa 'lng'.
      // Converter aqui resolve problemas em cascata no validator e analyzer.
      const normalizedGeometry = geometry.map((p: any) => ({
        lat: p.lat,
        lng: p.lng !== undefined ? p.lng : p.lon
      }));

      buildings.push({
        id: `osm_building_${element.id}`,
        geometry: normalizedGeometry,
        height: this.extractBuildingHeight(element.tags),
        tags: element.tags
      });
    }
    
    return buildings;
  }

  /**
   * Extrai geometria de um elemento (Way ou Relation)
   * Para Relations, tenta combinar todos os membros 'outer'
   */
  private extractElementGeometry(element: any): any[] | null {
    if (element.geometry) return element.geometry;
    
    if (element.type === 'relation' && element.members) {
      // 🚀 MELHORIA SÊNIOR: Combinar todos os membros 'outer'
      // Muitas vezes um estádio ou parque é composto por vários ways 'outer'
      const outerMembers = element.members.filter((m: any) => m.role === 'outer' && m.geometry);
      if (outerMembers.length === 0) return null;
      
      if (outerMembers.length === 1) return outerMembers[0].geometry;
      
      // Combinar geometrias (simplificado: concatena as coordenadas)
      // Para cálculo de área e centro, isso costuma funcionar se os membros estiverem em ordem
      const combined = [];
      for (const m of outerMembers) {
        combined.push(...m.geometry);
      }
      return combined;
    }
    
    return null;
  }

  /**
   * Parseia obstruções naturais (bosques, muros) como "buildings" virtuais
   */
  private parseNaturalObstructions(elements: any[]): BuildingData[] {
    const obstructions: BuildingData[] = [];
    
    for (const element of elements) {
      if (!element.geometry || element.geometry.length < 3) continue;
      
      const geometry = element.geometry.map((p: any) => ({
        lat: p.lat,
        lng: p.lon
      }));
      
      // Estimar altura baseado no tipo
      let height = 10; // Default
      if (element.tags?.natural === 'wood' || element.tags?.landuse === 'forest') {
        height = 15; // Árvores médias
      } else if (element.tags?.barrier === 'wall') {
        height = parseFloat(element.tags?.height) || 3;
      }
      
      obstructions.push({
        id: `osm_obstruction_${element.id}`,
        geometry,
        height,
        tags: element.tags
      });
    }
    
    return obstructions;
  }

  /**
   * Extrai altura do building a partir de tags OSM
   * DRY: Usa mesma lógica do calculations.ts
   * 
   * 🏠 ATUALIZADO: Usa constante DEFAULT_HOUSE_HEIGHT (6m) para casas/sobrados
   * Isso garante que áreas residenciais bloqueiem visão de POIs baixos.
   */
  private extractBuildingHeight(tags: any): number {
    // Importar constante de altura de casas
    const DEFAULT_HOUSE_HEIGHT = 6; // CONSTANTE FIXA: casas/sobrados = 6m
    
    if (!tags) return DEFAULT_HOUSE_HEIGHT; // Default: casa com 6m
    
    // 1. Tag height direta (dados precisos do OSM)
    if (tags.height) {
      const height = parseFloat(tags.height);
      if (!isNaN(height)) return height;
    }
    
    // 2. Níveis × 3.5m (dados precisos do OSM)
    if (tags['building:levels']) {
      const levels = parseInt(tags['building:levels']);
      if (!isNaN(levels)) return levels * 3.5;
    }
    
    // 3. Estimativa por tipo de building
    const buildingType = tags.building?.toLowerCase();
    
    // 🏙️ ESTRATÉGIA: Usar constantes configuráveis para casas
    // Em centros urbanos, o erro deve ser para CIMA (bloquear visão conservadoramente)
    const estimates: Record<string, number> = {
      // 🏠 CASAS/RESIDÊNCIAS - Usam constante DEFAULT_HOUSE_HEIGHT
      'house': DEFAULT_HOUSE_HEIGHT,        // Casa/sobrado = 6m (constante)
      'detached': DEFAULT_HOUSE_HEIGHT,     // Casa isolada = 6m
      'semidetached_house': DEFAULT_HOUSE_HEIGHT, // Geminada = 6m
      'terrace': DEFAULT_HOUSE_HEIGHT,      // Casa em fileira = 6m
      'bungalow': 4,                        // Bangalô = 4m (mais baixo)
      
      // 🏢 PRÉDIOS RESIDENCIAIS
      'apartments': 35,  // ~12 andares
      'residential': 15, // ~5 andares (prédio, não casa)
      
      // 🏢 COMERCIAL/ESCRITÓRIOS
      'commercial': 25,
      'office': 45,      // Prédios comerciais costumam ser altos
      'retail': 10,
      
      // 🏭 INDUSTRIAL
      'industrial': 15,
      
      // 🏗️ OUTROS
      'garage': 4,       // Garagem = 4m (mais baixo que casa)
      'shed': 3,         // Galpão pequeno = 3m
      'church': 25,
      'cathedral': 45,
      'hospital': 25,
      'hotel': 40,
      'school': 15,
      'university': 25,
      'skyscraper': 120,
      'stadium': 30,     // Estádios são altos
      'grandstand': 20,  // Arquibancadas
      
      // 🏙️ "yes" em centros urbanos = assume prédio alto
      'yes': 30  // No centrão, 'yes' geralmente é um prédio alto
    };
    
    // Se tipo conhecido, usar estimativa
    if (buildingType && estimates[buildingType] !== undefined) {
      return estimates[buildingType];
    }
    
    // 🏠 Default para buildings desconhecidos = altura de casa (6m)
    // Isso é conservador: bloqueia visão em áreas residenciais
    return DEFAULT_HOUSE_HEIGHT;
  }

  /**
   * Classifica tipo de highway
   */
  private classifyHighway(highway: string): string {
    const mapping: Record<string, string> = {
      'motorway': 'motorway',
      'motorway_link': 'motorway',
      'trunk': 'trunk',
      'trunk_link': 'trunk',
      'primary': 'primary',
      'primary_link': 'primary',
      'secondary': 'secondary',
      'secondary_link': 'secondary',
      'tertiary': 'tertiary',
      'tertiary_link': 'tertiary',
      'residential': 'residential',
      'unclassified': 'residential',
      'living_street': 'residential'
    };
    return mapping[highway] || 'residential';
  }

  /**
   * Determina acessibilidade da rua
   */
  private determineAccessibility(tags: any): 'public' | 'restricted' | 'private' {
    if (!tags) return 'public';
    if (tags.access === 'private') return 'private';
    if (tags.access === 'no') return 'private';
    if (tags.access === 'restricted') return 'restricted';
    return 'public';
  }

  /**
   * Estima área de um polígono (para ordenação)
   */
  private estimateArea(geometry: any[]): number {
    if (!geometry || geometry.length < 3) return 0;
    const coords = geometry.map((p: any) => ({ lat: p.lat, lng: p.lon }));
    return calculatePolygonArea(coords);
  }

  /**
   * Gera variações do nome para busca mais resiliente
   */
  private generateNameVariations(name: string): string[] {
    const variations: string[] = [name];
    
    // Remover parênteses
    const withoutParens = name.replace(/\s*\([^)]*\)\s*/g, '').trim();
    if (withoutParens !== name) variations.push(withoutParens);
    
    // Remover prefixos comuns
    const withoutPrefix = name.replace(/^(Estádio|Arena|Parque|Museu|Igreja|Teatro)\s+/i, '').trim();
    if (withoutPrefix !== name) variations.push(withoutPrefix);
    
    // Primeiras palavras
    const words = name.split(' ');
    if (words.length > 1) {
      variations.push(words.slice(0, 2).join(' '));
    }

    return [...new Set(variations)].filter(v => v.length > 3);
  }

  /**
   * Calcula similaridade entre dois nomes
   */
  private calculateNameSimilarity(s1: string, s2: string): number {
    const n1 = s1.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const n2 = s2.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    if (n1 === n2) return 1.0;
    if (n1.includes(n2) || n2.includes(n1)) return 0.8;
    
    // Jaro-Winkler ou similaridade simples de palavras
    const words1 = new Set(n1.split(/\s+/));
    const words2 = new Set(n2.split(/\s+/));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    
    return intersection.size / Math.max(words1.size, words2.size);
  }

  /**
   * Sanitiza nome para uso em regex OSM
   */
  private sanitizeName(name: string): string {
    return name
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escapar caracteres especiais de regex
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
