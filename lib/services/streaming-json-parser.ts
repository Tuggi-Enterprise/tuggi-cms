/**
 * Streaming JSON Parser Service
 * 
 * Efficiently parses large GeoJSON files using streaming approach
 * 
 * @module lib/services/streaming-json-parser
 */

import { OSMFeature } from '@/types/osm-importer'

export interface StreamingParseOptions {
  chunkSize?: number
  onProgress?: (progress: number) => void
  onChunk?: (features: OSMFeature[]) => void
  onComplete?: (totalFeatures: number) => void
  onError?: (error: Error) => void
}

export class StreamingJSONParser {
  private chunkSize: number
  private onProgress?: (progress: number) => void
  private onChunk?: (features: OSMFeature[]) => void
  private onComplete?: (totalFeatures: number) => void
  private onError?: (error: Error) => void

  constructor(options: StreamingParseOptions = {}) {
    this.chunkSize = options.chunkSize || 1000
    this.onProgress = options.onProgress
    this.onChunk = options.onChunk
    this.onComplete = options.onComplete
    this.onError = options.onError
  }

  /**
   * Parse GeoJSON file with streaming approach
   */
  async *parseGeoJSON(file: File): AsyncGenerator<OSMFeature[], void, unknown> {
    try {
      const text = await file.text()
      const geojson = JSON.parse(text)

      if (geojson.type !== 'FeatureCollection') {
        throw new Error('Invalid GeoJSON: must be FeatureCollection')
      }

      const features = geojson.features as OSMFeature[]
      const totalFeatures = features.length
      let processedFeatures = 0

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
    } catch (error) {
      if (this.onError) {
        this.onError(error as Error)
      }
      throw error
    }
  }

  /**
   * Parse GeoJSON with Web Workers for better performance
   */
  async parseGeoJSONWithWorker(file: File): Promise<OSMFeature[]> {
    return new Promise((resolve, reject) => {
      const worker = new Worker('/workers/geojson-parser.worker.js')
      
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
          this.onError(new Error('Worker error'))
        }
        reject(new Error('Worker error'))
        worker.terminate()
      }
    })
  }

  /**
   * Parse GeoJSON with IndexedDB caching
   */
  async parseGeoJSONWithCache(file: File, cacheKey: string): Promise<OSMFeature[]> {
    try {
      // Try to load from cache first
      const cached = await this.loadFromCache(cacheKey)
      if (cached) {
        if (this.onComplete) {
          this.onComplete(cached.length)
        }
        return cached
      }

      // Parse file
      const features: OSMFeature[] = []
      
      for await (const chunk of this.parseGeoJSON(file)) {
        features.push(...chunk)
      }

      // Save to cache
      await this.saveToCache(cacheKey, features)

      return features
    } catch (error) {
      if (this.onError) {
        this.onError(error as Error)
      }
      throw error
    }
  }

  /**
   * Load features from IndexedDB cache
   */
  private async loadFromCache(key: string): Promise<OSMFeature[] | null> {
    try {
      const db = await this.openDB()
      const transaction = db.transaction(['features'], 'readonly')
      const store = transaction.objectStore('features')
      return new Promise((resolve, reject) => {
        const request = store.get(key)
        request.onsuccess = () => {
          const result = request.result
          resolve(result ? result.features : null)
        }
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.warn('Failed to load from cache:', error)
      return null
    }
  }

  /**
   * Save features to IndexedDB cache
   */
  private async saveToCache(key: string, features: OSMFeature[]): Promise<void> {
    try {
      const db = await this.openDB()
      const transaction = db.transaction(['features'], 'readwrite')
      const store = transaction.objectStore('features')
      
      await new Promise((resolve, reject) => {
        const request = store.put({
          key,
          features,
          timestamp: Date.now()
        })
        request.onsuccess = () => resolve(undefined)
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.warn('Failed to save to cache:', error)
    }
  }

  /**
   * Open IndexedDB database
   */
  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('OSMImporterCache', 1)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        
        if (!db.objectStoreNames.contains('features')) {
          const store = db.createObjectStore('features', { keyPath: 'key' })
          store.createIndex('timestamp', 'timestamp')
        }
      }
    })
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    try {
      const db = await this.openDB()
      const transaction = db.transaction(['features'], 'readwrite')
      const store = transaction.objectStore('features')
      await store.clear()
    } catch (error) {
      console.warn('Failed to clear cache:', error)
    }
  }

  /**
   * Get cache size
   */
  async getCacheSize(): Promise<number> {
    try {
      const db = await this.openDB()
      const transaction = db.transaction(['features'], 'readonly')
      const store = transaction.objectStore('features')
      return new Promise((resolve, reject) => {
        const request = store.count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } catch (error) {
      console.warn('Failed to get cache size:', error)
      return 0
    }
  }
}
