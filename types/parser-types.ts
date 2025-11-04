/**
 * Unified Parser Types
 * 
 * Common interfaces for GeoJSON, PBF, and CSV parsing
 * 
 * @module types/parser-types
 */

import { OSMFeature } from './osm-importer'

export type FileType = 'geojson' | 'pbf' | 'csv'

export interface FileInfo {
  size: number
  featureCount: number
  bounds?: {
    north: number
    south: number
    east: number
    west: number
  }
  tags?: Record<string, number>
  type: FileType
}

export interface ParseOptions {
  chunkSize?: number
  onProgress?: (progress: number) => void
  onChunk?: (chunk: OSMFeature[]) => void
  onComplete?: (totalFeatures: number) => void
  onError?: (error: Error) => void
}

export interface FileParser {
  parse(file: File): AsyncGenerator<OSMFeature[], void, unknown>
  getFileInfo(file: File): Promise<FileInfo>
  validate(file: File): Promise<boolean>
}

export interface ParserFactory {
  createParser(fileType: FileType): FileParser
  detectFileType(file: File): FileType
  supportsFileType(fileType: FileType): boolean
}
