// Interfaces para o sistema de trigger points migrado para Google APIs

export interface POIData {
  id: string;
  name: string;
  location: {
    lat: number;
    lng: number;
  };
  type: string;
  country: string;
  city: string;
  state?: string;
  osm_id?: string | number;
  osm_type?: 'node' | 'way' | 'relation';
  osm_tags?: any; // Tags OSM do POI
  geometry?: {
    viewport?: {
      northeast: { lat: number; lng: number };
      southwest: { lat: number; lng: number };
    };
    location?: { lat: number; lng: number };
  };
}

export interface GeographicContext {
  urbanDensity: {
    level: 'very_dense' | 'dense' | 'medium' | 'low' | 'rural';
    score: number;
  };
  elevationContext: {
    type: 'mountainous' | 'hilly' | 'flat';
    variance: number;
  };
  streetPattern: {
    type: 'grid' | 'organic' | 'boulevard' | 'mixed';
    confidence: number;
  };
  infrastructure: {
    transitTypes: string[];
    parkingAvailability: number;
    infrastructureDensity: number;
  };
  region: 'auto_detected';
}

// NOVO: Análise direcional
export interface DirectionalAnalysis {
  direction: string;
  angle: number;
  range: [number, number];
  streets: {
    total: number;
    withOpenSpaces: number;
    accessible: number;
  };
  openSpaces: {
    count: number;
    percentage: number;
    types: string[];
  };
  buildings: {
    count: number;
    avgHeight: number;
    maxHeight: number;
    density: number; // buildings/km²
  };
  visibility: {
    score: number; // 0-1
    hasObstructions: boolean;
    maxObstructionHeight: number;
  };
  allowTPs: boolean;
  reason: string;
}

export interface BoundaryData {
  coordinates: Array<{lat: number, lng: number}>;
  center: {lat: number, lng: number};
  area: number;
  confidence: number;
  source: 'google_places' | 'osm' | 'estimated' | 'manual' | 'manual_drawing' | 'nominatim'; // ✅ Adicionado 'manual', 'manual_drawing' e 'nominatim' para boundaries do banco
  osmIdentified?: boolean; // ✅ Flag: OSM identificou o POI? (para POIs manuais, indica se OSM encontrou dados)
  elevation?: {
    min: number;
    max: number;
    average: number;
    center: number;
    highestPoint?: { lat: number; lng: number }; // NOVO: Ponto mais alto (para picos)
  };
  height?: number; // altura do POI (ex: prédio)
  surroundingHeight?: { // NOVO: altura dos prédios vizinhos
    average: number;
    max: number;
    buildingCount: number;
    tallBuildingsCount?: number; // NOVO: contagem de prédios altos (>50m)
  };
  address?: { // NOVO: informações de endereço do POI
    street?: string;
    number?: string;
    city?: string;
    state?: string;
    country?: string;
    allStreets?: string[]; // NOVO: todas as ruas encontradas no endereço
  };
  // NOVO: Dados consolidados do OSM para evitar requests redundantes
  streets?: StreetData[]; // ruas encontradas ao redor do boundary
  buildings?: any[]; // buildings para análise de obstruções
  vegetation?: any[]; // vegetação para análise de obstruções
  barriers?: any[]; // barreiras para análise de obstruções
  peaks?: any[]; // picos/montanhas para análise de obstruções (SSLT: reutilizar dados já coletados)
  // NOVO: Classificação do POI (HIGH, MEDIUM, CANYON, FLAT)
  classification?: any; // POIClassification from poi-classifier.service
  osmTags?: any; // NOVO: tags OSM para classificação de POI
}

export interface StreetData {
  id: string;
  type: string;
  name?: string; // NOVO: nome da rua
  coordinates: Array<{lat: number, lng: number}>;
  accessibility: string;
  width?: number;
  confidence: number;
  distance?: number;
  tags?: { // NOVO: Tags OSM para validação de túneis, pontes, etc
    tunnel?: string;
    bridge?: string;
    layer?: string;
    covered?: string;
    surface?: string;
    lit?: string;
    width?: string;
    lanes?: string;
    sidewalk?: string;
    access?: string;
    oneway?: string;
    junction?: string;
    maxspeed?: string;
  };
}

export interface TriggerPointCandidate {
  location: {lat: number, lng: number};
  distance: number;
  quality: number;
  street: StreetData;
  expectedBearing: number;
  confidence: number;
  streetName?: string; // NOVO: nome da rua
  streetDirection?: { lat: number; lng: number }; // NOVO: direção da rua
  metadata?: any; // NOVO: metadados adicionais
}

export interface TriggerPoint {
  id: string;
  location: {lat: number, lng: number};
  radius: number;
  expectedBearing: number;
  bearingThreshold: number;
  type: 'primary' | 'secondary' | 'fallback';
  priority: number;
  confidence: number;
  quality: number;
  street: StreetData;
  distance: number;
  generationMethod: 'google_apis' | 'fallback';
  contextData?: GeographicContext;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProcessingResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  processingTime: number;
  metadata?: {
    step: string;
    status: string;
    timestamp: string;
    strategy?: string;
    [key: string]: any; // ✅ Permitir campos extras para flexibilidade (ex: database_boundary_found, osm_boundary_found)
  };
}

export interface TriggerPointGenerationOptions {
  maxSearchRadius?: number;
  minQuality?: number;
  maxTriggerPoints?: number; // Se não fornecido, será calculado dinamicamente baseado em área, elevação e altura do POI (10-150 TPs)
  maxConcurrent?: number;
}

export interface TriggerPointGenerationResult {
  poiId: string;
  triggerPoints: TriggerPoint[];
  count: number;
  generatedAt: string;
  processingTime: number;
  context: {
    urbanDensity: string;
    elevationContext: string;
    streetPattern: string;
    boundarySource: string;
  };
}

export interface BatchGenerationRequest {
  pois: POIData[];
  options?: TriggerPointGenerationOptions;
}

export interface BatchGenerationResult {
  totalProcessed: number;
  successful: number;
  failed: number;
  results: Array<{
    poiId: string;
    success: boolean;
    triggerPoints?: TriggerPoint[];
    error?: string;
    processingTime: number;
  }>;
  totalProcessingTime: number;
}

export interface GoogleAPIConfig {
  apiKey: string;
  timeout: number;
  retries: number;
}

export interface CacheConfig {
  ttl: {
    geographic: number;
    boundary: number;
    streets: number;
  };
}

export interface SystemConfig {
  maxSearchRadius: number;
  optimalViewingDistance: number;
  maxTriggerDistance: number;
  minTriggerQuality: number;
  minBoundaryConfidence: number;
  maxConcurrentPOIs: number;
  apiTimeouts: {
    google: number;
    osm: number;
  };
}

export interface TriggerPointPredictionResult {
  triggerPoints: TriggerPoint[];
  boundary: BoundaryData;
  context: GeographicContext;
  processingTime: number;
  metadata: {
    boundarySource: 'google_places' | 'osm' | 'estimated' | 'manual' | 'manual_drawing' | 'nominatim'; // ✅ Adicionado 'manual', 'manual_drawing' e 'nominatim' para boundaries do banco
    boundaryConfidence: number;
    streetCount: number;
    optimalPointsFound: number;
    streetValidatedCandidates?: number;
    validatedPoints: number;
    finalPoints: number;
    fallbackUsed: boolean;
    searchRadius: number;
    skipped?: boolean; // ✅ Flag: processamento foi pulado?
    skipReason?: string; // ✅ Razão do skip (ex: 'manual_boundary')
    elevationAnalysis?: {
      poiElevation: number;
      baseElevation: number;
      elevationDiff: number;
      isHighVisibility: boolean;
    } | null;
  };
}
