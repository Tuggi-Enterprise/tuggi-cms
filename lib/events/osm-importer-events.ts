// Event Bus for OSM Importer - Event-Driven Architecture
export interface OSMImporterEvent {
  type: string
  payload: any
  timestamp: number
}

export interface OSMImporterEventBus {
  emit(eventType: string, payload: any): void
  on(eventType: string, callback: (payload: any) => void): () => void
  off(eventType: string, callback: (payload: any) => void): void
  once(eventType: string, callback: (payload: any) => void): void
}

class OSMImporterEventBusImpl implements OSMImporterEventBus {
  private listeners: Map<string, Set<(payload: any) => void>> = new Map()

  emit(eventType: string, payload: any): void {
    console.log(`🎯 EVENT BUS: ${eventType}`, payload)
    
    const event: OSMImporterEvent = {
      type: eventType,
      payload,
      timestamp: Date.now()
    }

    const callbacks = this.listeners.get(eventType)
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(event.payload)
        } catch (error) {
          console.error(`❌ Event callback error for ${eventType}:`, error)
        }
      })
    }
  }

  on(eventType: string, callback: (payload: any) => void): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    
    this.listeners.get(eventType)!.add(callback)
    
    // Return unsubscribe function
    return () => this.off(eventType, callback)
  }

  off(eventType: string, callback: (payload: any) => void): void {
    const callbacks = this.listeners.get(eventType)
    if (callbacks) {
      callbacks.delete(callback)
      if (callbacks.size === 0) {
        this.listeners.delete(eventType)
      }
    }
  }

  once(eventType: string, callback: (payload: any) => void): void {
    const onceCallback = (payload: any) => {
      callback(payload)
      this.off(eventType, onceCallback)
    }
    this.on(eventType, onceCallback)
  }
}

// Singleton Event Bus
export const osmImporterEventBus = new OSMImporterEventBusImpl()

// Event Types
export const OSM_IMPORTER_EVENTS = {
  // File operations
  FILE_LOAD_START: 'FILE_LOAD_START',
  FILE_LOAD_PROGRESS: 'FILE_LOAD_PROGRESS',
  FILE_LOAD_COMPLETE: 'FILE_LOAD_COMPLETE',
  FILE_LOAD_ERROR: 'FILE_LOAD_ERROR',
  
  // Data operations
  FEATURES_UPDATED: 'FEATURES_UPDATED',
  FILTERS_APPLIED: 'FILTERS_APPLIED',
  SELECTION_CHANGED: 'SELECTION_CHANGED',
  
  // Import operations
  IMPORT_START: 'IMPORT_START',
  IMPORT_PROGRESS: 'IMPORT_PROGRESS',
  IMPORT_COMPLETE: 'IMPORT_COMPLETE',
  IMPORT_ERROR: 'IMPORT_ERROR',
  
  // UI operations
  VIEW_MODE_CHANGED: 'VIEW_MODE_CHANGED',
  MODAL_OPENED: 'MODAL_OPENED',
  MODAL_CLOSED: 'MODAL_CLOSED'
} as const

// Event Payload Types
export interface FileLoadStartPayload {
  filename: string
  contentLength: number
}

export interface FileLoadProgressPayload {
  progress: number
  step: string
}

export interface FileLoadCompletePayload {
  features: any[]
  cities: string[]
  categories: any[]
  file: {
    name: string
    size: number
    type: string
  }
}

export interface FileLoadErrorPayload {
  error: string
}

export interface FeaturesUpdatedPayload {
  features: any[]
  filteredFeatures: any[]
}

export interface FiltersAppliedPayload {
  filteredFeatures: any[]
  cityFilter: string[]
  categoryFilter: string[]
  searchTerm: string
}

export interface SelectionChangedPayload {
  selectedFeatures: Set<string>
  selectionCount: number
}

export interface ImportStartPayload {
  selectedCount: number
  duplicateStrategy: string
}

export interface ImportProgressPayload {
  progress: number
  processed: number
  total: number
}

export interface ImportCompletePayload {
  results: any
}

export interface ImportErrorPayload {
  error: string
}

export interface ViewModeChangedPayload {
  viewMode: 'table' | 'map' | 'split'
}

export interface ModalOpenedPayload {
  poi: any
}

export interface ModalClosedPayload {
  poi: any
}
