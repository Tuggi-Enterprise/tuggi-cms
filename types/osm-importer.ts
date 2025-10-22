/**
 * OSM Importer Types
 * 
 * TypeScript definitions for OpenStreetMap data import workflow
 */

// OSM Feature from GeoJSON
export interface OSMFeature {
  type: 'Feature'
  id: string // GeoJSON feature ID (not unique alone)
  properties: {
    id: number // OSM numeric ID (not unique alone - same ID can exist for node/way/relation)
    type: 'node' | 'way' | 'relation' // OSM type
    tags: Record<string, string>
    // Parsed from tags
    name?: string
    'addr:city'?: string
    'addr:state'?: string
    'addr:country'?: string
  }
  geometry: {
    type: 'Point' | 'LineString' | 'Polygon'
    coordinates: number[] | number[][] | number[][][]
  }
}

// OSM Category (tag-based)
export interface OSMCategory {
  key: string // 'tourism', 'amenity', etc.
  value: string // 'museum', 'restaurant', etc.
  label: string
  count?: number
  icon?: React.ComponentType
  group: string // 'Tourism', 'Food & Drink', etc.
}

// Import batch tracking
export interface ImportBatch {
  id: string
  source_file: string
  file_type: 'pbf' | 'geojson'
  total_processed: number
  successful_imports: number
  skipped_duplicates: number
  failed_count: number
  created_at: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'rolled_back'
}

// POI with edit state
export interface EditableOSMPOI extends OSMFeature {
  _id: string // Local UUID for React keys
  _selected: boolean
  _edited: boolean
  _editedFields: {
    name?: string
    city?: string
    state?: string
    country?: string
    coordinates?: [number, number]
  }
}

// OSM File metadata
export interface OSMFile {
  id: string
  filename: string
  original_filename?: string
  file_path: string
  file_type: 'pbf' | 'geojson'
  file_size_bytes?: number
  source_type: 'raw' | 'processed' | 'uploaded'
  category?: string
  region?: string
  feature_count?: number
  bounding_box?: {
    north: number
    south: number
    east: number
    west: number
  }
  tags_summary?: Record<string, number>
  status: 'available' | 'processing' | 'error' | 'archived'
  error_message?: string
  created_at: string
  created_by?: string
  last_accessed_at?: string
  access_count: number
  processed_from_id?: string
  import_batches_count: number
}

// Import results
export interface ImportResults {
  imported: string[]
  skipped: string[]
  failed: Array<{ poi: string; error: string }>
  summary: {
    total: number
    imported: number
    skipped: number
    failed: number
    processing_time_ms: number
  }
}

// Duplicate detection result
export interface DuplicateMatch {
  poi_id: string
  existing_poi: {
    id: string
    name: string
    city: string
    country: string
    osm_id?: string
  }
  match_type: 'osm_id' | 'name_city' | 'coordinates'
  confidence: number
}

// Filter configuration
export interface FilterConfig {
  cities: string[]
  categories: string[]
  search_term: string
  bounding_box?: {
    north: number
    south: number
    east: number
    west: number
  }
}

// File upload progress
export interface UploadProgress {
  loaded: number
  total: number
  percentage: number
  stage: 'uploading' | 'processing' | 'analyzing' | 'complete'
}

// Map marker for OSM POI
export interface OSMMarker {
  id: string
  position: { lat: number; lng: number }
  title: string
  description: string
  color: string
  category?: string
  selected?: boolean
}

// Command palette action
export interface CommandAction {
  id: string
  label: string
  description: string
  icon: React.ComponentType
  shortcut?: string
  action: () => void
  category: 'navigation' | 'selection' | 'import' | 'export' | 'filter'
}
