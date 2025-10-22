/**
 * Progressive Loading Service
 * 
 * Implements enterprise-level progressive loading for large datasets
 * Based on practices from MapBox, Google Maps, and Netflix
 * 
 * @module lib/services/progressive-loader
 */

export interface LoadingChunk {
  id: string
  data: any[]
  priority: number
  loaded: boolean
  error?: string
}

export interface LoadingProgress {
  totalChunks: number
  loadedChunks: number
  failedChunks: number
  progress: number
  estimatedTimeRemaining: number
}

export interface ProgressiveLoaderOptions {
  chunkSize: number
  maxConcurrentChunks: number
  priorityThreshold: number
  retryAttempts: number
  retryDelay: number
}

export class ProgressiveLoader {
  private chunks: Map<string, LoadingChunk> = new Map()
  private loadingQueue: string[] = []
  private activeLoads: Set<string> = new Set()
  private options: ProgressiveLoaderOptions
  private onProgress?: (progress: LoadingProgress) => void
  private onChunkLoaded?: (chunkId: string, data: any[]) => void
  private onError?: (chunkId: string, error: string) => void

  constructor(options: Partial<ProgressiveLoaderOptions> = {}) {
    this.options = {
      chunkSize: 1000,
      maxConcurrentChunks: 3,
      priorityThreshold: 0.5,
      retryAttempts: 3,
      retryDelay: 1000,
      ...options
    }
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: {
    onProgress?: (progress: LoadingProgress) => void
    onChunkLoaded?: (chunkId: string, data: any[]) => void
    onError?: (chunkId: string, error: string) => void
  }): void {
    this.onProgress = handlers.onProgress
    this.onChunkLoaded = handlers.onChunkLoaded
    this.onError = handlers.onError
  }

  /**
   * Load data progressively
   */
  async loadProgressive(
    data: any[], 
    priorityFunction?: (item: any, index: number) => number
  ): Promise<void> {
    // Create chunks with priorities
    const chunks = this.createChunks(data, priorityFunction)
    
    // Initialize chunks
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, chunk)
      this.loadingQueue.push(chunk.id)
    }

    // Sort queue by priority
    this.sortQueueByPriority()

    // Start loading
    await this.processQueue()
  }

  /**
   * Create chunks from data
   */
  private createChunks(
    data: any[], 
    priorityFunction?: (item: any, index: number) => number
  ): LoadingChunk[] {
    const chunks: LoadingChunk[] = []
    const chunkSize = this.options.chunkSize

    for (let i = 0; i < data.length; i += chunkSize) {
      const chunkData = data.slice(i, i + chunkSize)
      const chunkId = `chunk_${i}_${i + chunkData.length}`
      
      // Calculate priority for chunk
      let priority = 0.5 // Default priority
      if (priorityFunction) {
        const priorities = chunkData.map((item, index) => priorityFunction(item, i + index))
        priority = priorities.reduce((sum, p) => sum + p, 0) / priorities.length
      }

      chunks.push({
        id: chunkId,
        data: chunkData,
        priority,
        loaded: false
      })
    }

    return chunks
  }

  /**
   * Sort loading queue by priority
   */
  private sortQueueByPriority(): void {
    this.loadingQueue.sort((a, b) => {
      const chunkA = this.chunks.get(a)
      const chunkB = this.chunks.get(b)
      
      if (!chunkA || !chunkB) return 0
      
      return chunkB.priority - chunkA.priority
    })
  }

  /**
   * Process loading queue
   */
  private async processQueue(): Promise<void> {
    while (this.loadingQueue.length > 0 || this.activeLoads.size > 0) {
      // Start new loads if we have capacity
      while (
        this.loadingQueue.length > 0 && 
        this.activeLoads.size < this.options.maxConcurrentChunks
      ) {
        const chunkId = this.loadingQueue.shift()!
        this.loadChunk(chunkId)
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  /**
   * Load individual chunk
   */
  private async loadChunk(chunkId: string): Promise<void> {
    const chunk = this.chunks.get(chunkId)
    if (!chunk) return

    this.activeLoads.add(chunkId)

    try {
      // Simulate async loading (replace with actual loading logic)
      await this.simulateChunkLoading(chunk)
      
      chunk.loaded = true
      this.onChunkLoaded?.(chunkId, chunk.data)
      
    } catch (error) {
      chunk.error = error instanceof Error ? error.message : 'Unknown error'
      this.onError?.(chunkId, chunk.error)
    } finally {
      this.activeLoads.delete(chunkId)
      this.updateProgress()
    }
  }

  /**
   * Simulate chunk loading (replace with actual implementation)
   */
  private async simulateChunkLoading(chunk: LoadingChunk): Promise<void> {
    // Simulate network delay based on chunk size
    const delay = Math.min(chunk.data.length * 0.1, 1000)
    await new Promise(resolve => setTimeout(resolve, delay))
  }

  /**
   * Update loading progress
   */
  private updateProgress(): void {
    const totalChunks = this.chunks.size
    const loadedChunks = Array.from(this.chunks.values()).filter(c => c.loaded).length
    const failedChunks = Array.from(this.chunks.values()).filter(c => c.error).length
    const progress = totalChunks > 0 ? loadedChunks / totalChunks : 0

    // Estimate remaining time based on current progress
    const startTime = performance.now()
    const elapsed = startTime - (this as any).startTime || 0
    const estimatedTotal = elapsed / Math.max(progress, 0.01)
    const estimatedTimeRemaining = Math.max(0, estimatedTotal - elapsed)

    if (!(this as any).startTime) {
      (this as any).startTime = startTime
    }

    this.onProgress?.({
      totalChunks,
      loadedChunks,
      failedChunks,
      progress,
      estimatedTimeRemaining
    })
  }

  /**
   * Get loaded data
   */
  getLoadedData(): any[] {
    const loadedChunks = Array.from(this.chunks.values())
      .filter(c => c.loaded)
      .sort((a, b) => a.id.localeCompare(b.id))
    
    return loadedChunks.flatMap(c => c.data)
  }

  /**
   * Get loading statistics
   */
  getLoadingStats(): {
    totalChunks: number
    loadedChunks: number
    failedChunks: number
    activeLoads: number
    progress: number
  } {
    const totalChunks = this.chunks.size
    const loadedChunks = Array.from(this.chunks.values()).filter(c => c.loaded).length
    const failedChunks = Array.from(this.chunks.values()).filter(c => c.error).length
    const progress = totalChunks > 0 ? loadedChunks / totalChunks : 0

    return {
      totalChunks,
      loadedChunks,
      failedChunks,
      activeLoads: this.activeLoads.size,
      progress
    }
  }

  /**
   * Cancel loading
   */
  cancelLoading(): void {
    this.loadingQueue = []
    this.activeLoads.clear()
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.chunks.clear()
    this.loadingQueue = []
    this.activeLoads.clear()
  }
}

/**
 * Create progressive loader instance
 */
export const createProgressiveLoader = (options?: Partial<ProgressiveLoaderOptions>): ProgressiveLoader => {
  return new ProgressiveLoader(options)
}
