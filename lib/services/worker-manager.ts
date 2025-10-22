/**
 * Worker Manager Service
 * 
 * Manages Web Workers for heavy data processing tasks
 * Based on enterprise practices from Google, Facebook, and Netflix
 * 
 * @module lib/services/worker-manager
 */

export interface WorkerTask {
  id: string
  type: 'parse-geojson' | 'filter-data' | 'spatial-query' | 'compress-data'
  data: any
  priority: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: any
  error?: string
  startTime?: number
  endTime?: number
}

export interface WorkerPoolOptions {
  maxWorkers: number
  taskTimeout: number
  retryAttempts: number
  retryDelay: number
}

export class WorkerManager {
  private workers: Worker[] = []
  private taskQueue: WorkerTask[] = []
  private activeTasks: Map<string, WorkerTask> = new Map()
  private completedTasks: Map<string, WorkerTask> = new Map()
  private options: WorkerPoolOptions
  private onTaskComplete?: (taskId: string, result: any) => void
  private onTaskError?: (taskId: string, error: string) => void
  private onProgress?: (completed: number, total: number) => void

  constructor(options: Partial<WorkerPoolOptions> = {}) {
    this.options = {
      maxWorkers: navigator.hardwareConcurrency || 4,
      taskTimeout: 30000, // 30 seconds
      retryAttempts: 3,
      retryDelay: 1000,
      ...options
    }

    this.initializeWorkers()
  }

  /**
   * Initialize worker pool
   */
  private initializeWorkers(): void {
    // Check if we're in browser environment
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      console.warn('Workers not available in this environment')
      return
    }

    for (let i = 0; i < this.options.maxWorkers; i++) {
      try {
        const worker = new Worker('/workers/geojson-parser.worker.js')
        worker.onmessage = this.handleWorkerMessage.bind(this)
        worker.onerror = this.handleWorkerError.bind(this)
        this.workers.push(worker)
      } catch (error) {
        console.warn('Failed to create worker:', error)
      }
    }
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: {
    onTaskComplete?: (taskId: string, result: any) => void
    onTaskError?: (taskId: string, error: string) => void
    onProgress?: (completed: number, total: number) => void
  }): void {
    this.onTaskComplete = handlers.onTaskComplete
    this.onTaskError = handlers.onTaskError
    this.onProgress = handlers.onProgress
  }

  /**
   * Add task to queue
   */
  addTask(
    type: WorkerTask['type'], 
    data: any, 
    priority: number = 0.5
  ): string {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    const task: WorkerTask = {
      id: taskId,
      type,
      data,
      priority,
      status: 'pending'
    }

    this.taskQueue.push(task)
    this.sortQueueByPriority()
    this.processQueue()

    return taskId
  }

  /**
   * Sort task queue by priority
   */
  private sortQueueByPriority(): void {
    this.taskQueue.sort((a, b) => b.priority - a.priority)
  }

  /**
   * Process task queue
   */
  private processQueue(): void {
    while (this.taskQueue.length > 0 && this.activeTasks.size < this.workers.length) {
      const task = this.taskQueue.shift()!
      this.executeTask(task)
    }
  }

  /**
   * Execute task on available worker
   */
  private async executeTask(task: WorkerTask): Promise<void> {
    const availableWorker = this.workers.find(worker => 
      !Array.from(this.activeTasks.values()).some(t => 
        t.status === 'running' && this.getWorkerForTask(t) === worker
      )
    )

    if (!availableWorker) {
      // No available worker, put task back in queue
      this.taskQueue.unshift(task)
      return
    }

    task.status = 'running'
    task.startTime = performance.now()
    this.activeTasks.set(task.id, task)

    try {
      // Send task to worker
      availableWorker.postMessage({
        taskId: task.id,
        type: task.type,
        data: task.data
      })

      // Set timeout for task
      setTimeout(() => {
        if (this.activeTasks.has(task.id)) {
          this.handleTaskTimeout(task.id)
        }
      }, this.options.taskTimeout)

    } catch (error) {
      this.handleTaskError(task.id, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  /**
   * Get worker for task (simplified)
   */
  private getWorkerForTask(task: WorkerTask): Worker | null {
    // In a real implementation, you'd track which worker is handling which task
    return this.workers[0]
  }

  /**
   * Handle worker message
   */
  private handleWorkerMessage(event: MessageEvent): void {
    const { taskId, result, error } = event.data

    if (this.activeTasks.has(taskId)) {
      const task = this.activeTasks.get(taskId)!
      task.endTime = performance.now()
      
      if (error) {
        task.status = 'failed'
        task.error = error
        this.onTaskError?.(taskId, error)
      } else {
        task.status = 'completed'
        task.result = result
        this.onTaskComplete?.(taskId, result)
      }

      this.activeTasks.delete(taskId)
      this.completedTasks.set(taskId, task)
      this.updateProgress()
      this.processQueue()
    }
  }

  /**
   * Handle worker error
   */
  private handleWorkerError(error: ErrorEvent): void {
    console.error('Worker error:', error)
    // Handle worker errors appropriately
  }

  /**
   * Handle task timeout
   */
  private handleTaskTimeout(taskId: string): void {
    if (this.activeTasks.has(taskId)) {
      const task = this.activeTasks.get(taskId)!
      task.status = 'failed'
      task.error = 'Task timeout'
      
      this.activeTasks.delete(taskId)
      this.completedTasks.set(taskId, task)
      this.onTaskError?.(taskId, 'Task timeout')
      this.updateProgress()
      this.processQueue()
    }
  }

  /**
   * Handle task error
   */
  private handleTaskError(taskId: string, error: string): void {
    if (this.activeTasks.has(taskId)) {
      const task = this.activeTasks.get(taskId)!
      task.status = 'failed'
      task.error = error
      
      this.activeTasks.delete(taskId)
      this.completedTasks.set(taskId, task)
      this.onTaskError?.(taskId, error)
      this.updateProgress()
      this.processQueue()
    }
  }

  /**
   * Update progress
   */
  private updateProgress(): void {
    const total = this.taskQueue.length + this.activeTasks.size + this.completedTasks.size
    const completed = this.completedTasks.size
    this.onProgress?.(completed, total)
  }

  /**
   * Get task result
   */
  getTaskResult(taskId: string): any {
    const task = this.completedTasks.get(taskId)
    return task?.result
  }

  /**
   * Get task status
   */
  getTaskStatus(taskId: string): WorkerTask['status'] | null {
    const task = this.activeTasks.get(taskId) || this.completedTasks.get(taskId)
    return task?.status || null
  }

  /**
   * Get all task statuses
   */
  getAllTaskStatuses(): WorkerTask[] {
    return [
      ...this.taskQueue,
      ...Array.from(this.activeTasks.values()),
      ...Array.from(this.completedTasks.values())
    ]
  }

  /**
   * Cancel task
   */
  cancelTask(taskId: string): boolean {
    // Remove from queue
    const queueIndex = this.taskQueue.findIndex(t => t.id === taskId)
    if (queueIndex !== -1) {
      this.taskQueue.splice(queueIndex, 1)
      return true
    }

    // Mark active task as cancelled
    if (this.activeTasks.has(taskId)) {
      const task = this.activeTasks.get(taskId)!
      task.status = 'failed'
      task.error = 'Cancelled by user'
      
      this.activeTasks.delete(taskId)
      this.completedTasks.set(taskId, task)
      return true
    }

    return false
  }

  /**
   * Clear completed tasks
   */
  clearCompletedTasks(): void {
    this.completedTasks.clear()
  }

  /**
   * Get worker pool statistics
   */
  getPoolStats(): {
    totalWorkers: number
    activeTasks: number
    queuedTasks: number
    completedTasks: number
  } {
    return {
      totalWorkers: this.workers.length,
      activeTasks: this.activeTasks.size,
      queuedTasks: this.taskQueue.length,
      completedTasks: this.completedTasks.size
    }
  }

  /**
   * Terminate all workers
   */
  terminate(): void {
    this.workers.forEach(worker => worker.terminate())
    this.workers = []
    this.taskQueue = []
    this.activeTasks.clear()
    this.completedTasks.clear()
  }
}

/**
 * Create worker manager instance
 */
export const createWorkerManager = (options?: Partial<WorkerPoolOptions>): WorkerManager => {
  return new WorkerManager(options)
}
