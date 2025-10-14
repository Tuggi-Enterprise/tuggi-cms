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
  source: 'google_places' | 'osm' | 'estimated';
  elevation?: {
    min: number;
    max: number;
    average: number;
    center: number;
  };
  height?: number; // altura do POI (ex: prédio)
  surroundingHeight?: { // NOVO: altura dos prédios vizinhos
    average: number;
    max: number;
    buildingCount: number;
  };
  address?: { // NOVO: informações de endereço do POI
    street?: string;
    number?: string;
    city?: string;
    state?: string;
    country?: string;
  };
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
  generationMethod: 'google_apis';
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
    boundarySource: 'google_places' | 'osm' | 'estimated';
    boundaryConfidence: number;
    streetCount: number;
    optimalPointsFound: number;
    validatedPoints: number;
    finalPoints: number;
    fallbackUsed: boolean;
    searchRadius: number;
    elevationAnalysis?: {
      poiElevation: number;
      baseElevation: number;
      elevationDiff: number;
      isHighVisibility: boolean;
    } | null;
  };
}
