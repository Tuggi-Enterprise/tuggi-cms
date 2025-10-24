/**
 * Unified Parser Service
 * 
 * Single source of truth for file parsing:
 * - Factory pattern for parser creation
 * - Automatic file type detection
 * - Unified interface for GeoJSON and PBF
 * 
 * @module lib/services/unified-parser-service
 */

import { FileParser, FileType, FileInfo, ParseOptions, ParserFactory } from '@/types/parser-types'
import { OSMFeature } from '@/types/osm-importer'
import { GeoJSONParserService } from './geojson-parser-service'
import { PBFParserService } from './pbf-parser-service'

export class UnifiedParserService {
  private static instance: UnifiedParserService

  private constructor() {}

  static getInstance(): UnifiedParserService {
    if (!UnifiedParserService.instance) {
      UnifiedParserService.instance = new UnifiedParserService()
    }
    return UnifiedParserService.instance
  }

  /**
   * Create parser based on file type
   */
  createParser(fileType: FileType): FileParser {
    console.log('🏭 [UNIFIED] Creating parser for type:', fileType)
    
    switch (fileType) {
      case 'geojson':
        return new GeoJSONParserAdapter()
      case 'pbf':
        return new PBFParserAdapter()
      default:
        throw new Error(`Unsupported file type: ${fileType}`)
    }
  }

  /**
   * Detect file type from file
   */
  static detectFileType(file: File): FileType {
    const fileName = file.name.toLowerCase()
    
    if (fileName.endsWith('.pbf')) {
      return 'pbf'
    } else if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
      return 'geojson'
    }
    
    // Fallback: try to detect by content type
    if (file.type === 'application/octet-stream' && fileName.endsWith('.pbf')) {
      return 'pbf'
    }
    
    // Default to geojson for backward compatibility
    return 'geojson'
  }

  /**
   * Check if file type is supported
   */
  supportsFileType(fileType: FileType): boolean {
    return fileType === 'geojson' || fileType === 'pbf'
  }

  /**
   * Parse file with automatic type detection
   */
  static async parseFile(file: File, options?: ParseOptions): Promise<OSMFeature[]> {
    const service = UnifiedParserService.getInstance()
    const fileType = UnifiedParserService.detectFileType(file)
    const parser = service.createParser(fileType)
    
    console.log('🔄 [UNIFIED] Parsing file:', { 
      name: file.name, 
      type: fileType, 
      size: file.size 
    })
    
    const features: OSMFeature[] = []
    
    for await (const chunk of parser.parse(file)) {
      features.push(...chunk)
    }
    
    console.log('✅ [UNIFIED] Parsing completed for type:', fileType)
    return features
  }

  /**
   * Get file info with automatic type detection
   */
  static async getFileInfo(file: File): Promise<FileInfo> {
    const service = UnifiedParserService.getInstance()
    const fileType = UnifiedParserService.detectFileType(file)
    const parser = service.createParser(fileType)
    
    return await parser.getFileInfo(file)
  }

  /**
   * Validate file with automatic type detection
   */
  static async validateFile(file: File): Promise<boolean> {
    const service = UnifiedParserService.getInstance()
    const fileType = UnifiedParserService.detectFileType(file)
    const parser = service.createParser(fileType)
    
    return await parser.validate(file)
  }
}

/**
 * GeoJSON Parser Adapter
 * Wraps existing GeoJSONParserService to implement FileParser interface
 */
class GeoJSONParserAdapter implements FileParser {
  private parser: GeoJSONParserService

  constructor() {
    this.parser = new GeoJSONParserService()
  }

  async *parse(file: File): AsyncGenerator<OSMFeature[], void, unknown> {
    yield* this.parser.parseGeoJSON(file)
  }

  async getFileInfo(file: File): Promise<FileInfo> {
    // For GeoJSON, we can get info by parsing the file
    const text = await file.text()
    const geojson = JSON.parse(text)
    
    return {
      size: file.size,
      featureCount: geojson.features?.length || 0,
      type: 'geojson'
    }
  }

  async validate(file: File): Promise<boolean> {
    try {
      const text = await file.text()
      const geojson = JSON.parse(text)
      return geojson.type === 'FeatureCollection'
    } catch {
      return false
    }
  }
}

/**
 * PBF Parser Adapter
 * Wraps PBFParserService to implement FileParser interface
 */
class PBFParserAdapter implements FileParser {
  private parser: PBFParserService

  constructor() {
    this.parser = new PBFParserService()
  }

  async *parse(file: File): AsyncGenerator<OSMFeature[], void, unknown> {
    yield* this.parser.parsePBF(file)
  }

  async getFileInfo(file: File): Promise<FileInfo> {
    const info = await this.parser.getPBFInfo(file)
    return {
      size: info.size,
      featureCount: info.featureCount,
      bounds: info.bounds,
      tags: info.tags,
      type: 'pbf'
    }
  }

  async validate(file: File): Promise<boolean> {
    return await this.parser.validatePBF(file)
  }
}
