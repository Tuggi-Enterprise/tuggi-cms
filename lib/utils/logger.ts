/**
 * Unified Logger - DRY Console Management
 * 
 * Single source of truth for all logging across OSM Importer
 * Eliminates 69+ duplicate console.log statements
 * 
 * @module lib/utils/logger
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

export enum LogCategory {
  FILE_LOAD = 'FILE_LOAD',
  FILTERS = 'FILTERS',
  SELECTION = 'SELECTION',
  IMPORT = 'IMPORT',
  COMPONENT = 'COMPONENT',
  EVENT = 'EVENT',
  HOOK = 'HOOK'
}

interface LogEntry {
  level: LogLevel
  category: LogCategory
  message: string
  data?: any
  timestamp: number
}

class UnifiedLogger {
  private isDevelopment = process.env.NODE_ENV === 'development'
  private logs: LogEntry[] = []

  private formatMessage(level: LogLevel, category: LogCategory, message: string, data?: any): string {
    const timestamp = new Date().toISOString()
    const emoji = this.getEmoji(level, category)
    const prefix = `${emoji} ${category}:`
    
    if (data) {
      return `${prefix} ${message} ${JSON.stringify(data)}`
    }
    return `${prefix} ${message}`
  }

  private getEmoji(level: LogLevel, category: LogCategory): string {
    const emojiMap = {
      [LogLevel.DEBUG]: '🔍',
      [LogLevel.INFO]: 'ℹ️',
      [LogLevel.WARN]: '⚠️',
      [LogLevel.ERROR]: '❌'
    }
    
    const categoryEmoji = {
      [LogCategory.FILE_LOAD]: '📁',
      [LogCategory.FILTERS]: '🔍',
      [LogCategory.SELECTION]: '✅',
      [LogCategory.IMPORT]: '📥',
      [LogCategory.COMPONENT]: '🖥️',
      [LogCategory.EVENT]: '🎯',
      [LogCategory.HOOK]: '🪝'
    }

    return `${emojiMap[level]}${categoryEmoji[category]}`
  }

  private log(level: LogLevel, category: LogCategory, message: string, data?: any): void {
    const formattedMessage = this.formatMessage(level, category, message, data)
    
    // Store log entry
    const entry: LogEntry = {
      level,
      category,
      message,
      data,
      timestamp: Date.now()
    }
    this.logs.push(entry)

    // Console output based on level
    switch (level) {
      case LogLevel.DEBUG:
        if (this.isDevelopment) {
          console.debug(formattedMessage)
        }
        break
      case LogLevel.INFO:
        console.info(formattedMessage)
        break
      case LogLevel.WARN:
        console.warn(formattedMessage)
        break
      case LogLevel.ERROR:
        console.error(formattedMessage)
        break
    }
  }

  // Public API (DRY)
  debug(category: LogCategory, message: string, data?: any): void {
    this.log(LogLevel.DEBUG, category, message, data)
  }

  info(category: LogCategory, message: string, data?: any): void {
    this.log(LogLevel.INFO, category, message, data)
  }

  warn(category: LogCategory, message: string, data?: any): void {
    this.log(LogLevel.WARN, category, message, data)
  }

  error(category: LogCategory, message: string, data?: any): void {
    this.log(LogLevel.ERROR, category, message, data)
  }

  // Specialized logging methods (DRY)
  fileLoadStart(filename: string, contentLength: number): void {
    this.info(LogCategory.FILE_LOAD, 'File load started', { filename, contentLength })
  }

  fileLoadProgress(progress: number, step: string): void {
    this.debug(LogCategory.FILE_LOAD, 'File load progress', { progress, step })
  }

  fileLoadComplete(featuresCount: number, citiesCount: number, categoriesCount: number): void {
    this.info(LogCategory.FILE_LOAD, 'File load complete', { 
      featuresCount, 
      citiesCount, 
      categoriesCount 
    })
  }

  fileLoadError(error: string): void {
    this.error(LogCategory.FILE_LOAD, 'File load failed', { error })
  }

  filtersApplied(originalCount: number, filteredCount: number): void {
    this.debug(LogCategory.FILTERS, 'Filters applied', { originalCount, filteredCount })
  }

  selectionChanged(selectionCount: number): void {
    this.debug(LogCategory.SELECTION, 'Selection changed', { selectionCount })
  }

  importStart(selectedCount: number, duplicateStrategy: string): void {
    this.info(LogCategory.IMPORT, 'Import started', { selectedCount, duplicateStrategy })
  }

  importComplete(results: any): void {
    this.info(LogCategory.IMPORT, 'Import completed', results)
  }

  importError(error: string): void {
    this.error(LogCategory.IMPORT, 'Import failed', { error })
  }

  componentRender(componentName: string, props: any): void {
    this.debug(LogCategory.COMPONENT, `${componentName} render`, props)
  }

  eventEmitted(eventType: string, payload: any): void {
    this.debug(LogCategory.EVENT, `Event emitted: ${eventType}`, payload)
  }

  hookStateUpdate(hookName: string, state: any): void {
    this.debug(LogCategory.HOOK, `${hookName} state update`, state)
  }

  // Utility methods
  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  clearLogs(): void {
    this.logs = []
  }

  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2)
  }
}

// Singleton instance (DRY)
export const logger = new UnifiedLogger()

// Convenience exports (DRY)
export const { debug, info, warn, error } = logger
export const { 
  fileLoadStart, 
  fileLoadProgress, 
  fileLoadComplete, 
  fileLoadError,
  filtersApplied,
  selectionChanged,
  importStart,
  importComplete,
  importError,
  componentRender,
  eventEmitted,
  hookStateUpdate
} = logger
