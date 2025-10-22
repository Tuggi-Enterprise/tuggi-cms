/**
 * Bottom Action Bar Component
 * 
 * Appears when POIs are selected, provides bulk actions
 * 
 * @module components/osm-importer/BottomActionBar
 */

'use client'

import { useState } from 'react'
import { 
  CheckSquare, Upload, Download, Edit3, Trash2, 
  Copy, Search, Settings, MoreHorizontal, X,
  AlertTriangle, CheckCircle, Clock
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOSMImporter } from '@/lib/hooks/use-osm-importer'

export function BottomActionBar() {
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [showDuplicateCheck, setShowDuplicateCheck] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  const {
    selectedFeatures,
    features,
    clearSelection,
    importSelected,
    checkDuplicates,
    extractLocationFromOSMTags,
    getPrimaryCategory
  } = useOSMImporter()

  const selectedCount = selectedFeatures.size
  const selectedPOIs = features.filter(poi => selectedFeatures.has(poi._id))

  // Don't show if no selection
  if (selectedCount === 0) return null

  const handleImport = async () => {
    setIsImporting(true)
    try {
      await importSelected()
    } finally {
      setIsImporting(false)
    }
  }

  const handleDuplicateCheck = async () => {
    setShowDuplicateCheck(true)
    try {
      await checkDuplicates()
    } finally {
      setShowDuplicateCheck(false)
    }
  }

  const handleBulkEdit = () => {
    setShowBulkEdit(true)
  }

  const handleExport = () => {
    // TODO: Implement export functionality
    console.log('Export selected POIs:', selectedPOIs)
  }

  const handleDelete = () => {
    // TODO: Implement delete functionality
    console.log('Delete selected POIs:', selectedPOIs)
  }

  // Get summary stats for selected POIs
  const stats = {
    cities: new Set(selectedPOIs.map(poi => 
      extractLocationFromOSMTags(poi.properties.tags).city
    )).size,
    categories: new Set(selectedPOIs.map(poi => 
      getPrimaryCategory(poi.properties.tags)
    )).size
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 shadow-lg">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Selection Info */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-blue-600" />
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {selectedCount} selected
              </span>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
              <span>{stats.cities} cities</span>
              <span>{stats.categories} categories</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Primary Actions */}
            <button
              onClick={handleImport}
              disabled={isImporting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition"
            >
              {isImporting ? (
                <Clock className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {isImporting ? 'Importing...' : 'Import Selected'}
            </button>

            <button
              onClick={handleExport}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg flex items-center gap-2 transition"
            >
              <Download className="w-4 h-4" />
              Export
            </button>

            {/* Secondary Actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleBulkEdit}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg transition"
                title="Bulk Edit"
              >
                <Edit3 className="w-4 h-4" />
              </button>

              <button
                onClick={handleDuplicateCheck}
                disabled={showDuplicateCheck}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg transition disabled:opacity-50"
                title="Check Duplicates"
              >
                {showDuplicateCheck ? (
                  <Clock className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
              </button>

              <button
                onClick={handleDelete}
                className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 rounded-lg transition"
                title="Delete Selected"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              <button
                onClick={clearSelection}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg transition"
                title="Clear Selection"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Bulk Edit Panel */}
        {showBulkEdit && (
          <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Bulk Edit {selectedCount} POIs
              </h3>
              <button
                onClick={() => setShowBulkEdit(false)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  City
                </label>
                <input
                  type="text"
                  placeholder="Set city for all selected"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  State
                </label>
                <input
                  type="text"
                  placeholder="Set state for all selected"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Country
                </label>
                <input
                  type="text"
                  placeholder="Set country for all selected"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setShowBulkEdit(false)}
                className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  // TODO: Implement bulk edit
                  setShowBulkEdit(false)
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition"
              >
                Apply Changes
              </button>
            </div>
          </div>
        )}

        {/* Duplicate Check Results */}
        {showDuplicateCheck && (
          <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600" />
              <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                Checking for duplicates...
              </span>
            </div>
            <p className="text-xs text-yellow-700 dark:text-yellow-300">
              This may take a moment for large selections
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
