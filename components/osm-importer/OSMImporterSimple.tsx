/**
 * OSM Importer Simple Component - KISS SIMPLIFIED
 * 
 * Main component with all functionality in one place
 * 
 * @module components/osm-importer/OSMImporterSimple
 */

'use client'

import { useState, useEffect } from 'react'
import { Table2, Map, Download, Upload, CheckSquare, Square, Trash2, Database, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOSMImporterSimple } from '@/lib/hooks/use-osm-importer-simple'
import { FileUpload } from './FileUpload'
import { POITable } from './POITable'
import { POIMap } from './POIMap'

export function OSMImporterSimple() {
  console.log('🏗️ [COMPONENT] OSMImporterSimple rendering')
  const [viewMode, setViewMode] = useState<'table' | 'map'>('table')
  
  const {
    features,
    selectedFeatures,
    selectedPOIs,
    availableCities,
    availableCategories,
    isLoading,
    error,
    currentFile,
    importResults,
    localDBStats,
    dbPagination,
    loadFile,
    toggleSelection,
    selectAll,
    clearSelection,
    importSelected,
    clearData,
    refreshLocalStats,
    loadDBFeatures,
    loadDBCities,
    loadDBCategories
  } = useOSMImporterSimple()

  // Load local DB stats on component mount
  useEffect(() => {
    refreshLocalStats()
  }, [refreshLocalStats])

  // All data comes from local database
  const currentFeatures = features
  const currentFeaturesCount = dbPagination.total

  console.log('📊 [COMPONENT] Current state:', {
    featuresCount: currentFeaturesCount,
    selectedCount: selectedFeatures.size,
    isLoading,
    hasError: !!error,
    currentFile: currentFile?.name,
    dbFeaturesCount: features.length
  })

  const handleSelectAll = () => {
    if (selectedFeatures.size === currentFeaturesCount) {
      clearSelection()
    } else {
      selectAll()
    }
  }

  const handleImport = async () => {
    await importSelected()
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              OSM Importer
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Import and manage OpenStreetMap POIs
            </p>
          </div>
          
          <div className="flex items-center space-x-4">
            {currentFile && (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {currentFeaturesCount} POIs loaded
              </div>
            )}
            
            {currentFeaturesCount > 0 && (
              <button
                onClick={clearData}
                className="px-4 py-2 text-sm text-red-600 hover:text-red-700 border border-red-300 rounded-lg hover:bg-red-50"
              >
                Clear Data
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* File Upload */}
        {currentFeaturesCount === 0 && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="w-full max-w-2xl">
              <FileUpload
                onFileSelect={loadFile}
                isLoading={isLoading}
                error={error}
                currentFile={currentFile}
              />
            </div>
          </div>
        )}

        {/* Data View */}
        {currentFeaturesCount > 0 && (
          <>
            {/* Toolbar */}
            <div className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  {/* View Mode Toggle */}
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setViewMode('table')}
                      className={cn(
                        "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                        viewMode === 'table'
                          ? "bg-blue-600 text-white"
                          : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                      )}
                    >
                      <Table2 className="w-4 h-4 mr-2 inline" />
                      Table
                    </button>
                    <button
                      onClick={() => setViewMode('map')}
                      className={cn(
                        "px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                        viewMode === 'map'
                          ? "bg-blue-600 text-white"
                          : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                      )}
                    >
                      <Map className="w-4 h-4 mr-2 inline" />
                      Map
                    </button>
                  </div>

                  {/* Selection Controls */}
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleSelectAll}
                      className="flex items-center space-x-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                    >
                      {selectedFeatures.size === currentFeaturesCount ? (
                        <Square className="w-4 h-4" />
                      ) : (
                        <CheckSquare className="w-4 h-4" />
                      )}
                      <span>
                        {selectedFeatures.size === currentFeaturesCount ? 'Deselect All' : 'Select All'}
                      </span>
                    </button>
                    
                    {selectedFeatures.size > 0 && (
                      <button
                        onClick={clearSelection}
                        className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                      >
                        Clear Selection
                      </button>
                    )}
                  </div>
                </div>

                {/* Local DB Stats */}
                {localDBStats && (
                  <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                    <Database className="w-4 h-4" />
                    <span>{localDBStats.features} features</span>
                    <span>•</span>
                    <span>{localDBStats.coordinates} coordinates</span>
                    <button
                      onClick={refreshLocalStats}
                      className="ml-2 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Import Button */}
                <div className="flex items-center space-x-4">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {selectedFeatures.size} selected
                  </div>
                  
                  <button
                    onClick={handleImport}
                    disabled={selectedFeatures.size === 0 || isLoading}
                    className={cn(
                      "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      selectedFeatures.size === 0 || isLoading
                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                        : "bg-green-600 text-white hover:bg-green-700"
                    )}
                  >
                    <Download className="w-4 h-4 mr-2 inline" />
                    Import to Supabase
                  </button>
                </div>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden">
              {viewMode === 'table' ? (
                <POITable
                  features={currentFeatures}
                  selectedFeatures={selectedFeatures}
                  onToggleSelection={toggleSelection}
                />
              ) : (
                <POIMap
                  features={currentFeatures}
                  selectedFeatures={selectedFeatures}
                  onToggleSelection={toggleSelection}
                />
              )}
            </div>
          </>
        )}

        {/* Import Results */}
        {importResults && (
          <div className="bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 px-6 py-4">
            <div className={cn(
              "p-4 rounded-lg",
              importResults.success 
                ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                : "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200"
            )}>
              <div className="flex items-center space-x-2">
                {importResults.success ? (
                  <CheckSquare className="w-5 h-5" />
                ) : (
                  <Trash2 className="w-5 h-5" />
                )}
                <span className="font-medium">
                  {importResults.success 
                    ? `Successfully imported ${importResults.imported} POIs`
                    : `Import failed: ${importResults.errors.join(', ')}`
                  }
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
