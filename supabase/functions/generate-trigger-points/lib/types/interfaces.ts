// ========================================
// TYPE DEFINITIONS AND INTERFACES
// ========================================
// Centralized type definitions for the trigger points system

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface TriggerPoint {
  lat: number;
  lng: number;
  type: 'primary' | 'secondary' | 'fallback';
  reasoning: string;
  confidence: number;
  distance_from_poi: number;
  expected_bearing: number;
  radius_meters: number;
  street_name?: string;
  highway_type?: string;
}

export interface BoundaryData {
  type: 'polygon' | 'circle';
  coordinates: GeoPoint[];
  area_m2: number;
  perimeter_m: number;
  confidence: number;
  source: string;
}

export interface LandmarkInfo {
  isHighVisibility: boolean;
  maxRange: number;
  elevationDiff: number;
}

export interface POIHeight {
  height: number;
  category: 'low' | 'medium' | 'high' | 'very_high';
  confidence: number;
}

export interface UrbanDensity {
  type: 'very_dense' | 'dense' | 'medium' | 'low' | 'rural';
  buildingCount: number;
  averageHeight: number;
}

export interface SearchStrategy {
  type: 'circular' | 'boundary_offset';
  center?: GeoPoint;
  radius?: number;
  boundary?: GeoPoint[];
  expansion?: number;
  reasoning: string;
}

export interface ProcessingMetadata {
  step: string;
  timestamp: string;
  legacy_migration: boolean;
  landmark_info?: LandmarkInfo;
  boundary_method: string;
  total_candidates: number;
  processing_time_ms: number;
}

export interface DebugReport {
  poi_info: {
    id: string | number;
    name: string;
    coordinates: GeoPoint;
    landmark_detection: LandmarkInfo;
  };
  boundary_analysis: {
    source: string;
    method_used: string;
    area_m2: number;
    perimeter_m: number;
    confidence: number;
    coordinates_count: number;
  };
  trigger_points_generation: {
    total_generated: number;
    generation_range: number;
    average_confidence: number;
    points_by_type: {
      primary: number;
      secondary: number;
      fallback: number;
    };
    distance_analysis: {
      closest_point: number;
      furthest_point: number;
      average_distance: number;
    };
  };
  processing_summary: {
    timestamp: string;
    legacy_migration: boolean;
    poi_confidence_score: number;
    database_saved: boolean;
    step: string;
  };
}

export interface TriggerPointsResponse {
  success: boolean;
  data?: {
    trigger_points: TriggerPoint[];
    boundary: BoundaryData;
    confidence: number;
    processing_metadata: ProcessingMetadata;
    debug_report?: DebugReport;
  };
  error?: string;
  processing_time?: number;
}

export interface OSMElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: Array<{
    type: string;
    ref: number;
    role: string;
  }>;
}

export interface OverpassResponse {
  version: number;
  generator: string;
  elements: OSMElement[];
}

export interface StreetData {
  id: string;
  name: string;
  highway_type: string;
  coordinates: GeoPoint[];
  distance_to_poi: number;
  confidence: number;
  tags: Record<string, string>;
}
