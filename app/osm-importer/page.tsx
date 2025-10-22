/**
 * OSM Importer Main Page
 * 
 * Full-featured OSM data management interface with modern UX
 * 
 * @module app/osm-importer/page
 */

'use client'

import { useState, useEffect } from 'react'
import { 
  FileX, HelpCircle, Settings, User, Command, RefreshCw
} from 'lucide-react'
import { useOSMImporterUnified } from '@/lib/hooks/use-osm-importer-unified'
import { FileBrowserPanel } from '@/components/osm-importer/FileBrowserPanel'
import { WorkspaceArea } from '@/components/osm-importer/WorkspaceArea'
import { CommandPalette } from '@/components/osm-importer/CommandPalette'
import { BottomActionBar } from '@/components/osm-importer/BottomActionBar'
import { ImportResults } from '@/components/osm-importer/ImportResults'
import { OSMPOIModal } from '@/components/osm-importer/OSMPOIModal'
import { LoadingOverlay } from '@/components/osm-importer/LoadingOverlay'

export default function OSMImporterPage() {
  // UI State
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [selectedPOI, setSelectedPOI] = useState<any>(null)
  const [showImportResults, setShowImportResults] = useState(false)

  // OSM Importer Hook (Unified)
  const {
    features,
    selectedFeatures,
    availableCities,
    availableCategories,
    currentFile,
    isLoading,
    loadingProgress,
    loadingStep,
    loadingDetails,
    error,
    importResults,
    
    // Actions
    loadGeoJSONFromText,
    clearData,
    toggleSelection,
    selectAll,
    clearSelection,
    editPOI,
    importSelected,
    checkDuplicates,
    extractLocationFromOSMTags,
    getPrimaryCategory
  } = useOSMImporterUnified()

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false)
        setSelectedPOI(null)
        setShowImportResults(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Show import results when available
  useEffect(() => {
    if (importResults) {
      setShowImportResults(true)
    }
  }, [importResults])

  const handlePOIClick = (poi: any) => {
    setSelectedPOI(poi)
  }

  const handlePOISave = (poi: any) => {
    editPOI(poi._id, poi._editedFields)
    setSelectedPOI(null)
  }

  const handleImportComplete = () => {
    setShowImportResults(false)
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Top Bar */}
      <header className="h-14 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <FileX className="w-6 h-6 text-blue-600" />
          <h1 className="text-lg font-semibold">OSM Data Manager</h1>
          <kbd className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 rounded border">
            ⌘K
          </kbd>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition">
            <HelpCircle className="w-5 h-5" />
          </button>
          <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition">
            <Settings className="w-5 h-5" />
          </button>
          <button className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition">
            <User className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar: File Browser */}
        <FileBrowserPanel 
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          isLoading={isLoading}
          onFileSelect={async (filename, type) => {
            console.log(`🔄 Loading file: ${filename} (${type})`)
            try {
              const response = await fetch(`/api/osm-importer/load-file?filename=${encodeURIComponent(filename)}&type=${type}`)
              
              if (response.ok) {
                const data = await response.json()
                console.log(`✅ File loaded successfully:`, data.metadata)
                await loadGeoJSONFromText(JSON.stringify(data.content), filename)
                console.log(`🎉 File processed and ready for editing`)
              } else {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
                console.error(`❌ Failed to load file:`, errorData.error || response.statusText)
                // TODO: Show error toast to user
              }
            } catch (error) {
              console.error(`💥 Error loading file:`, error)
              // TODO: Show error toast to user
            }
          }}
          onFileUpload={async (file) => {
            console.log(`🔄 Uploading file: ${file.name}`)
            // File upload would need to be implemented
            console.log('File upload not implemented yet')
          }}
        />

        {/* Main Workspace */}
        <div className="flex-1 relative">
          {isLoading && (
            <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm z-50 flex items-center justify-center">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 flex flex-col items-center gap-4">
                <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
                <div className="text-center">
                  <h3 className="font-semibold text-gray-900 dark:text-white">Loading File</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Processing {currentFile?.name || 'file'}...
                  </p>
                  {loadingProgress > 0 && (
                    <div className="mt-2 w-48 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${loadingProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <WorkspaceArea />
        </div>
      </div>

      {/* Bottom Action Bar (appears when items selected) */}
      <BottomActionBar />

      {/* Command Palette */}
      <CommandPalette 
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      {/* Import Results Modal */}
      {showImportResults && importResults && (
        <ImportResults
          results={importResults}
          onClose={handleImportComplete}
          onRetry={() => {
            // TODO: Implement retry logic
            setShowImportResults(false)
          }}
          onExport={() => {
            // TODO: Implement export logic
            setShowImportResults(false)
          }}
        />
      )}

      {/* POI Details Modal */}
      {selectedPOI && (
        <OSMPOIModal
          poi={selectedPOI}
          isOpen={!!selectedPOI}
          onClose={() => setSelectedPOI(null)}
          onSave={handlePOISave}
          extractLocationFromOSMTags={extractLocationFromOSMTags}
          getPrimaryCategory={getPrimaryCategory}
        />
      )}

      {/* Loading Overlay */}
      {console.log('🔍 LOADING OVERLAY PROPS:', { isLoading, loadingProgress, loadingStep, loadingDetails, error })}
      <LoadingOverlay
        isLoading={isLoading}
        progress={loadingProgress}
        step={loadingStep}
        details={loadingDetails}
        error={error}
      />
    </div>
  )
}