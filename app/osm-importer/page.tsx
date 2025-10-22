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
  FileX, HelpCircle, Settings, User, Command
} from 'lucide-react'
import { useOSMImporter } from '@/lib/hooks/use-osm-importer'
import { FileBrowserPanel } from '@/components/osm-importer/FileBrowserPanel'
import { WorkspaceArea } from '@/components/osm-importer/WorkspaceArea'
import { CommandPalette } from '@/components/osm-importer/CommandPalette'
import { BottomActionBar } from '@/components/osm-importer/BottomActionBar'
import { ImportResults } from '@/components/osm-importer/ImportResults'
import { OSMPOIModal } from '@/components/osm-importer/OSMPOIModal'

export default function OSMImporterPage() {
  // UI State
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [selectedPOI, setSelectedPOI] = useState<any>(null)
  const [showImportResults, setShowImportResults] = useState(false)

  // OSM Importer Hook
  const {
    features,
    selectedFeatures,
    availableCities,
    availableCategories,
    currentFile,
    isLoading,
    loadingProgress,
    isImporting,
    importProgress,
    error,
    importResults,
    duplicates,
    
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
  } = useOSMImporter()

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
    editPOI(poi._id, 'name', poi._editedFields.name)
    editPOI(poi._id, 'city', poi._editedFields.city)
    editPOI(poi._id, 'state', poi._editedFields.state)
    editPOI(poi._id, 'country', poi._editedFields.country)
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
          onFileSelect={(filename, type) => {
            // TODO: Handle file selection
            console.log('File selected:', filename, type)
          }}
        />

        {/* Main Workspace */}
        <WorkspaceArea />
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
    </div>
  )
}