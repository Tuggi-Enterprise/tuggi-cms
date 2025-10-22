/**
 * Data Compression Service
 * 
 * Implements enterprise-level data compression for large GeoJSON datasets
 * Based on practices from AWS, Google Cloud, and Azure
 * 
 * @module lib/services/data-compression
 */

export interface CompressionOptions {
  algorithm: 'gzip' | 'deflate'
  level: number // 1-9 for gzip/deflate
  chunkSize?: number
}

export interface CompressionResult {
  originalSize: number
  compressedSize: number
  compressionRatio: number
  algorithm: string
  processingTime: number
}

/**
 * Compress data using Web Compression API
 */
export class DataCompressionService {
  private compressionStream: CompressionStream | null = null
  private decompressionStream: DecompressionStream | null = null

  /**
   * Compress data with specified algorithm
   */
  async compress(
    data: string | ArrayBuffer, 
    options: CompressionOptions = { algorithm: 'gzip', level: 6 }
  ): Promise<CompressionResult> {
    const startTime = performance.now()
    
    try {
      // Convert to ArrayBuffer if needed
      const inputBuffer = typeof data === 'string' 
        ? new TextEncoder().encode(data)
        : data

      // Create compression stream
      const compressionStream = new CompressionStream(options.algorithm)
      const writer = compressionStream.writable.getWriter()
      const reader = compressionStream.readable.getReader()

      // Write data to stream
      await writer.write(inputBuffer)
      await writer.close()

      // Read compressed data
      const chunks: Uint8Array[] = []
      let done = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        done = readerDone
        if (value) {
          chunks.push(value)
        }
      }

      // Combine chunks
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const compressedBuffer = new Uint8Array(totalLength)
      let offset = 0
      
      for (const chunk of chunks) {
        compressedBuffer.set(chunk, offset)
        offset += chunk.length
      }

      const endTime = performance.now()
      const originalSize = inputBuffer.byteLength
      const compressedSize = compressedBuffer.byteLength
      const compressionRatio = (1 - compressedSize / originalSize) * 100

      return {
        originalSize,
        compressedSize,
        compressionRatio,
        algorithm: options.algorithm,
        processingTime: endTime - startTime
      }
    } catch (error) {
      throw new Error(`Compression failed: ${error}`)
    }
  }

  /**
   * Decompress data
   */
  async decompress(
    compressedData: ArrayBuffer, 
    algorithm: 'gzip' | 'deflate' = 'gzip'
  ): Promise<ArrayBuffer> {
    try {
      const decompressionStream = new DecompressionStream(algorithm)
      const writer = decompressionStream.writable.getWriter()
      const reader = decompressionStream.readable.getReader()

      // Write compressed data
      await writer.write(compressedData)
      await writer.close()

      // Read decompressed data
      const chunks: Uint8Array[] = []
      let done = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        done = readerDone
        if (value) {
          chunks.push(value)
        }
      }

      // Combine chunks
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const decompressedBuffer = new Uint8Array(totalLength)
      let offset = 0
      
      for (const chunk of chunks) {
        decompressedBuffer.set(chunk, offset)
        offset += chunk.length
      }

      return decompressedBuffer.buffer
    } catch (error) {
      throw new Error(`Decompression failed: ${error}`)
    }
  }

  /**
   * Compress GeoJSON with optimization
   */
  async compressGeoJSON(
    geoJSON: any, 
    options: CompressionOptions = { algorithm: 'gzip', level: 9 }
  ): Promise<CompressionResult> {
    // Optimize GeoJSON structure before compression
    const optimized = this.optimizeGeoJSONStructure(geoJSON)
    const jsonString = JSON.stringify(optimized)
    
    return this.compress(jsonString, options)
  }

  /**
   * Optimize GeoJSON structure for better compression
   */
  private optimizeGeoJSONStructure(geoJSON: any): any {
    if (!geoJSON.features) return geoJSON

    // Extract common properties to reduce redundancy
    const commonProperties = this.extractCommonProperties(geoJSON.features)
    
    return {
      type: geoJSON.type,
      crs: geoJSON.crs,
      commonProperties,
      features: geoJSON.features.map((feature: any) => ({
        type: feature.type,
        geometry: feature.geometry,
        properties: this.optimizeFeatureProperties(feature.properties, commonProperties)
      }))
    }
  }

  /**
   * Extract common properties across features
   */
  private extractCommonProperties(features: any[]): Record<string, any> {
    if (features.length === 0) return {}

    const firstFeature = features[0]
    const commonProperties: Record<string, any> = {}
    
    // Find properties that are the same across all features
    for (const key in firstFeature.properties) {
      const value = firstFeature.properties[key]
      const isCommon = features.every(f => 
        f.properties[key] === value
      )
      
      if (isCommon) {
        commonProperties[key] = value
      }
    }
    
    return commonProperties
  }

  /**
   * Optimize feature properties by removing common ones
   */
  private optimizeFeatureProperties(
    properties: Record<string, any>, 
    commonProperties: Record<string, any>
  ): Record<string, any> {
    const optimized: Record<string, any> = {}
    
    for (const key in properties) {
      if (!(key in commonProperties)) {
        optimized[key] = properties[key]
      }
    }
    
    return optimized
  }

  /**
   * Estimate compression ratio for data
   */
  estimateCompressionRatio(data: string | ArrayBuffer): number {
    // Simple heuristic based on data characteristics
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
    
    // JSON data typically compresses well
    if (text.includes('{') && text.includes('}')) {
      return 0.7 // 70% compression expected
    }
    
    // GeoJSON with repeated patterns compresses very well
    if (text.includes('"type":') && text.includes('"coordinates"')) {
      return 0.8 // 80% compression expected
    }
    
    return 0.5 // 50% compression for general text
  }
}

/**
 * Create compression service instance
 */
export const createCompressionService = (): DataCompressionService => {
  return new DataCompressionService()
}
