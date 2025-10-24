/**
 * PBF Parser Service
 * 
 * Handles PBF file parsing and metadata extraction:
 * - Parse PBF files with streaming support
 * - Extract OSM features from binary format
 * - Convert to unified OSMFeature format
 * 
 * @module lib/services/pbf-parser-service
 */

import { OSMFeature } from '@/types/osm-importer'

export interface PBFParseOptions {
  chunkSize?: number
  onProgress?: (progress: number) => void
  onChunk?: (chunk: OSMFeature[]) => void
  onComplete?: (totalFeatures: number) => void
  onError?: (error: Error) => void
}

export interface PBFInfo {
  size: number
  featureCount: number
  bounds: {
    north: number
    south: number
    east: number
    west: number
  }
  tags: Record<string, number>
}

export class PBFParserService {
  private chunkSize: number
  private onProgress?: (progress: number) => void
  private onChunk?: (chunk: OSMFeature[]) => void
  private onComplete?: (totalFeatures: number) => void
  private onError?: (error: Error) => void

  constructor(options: PBFParseOptions = {}) {
    this.chunkSize = options.chunkSize || 100
    this.onProgress = options.onProgress
    this.onChunk = options.onChunk
    this.onComplete = options.onComplete
    this.onError = options.onError
  }

  /**
   * Parse PBF file with streaming approach
   * Note: This is a placeholder implementation
   * Real PBF parsing requires specialized libraries like osmium-tool or node-osmium
   */
  async *parsePBF(file: File): AsyncGenerator<OSMFeature[], void, unknown> {
    try {
      console.log('📄 [PBF] Starting PBF parsing:', { name: file.name, size: file.size })
      
      // For now, we'll use a conversion approach:
      // 1. Convert PBF to GeoJSON using osmium-tool (server-side)
      // 2. Parse the resulting GeoJSON
      // This maintains compatibility while we implement native PBF parsing
      
      const geojsonData = await this.convertPBFToGeoJSON(file)
      const features = geojsonData.features as OSMFeature[]
      
      console.log('🔍 [PBF] Converted to GeoJSON, features count:', features.length)
      
      let processedFeatures = 0
      const totalFeatures = features.length
      
      // Process features in chunks
      for (let i = 0; i < features.length; i += this.chunkSize) {
        const chunk = features.slice(i, i + this.chunkSize)
        processedFeatures += chunk.length
        
        // Report progress
        if (this.onProgress) {
          const progress = (processedFeatures / totalFeatures) * 100
          this.onProgress(progress)
        }
        
        // Yield chunk
        if (this.onChunk) {
          this.onChunk(chunk)
        }
        
        yield chunk
        
        // Allow other tasks to run
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      
      // Report completion
      if (this.onComplete) {
        this.onComplete(totalFeatures)
      }
      
      console.log('✅ [PBF] Parsing completed:', { totalFeatures })
      
    } catch (error) {
      console.error('❌ [PBF] Parsing failed:', error)
      if (this.onError) {
        this.onError(error as Error)
      }
      throw error
    }
  }

  /**
   * Convert PBF to GeoJSON using server-side processing
   * This approach uses osmium-tool for conversion
   */
  private async convertPBFToGeoJSON(file: File): Promise<any> {
    console.log('🔄 [PBF] Converting PBF to GeoJSON via server...')
    
    // Upload PBF file to server for conversion
    const formData = new FormData()
    formData.append('file', file)
    
    const response = await fetch('/api/osm-importer/convert-pbf', {
      method: 'POST',
      body: formData
    })
    
    if (!response.ok) {
      throw new Error(`PBF conversion failed: ${response.statusText}`)
    }
    
    const result = await response.json()
    
    if (!result.success) {
      throw new Error(result.error || 'PBF conversion failed')
    }
    
    console.log('✅ [PBF] Conversion completed:', { 
      features: result.geojson.features?.length || 0 
    })
    
    return result.geojson
  }

  /**
   * Get PBF file information
   */
  async getPBFInfo(file: File): Promise<PBFInfo> {
    console.log('📊 [PBF] Getting file info:', { name: file.name, size: file.size })
    
    try {
      // Use server-side osmium-tool to get file info
      const formData = new FormData()
      formData.append('file', file)
      
      const response = await fetch('/api/osm-importer/pbf-info', {
        method: 'POST',
        body: formData
      })
      
      if (!response.ok) {
        throw new Error(`PBF info failed: ${response.statusText}`)
      }
      
      const result = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to get PBF info')
      }
      
      return result.info
      
    } catch (error) {
      console.error('❌ [PBF] Failed to get file info:', error)
      throw error
    }
  }

  /**
   * Validate PBF file
   */
  async validatePBF(file: File): Promise<boolean> {
    try {
      // Check file extension
      if (!file.name.toLowerCase().endsWith('.pbf')) {
        return false
      }
      
      // Check file size (basic validation)
      if (file.size === 0) {
        return false
      }
      
      // Try to get file info (this will fail if file is invalid)
      await this.getPBFInfo(file)
      
      return true
      
    } catch (error) {
      console.error('❌ [PBF] Validation failed:', error)
      return false
    }
  }

  /**
   * Parse PBF with Web Workers for better performance
   */
  async parsePBFWithWorker(file: File): Promise<OSMFeature[]> {
    return new Promise((resolve, reject) => {
      const worker = new Worker('/workers/pbf-parser.worker.js')
      
      worker.postMessage({ file })

      worker.onmessage = (event) => {
        const { type, data, error } = event.data

        switch (type) {
          case 'progress':
            if (this.onProgress) {
              this.onProgress(data.progress)
            }
            break

          case 'chunk':
            if (this.onChunk) {
              this.onChunk(data.features)
            }
            break

          case 'complete':
            if (this.onComplete) {
              this.onComplete(data.totalFeatures)
            }
            resolve(data.features)
            worker.terminate()
            break

          case 'error':
            if (this.onError) {
              this.onError(data.error)
            }
            reject(new Error(data.error))
            worker.terminate()
            break
        }
      }

      worker.onerror = (error) => {
        if (this.onError) {
          this.onError(new Error('PBF Worker error'))
        }
        reject(new Error('PBF Worker error'))
        worker.terminate()
      }
    })
  }
}
