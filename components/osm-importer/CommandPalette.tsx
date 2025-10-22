/**
 * Command Palette Component
 * 
 * Keyboard-first interface for quick actions (⌘K)
 * 
 * @module components/osm-importer/CommandPalette
 */

'use client'

import { useState, useEffect, useMemo } from 'react'
import { 
  Search, CheckSquare, Square, Upload, Download, 
  Filter, Map, Table2, LayoutGrid, Settings,
  ArrowRight, Command
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOSMImporter } from '@/lib/hooks/use-osm-importer'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

interface Command {
  id: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  action: () => void
  keywords: string[]
  shortcut?: string
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const {
    features,
    selectedFeatures,
    availableCities,
    availableCategories,
    selectAll,
    clearSelection,
    setCityFilter,
    setCategoryFilter,
    setSearchTerm,
    loadGeoJSON,
    importSelected,
    checkDuplicates
  } = useOSMImporter()

  // Define available commands
  const commands: Command[] = useMemo(() => [
    // Selection commands
    {
      id: 'select-all',
      title: 'Select All POIs',
      description: 'Select all visible POIs',
      icon: CheckSquare,
      action: selectAll,
      keywords: ['select', 'all', 'choose'],
      shortcut: '⌘A'
    },
    {
      id: 'clear-selection',
      title: 'Clear Selection',
      description: 'Deselect all POIs',
      icon: Square,
      action: () => {
        clearSelection()
        onClose()
      },
      keywords: ['clear', 'deselect', 'none'],
      shortcut: '⌘D'
    },

    // Import/Export commands
    {
      id: 'import-selected',
      title: 'Import Selected POIs',
      description: `Import ${selectedFeatures.size} selected POIs to database`,
      icon: Upload,
      action: () => {
        importSelected()
        onClose()
      },
      keywords: ['import', 'save', 'database'],
      shortcut: '⌘I'
    },
    {
      id: 'export-selected',
      title: 'Export Selected POIs',
      description: `Export ${selectedFeatures.size} selected POIs to GeoJSON`,
      icon: Download,
      action: () => {
        // TODO: Implement export
        onClose()
      },
      keywords: ['export', 'download', 'geojson']
    },

    // Filter commands
    {
      id: 'filter-by-city',
      title: 'Filter by City',
      description: 'Show filter options for cities',
      icon: Filter,
      action: () => {
        // TODO: Open city filter
        onClose()
      },
      keywords: ['filter', 'city', 'location']
    },
    {
      id: 'filter-by-category',
      title: 'Filter by Category',
      description: 'Show filter options for categories',
      icon: Filter,
      action: () => {
        // TODO: Open category filter
        onClose()
      },
      keywords: ['filter', 'category', 'type']
    },

    // View commands
    {
      id: 'view-table',
      title: 'Table View',
      description: 'Switch to table view',
      icon: Table2,
      action: () => {
        // TODO: Switch to table view
        onClose()
      },
      keywords: ['view', 'table', 'list']
    },
    {
      id: 'view-map',
      title: 'Map View',
      description: 'Switch to map view',
      icon: Map,
      action: () => {
        // TODO: Switch to map view
        onClose()
      },
      keywords: ['view', 'map', 'geographic']
    },
    {
      id: 'view-split',
      title: 'Split View',
      description: 'Switch to split view (table + map)',
      icon: LayoutGrid,
      action: () => {
        // TODO: Switch to split view
        onClose()
      },
      keywords: ['view', 'split', 'both']
    },

    // Data commands
    {
      id: 'check-duplicates',
      title: 'Check for Duplicates',
      description: 'Check selected POIs for duplicates in database',
      icon: Search,
      action: () => {
        checkDuplicates()
        onClose()
      },
      keywords: ['duplicate', 'check', 'database']
    },

    // City-specific commands (dynamically generated)
    ...availableCities.slice(0, 5).map(city => ({
      id: `filter-city-${city}`,
      title: `Filter by ${city}`,
      description: `Show only POIs from ${city}`,
      icon: Filter,
      action: () => {
        setCityFilter([city])
        onClose()
      },
      keywords: ['filter', 'city', city.toLowerCase()]
    })),

    // Category-specific commands (dynamically generated)
    ...availableCategories.slice(0, 5).map(category => ({
      id: `filter-category-${category.key}`,
      title: `Filter by ${category.value}`,
      description: `Show only ${category.value} POIs`,
      icon: Filter,
      action: () => {
        setCategoryFilter([category.label])
        onClose()
      },
      keywords: ['filter', 'category', category.value.toLowerCase()]
    }))
  ], [
    selectedFeatures.size,
    availableCities,
    availableCategories,
    selectAll,
    clearSelection,
    setCityFilter,
    setCategoryFilter,
    importSelected,
    checkDuplicates,
    onClose
  ])

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands

    const lowercaseQuery = query.toLowerCase()
    return commands.filter(command => 
      command.title.toLowerCase().includes(lowercaseQuery) ||
      command.description.toLowerCase().includes(lowercaseQuery) ||
      command.keywords.some(keyword => keyword.includes(lowercaseQuery))
    )
  }, [commands, query])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => 
            prev < filteredCommands.length - 1 ? prev + 1 : 0
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => 
            prev > 0 ? prev - 1 : filteredCommands.length - 1
          )
          break
        case 'Enter':
          e.preventDefault()
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action()
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, filteredCommands, selectedIndex, onClose])

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Command Palette */}
      <div className="relative w-full max-w-2xl mx-4 bg-white dark:bg-gray-950 rounded-lg shadow-xl border border-gray-200 dark:border-gray-800">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Type a command or search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-lg placeholder-gray-400 focus:outline-none"
            autoFocus
          />
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Command className="w-3 h-3" />
            <span>K</span>
          </div>
        </div>

        {/* Commands List */}
        <div className="max-h-96 overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No commands found</p>
              <p className="text-sm">Try a different search term</p>
            </div>
          ) : (
            <div className="py-2">
              {filteredCommands.map((command, index) => {
                const Icon = command.icon
                const isSelected = index === selectedIndex

                return (
                  <button
                    key={command.id}
                    onClick={command.action}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-900 transition",
                      isSelected && "bg-blue-50 dark:bg-blue-900/20"
                    )}
                  >
                    <Icon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {command.title}
                        </span>
                        {command.shortcut && (
                          <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                            {command.shortcut}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                        {command.description}
                      </p>
                    </div>
                    {isSelected && (
                      <ArrowRight className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span>↑↓ Navigate</span>
              <span>↵ Select</span>
              <span>⎋ Close</span>
            </div>
            <span>{filteredCommands.length} commands</span>
          </div>
        </div>
      </div>
    </div>
  )
}
