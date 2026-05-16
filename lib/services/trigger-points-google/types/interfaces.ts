// Interfaces para o sistema de trigger points migrado para Google APIs

export interface GeoPoint {
  lat: number;
  lng: number;
}

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
  // 🆕 Campos opcionais para OSM ID (quando disponível)
  osm_id?: string | number;
  osm_type?: 'node' | 'way' | 'relation';
  osm_tags?: any; // Tags OSM do POI
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

export interface LandmarkInfo {
  isHighVisibility: boolean;
  maxRange: number;
  elevationDiff: number;
}

export interface BoundaryData {
  id?: string | number; // ID do boundary (ex: OSM element ID)
  type: 'polygon' | 'circle' | 'rectangle';
  coordinates: GeoPoint[];
  center: {lat: number, lng: number}; // Kept from original, not in snippet but makes sense
  area_m2: number;
  perimeter_m: number;
  confidence: number;
  source: 'google_places' | 'osm' | 'estimated' | 'manual' | 'manual_drawing' | 'nominatim' | 'unified_overpass' | 'estimated_boundary' | 'osm_nominatim' | 'osm_reverse_geocoding' | 'osm_nearby_features'; // ✅ Adicionado 'manual', 'manual_drawing' e 'nominatim' para boundaries do banco
  osmIdentified?: boolean; // ✅ Flag: OSM identificou o POI? (para POIs manuais, indica se OSM encontrou dados)
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
  // NOVO: pontos de entrada OSM (entrance=main / entrance=yes) dentro do boundary.
  // Usado como bearing target prioritário em vez do centroid/closest-point.
  entrances?: Array<{ lat: number; lng: number; kind: 'main' | 'yes' | 'other' }>;
  /**
   * Visibility fan: união de polígonos (um por ponto amostrado no boundary)
   * representando onde o POI é fisicamente visível (ray-cast 2.5D). Quando
   * presente, substitui o searchRadius categórico para filtrar ruas. Opt-in
   * via options.useVisibilityMap.
   *
   * Multi-polígono porque POIs longos (pontes, parques, avenidas como POI)
   * têm sua visibilidade definida ao redor de toda a extensão, não apenas
   * do centroide.
   */
  visibilityFan?: {
    polygons: Array<Array<{ lat: number; lng: number }>>;
    samplePoints: Array<{ lat: number; lng: number }>;
    maxDistanceM: number;
    meanDistanceM: number;
    minDistanceM: number;
    coverageAreaM2: number;
    elapsedMs: number;
  };
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
  /**
   * Tipo do trigger:
   * - 'primary' / 'secondary' / 'fallback': TP arrival (point + radius + bearing)
   * - 'geofence': dispara quando o usuário entra no polígono do boundary,
   *   sem checagem de bearing. Requer `geometryGeoJson` preenchido.
   */
  type: 'primary' | 'secondary' | 'fallback' | 'geofence';
  priority: number;
  confidence: number;
  quality: number;
  street: StreetData;
  distance: number;
  generationMethod: 'local_osm' | 'overpass_fallback' | 'estimated' | 'fallback_recovery';
  contextData?: GeographicContext;
  // Para TPs do tipo 'geofence': polígono que define a área de disparo.
  // O save layer persiste isso (depois da migração que adiciona a coluna)
  // ou propaga para attractions.boundary_geometry para o app sintetizar.
  geometryGeoJson?: string;
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
  /**
   * Issue 2.1 — Aproximação simulada via OSRM.
   * Quando true, cada candidato é validado simulando rotas reais que passam
   * por ele em direção ao POI. Rejeita candidatos que disparariam com
   * direction="back" no app. Requer OSRM (env OSRM_API_URL) — desligado por
   * padrão para evitar custos/timeouts no demo público.
   */
  simulateApproach?: boolean;
  /** Issue 2.3 — Validação de corredor via OSRM (testa se rua leva ao POI). */
  validateCorridor?: boolean;
  /**
   * Visibility-driven mode. Substitui o raio de busca categórico (HIGH=5km,
   * FLAT=120m, etc.) por um polígono de visibilidade real computado via
   * ray-cast 2.5D (alturas dos prédios + SRTM). TPs ficam onde o POI é
   * fisicamente visível, independente de regra categórica.
   *
   * Performance: +1-3s por POI. Local data only (sem rate-limit).
   */
  useVisibilityMap?: boolean;
  /** Cap superior pra busca de visibilidade. Default 10km. Decisão de produto. */
  visibilityMaxHorizonM?: number;
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
    boundarySource: BoundaryData['source']; // ✅ SSOT: Usar referência direta ao tipo de source do BoundaryData
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

export interface OSMElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  nodes?: number[];
  members?: Array<{
    type: 'node' | 'way' | 'relation';
    ref: number;
    role: string;
  }>;
  geometry?: Array<{lat: number, lon: number}>;
}

export interface OverpassResponse {
  version: number;
  generator: string;
  osm3s: {
    timestamp_osm_base: string;
    copyright: string;
  };
  elements: OSMElement[];
}
