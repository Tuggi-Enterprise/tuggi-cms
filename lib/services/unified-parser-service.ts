/**
 * Unified Parser Service
 * 
 * Single source of truth for file parsing:
 * - Factory pattern for parser creation
 * - Automatic file type detection
 * - Unified interface for GeoJSON, CSV files (converted from PBF using osmium-tool)
 * 
 * @module lib/services/unified-parser-service
 */

import { FileParser, FileType, FileInfo, ParseOptions, ParserFactory } from '@/types/parser-types'
import { OSMFeature } from '@/types/osm-importer'
import { GeoJSONParserService } from './geojson-parser-service'
import { CSVParserService } from './csv-parser-service'

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
      case 'csv':
        return new CSVParserAdapter()
      default:
        throw new Error(`Unsupported file type: ${fileType}`)
    }
  }

  /**
   * Detect file type from file
   */
  static detectFileType(file: File): FileType {
    const fileName = file.name.toLowerCase()
    
    if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
      return 'geojson'
    }
    
    if (fileName.endsWith('.csv')) {
      return 'csv'
    }
    
    throw new Error(`Unsupported file type: ${fileName}. Supported formats: GeoJSON (.geojson, .json) and CSV (.csv)`)
  }

  /**
   * Check if file type is supported
   */
  supportsFileType(fileType: FileType): boolean {
    return fileType === 'geojson' || fileType === 'csv'
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
 * CSV Parser Adapter
 * Wraps existing CSVParserService to implement FileParser interface
 */
class CSVParserAdapter implements FileParser {
  private parser: CSVParserService

  constructor() {
    this.parser = new CSVParserService()
  }

  async *parse(file: File): AsyncGenerator<OSMFeature[], void, unknown> {
    yield* this.parser.parseCSV(file)
  }

  async getFileInfo(file: File): Promise<FileInfo> {
    // For CSV, count lines (excluding header)
    const text = await file.text()
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0)
    const featureCount = Math.max(0, lines.length - 1) // Subtract header row
    
    return {
      size: file.size,
      featureCount,
      type: 'csv'
    }
  }

  async validate(file: File): Promise<boolean> {
    try {
      const text = await file.text()
      const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0)
      
      if (lines.length < 2) {
        return false // Need at least header + 1 data row
      }
      
      // Use the parser's parseCSVLine method (we need to access it, so create a temporary parser)
      const tempParser = new CSVParserService()
      // Access private method via reflection or use a simpler approach
      // For validation, we'll use a simple CSV line parser
      const parseLine = (line: string): string[] => {
        const result: string[] = []
        let current = ''
        let inQuotes = false
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i]
          const nextChar = line[i + 1]
          
          if (char === '"') {
            if (inQuotes && nextChar === '"') {
              current += '"'
              i++
            } else {
              inQuotes = !inQuotes
            }
          } else if (char === ',' && !inQuotes) {
            result.push(current)
            current = ''
          } else {
            current += char
          }
        }
        result.push(current)
        return result
      }
      
      // Check if header contains required columns
      const headerLine = lines[0]
      const headers = parseLine(headerLine).map(h => h.trim().toLowerCase())
      
      const hasLat = headers.some(h => h === 'latitude' || h === 'lat')
      const hasLng = headers.some(h => h === 'longitude' || h === 'lng' || h === 'lon')
      
      return hasLat && hasLng
    } catch {
      return false
    }
  }
}

