/**
 * Type definitions for OSM GeoJSON Filter Plugin
 */

export interface GeoJSONFeature {
  type: "Feature";
  geometry: {
    type: "Point" | "LineString" | "Polygon" | "MultiPoint" | "MultiLineString" | "MultiPolygon";
    coordinates: number[] | number[][] | number[][][];
  };
  properties: {
    [key: string]: any;
    name?: string;
    [key: `osm:${string}`]: any;
  };
}

export interface GeoJSONCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

export interface FilterConfig {
  name: string;
  regions: {
    states?: string[];
    cities?: string[];
  };
  excludedCategories: string[];
  includedCategories?: string[];
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export interface CategoryStats {
  category: string;
  count: number;
  sampleNames: string[];
  tags: string[];
  geographicDistribution: {
    [location: string]: number;
  };
  dataQuality: {
    withNames: number;
    withoutNames: number;
    validCoordinates: number;
    invalidCoordinates: number;
  };
}

export interface PreviewStats {
  totalFeatures: number;
  sampleFeatures: GeoJSONFeature[];
  availableTags: string[];
  dataQuality: {
    withNames: number;
    withoutNames: number;
    validCoordinates: number;
    invalidCoordinates: number;
    duplicates: number;
  };
  fileSize: number;
  processingTime: number;
}

export interface ProcessingStats {
  originalCount: number;
  filteredCount: number;
  excludedByCategory: number;
  excludedByRegion: number;
  excludedByBounds: number;
  processingTime: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export type FilterMode = "preview" | "analyze" | "filter" | "config";
export type ConfigAction = "list" | "create" | "edit" | "delete" | "show";
